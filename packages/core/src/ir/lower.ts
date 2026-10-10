// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Lowering: flat tables -> IR. Selection becomes straight-line code: each
 * offer is an if/else-if chain over its candidates, and the conflict check
 * is resolved statically into "none of the earlier conflicting transitions
 * was taken". Exit, history recording and default entry become one helper
 * function per region that needs it.
 */
import type { Action } from "../v1/model";
import type { EntryOp, FlatGuard, FlatModel, FlatTransition, Offer, RegionOp } from "../semantics/flatten";
import type { Expr, IrFunction, IrHistory, IrModule, IrTimer, IrTransition, Stmt } from "./ir";
import { fingerprint, stateNames } from "./ids";

export interface LowerOptions {
  /** Emit trace statements (the `trace` option): transitions taken, states entered and exited. Default false. */
  trace?: boolean;
}

export function lowerToIr(flat: FlatModel, options: LowerOptions = {}): IrModule {
  const trace = options.trace ?? false;
  const fns: IrFunction[] = [];
  const done = new Set<string>();
  const R = flat.regions;
  const V = flat.vertices;

  /** A trace statement, or nothing without the `trace` option. */
  const hook = (h: "transition" | "enter" | "exit", index: number): Stmt[] => (trace ? [{ op: "trace", hook: h, index }] : []);
  const starts = (timers: number[]): Stmt[] => timers.map((timer) => ({ op: "timerStart", timer }));
  const stops = (timers: number[]): Stmt[] => timers.map((timer) => ({ op: "timerStop", timer }));
  /** reset() and terminate stop every timer, in timer order. */
  const stopAll = (): Stmt[] => stops(flat.timers.map((_, i) => i));
  const actions = (list: Action[]): Stmt[] => list.map((a) => ("call" in a ? { op: "call", action: a.call } : { op: "emit", signal: a.emit }));
  const hasContent = (r: number): boolean => R[r]!.slots.length > 0;
  const enterable = (r: number): boolean => R[r]!.init !== undefined || R[r]!.history !== "none";
  /** Does the subtree strictly inside region r contain a history region? */
  const historyInside = (r: number): boolean => {
    for (let k = R[r]!.regionFrom; k < R[r]!.regionTo; k++) if (R[k]!.history !== "none") return true;
    return false;
  };

  // ---------------------------------------------------------------- exit

  /** exit_rN: exit the active contents of region N, innermost and lowest first. */
  const exitFn = (r: number): string => {
    const name = `exit_r${r}`;
    if (done.has(name)) return name;
    done.add(name);
    const cases = R[r]!.slots.map((v, i) => {
      const fv = V[v]!;
      const body: Stmt[] = [];
      for (const c of [...fv.regions].reverse()) if (hasContent(c)) body.push({ op: "invoke", fn: exitFn(c) });
      body.push(...hook("exit", v), ...stops(fv.timers), ...actions(fv.exit));
      return { slot: i + 1, body };
    }).filter((c) => c.body.length > 0);
    const body: Stmt[] = [];
    if (cases.length) body.push({ op: "switch", on: { kind: "cfg", region: r }, cases });
    body.push({ op: "set", region: r, slot: 0 });
    fns.push({ name, returns: "void", flags: [], body, doc: `Exit the active contents of ${regionName(r)}.` });
    return name;
  };

  /** record_rN: before region N's contents are exited, record history of the regions inside it. */
  const recordFn = (r: number): string => {
    const name = `record_r${r}`;
    if (done.has(name)) return name;
    done.add(name);
    const cases = R[r]!.slots.map((v, i) => {
      const body: Stmt[] = [];
      for (const c of V[v]!.regions) {
        const fr = R[c]!;
        if (fr.history !== "none") {
          const save: Stmt[] = [{ op: "saveHistory", region: c }];
          if (fr.history === "deep") save.push({ op: "saveDeep", region: c });
          body.push({ op: "if", cond: { op: "activeIn", region: c, slots: [0, ...fr.finalSlots] }, then: [{ op: "clearHistory", region: c }], else: save });
        }
        if (historyInside(c)) body.push({ op: "invoke", fn: recordFn(c) });
      }
      return { slot: i + 1, body };
    }).filter((c) => c.body.length > 0);
    fns.push({ name, returns: "void", flags: [], body: [{ op: "switch", on: { kind: "cfg", region: r }, cases }], doc: `Record history inside ${regionName(r)}.` });
    return name;
  };

  // ---------------------------------------------------------------- entry

  const enterOp = (op: EntryOp): Stmt[] => {
    const fv = V[op.vertex]!;
    return [
      { op: "set", region: fv.region, slot: fv.slot },
      ...hook("enter", op.vertex),
      ...actions(fv.entry),
      ...starts(fv.timers),
      ...op.regions.flatMap(regionOp),
    ];
  };
  const regionOp = (op: RegionOp): Stmt[] => {
    if ("path" in op) return enterOp(op.path);
    return enterable(op.region) ? [{ op: "invoke", fn: enterFn(op.region) }] : [];
  };
  const enterDefaults = (v: number): Stmt[] => enterOp({ vertex: v, regions: V[v]!.regions.map((region) => ({ region, default: true as const })) });

  /** enter_rN: default entry of region N (history if recorded, else its initializer). */
  const enterFn = (r: number): string => {
    const name = `enter_r${r}`;
    if (done.has(name)) return name;
    done.add(name);
    const fr = R[r]!;
    const init: Stmt[] = fr.init ? [...actions(fr.init.actions), ...enterOp(fr.init.path)] : [];
    let body: Stmt[] = init;
    if (fr.history === "shallow") {
      const restore: Stmt = { op: "switch", on: { kind: "hist", region: r }, cases: fr.slots.map((v, i) => ({ slot: i + 1, body: enterDefaults(v) })) };
      body = [{ op: "if", cond: { op: "hasHistory", region: r }, then: [restore], else: init }];
    } else if (fr.history === "deep") {
      body = [{ op: "if", cond: { op: "hasHistory", region: r }, then: [{ op: "invoke", fn: restoreFn(r) }], else: init }];
    }
    fns.push({ name, returns: "void", flags: [], body, doc: `Enter ${regionName(r)} by default.` });
    return name;
  };

  /** restore_rN: re-enter the configuration recorded by deep history region N. */
  const restoreFn = (r: number): string => {
    const name = `restore_r${r}`;
    if (done.has(name)) return name;
    done.add(name);
    const base = R[r]!.regionFrom;
    const restoreIn = (c: number, top: boolean): Stmt => ({
      op: "switch",
      on: top ? { kind: "hist", region: r } : { kind: "deep", history: r, index: c - base },
      cases: R[c]!.slots.map((v, i) => {
        const fv = V[v]!;
        return {
          slot: i + 1,
          body: [{ op: "set", region: c, slot: i + 1 } as Stmt, ...hook("enter", v), ...actions(fv.entry), ...starts(fv.timers), ...fv.regions.map((cc) => restoreIn(cc, false))],
        };
      }),
    });
    fns.push({ name, returns: "void", flags: [], body: [restoreIn(r, true)], doc: `Restore the deep history of ${regionName(r)}.` });
    return name;
  };

  // ---------------------------------------------------------------- selection

  const guardExpr = (g: FlatGuard): Expr => {
    if ("in" in g) {
      const fv = V[g.in]!;
      const e: Expr = { op: "active", region: fv.region, slot: fv.slot };
      return g.not ? { op: "not", expr: e } : e;
    }
    const e: Expr = { op: "guard", guard: g.call };
    return g.not ? { op: "not", expr: e } : e;
  };
  const and = (exprs: Expr[]): Expr => (exprs.length === 0 ? { op: "true" } : exprs.length === 1 ? exprs[0]! : { op: "and", exprs });
  const or = (exprs: Expr[]): Expr => (exprs.length === 1 ? exprs[0]! : { op: "or", exprs });

  /** Enabled, apart from the offering state being active (checked by the enclosing offer). */
  const enabled = (t: FlatTransition, offerState: number): Expr =>
    and([
      ...t.sources.filter((v) => v !== offerState).map((v): Expr => ({ op: "active", region: V[v]!.region, slot: V[v]!.slot })),
      ...t.complete.map((r): Expr => ({ op: "activeIn", region: r, slots: R[r]!.finalSlots })),
      ...t.guard.map(guardExpr),
    ]);
  const flag = (t: number): string => `take_t${t}`;
  const conflicts = (a: FlatTransition, b: FlatTransition): boolean => a.blocks.includes(b.domain);

  /** Path of (region, slot) pairs from the root down to vertex v. */
  const pathOf = (v: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let x = v; x >= 0; x = R[V[x]!.region]!.owner) out.unshift([V[x]!.region, V[x]!.slot]);
    return out;
  };
  /** Two vertices can never be active together: they part ways in one region. */
  const exclusive = (a: number, b: number): boolean => {
    const pa = pathOf(a);
    const pb = pathOf(b);
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const [ra, sa] = pa[i]!;
      const [rb, sb] = pb[i]!;
      if (ra !== rb) return false; // orthogonal regions
      if (sa !== sb) return true;
    }
    return false; // one contains the other
  };
  /** Two transitions can be enabled in the same microstep only if all their sources can be active together. */
  const compatible = (a: FlatTransition, b: FlatTransition): boolean => a.sources.every((x) => b.sources.every((y) => !exclusive(x, y)));

  const stepFn = (name: string, offers: Offer[], doc: string): string => {
    const considered: number[] = [];
    const body: Stmt[] = [];
    for (const o of offers) {
      const sv = V[o.state]!;
      const earlier = [...considered];
      let chain: Stmt[] | undefined;
      for (const c of [...o.candidates].reverse()) {
        const t = flat.transitions[c.transition]!;
        let then: Stmt[] = [];
        if (c.offer) {
          const conds: Expr[] = [];
          for (const src of c.firstAt ?? []) {
            // The join must be the first enabled candidate at its other sources too.
            const other = offers.find((x) => x.state === src)!;
            const before = other.candidates.slice(0, other.candidates.findIndex((x) => x.transition === c.transition));
            for (const b of before) conds.push({ op: "not", expr: enabled(flat.transitions[b.transition]!, src) });
          }
          const blockers = earlier.filter((k) => conflicts(flat.transitions[k]!, t) && compatible(flat.transitions[k]!, t));
          if (blockers.length) conds.push({ op: "not", expr: or(blockers.map((k): Expr => ({ op: "flag", name: flag(k) }))) });
          const take: Stmt = { op: "setFlag", name: flag(c.transition) };
          then = conds.length ? [{ op: "if", cond: and(conds), then: [take] }] : [take];
          considered.push(c.transition);
        }
        const node: Stmt = { op: "if", cond: enabled(t, o.state), then };
        if (chain) node.else = chain;
        chain = [node];
      }
      body.push({ op: "if", cond: { op: "active", region: sv.region, slot: sv.slot }, then: chain! });
    }
    // `considered` was filled per offer in reverse candidate order; keep offer order for actions.
    const ordered = offers.flatMap((o) => o.candidates.filter((c) => c.offer).map((c) => c.transition));
    const T = (k: number): FlatTransition => flat.transitions[k]!;
    // With a single candidate, reaching the execution part means it was taken.
    const when = (k: number, then: Stmt[]): Stmt[] =>
      then.length === 0 ? [] : ordered.length === 1 ? then : [{ op: "if", cond: { op: "flag", name: flag(k) }, then }];
    const byDomainDesc = [...ordered].sort((a, b) => T(b).domain - T(a).domain);
    const byDomainAsc = [...ordered].sort((a, b) => T(a).domain - T(b).domain);
    body.push({ op: "if", cond: { op: "not", expr: or(ordered.map((k): Expr => ({ op: "flag", name: flag(k) }))) }, then: [{ op: "return", value: false }] });
    body.push({ op: "microstep" });
    // Transitions with the same domain block each other, so at most one of them is taken: record and exit once per domain.
    // Internal transitions exit nothing and record no history.
    const exiting = byDomainDesc.filter((k) => !T(k).internal);
    const domains = [...new Set(exiting.map((k) => T(k).domain))];
    const inDomain = (d: number): number[] => ordered.filter((k) => T(k).domain === d && !T(k).internal);
    const whenAny = (ks: number[], then: Stmt[]): Stmt[] =>
      ordered.length === ks.length ? then : [{ op: "if", cond: or(ks.map((k): Expr => ({ op: "flag", name: flag(k) }))), then }];
    for (const d of domains) if (historyInside(d)) body.push(...whenAny(inDomain(d), [{ op: "invoke", fn: recordFn(d) }]));
    for (const d of domains) body.push(...whenAny(inDomain(d), [{ op: "invoke", fn: exitFn(d) }]));
    for (const k of ordered) body.push(...when(k, [...hook("transition", k), ...actions(T(k).actions)]));
    for (const k of byDomainAsc) body.push(...when(k, T(k).entry ? regionOp(T(k).entry!) : []));
    // Two orthogonal transitions may terminate together: the timers are stopped once.
    const terminating = ordered.filter((k) => T(k).terminate);
    if (terminating.length) body.push(...whenAny(terminating, [{ op: "terminate" }, ...stopAll()]));
    body.push({ op: "return", value: true });
    fns.push({ name, returns: "bool", flags: ordered.map(flag), body: simplify(body), doc });
    return name;
  };

  const regionName = (r: number): string => {
    const fr = R[r]!;
    return fr.owner < 0 ? "root" : `${V[fr.owner]!.name}.${fr.name ?? fr.id}`;
  };

  for (const f of fns) f.body = simplify(f.body);
  const start = [...stopAll(), ...regionOp({ region: 0, default: true })];
  const onEvent: Record<string, string> = {};
  const onSignal: Record<string, string> = {};
  for (const e of flat.events) {
    const offers = flat.offers[e.id];
    if (offers) onEvent[e.id] = stepFn(`step_${e.name}`, offers, `Event ${e.name}.`);
  }
  for (const s of flat.signals) {
    const offers = flat.offers[s.id];
    if (offers) onSignal[s.id] = stepFn(`step_${s.name}`, offers, `Signal ${s.name}.`);
  }
  const eventless = flat.eventless.length ? stepFn("eventless", flat.eventless, "Auto and completion transitions.") : undefined;

  const history: IrHistory[] = R.flatMap((fr, r): IrHistory[] => {
    if (fr.history === "none") return [];
    return [fr.history === "deep" ? { region: r, kind: "deep", snapshotFrom: fr.regionFrom, snapshotTo: fr.regionTo } : { region: r, kind: "shallow" }];
  });

  const names = stateNames(V.map((v) => ({ id: v.id, name: v.name, parent: R[v.region]!.owner })));
  const states = V.map((v, i) => ({ id: v.id, name: v.name, ...names[i]!, region: v.region, slot: v.slot, final: v.kind === "final" }));
  /** The explicit targets of an entry: the innermost vertices its paths lead to. */
  const targets = (op: RegionOp | undefined): number[] => {
    if (!op || !("path" in op)) return [];
    const inner = op.path.regions.flatMap(targets);
    return inner.length ? inner : [op.path.vertex];
  };
  const transitions: IrTransition[] = flat.transitions.map((t) => {
    const from = t.sources.map((v) => states[v]!.label).join(", ");
    const to = t.internal ? "(internal)" : t.terminate ? "terminate" : targets(t.entry).map((v) => states[v]!.label).join(", ");
    const on = t.trigger.kind === "event" ? ` on ${t.trigger.name}` : t.trigger.kind === "none" ? "" : ` (${t.trigger.kind})`;
    return { id: t.id, label: `${t.id}: ${from} -> ${to}${on}` };
  });

  const eventIndex = new Map(flat.events.map((e, i) => [e.id, i]));
  const timers: IrTimer[] = flat.timers.map((t) => ({ id: t.id, name: t.name, ms: t.ms, periodic: t.periodic, event: eventIndex.get(t.event)! }));

  return {
    name: flat.name,
    regions: R.length,
    regionNames: R.map((_, r) => regionName(r)),
    states,
    transitions,
    history,
    events: flat.events,
    signals: flat.signals,
    actions: flat.actions,
    guards: flat.guards,
    timers,
    start,
    onEvent,
    onSignal,
    eventless,
    // helpers were pushed while building the step functions; put them first, keep the steps in trigger order
    functions: [...fns.filter((f) => f.returns === "void"), ...fns.filter((f) => f.returns === "bool")],
    trace,
    fingerprint: fingerprint({ name: flat.name, events: flat.events, signals: flat.signals, states, transitions }),
  };
}

