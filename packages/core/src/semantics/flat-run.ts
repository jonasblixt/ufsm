// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs a FlatModel with nothing but integer arrays, the way generated code
 * will: cfg[] per region, history slots and snapshots, a signal queue.
 * It exists to prove the flat tables right (it must match the reference
 * interpreter step for step) and to document what backends emit.
 */
import type { Action, Id } from "../v1/model";
import { OPTION_DEFAULTS, defined } from "../v1/options";
import { InterpreterError, busyError, type InterpreterHost, type InterpreterOptions } from "../interp/interpreter";
import type { EntryOp, FlatGuard, FlatModel, FlatTransition, Offer, RegionOp } from "./flatten";

export class FlatRunner {
  readonly model: FlatModel;
  private readonly host: InterpreterHost;
  private readonly options: InterpreterOptions & { signalQueue: number; maxMicrosteps: number };
  /** Active slot per region; 0 = none. */
  private readonly cfg: Int32Array;
  /** Shallow history: recorded slot per region (0 = none). Deep history: snapshot of cfg for the region's subtree. */
  private readonly hist: Int32Array;
  private readonly deep = new Map<number, Int32Array>();
  private queue: number[] = [];
  private started = false;
  private terminatedFlag = false;
  /** Set while reset()/process() runs; a call that fails leaves it set until the next reset(). */
  private busy = false;
  private steps = 0;
  private readonly eventIndex = new Map<string, Id>();
  private readonly actionName = new Map<Id, string>();
  private readonly guardName = new Map<Id, string>();
  private readonly signalIds: Id[];

  constructor(model: FlatModel, host: InterpreterHost = {}, options: InterpreterOptions = {}) {
    this.model = model;
    this.host = host;
    this.options = { ...OPTION_DEFAULTS, ...defined(options) };
    this.cfg = new Int32Array(model.regions.length);
    this.hist = new Int32Array(model.regions.length);
    for (const e of model.events) {
      this.eventIndex.set(e.name, e.id);
      this.eventIndex.set(e.id, e.id);
    }
    for (const a of model.actions) this.actionName.set(a.id, a.name);
    for (const g of model.guards) this.guardName.set(g.id, g.name);
    this.signalIds = model.signals.map((x) => x.id);
  }

  get terminated(): boolean {
    return this.terminatedFlag;
  }

  /** Active vertex ids in document order. */
  activeIds(): Id[] {
    return this.model.vertices.filter((_, i) => this.isActiveIndex(i)).map((v) => v.id);
  }

  isActive(id: Id): boolean {
    const i = this.model.vertices.findIndex((v) => v.id === id);
    return i >= 0 && this.isActiveIndex(i);
  }

  private isActiveIndex(v: number): boolean {
    const fv = this.model.vertices[v]!;
    return this.cfg[fv.region] === fv.slot;
  }

  reset(): void {
    this.busy = true;
    this.cfg.fill(0);
    this.hist.fill(0);
    this.deep.clear();
    this.queue = [];
    this.started = true;
    this.terminatedFlag = false;
    this.steps = 0;
    this.stopTimers(this.model.timers.map((_, i) => i));
    this.enterRegion({ region: 0, default: true });
    this.settle();
    this.busy = false;
  }

  process(event: string): number {
    if (!this.started) throw new InterpreterError("not-started", "call reset() before process()");
    const id = this.eventIndex.get(event);
    if (id === undefined) throw new InterpreterError("unknown-event", `unknown event '${event}'`);
    if (this.busy) throw busyError();
    if (this.terminatedFlag) return 0;
    this.busy = true;
    this.steps = 0;
    const fired = this.microstep(this.select(this.model.offers[id] ?? [])) + this.settle();
    this.busy = false;
    return fired;
  }

  private settle(): number {
    let fired = 0;
    for (;;) {
      if (this.terminatedFlag) {
        this.queue = [];
        return fired;
      }
      const ts = this.select(this.model.eventless);
      if (ts.length) {
        fired += this.microstep(ts);
        continue;
      }
      const sig = this.queue.shift();
      if (sig === undefined) return fired;
      fired += this.microstep(this.select(this.model.offers[this.signalIds[sig]!] ?? []));
    }
  }

  // ------------------------------------------------------------ selection

  private select(offers: Offer[]): FlatTransition[] {
    const chosen: FlatTransition[] = [];
    const blocked = new Set<number>();
    const firstOf = (o: Offer): number | undefined => {
      if (!this.isActiveIndex(o.state)) return undefined;
      for (const c of o.candidates) if (this.enabled(this.model.transitions[c.transition]!)) return c.transition;
      return undefined;
    };
    for (const o of offers) {
      if (!this.isActiveIndex(o.state)) continue;
      const c = o.candidates.find((x) => this.enabled(this.model.transitions[x.transition]!));
      if (!c || !c.offer) continue;
      if (c.firstAt && !c.firstAt.every((src) => firstOf(offers.find((x) => x.state === src)!) === c.transition)) continue;
      const t = this.model.transitions[c.transition]!;
      if (blocked.has(t.domain)) continue;
      chosen.push(t);
      for (const r of t.blocks) blocked.add(r);
    }
    return chosen;
  }

