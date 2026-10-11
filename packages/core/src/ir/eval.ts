// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Executes an IrModule directly, including the runtime loop described in
 * ir.ts. It plays the role of a backend in tests: if the IR evaluated here
 * matches the reference interpreter, a backend that prints the IR
 * faithfully matches it too.
 */
import type { Id } from "../v1/model";
import { OPTION_DEFAULTS } from "../v1/options";
import { MachineError, busyError, type MachineHost, type RunOptions } from "../runtime/contract";
import type { Expr, IrFunction, IrModule, Stmt, SwitchOn, TraceKind } from "./ir";

class Return {
  constructor(readonly value: boolean) {}
}

export class IrRunner {
  readonly ir: IrModule;
  private readonly host: MachineHost;
  private readonly maxMicrosteps: number;
  private readonly signalQueue: number;
  private readonly cfg: Int32Array;
  private readonly hist: Int32Array;
  private readonly deep = new Map<number, Int32Array>();
  private readonly fns = new Map<string, IrFunction>();
  private readonly names = new Map<Id, string>();
  private readonly eventByName = new Map<string, Id>();
  private readonly signalIndex = new Map<Id, number>();
  private readonly eventIndex = new Map<Id, number>();
  /** The trace hook of generated code (only called when the IR was lowered with `trace`). */
  private readonly onHook: ((kind: TraceKind, index: number) => void) | undefined;
  private queue: Id[] = [];
  private terminatedFlag = false;
  private started = false;
  /** Set while reset()/process() runs; a call that fails leaves it set until the next reset(). */
  private busy = false;
  private steps = 0;

  constructor(ir: IrModule, host: MachineHost = {}, options: RunOptions = {}, onHook?: (kind: TraceKind, index: number) => void) {
    this.ir = ir;
    this.host = host;
    this.onHook = ir.trace ? onHook : undefined;
    this.maxMicrosteps = options.maxMicrosteps ?? OPTION_DEFAULTS.maxMicrosteps;
    this.signalQueue = options.signalQueue ?? OPTION_DEFAULTS.signalQueue;
    this.cfg = new Int32Array(ir.regions);
    this.hist = new Int32Array(ir.regions);
    for (const f of ir.functions) this.fns.set(f.name, f);
    for (const d of [...ir.actions, ...ir.guards, ...ir.signals, ...ir.events]) this.names.set(d.id, d.name);
    for (const e of ir.events) {
      this.eventByName.set(e.name, e.id);
      this.eventByName.set(e.id, e.id);
    }
    ir.signals.forEach((s, i) => this.signalIndex.set(s.id, i));
    ir.events.forEach((e, i) => this.eventIndex.set(e.id, i));
  }

  get terminated(): boolean {
    return this.terminatedFlag;
  }

  activeIds(): Id[] {
    return this.ir.states.filter((s) => this.cfg[s.region] === s.slot).map((s) => s.id);
  }

  isActive(id: Id): boolean {
    const s = this.ir.states.find((x) => x.id === id);
    return s !== undefined && this.cfg[s.region] === s.slot;
  }

  reset(): void {
    this.busy = true;
    this.cfg.fill(0);
    this.hist.fill(0);
    this.deep.clear();
    this.queue = [];
    this.terminatedFlag = false;
    this.started = true;
    this.steps = 0;
    this.exec(this.ir.start, new Set());
    this.settle();
    this.busy = false;
  }

  process(event: string): number {
    if (!this.started) throw new MachineError("not-started", "call reset() before process()");
    const id = this.eventByName.get(event);
    if (id === undefined) throw new MachineError("unknown-event", `unknown event '${event}'`);
    if (this.busy) throw busyError();
    if (this.terminatedFlag) return 0;
    this.busy = true;
    this.steps = 0;
    this.onHook?.("event", this.eventIndex.get(id)!);
    const fn = this.ir.onEvent[id];
    if (fn) this.call(fn);
    this.settle();
    this.busy = false;
    return this.steps;
  }

  private settle(): void {
    for (;;) {
      if (this.terminatedFlag) {
        this.cfg.fill(0);
        this.queue = [];
        return;
      }
      if (this.ir.eventless && this.call(this.ir.eventless)) continue;
      const sig = this.queue.shift();
      if (sig === undefined) return;
      this.onHook?.("signal", this.signalIndex.get(sig)!);
      const fn = this.ir.onSignal[sig];
      if (fn) this.call(fn);
    }
  }

  private call(name: string): boolean {
    const f = this.fns.get(name);
    if (!f) throw new Error(`IR: no function ${name}`);
    try {
      this.exec(f.body, new Set());
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    }
    return false;
  }

  private exec(stmts: Stmt[], flags: Set<string>): void {
    for (const s of stmts) {
      switch (s.op) {
        case "if":
          if (this.eval(s.cond, flags)) this.exec(s.then, flags);
          else if (s.else) this.exec(s.else, flags);
          break;
        case "switch": {
          const v = this.switchValue(s.on);
          const c = s.cases.find((x) => x.slot === v);
          if (c) this.exec(c.body, flags);
          break;
        }
        case "set":
          this.cfg[s.region] = s.slot;
          break;
        case "call":
          this.host.call?.(this.names.get(s.action)!, s.action);
          break;
        case "emit":
          if (this.queue.length >= this.signalQueue) {
            throw new MachineError("queue-overflow", `signal queue full (${this.signalQueue})`);
          }
          this.queue.push(s.signal);
          break;
        case "setFlag":
          flags.add(s.name);
          break;
        case "invoke":
          this.call(s.fn);
          break;
        case "saveHistory":
          this.hist[s.region] = this.cfg[s.region]!;
          break;
        case "clearHistory":
          this.hist[s.region] = 0;
          this.deep.delete(s.region);
          break;
        case "saveDeep": {
          const h = this.ir.history.find((x) => x.region === s.region)!;
          this.deep.set(s.region, this.cfg.slice(h.snapshotFrom!, h.snapshotTo!));
          break;
        }
        case "microstep":
          if (++this.steps > this.maxMicrosteps) {
            throw new MachineError("livelock", `more than ${this.maxMicrosteps} microsteps without becoming stable`);
          }
          break;
        case "trace":
          this.onHook?.(s.hook, s.index);
          break;
        case "timerStart": {
          const t = this.ir.timers[s.timer]!;
          this.host.timerStart?.(t.name, t.id, t.ms, t.periodic);
          break;
        }
        case "timerStop": {
          const t = this.ir.timers[s.timer]!;
          this.host.timerStop?.(t.name, t.id);
          break;
        }
        case "terminate":
          this.terminatedFlag = true;
          break;
        case "return":
          throw new Return(s.value);
      }
    }
  }

  private switchValue(on: SwitchOn): number {
    if (on.kind === "cfg") return this.cfg[on.region]!;
    if (on.kind === "hist") return this.hist[on.region]!;
    return this.deep.get(on.history)?.[on.index] ?? 0;
  }

  private eval(e: Expr, flags: Set<string>): boolean {
    switch (e.op) {
      case "true":
        return true;
      case "active":
        return this.cfg[e.region] === e.slot;
      case "activeIn":
        return e.slots.includes(this.cfg[e.region]!);
      case "hasHistory":
        return this.hist[e.region] !== 0;
      case "guard":
        return this.host.guard?.(this.names.get(e.guard)!, e.guard) ?? false;
      case "flag":
        return flags.has(e.name);
      case "not":
        return !this.eval(e.expr, flags);
      case "and":
        return e.exprs.every((x) => this.eval(x, flags));
      case "or":
        return e.exprs.some((x) => this.eval(x, flags));
    }
  }
}
