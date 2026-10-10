// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Reference interpreter: executes a v1 model directly, following
 * docs/semantics.md. Used by the editor's simulator and as the test oracle
 * that every code generator backend is compared against.
 *
 * Not optimised; clarity first. Generated code must produce the same
 * action trace for the same inputs.
 */
import { checkV1 } from "../v1/check";
import { defined, behaviourOptions } from "../v1/options";
import type { Action, GuardTerm, Id, UfsmDocument } from "../v1/model";
import {
  buildStructure,
  conflicts,
  type CompoundTransition,
  type SemRegion,
  type SemTimer,
  type SemVertex,
  type Structure,
} from "../semantics/structure";

/** What the machine calls out to. Guards default to false. */
export interface InterpreterHost {
  call?(name: string, id: Id): void;
  guard?(name: string, id: Id): boolean;
  /** Start a timer (by name and id): one-shot, or periodic (the host re-arms it). On expiry the host sends its event. */
  timerStart?(name: string, id: Id, ms: number, periodic: boolean): void;
  /** Stop a timer; stopping one that is not running does nothing. */
  timerStop?(name: string, id: Id): void;
}

export type TraceEntry =
  | { type: "call"; action: string }
  | { type: "emit"; signal: string }
  | { type: "exit"; state: Id }
  | { type: "enter"; state: Id }
  /** `id` carries the trigger (a join's outgoing transition); `parts` are every model transition taken, fork/join legs included. */
  | { type: "transition"; id: Id; parts: Id[]; internal: boolean }
  | { type: "event"; name: string; signal: boolean }
  | { type: "timer-start"; timer: string; id: Id; ms: number; periodic: boolean }
  | { type: "timer-stop"; timer: string; id: Id }
  | { type: "reset" }
  | { type: "terminate" };

/** Overrides of the model's `options` (unset: the model's value, else its default). */
export interface InterpreterOptions {
  /** Maximum number of queued signals; emitting more throws `queue-overflow`. Default: the model's (16). */
  signalQueue?: number;
  /** Microsteps per process()/reset() call before giving up with `livelock`. Default: the model's (10000). */
  maxMicrosteps?: number;
  /** Receives every observable step, for simulators and debugging. */
  onTrace?: (entry: TraceEntry) => void;
}

export type InterpreterErrorCode = "invalid-model" | "not-started" | "unknown-event" | "queue-overflow" | "livelock" | "busy";

export class InterpreterError extends Error {
  readonly code: InterpreterErrorCode;
  constructor(code: InterpreterErrorCode, message: string) {
    super(message);
    this.name = "InterpreterError";
    this.code = code;
  }
}

/**
 * process() while an earlier reset()/process() call has not finished: it was called from inside an action or guard,
 * or the earlier call failed (an error, or an exception from the host) half-way through a microstep.
 */
export function busyError(): InterpreterError {
  return new InterpreterError("busy", BUSY_MESSAGE);
}

/** The message of a `busy` error, in the interpreter and in generated code. */
export const BUSY_MESSAGE = "reset() or process() did not finish (it failed, or this call was made from inside it); call reset()";

type TriggerSel = { kind: "event"; id: Id } | { kind: "eventless" };

export class Interpreter {
  readonly structure: Structure;
  private readonly host: InterpreterHost;
  private readonly options: Required<Pick<InterpreterOptions, "signalQueue" | "maxMicrosteps">> & InterpreterOptions;
  private readonly active = new Set<SemVertex>();
  /** Recorded history per region id: the vertices to restore. */
  private readonly history = new Map<Id, SemVertex[]>();
  private queue: Id[] = [];
  private started = false;
  private terminatedFlag = false;
  /** Set while reset()/process() runs; a call that fails leaves it set until the next reset(). */
  private busy = false;
  private steps = 0;

  constructor(doc: UfsmDocument, host: InterpreterHost = {}, options: InterpreterOptions = {}) {
    const errors = checkV1(doc).filter((d) => d.severity === "error");
    if (errors.length > 0) {
      throw new InterpreterError("invalid-model", `model has ${errors.length} error(s): ${errors.map((e) => e.message).join("; ")}`);
    }
    this.structure = buildStructure(doc);
    this.host = host;
    this.options = { ...behaviourOptions(doc), ...defined(options) };
  }