  private enabled(t: FlatTransition): boolean {
    if (!t.sources.every((v) => this.isActiveIndex(v))) return false;
    for (const r of t.complete) if (!this.model.regions[r]!.finalSlots.includes(this.cfg[r]!)) return false;
    return t.guard.every((g) => this.holds(g));
  }

  private holds(g: FlatGuard): boolean {
    if ("in" in g) return this.isActiveIndex(g.in) !== (g.not === true);
    return (this.host.guard?.(this.guardName.get(g.call)!, g.call) ?? false) !== (g.not === true);
  }

  // ------------------------------------------------------------ microstep

  private microstep(ts: FlatTransition[]): number {
    if (ts.length === 0) return 0;
    if (++this.steps > this.options.maxMicrosteps) {
      throw new InterpreterError("livelock", `more than ${this.options.maxMicrosteps} microsteps without becoming stable`);
    }
    const m = this.model;
    // Domains of the chosen transitions are disjoint: exit the later one first, each in reverse document order.
    const byDomain = ts.filter((t) => !t.internal).sort((a, b) => b.domain - a.domain); // internal transitions exit nothing
    for (const t of byDomain) this.recordHistory(t.domain);
    for (const t of byDomain) {
      const d = m.regions[t.domain]!;
      for (let v = d.vertexTo - 1; v >= d.vertexFrom; v--) {
        if (!this.isActiveIndex(v)) continue;
        const fv = m.vertices[v]!;
        this.stopTimers(fv.timers);
        this.run(fv.exit);
        this.cfg[fv.region] = 0;
      }
    }
    for (const t of ts) this.run(t.actions);
    let terminate = false;
    for (const t of [...ts].sort((a, b) => a.domain - b.domain)) {
      if (t.entry) this.enterRegion(t.entry);
      if (t.terminate) terminate = true;
    }
    if (terminate) {
      this.terminatedFlag = true;
      this.cfg.fill(0);
      this.queue = [];
      this.stopTimers(m.timers.map((_, i) => i));
    }
    return 1;
  }

  /** Before exiting the active contents of `domain`: record history of every region whose owner is about to be exited. */
  private recordHistory(domain: number): void {
    const m = this.model;
    const d = m.regions[domain]!;
    for (let v = d.vertexFrom; v < d.vertexTo; v++) {
      if (!this.isActiveIndex(v)) continue;
      for (const r of m.vertices[v]!.regions) {
        const fr = m.regions[r]!;
        if (fr.history === "none") continue;
        const slot = this.cfg[r]!;
        if (slot === 0 || fr.finalSlots.includes(slot)) {
          this.hist[r] = 0;
          this.deep.delete(r);
        } else if (fr.history === "shallow") {
          this.hist[r] = slot;
        } else {
          this.hist[r] = slot;
          this.deep.set(r, this.cfg.slice(fr.regionFrom, fr.regionTo));
        }
      }
    }
  }

  // ------------------------------------------------------------ entry

  private enterRegion(op: RegionOp): void {
    if ("path" in op) {
      this.enterVertex(op.path);
      return;
    }
    const r = op.region;
    const fr = this.model.regions[r]!;
    const slot = this.hist[r]!;
    if (fr.history !== "none" && slot !== 0) {
      if (fr.history === "shallow") this.enterVertex(this.defaultOp(fr.slots[slot - 1]!));
      else this.restoreDeep(r, slot, this.deep.get(r)!);
      return;
    }
    if (!fr.init) return;
    this.run(fr.init.actions);
    this.enterVertex(fr.init.path);
  }

  private defaultOp(v: number): EntryOp {
    return { vertex: v, regions: this.model.vertices[v]!.regions.map((region) => ({ region, default: true as const })) };
  }

  private enterVertex(op: EntryOp): void {
    const fv = this.model.vertices[op.vertex]!;
    this.cfg[fv.region] = fv.slot;
    this.run(fv.entry);
    this.startTimers(fv.timers);
    for (const r of op.regions) this.enterRegion(r);
  }

  /** Re-enter the configuration recorded below a deep-history region. */
  private restoreDeep(r: number, slot: number, snap: Int32Array): void {
    const m = this.model;
    const base = m.regions[r]!.regionFrom;
    const enter = (region: number, s: number): void => {
      if (s === 0) return;
      const v = m.regions[region]!.slots[s - 1]!;
      const fv = m.vertices[v]!;
      this.cfg[region] = s;
      this.run(fv.entry);
      this.startTimers(fv.timers);
      for (const c of fv.regions) enter(c, snap[c - base]!);
    };
    enter(r, slot);
  }

  private startTimers(timers: number[]): void {
    for (const i of timers) {
      const t = this.model.timers[i]!;
      this.host.timerStart?.(t.name, t.id, t.ms, t.periodic);
    }
  }

  private stopTimers(timers: number[]): void {
    for (const i of timers) {
      const t = this.model.timers[i]!;
      this.host.timerStop?.(t.name, t.id);
    }
  }

  private run(actions: Action[]): void {
    for (const a of actions) {
      if ("call" in a) {
        this.host.call?.(this.actionName.get(a.call)!, a.call);
      } else {
        const limit = this.options.signalQueue;
        if (this.queue.length >= limit) {
          throw new InterpreterError("queue-overflow", `signal queue full (${limit})`);
        }
        this.queue.push(this.signalIds.indexOf(a.emit));
      }
    }
  }
}
