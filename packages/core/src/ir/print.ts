// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Readable pseudo-code for an IrModule: what every backend emits, before
 * language details. Used by `ufsm ir` and for reviewing the lowering.
 */
import type { Expr, IrModule, Stmt, SwitchOn } from "./ir";
import { hex32 } from "./ids";

export function printIr(ir: IrModule): string {
  const name = new Map<string, string>();
  for (const d of [...ir.events, ...ir.signals, ...ir.actions, ...ir.guards]) name.set(d.id, d.name);
  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const st = (region: number, slot: number): string => stateAt.get(`${region}:${slot}`) ?? `r${region}#${slot}`;
  const out: string[] = [];
  const line = (depth: number, text: string): void => void out.push(`${"  ".repeat(depth)}${text}`);

  const expr = (e: Expr, top = true): string => {
    switch (e.op) {
      case "true": return "true";
      case "active": return `in(${st(e.region, e.slot)})`;
      case "activeIn": return `cfg[r${e.region}] in {${e.slots.map((s) => (s === 0 ? "none" : st(e.region, s))).join(", ")}}`;
      case "hasHistory": return `hist[r${e.region}] != none`;
      case "guard": return `${name.get(e.guard)}()`;
      case "flag": return e.name;
      case "not": return `!${expr(e.expr, false)}`;
      case "and": {
        const s = e.exprs.map((x) => expr(x, false)).join(" && ");
        return top ? s : `(${s})`;
      }
      case "or": {
        const s = e.exprs.map((x) => expr(x, false)).join(" || ");
        return top ? s : `(${s})`;
      }
    }
  };
  const on = (o: SwitchOn): string => (o.kind === "cfg" ? `cfg[r${o.region}]` : o.kind === "hist" ? `hist[r${o.region}]` : `deep[r${o.history}][${o.index}]`);
  const caseRegion = (o: SwitchOn): number => (o.kind === "deep" ? (ir.history.find((h) => h.region === o.history)!.snapshotFrom ?? 0) + o.index : o.region);

  const stmts = (list: Stmt[], d: number): void => {
    for (const s of list) {
      switch (s.op) {
        case "if": {
          line(d, `if ${expr(s.cond)} {`);
          stmts(s.then, d + 1);
          let els = s.else;
          // print else-if chains flat
          while (els && els.length === 1 && els[0]!.op === "if") {
            const e = els[0] as Extract<Stmt, { op: "if" }>;
            line(d, `} else if ${expr(e.cond)} {`);
            stmts(e.then, d + 1);
            els = e.else;
          }
          if (els) {
            line(d, "} else {");
            stmts(els, d + 1);
          }
          line(d, "}");
          break;
        }
        case "switch":
          line(d, `switch ${on(s.on)} {`);
          for (const c of s.cases) {
            line(d + 1, `case ${c.slot} (${st(caseRegion(s.on), c.slot)}):`);
            stmts(c.body, d + 2);
          }
          line(d, "}");
          break;
        case "set":
          line(d, s.slot === 0 ? `cfg[r${s.region}] = none` : `cfg[r${s.region}] = ${s.slot}  // ${st(s.region, s.slot)}`);
          break;
        case "call": line(d, `${name.get(s.action)}()`); break;
        case "emit": line(d, `emit ${name.get(s.signal)}`); break;
        case "setFlag": line(d, `${s.name} = true`); break;
        case "invoke": line(d, `${s.fn}()`); break;
        case "saveHistory": line(d, `hist[r${s.region}] = cfg[r${s.region}]`); break;
        case "clearHistory": line(d, `hist[r${s.region}] = none`); break;
        case "saveDeep": line(d, `deep[r${s.region}] = snapshot of the regions inside r${s.region}`); break;
        case "microstep": line(d, "microstep  // livelock check"); break;
        case "trace": line(d, `trace ${s.hook} ${s.index}  // ${s.hook === "transition" ? ir.transitions[s.index]!.id : ir.states[s.index]!.label}`); break;
        case "timerStart": {
          const t = ir.timers[s.timer]!;
          line(d, `timer_start ${t.name} ${t.periodic ? "every " : ""}${t.ms} ms`);
          break;
        }
        case "timerStop": line(d, `timer_stop ${ir.timers[s.timer]!.name}`); break;
        case "terminate": line(d, "terminate"); break;
        case "return": line(d, `return ${s.value}`); break;
      }
    }
  };

  line(0, `// ${ir.name}: ${ir.regions} regions, ${ir.states.length} states, ${ir.functions.length} functions`);
  line(0, `// fingerprint ${hex32(ir.fingerprint)}${ir.trace ? ", trace" : ""}`);
  ir.regionNames.forEach((n, r) => {
    const slots = ir.states.filter((s) => s.region === r).map((s) => `${s.slot}=${s.name}`).join(" ");
    const h = ir.history.find((x) => x.region === r);
    line(0, `//   r${r} ${n}: ${slots}${h ? `  (${h.kind} history)` : ""}`);
  });
  ir.timers.forEach((t, i) => line(0, `//   timer ${i} ${t.name}: ${t.periodic ? "every" : "after"} ${t.ms} ms -> ${ir.events[t.event]!.name}`));
  line(0, "");
  line(0, "start {");
  stmts(ir.start, 1);
  line(0, "}");
  for (const f of ir.functions) {
    line(0, "");
    if (f.doc) line(0, `// ${f.doc}`);
    line(0, `fn ${f.name}()${f.returns === "bool" ? " -> bool" : ""} {`);
    if (f.flags.length) line(1, `flags ${f.flags.join(", ")} = false`);
    stmts(f.body, 1);
    line(0, "}");
  }
  return `${out.join("\n")}\n`;
}
