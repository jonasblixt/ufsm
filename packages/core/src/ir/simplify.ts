// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The IR simplifier the lowering runs on every function body: conditions decided by what enclosing ifs and switch
 * cases already established about the configuration are folded away, and slot tests on one region are merged.
 */
import type { Expr, Stmt } from "./ir";

const same = (a: Expr, b: Expr): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What is known about cfg[region] at a point: it is one of `pos` (when set)
 * and none of `neg`. Facts come from the conditions of enclosing ifs and
 * switch cases and hold until a statement may change that region.
 */
type Facts = Map<number, { pos?: Set<number>; neg: Set<number> }>;

function cloneFacts(f: Facts): Facts {
  return new Map([...f].map(([r, c]) => [r, { ...(c.pos ? { pos: new Set(c.pos) } : {}), neg: new Set(c.neg) }]));
}

/** Facts that hold where `cond` evaluated to `truth` (only slot terms, and conjunctions of them when true, add facts). */
function assume(f: Facts, cond: Expr, truth: boolean): Facts {
  const out = cloneFacts(f);
  const add = (e: Expr, holds: boolean): void => {
    const t = slotTerm(e);
    if (!t) return;
    const isIn = holds !== t.neg; // cfg[r] in t.slots
    const c = out.get(t.region) ?? { neg: new Set<number>() };
    if (isIn) c.pos = c.pos ? new Set([...c.pos].filter((v) => t.slots.includes(v))) : new Set(t.slots);
    else for (const v of t.slots) c.neg.add(v);
    out.set(t.region, c);
  };
  if (truth && cond.op === "and") cond.exprs.forEach((x) => add(x, true));
  else add(cond, truth);
  return out;
}

/** Drop the facts a statement may invalidate: a `set` on a region, or any invoked helper (it may set any region). */
function invalidate(f: Facts, s: Stmt): void {
  switch (s.op) {
    case "set":
      f.delete(s.region);
      break;
    case "invoke":
      f.clear();
      break;
    case "if":
      s.then.forEach((x) => invalidate(f, x));
      s.else?.forEach((x) => invalidate(f, x));
      break;
    case "switch":
      for (const c of s.cases) c.body.forEach((x) => invalidate(f, x));
      break;
    default:
      break;
  }
}

/** True/false if the facts decide a slot term, else undefined. */
function decide(e: Expr, f: Facts): boolean | undefined {
  const t = slotTerm(e);
  const c = t && f.get(t.region);
  if (!t || !c) return undefined;
  let inS: boolean | undefined;
  if (c.pos) {
    const possible = [...c.pos].filter((v) => !c.neg.has(v));
    if (possible.every((v) => t.slots.includes(v))) inS = true;
    else if (possible.every((v) => !t.slots.includes(v))) inS = false;
  } else if (t.slots.every((v) => c.neg.has(v))) inS = false;
  return inS === undefined ? undefined : inS !== t.neg;
}

/**
 * Fold `if true`, flatten trivial conjunctions, merge adjacent ifs with the
 * same condition, and decide slot tests already implied by an enclosing
 * condition (`if cfg[2] == 2: if cfg[2] != 1 and ...` drops the second
 * test; type checkers and compilers report it as always true).
 */
export function simplify(stmts: Stmt[], facts: Facts = new Map()): Stmt[] {
  const out: Stmt[] = [];
  const known = cloneFacts(facts);
  const emit = (xs: Stmt[]): void => {
    for (const x of xs) {
      out.push(x);
      invalidate(known, x);
    }
  };
  for (const s0 of stmts) {
    let s = s0;
    if (s.op === "switch") {
      const on = s.on;
      s = {
        ...s,
        cases: s.cases.map((c) => ({
          slot: c.slot,
          body: simplify(
            c.body,
            on.kind === "cfg" ? assume(known, { op: "active", region: on.region, slot: c.slot }, true) : known,
          ),
        })),
      };
    }
    if (s.op === "if") {
      const cond = simplifyExpr(s.cond, known);
      if (cond.op === "true") {
        emit(simplify(s.then, known));
        continue;
      }
      if (isFalse(cond)) {
        emit(simplify(s.else ?? [], known));
        continue;
      }
      const then = simplify(s.then, assume(known, cond, true));
      const els = s.else ? simplify(s.else, assume(known, cond, false)) : undefined;
      if (then.length === 0 && (!els || els.length === 0)) {
        if (!sideEffectFree(cond)) emit([{ op: "if", cond, then: [] }]);
        continue;
      }
      const prev = out[out.length - 1];
      if (!els && prev?.op === "if" && !prev.else && same(prev.cond, cond) && flagOnly(cond)) {
        prev.then = simplify([...prev.then, ...then]);
        invalidate(known, prev);
        continue;
      }
      s = els && els.length ? { op: "if", cond, then, else: els } : { op: "if", cond, then };
    }
    emit([s]);
  }
  return out;
}