  /** True after the machine entered a terminate pseudo-state. */
  get terminated(): boolean {
    return this.terminatedFlag;
  }

  /** Active states and final states, in document order. */
  activeIds(): Id[] {
    return [...this.active].sort((a, b) => a.order - b.order).map((v) => v.id);
  }

  isActive(id: Id): boolean {
    const v = this.structure.vertices.get(id);
    return v !== undefined && this.active.has(v);
  }

  /**
   * Enter the initial configuration (the root region's default entry).
   * Calling it again restarts the machine without running exit actions,
   * and forgets history and queued signals. It also recovers from a failed
   * call (see process()).
   */
  reset(): void {
    this.busy = true;
    this.active.clear();
    this.history.clear();
    this.queue = [];
    this.started = true;
    this.terminatedFlag = false;
    this.steps = 0;
    this.trace({ type: "reset" });
    this.stopTimers(this.structure.timers);
    this.enter([], [this.structure.root]);
    this.settle();
    this.busy = false;
  }

  /**
   * Process one event (by name or id): one microstep for the event, then
   * eventless transitions and queued signals until the machine is stable.
   * Returns the number of microsteps that fired.
   *
   * Throws `busy` when called from inside an action or guard of a running
   * call, or after a call that did not finish (an error, or an exception
   * from the host): the machine may be half-way through a microstep then,
   * and only reset() starts it again.
   */
  process(event: string): number {
    if (!this.started) throw new InterpreterError("not-started", "call reset() before process()");
    const s = this.structure;
    const id = this.eventId(event);
    if (id === undefined) throw new InterpreterError("unknown-event", `unknown event '${event}'`);
    if (this.busy) throw busyError();
    if (this.terminatedFlag) return 0;
    this.busy = true;
    this.steps = 0;
    this.trace({ type: "event", name: s.index.decls.get(id)!.decl.name, signal: false });
    const fired = this.microstep(this.select({ kind: "event", id }));
    const total = fired + this.settle();
    this.busy = false;
    return total;
  }

  /**
   * The transitions an event (by name or id) would take in its first microstep, without taking them: what a
   * simulator shows before the event is sent. Eventless transitions and signals that would follow are not included.
   * Guards are asked as they would be. Empty before reset(), after terminate and for an unknown event.
   */
  wouldTake(event: string): CompoundTransition[] {
    const id = this.eventId(event);
    if (!this.started || this.terminatedFlag || id === undefined) return [];
    return this.select({ kind: "event", id });
  }

  /** The id of an event given by name or id; undefined for signals and unknown names. */
  private eventId(event: string): Id | undefined {
    const s = this.structure;
    let id = s.triggers.get(event);
    if (id === undefined && s.index.decls.get(event)?.kind === "event") id = event;
    return id !== undefined && s.index.decls.get(id)?.kind === "event" ? id : undefined;
  }

  // ------------------------------------------------------------ macrostep

  /** Eventless transitions until none is enabled, then the next queued signal; repeat. */
  private settle(): number {
    let fired = 0;
    for (;;) {
      if (this.terminatedFlag) {
        this.queue = [];
        return fired;
      }
      const eventless = this.select({ kind: "eventless" });
      if (eventless.length > 0) {
        fired += this.microstep(eventless);
        continue;
      }
      const sig = this.queue.shift();
      if (sig === undefined) return fired;
      this.trace({ type: "event", name: this.structure.index.decls.get(sig)!.decl.name, signal: true });
      fired += this.microstep(this.select({ kind: "event", id: sig }));
    }
  }

  // ------------------------------------------------------------ selection

