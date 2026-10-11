// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Facts about an IrModule every backend needs before it prints anything: which runtime parts the model uses (signal
 * queue, terminate, timers, a microstep counter) and which functions can fail. Computed once here, so the printers
 * only print. Which functions exist at all is decided by the lowering (it drops what the runtime loop cannot reach).
 */
import type { IrModule, Stmt } from "./ir";

/** Call `f` on every statement of `stmts`, depth first, including those inside ifs and switch cases. */
export function walkStmts(stmts: Stmt[], f: (s: Stmt) => void): void {
  for (const s of stmts) {
    f(s);
    if (s.op === "if") {
      walkStmts(s.then, f);
      if (s.else) walkStmts(s.else, f);
    } else if (s.op === "switch") for (const c of s.cases) walkStmts(c.body, f);
  }
}

/** Does any statement of the module (reset's start code or any function) satisfy `pred`? */
export function someStmt(ir: Pick<IrModule, "start" | "functions">, pred: (s: Stmt) => boolean): boolean {
  let found = false;
  const check = (s: Stmt): void => void (found ||= pred(s));
  walkStmts(ir.start, check);
  for (const f of ir.functions) walkStmts(f.body, check);
  return found;
}

/** Can a signal ever be queued? Only then does generated code need a queue and the signal step functions. */
export function emitsSignals(ir: Pick<IrModule, "signals" | "start" | "functions">): boolean {
  return ir.signals.length > 0 && someStmt(ir, (s) => s.op === "emit");
}

export interface IrAnalysis {
  /** Signals can be queued: the code has a signal queue, and settle takes signals from it. */
  hasQueue: boolean;
  /** A transition can reach a terminate pseudo-state: the code has a terminated flag. */
  hasTerminate: boolean;
  /** The model has timers: the code has a timer API. */
  hasTimers: boolean;
  /** `maxMicrosteps` is above 0: calls count microsteps and fail with a livelock error past the limit. */
  checkSteps: boolean;
  /** `checkSteps`, and some statement counts a microstep: the code needs a step counter. */
  countSteps: boolean;
  /** Functions that can fail: they emit, count a microstep (with `checkSteps`), or invoke one that can fail. */
  fallible: ReadonlySet<string>;
}

export function analyzeIr(ir: IrModule, maxMicrosteps: number): IrAnalysis {
  const checkSteps = maxMicrosteps > 0;
  const fallible = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const f of ir.functions) {
      if (fallible.has(f.name)) continue;
      let fails = false;
      walkStmts(f.body, (s) => {
        if (s.op === "emit" || (s.op === "microstep" && checkSteps) || (s.op === "invoke" && fallible.has(s.fn)))
          fails = true;
      });
      if (fails) {
        fallible.add(f.name);
        changed = true;
      }
    }
  }
  return {
    hasQueue: emitsSignals(ir),
    hasTerminate: someStmt(ir, (s) => s.op === "terminate"),
    hasTimers: ir.timers.length > 0,
    checkSteps,
    countSteps: checkSteps && someStmt(ir, (s) => s.op === "microstep"),
    fallible,
  };
}
