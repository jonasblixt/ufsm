// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The simulator behind the Simulator tab: the reference interpreter on a snapshot of the document, a step log for
 * the panel, the highlight for the canvas, and every step recorded as a conformance trace (tests/traces format) that
 * can be saved and replayed against the interpreter and the generated code.
 *
 * Time is virtual, as in traces: the simulator keeps the timers the machine started (and has not stopped) and fires
 * one on request by sending its event. A one-shot timer is no longer running once fired; a periodic one keeps running.
 *
 * No DOM here, so it is unit-tested with node:test.
 */
import {
  Interpreter,
  MachineError,
  defined,
  indexV1,
  behaviourOptions,
  resolveStateRef,
  timerStartCall,
  timerStopCall,
  type DocIndex,
  type Id,
  type Trace,
  type StepEvent,
  type TraceOptions,
  type TraceStep,
  type UfsmDocument,
} from "@ufsm/core";

/** What the simulator runs with: the model's options, or the session's overrides of them. */
export interface SimOptions {
  /** Signal queue capacity; emitting into a full queue is a `queue-overflow` error. */
  signalQueue: number;
  /** Microsteps per reset/event before a `livelock` error. */
  maxMicrosteps: number;
}

/** One line of the step log. */
export type LogLine =
  | { kind: "exit" | "enter"; state: Id }
  | { kind: "transition"; id: Id; internal: boolean }
  | { kind: "call" | "emit" | "signal"; name: string }
  | { kind: "timer"; start: boolean; name: string; ms: number; periodic: boolean }
  | { kind: "terminate" };

/** A timer the machine started and has not stopped (the simulator's virtual clock). */
export interface RunningTimer {
  id: Id;
  name: string;
  ms: number;
  periodic: boolean;
  /** Name of the event its expiry sends. */
  event: string;
}

export interface LogStep {
  /** 0 for the first reset, counting up. */
  n: number;
  /** The event sent, or undefined for a reset. */
  event: string | undefined;
  /** The timer whose expiry sent the event (`fire`). */
  timer?: string;
  /** Guard values that changed since the previous step (what the trace step records). */
  guards: Record<string, boolean> | undefined;
  lines: LogLine[];
  /** Action names called, in order (the trace step's `expect`). */
  calls: string[];
  error: { code: string; message: string } | undefined;
  /** Microsteps taken (0: the event did nothing). */
  fired: number;
  /** The step as a conformance trace step. */
  record: TraceStep;
}

export class Simulation {
  /** The document simulated; the simulator is out of date once the machine, declarations or options differ from it. */
  readonly doc: UfsmDocument;
  readonly index: DocIndex;
  readonly options: Readonly<SimOptions>;
  readonly steps: LogStep[] = [];
  /** Bumped on every step, for views that only redraw when something happened. */
  version = 0;
  /** Model transitions taken by the last step (fork and join legs included). */
  fired = new Set<Id>();
  private readonly interp: Interpreter;
  private readonly guards: ReadonlyMap<string, boolean>;
  /** Timers started and not stopped, by id. */
  private readonly running = new Map<Id, RunningTimer>();
  /** Guard values as of the last recorded step. */
  private recordedGuards = new Map<string, boolean>();
  private current: LogStep | undefined;

  /**
   * `guards` is read live (by guard name) whenever the machine asks; the caller owns it. `overrides` replace the
   * model's options for this run. Throws MachineError `invalid-model` when the model has errors.
   */
  constructor(doc: UfsmDocument, guards: ReadonlyMap<string, boolean>, overrides: Partial<SimOptions> = {}) {
    this.doc = doc;
    this.index = indexV1(doc);
    this.options = { ...behaviourOptions(doc), ...defined(overrides) };
    this.guards = guards;
    this.interp = new Interpreter(
      doc,
      {
        call: (name) => void this.current?.calls.push(name),
        guard: (name) => guards.get(name) ?? false,
        timerStart: (name, id, ms, periodic) => {
          const t = this.index.timers.get(id)?.timer;
          this.running.set(id, { id, name, ms, periodic, event: (t && this.index.decls.get(t.event)?.decl.name) ?? "?" });
          this.current?.calls.push(timerStartCall(name, ms, periodic));
        },
        timerStop: (name, id) => {
          this.running.delete(id);
          this.current?.calls.push(timerStopCall(name));
        },
      },
      { ...this.options, onStep: (e) => this.log(e) },
    );
  }

  get terminated(): boolean {
    return this.interp.terminated;
  }

  /** True once the document's machine, declarations or options are not the ones simulated (layout edits do not count). */
  staleFor(doc: UfsmDocument): boolean {
    return doc.machine !== this.doc.machine || doc.declarations !== this.doc.declarations || doc.options !== this.doc.options;
  }

  /** Start, or start over: the initial configuration, history and queue cleared. */
  reset(): LogStep {
    return this.step(undefined, () => this.interp.reset());
  }

  /** Send an event by name. */
  send(event: string): LogStep {
    return this.step(event, () => this.interp.process(event));
  }

  /** Timers running now (started and not stopped), in timer order. */
  timers(): RunningTimer[] {
    return this.interp.structure.timers.flatMap((t) => this.running.get(t.id) ?? []);
  }

  /**
   * A running timer expires: its event is sent like any other (that is all a trace records). A one-shot timer stops
   * running first; a periodic one goes on. Undefined when the timer is not running.
   */
  fire(timerId: Id): LogStep | undefined {
    const t = this.running.get(timerId);
    if (!t) return undefined;
    if (!t.periodic) this.running.delete(timerId);
    const step = this.send(t.event);
    step.timer = t.name;
    this.version++;
    return step;
  }