  /**
   * Visit active states in post-order (children first, upper regions
   * first). Each offers its first enabled transition; a join is offered by
   * its last source, and only if it is the first enabled transition of every
   * source. An offer is taken unless it conflicts with one already taken.
   */
  private select(sel: TriggerSel): CompoundTransition[] {
    const chosen: CompoundTransition[] = [];
    for (const s of this.structure.postOrder) {
      if (!this.active.has(s)) continue;
      const t = this.firstEnabled(s, sel);
      if (!t || t.offeredBy !== s) continue;
      if (t.sources.length > 1 && !t.sources.every((src) => this.firstEnabled(src, sel) === t)) continue;
      if (chosen.some((c) => conflicts(c, t))) continue;
      chosen.push(t);
    }
    return chosen;
  }

  private firstEnabled(s: SemVertex, sel: TriggerSel): CompoundTransition | undefined {
    for (const t of this.structure.bySource.get(s.id) ?? []) if (this.enabledBy(t, sel)) return t;
    return undefined;
  }

  private enabledBy(t: CompoundTransition, sel: TriggerSel): boolean {
    const tr = t.trigger;
    if (sel.kind === "event") {
      if (tr.kind !== "event" || tr.id !== sel.id) return false;
    } else if (tr.kind === "auto") {
      // eventless
    } else if (tr.kind === "completion") {
      if (!t.sources.every((s) => this.isComplete(s))) return false;
    } else {
      return false;
    }
    if (!t.sources.every((s) => this.active.has(s))) return false;
    return t.guard.every((g) => this.holds(g));
  }

  /** A state is complete when every one of its regions rests in a final state (a simple state always is). */
  private isComplete(s: SemVertex): boolean {
    return s.regions.every((r) => r.vertices.some((v) => v.kind === "final" && this.active.has(v)));
  }

  private holds(g: GuardTerm): boolean {
    if ("in" in g) return this.isActive(g.in) !== (g.not === true);
    const decl = this.structure.index.decls.get(g.call)!.decl;
    return (this.host.guard?.(decl.name, decl.id) ?? false) !== (g.not === true);
  }

  private exitSet(t: CompoundTransition): Set<SemVertex> {
    if (t.internal) return new Set(); // internal transitions leave nothing
    const d = t.domain.id;
    return new Set([...this.active].filter((v) => v.within.has(d)));
  }

  // ------------------------------------------------------------ microstep

  private microstep(ts: CompoundTransition[]): number {
    if (ts.length === 0) return 0;
    if (++this.steps > this.options.maxMicrosteps) {
      throw new InterpreterError("livelock", `more than ${this.options.maxMicrosteps} microsteps without becoming stable`);
    }

    // 1. Exit, innermost and last first (reverse document order). History is recorded before anything is exited.
    const exiting = new Set<SemVertex>();
    for (const t of ts) for (const v of this.exitSet(t)) exiting.add(v);
    const exitOrder = [...exiting].sort((a, b) => b.order - a.order);
    for (const s of exitOrder) for (const r of s.regions) if (r.history) this.recordHistory(r);
    for (const s of exitOrder) {
      this.trace({ type: "exit", state: s.id });
      this.stopTimers(s.timers);
      if (s.vertex.kind === "state") this.run(s.vertex.exit);
      this.active.delete(s);
    }

    // 2. Transition actions, in selection order.
    for (const t of ts) {
      this.trace({ type: "transition", id: t.id, parts: t.parts.map((p) => p.id), internal: t.internal });
      this.run(t.actions);
    }

    // 3. Enter, outermost and first first (document order).
    this.enter(ts, []);
    return 1;
  }

  private recordHistory(r: SemRegion): void {
    const deep = r.history!.kind === "deep-history";
    const top = r.vertices.find((v) => this.active.has(v));
    if (!top || top.kind === "final") {
      this.history.delete(r.id); // a region resting in its final state keeps no history
      return;
    }
    if (!deep) {
      this.history.set(r.id, [top]);
      return;
    }
    const leaves = [...this.active].filter((v) => v.within.has(r.id) && !v.regions.some((c) => c.vertices.some((x) => this.active.has(x))));
    this.history.set(r.id, leaves.sort((a, b) => a.order - b.order));
  }