// ------------------------------------------------------------------ simplification

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
      s = { ...s, cases: s.cases.map((c) => ({ slot: c.slot, body: simplify(c.body, on.kind === "cfg" ? assume(known, { op: "active", region: on.region, slot: c.slot }, true) : known) })) };
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
      out.push(allowed.length === 1 ? { op: "active", region: t.region, slot: allowed[0]! } : { op: "activeIn", region: t.region, slots: allowed });
    } else {
      const not = [...c.neg].sort((a, b) => a - b);
      const inner: Expr = not.length === 1 ? { op: "active", region: t.region, slot: not[0]! } : { op: "activeIn", region: t.region, slots: not };
      out.push({ op: "not", expr: inner });
    }
  }
  return out;
}

function simplifyExpr(e: Expr, facts: Facts = new Map()): Expr {
  const d = decide(e, facts);
  if (d !== undefined) return d ? { op: "true" } : FALSE;
  if (e.op === "and") {
    const flat = e.exprs.map((x) => simplifyExpr(x, facts)).flatMap((x) => (x.op === "and" ? x.exprs : [x])).filter((x) => x.op !== "true");
    // Guard calls before a false term are skipped too: guards may be called any number of times (backend-c.md).
    if (flat.some(isFalse)) return FALSE;
    const xs = mergeSlotTerms(flat);
    if (!xs) return FALSE;
    return xs.length === 0 ? { op: "true" } : xs.length === 1 ? xs[0]! : { op: "and", exprs: xs };
  }
  if (e.op === "or") {
    const xs = e.exprs.map((x) => simplifyExpr(x, facts)).flatMap((x) => (x.op === "or" ? x.exprs : [x])).filter((x) => !isFalse(x));
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