/** Merging two ifs is only safe when nothing in between can change the condition: flags are set during selection only. */
function flagOnly(e: Expr): boolean {
  return e.op === "flag";
}

function sideEffectFree(e: Expr): boolean {
  switch (e.op) {
    case "guard":
      return false; // guards are user code; keep the call order the interpreter has
    case "not":
      return sideEffectFree(e.expr);
    case "and":
    case "or":
      return e.exprs.every(sideEffectFree);
    default:
      return true;
  }
}

/** The never-true condition: no slot of region 0 matches. */
const FALSE: Expr = { op: "activeIn", region: 0, slots: [] };
const isFalse = (e: Expr): boolean => e.op === "activeIn" && e.slots.length === 0;

/** A condition on one region's slot: cfg[r] in `slots` (or not in them, when `neg`). */
function slotTerm(e: Expr): { region: number; slots: number[]; neg: boolean } | undefined {
  if (e.op === "active") return { region: e.region, slots: [e.slot], neg: false };
  if (e.op === "activeIn") return { region: e.region, slots: e.slots, neg: false };
  if (e.op === "not") {
    const t = slotTerm(e.expr);
    return t && !t.neg ? { ...t, neg: true } : undefined;
  }
  return undefined;
}

/**
 * Within one conjunction, merge all conditions on the same region into one
 * (at the place of the first): duplicates vanish, and contradictions such as
 * `in S && !in S` or a completion test on a region without final states fold
 * to false. C compilers warn about both forms otherwise.
 */
function mergeSlotTerms(xs: Expr[]): Expr[] | undefined {
  const byRegion = new Map<number, { pos?: Set<number>; neg: Set<number> }>();
  for (const x of xs) {
    const t = slotTerm(x);
    if (!t) continue;
    const c = byRegion.get(t.region) ?? { neg: new Set<number>() };
    if (t.neg) for (const v of t.slots) c.neg.add(v);
    else c.pos = c.pos ? new Set(t.slots.filter((v) => c.pos!.has(v))) : new Set(t.slots);
    byRegion.set(t.region, c);
  }
  const out: Expr[] = [];
  const done = new Set<number>();
  for (const x of xs) {
    const t = slotTerm(x);
    if (!t) {
      out.push(x);
      continue;
    }
    if (done.has(t.region)) continue;
    done.add(t.region);
    const c = byRegion.get(t.region)!;
    if (c.pos) {
      const allowed = [...c.pos].filter((v) => !c.neg.has(v)).sort((a, b) => a - b);
      if (allowed.length === 0) return undefined;
      out.push(
        allowed.length === 1
          ? { op: "active", region: t.region, slot: allowed[0]! }
          : { op: "activeIn", region: t.region, slots: allowed },
      );
    } else {
      const not = [...c.neg].sort((a, b) => a - b);
      const inner: Expr =
        not.length === 1
          ? { op: "active", region: t.region, slot: not[0]! }
          : { op: "activeIn", region: t.region, slots: not };
      out.push({ op: "not", expr: inner });
    }
  }
  return out;
}

function simplifyExpr(e: Expr, facts: Facts = new Map()): Expr {
  const d = decide(e, facts);
  if (d !== undefined) return d ? { op: "true" } : FALSE;
  if (e.op === "and") {
    const flat = e.exprs
      .map((x) => simplifyExpr(x, facts))
      .flatMap((x) => (x.op === "and" ? x.exprs : [x]))
      .filter((x) => x.op !== "true");
    // Guard calls before a false term are skipped too: guards may be called any number of times (backend-c.md).
    if (flat.some(isFalse)) return FALSE;
    const xs = mergeSlotTerms(flat);
    if (!xs) return FALSE;
    return xs.length === 0 ? { op: "true" } : xs.length === 1 ? xs[0]! : { op: "and", exprs: xs };
  }
  if (e.op === "or") {
    const xs = e.exprs
      .map((x) => simplifyExpr(x, facts))
      .flatMap((x) => (x.op === "or" ? x.exprs : [x]))
      .filter((x) => !isFalse(x));
    if (xs.some((x) => x.op === "true")) return { op: "true" };
    return xs.length === 0 ? FALSE : xs.length === 1 ? xs[0]! : { op: "or", exprs: xs };
  }
  if (e.op === "not") {
    const x = simplifyExpr(e.expr, facts);
    if (x.op === "true") return FALSE;
    if (isFalse(x)) return { op: "true" };
    if (x.op === "not") return x.expr;
    return { op: "not", expr: x };
  }
  return e;
}
