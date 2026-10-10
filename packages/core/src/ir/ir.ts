// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * uFSM IR: a small imperative language that every code generator backend
 * prints (rework plan S8). It is lowered from the flat tables
 * (semantics/flatten.ts), so all semantic decisions are already made:
 * a backend only maps these few statements and expressions to its
 * language and adds the fixed runtime loop below.
 *
 * Machine variables (all integers):
 *   cfg[r]        active slot of region r (1-based), 0 = inactive
 *   hist[r]       recorded slot of history region r, 0 = none
 *   deep[r][k]    deep-history snapshot of region r: cfg of the regions
 *                 numbered snapshotFrom + k
 *   queue         FIFO of signal numbers, capacity chosen by the backend
 *   terminated    true after a terminate pseudo-state was reached
 *   steps         microsteps in the current macrostep (livelock limit)
 *   busy          a reset()/process() call is running, or one did not finish
 *
 * Runtime loop every backend implements (identical to docs/semantics.md):
 *
 *   reset():      busy = true; clear cfg, hist, deep, queue, terminated;
 *                 steps = 0; run `start`; settle(); busy = false
 *   process(e):   if busy: fail "busy"; if terminated: return;
 *                 busy = true; steps = 0;
 *                 call events[e] (if any); settle(); busy = false
 *   settle():     loop {
 *                   if terminated: clear queue; return
 *                   if eventless && call eventless(): continue
 *                   if queue empty: return
 *                   s = pop(queue); call signals[s] (if any)
 *                 }
 *
 * Step functions return whether a microstep ran. `microstep` and `emit`
 * may fail (livelock, full queue): the backend aborts the whole
 * process()/reset() call with that error. `busy` is cleared only at the end
 * of a call that finished, so an error, or an exception or panic out of an
 * action or guard, leaves it set and process() refuses to run until the
 * next reset(); a process() call from inside an action or guard is refused
 * the same way. Nothing catches the application's exceptions.
 */
import type { Id } from "../v1/model";

export type Expr =
  | { op: "true" }
  /** cfg[region] == slot */
  | { op: "active"; region: number; slot: number }
  /** cfg[region] is one of `slots` */
  | { op: "activeIn"; region: number; slots: number[] }
  /** hist[region] != 0 */
  | { op: "hasHistory"; region: number }
  /** guard() is true (guards return a boolean) */
  | { op: "guard"; guard: Id }
  | { op: "flag"; name: string }
  | { op: "not"; expr: Expr }
  | { op: "and"; exprs: Expr[] }
  | { op: "or"; exprs: Expr[] };

export type Stmt =
  | { op: "if"; cond: Expr; then: Stmt[]; else?: Stmt[] }
  /** switch on cfg[region] (or hist[region], or deep[history][index]); slots without a case do nothing */
  | { op: "switch"; on: SwitchOn; cases: { slot: number; body: Stmt[] }[] }
  /** cfg[region] = slot (0 = leave the region) */
  | { op: "set"; region: number; slot: number }
  /** user action */
  | { op: "call"; action: Id }
  /** push a signal; fails when the queue is full */
  | { op: "emit"; signal: Id }
  /** local boolean flag of the enclosing function (initially false) */
  | { op: "setFlag"; name: string }
  /** call another IR function */
  | { op: "invoke"; fn: string }
  /** hist[region] = cfg[region] */
  | { op: "saveHistory"; region: number }
  /** hist[region] = 0 */
  | { op: "clearHistory"; region: number }
  /** deep[region] = copy of cfg[snapshotFrom .. snapshotTo) */
  | { op: "saveDeep"; region: number }
  /** count a microstep; fails when the livelock limit is exceeded */
  | { op: "microstep" }
  /** set terminated: the runtime loop clears cfg and the queue */
  | { op: "terminate" }
  | { op: "return"; value: boolean };

export type SwitchOn =
  | { kind: "cfg"; region: number }
  | { kind: "hist"; region: number }
  | { kind: "deep"; history: number; index: number };

export interface IrFunction {
  name: string;
  /** Step functions return whether a microstep ran; helpers return nothing. */
  returns: "bool" | "void";
  /** Local boolean flags, all false on entry. */
  flags: string[];
  body: Stmt[];
  doc?: string;
}

export interface IrState {
  id: Id;
  name: string;
  region: number;
  slot: number;
  final: boolean;
}

export interface IrHistory {
  region: number;
  kind: "shallow" | "deep";
  /** Deep history: snapshot of cfg[snapshotFrom .. snapshotTo). */
  snapshotFrom?: number;
  snapshotTo?: number;
}

export interface IrModule {
  name: string;
  /** Size of cfg[]. Region 0 is the root. */
  regions: number;
  /** Region names for comments and debugging: "root" or "<owner state>.<region>". */
  regionNames: string[];
  states: IrState[];
  history: IrHistory[];
  events: { id: Id; name: string }[];
  signals: { id: Id; name: string }[];
  actions: { id: Id; name: string }[];
  guards: { id: Id; name: string }[];
  /** Run by reset() after clearing everything. */
  start: Stmt[];
  /** Step function per event / signal id (absent: nothing reacts to it). */
  onEvent: Record<Id, string>;
  onSignal: Record<Id, string>;
  /** Step function for auto/completion transitions, if any. */
  eventless: string | undefined;
  /** In definition order: helpers first, then step functions. */
  functions: IrFunction[];
}