  isActive(id: Id): boolean {
    return this.interp.isActive(id);
  }

  /** Active states and final states, in document order. */
  activeIds(): Id[] {
    return this.interp.activeIds();
  }

  /** Active vertices none of whose regions has an active vertex: the innermost states (their ancestors are implied). */
  leafIds(): Id[] {
    const active = new Set(this.interp.activeIds());
    return [...active].filter((id) => {
      const v = this.index.vertices.get(id)?.vertex;
      return !(v?.kind === "state" && v.regions?.some((r) => r.states.some((x) => active.has(x.id))));
    });
  }

  /** Model transitions the event would take in its first microstep now (fork and join legs included). */
  wouldTake(event: string): Id[] {
    return this.interp.wouldTake(event).flatMap((t) => t.parts.map((p) => p.id));
  }

  /** The steps so far as a conformance trace. `active` records the innermost active states after each step. */
  trace(model: string, opts: { active?: boolean; doc?: string } = {}): Trace {
    // A trace's options override the model's: only the ones this run changed.
    const options: TraceOptions = {};
    const own = behaviourOptions(this.doc);
    if (this.options.signalQueue !== own.signalQueue) options.signalQueue = this.options.signalQueue;
    if (this.options.maxMicrosteps !== own.maxMicrosteps) options.maxMicrosteps = this.options.maxMicrosteps;
    const trace: Trace = { model, steps: this.steps.map((s) => s.record) };
    if (opts.doc) trace.doc = opts.doc;
    if (Object.keys(options).length) trace.options = options;
    if (opts.active === false) trace.steps = trace.steps.map(({ active: _, ...rest }) => rest);
    return trace;
  }

  // ------------------------------------------------------------ internals

  private step(event: string | undefined, run: () => unknown): LogStep {
    const changed = this.guardChanges();
    const s: LogStep = {
      n: this.steps.length,
      event,
      guards: changed,
      lines: [],
      calls: [],
      error: undefined,
      fired: 0,
      record: {},
    };
    this.current = s;
    this.fired = new Set();
    try {
      const n = run();
      s.fired = typeof n === "number" ? n : s.lines.some((l) => l.kind === "transition") ? 1 : 0;
    } catch (e) {
      if (!(e instanceof MachineError)) throw e;
      s.error = { code: e.code, message: e.message };
    } finally {
      this.current = undefined;
    }
    const r: TraceStep = {};
    if (changed) r.guards = changed;
    if (event === undefined) r.reset = true;
    else r.send = event;
    if (s.error) r.error = s.error.code;
    else r.expect = [...s.calls];
    const leaves = this.leafIds().map((id) => this.stateRef(id));
    if (!s.error && leaves.length) r.active = leaves;
    s.record = r;
    this.steps.push(s);
    this.version++;
    return s;
  }

  /** Guards whose value differs from the last recorded step (a trace starts with every guard false). */
  private guardChanges(): Record<string, boolean> | undefined {
    const out: Record<string, boolean> = {};
    let any = false;
    for (const g of this.doc.declarations.guards) {
      const now = this.guards.get(g.name) ?? false;
      if (now !== (this.recordedGuards.get(g.name) ?? false)) {
        out[g.name] = now;
        any = true;
      }
      this.recordedGuards.set(g.name, now);
    }
    return any ? out : undefined;
  }

  /** How a trace names a state: its name when that is unique, else its id. */
  private stateRef(id: Id): string {
    const v = this.index.vertices.get(id)?.vertex;
    return v?.name !== undefined && resolveStateRef(this.doc, v.name) === id ? v.name : id;
  }

  private log(e: StepEvent): void {
    const s = this.current;
    if (!s) return;
    switch (e.type) {
      case "exit":
      case "enter":
        s.lines.push({ kind: e.type, state: e.state });
        break;
      case "transition":
        s.lines.push({ kind: "transition", id: e.id, internal: e.internal });
        for (const p of e.parts) this.fired.add(p);
        break;
      case "call":
        s.lines.push({ kind: "call", name: e.action });
        break;
      case "emit":
        s.lines.push({ kind: "emit", name: e.signal });
        break;
      case "timer-start":
        s.lines.push({ kind: "timer", start: true, name: e.timer, ms: e.ms, periodic: e.periodic });
        break;
      case "timer-stop":
        s.lines.push({ kind: "timer", start: false, name: e.timer, ms: 0, periodic: false });
        break;
      case "event":
        if (e.signal) s.lines.push({ kind: "signal", name: e.name });
        break;
      case "terminate":
        s.lines.push({ kind: "terminate" });
        break;
      case "reset":
        break;
    }
  }
}

/**
 * `to` relative to the directory of `from` (both absolute; Windows or POSIX), with `/` separators as trace files
 * use. Paths on different Windows drives give `to` itself.
 */
export function relativePath(from: string, to: string): string {
  const windows = /^[A-Za-z]:|\\/.test(from) || /^[A-Za-z]:|\\/.test(to);
  const split = (p: string): string[] => p.split(/[\\/]+/).filter((x, i) => x !== "" || i === 0);
  const a = split(from).slice(0, -1);
  const b = split(to);
  const same = (x: string, y: string): boolean => (windows ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (a.length === 0 || b.length === 0 || !same(a[0]!, b[0]!)) return b.join("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && same(a[i]!, b[i]!)) i++;
  return [...Array<string>(a.length - i).fill(".."), ...b.slice(i)].join("/");
}