  /** Compute and execute the entry set for `ts` plus default entry of `regions`. */
  private enter(ts: CompoundTransition[], regions: SemRegion[]): void {
    const states = new Set<SemVertex>();
    /** Initial/history transition actions, run when their region is reached in document order. */
    const content = new Map<SemRegion, Action[]>();
    let terminate = false;

    const hasDescendantIn = (r: SemRegion): boolean => [...states].some((v) => v.within.has(r.id));

    const enterDefault = (r: SemRegion): void => {
      if (r.initializer) addDescendants(r.initializer);
    };

    const addDescendants = (v: SemVertex): void => {
      if (v.kind === "terminate") {
        terminate = true;
        return;
      }
      if (v.kind === "initial" || v.kind === "shallow-history" || v.kind === "deep-history") {
        const r = v.region;
        const recorded = v.kind === "initial" ? undefined : this.history.get(r.id);
        if (recorded) {
          for (const x of recorded) addDescendants(x);
          for (const x of recorded) addAncestors(x, r);
          return;
        }
        const init = this.structure.initializers.get(r.id);
        if (!init || init.pseudo !== v) return; // a second history/initial in one region is rejected by checkV1
        content.set(r, [...(content.get(r) ?? []), ...init.actions]);
        for (const x of init.targets) addDescendants(x);
        for (const x of init.targets) if (x.kind !== "terminate") addAncestors(x, r);
        return;
      }
      states.add(v);
      for (const r of v.regions) if (!hasDescendantIn(r)) enterDefault(r);
    };

    const addAncestors = (v: SemVertex, stop: SemRegion): void => {
      for (let r = v.region; r !== stop && r.owner; r = r.owner.region) {
        const p = r.owner;
        states.add(p);
        for (const pr of p.regions) if (!hasDescendantIn(pr)) enterDefault(pr);
      }
    };

    for (const t of ts) for (const x of t.targets) addDescendants(x);
    for (const t of ts) for (const x of t.targets) if (x.kind !== "terminate") addAncestors(x, t.domain);
    for (const r of regions) if (!hasDescendantIn(r)) enterDefault(r);

    const items: (SemVertex | SemRegion)[] = [...states, ...content.keys()];
    items.sort((a, b) => a.order - b.order);
    for (const item of items) {
      if ("kind" in item) {
        this.active.add(item);
        this.trace({ type: "enter", state: item.id });
        if (item.vertex.kind === "state") this.run(item.vertex.entry);
        this.startTimers(item.timers);
      } else {
        this.run(content.get(item));
      }
    }

    if (terminate) {
      this.trace({ type: "terminate" });
      this.terminatedFlag = true;
      this.active.clear();
      this.queue = [];
      this.stopTimers(this.structure.timers);
    }
  }

  // ------------------------------------------------------------ timers

  private startTimers(timers: SemTimer[]): void {
    for (const t of timers) {
      this.trace({ type: "timer-start", timer: t.name, id: t.id, ms: t.ms, periodic: t.periodic });
      this.host.timerStart?.(t.name, t.id, t.ms, t.periodic);
    }
  }

  private stopTimers(timers: SemTimer[]): void {
    for (const t of timers) {
      this.trace({ type: "timer-stop", timer: t.name, id: t.id });
      this.host.timerStop?.(t.name, t.id);
    }
  }

  // ------------------------------------------------------------ actions

  private run(actions: Action[] | undefined): void {
    for (const a of actions ?? []) {
      if ("call" in a) {
        const d = this.structure.index.decls.get(a.call)!.decl;
        this.trace({ type: "call", action: d.name });
        this.host.call?.(d.name, d.id);
      } else {
        const d = this.structure.index.decls.get(a.emit)!.decl;
        const limit = this.options.signalQueue;
        if (this.queue.length >= limit) {
          throw new InterpreterError("queue-overflow", `signal queue full (${limit}) when emitting '${d.name}'`);
        }
        this.trace({ type: "emit", signal: d.name });
        this.queue.push(d.id);
      }
    }
  }

  private trace(e: TraceEntry): void {
    this.options.onTrace?.(e);
  }
}
