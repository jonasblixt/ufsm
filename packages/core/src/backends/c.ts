// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * C backend: prints an IrModule as a C99 header and source file.
 *
 * The generated code is static: no heap, no recursion, no libc beyond
 * <stdint.h> and <stdbool.h>. Every public identifier is the prefix
 * (`targets.c.prefix`, default: model name + "_") followed by a fixed name
 * or a declaration name, so several machines can live in one program.
 * The runtime loop (reset/process/settle) is the one described in ir/ir.ts.
 *
 * Errors (full signal queue, livelock) abort the call and are returned as
 * negative codes; every function that can fail returns its error upwards.
 * Only what the model uses is emitted: no queue without emits, no history
 * arrays without history, no terminated flag without terminate.
 */
import type { UfsmDocument } from "../v1/model";
import { IDENTIFIER } from "../v1/model";
import { UFSM_VERSION } from "../version";
import type { Expr, IrFunction, IrModule, Stmt, SwitchOn } from "../ir/ir";

export interface COptions {
  /** Prefix of every public identifier. Default: the model name as an identifier, plus "_". */
  prefix?: string;
  /** Capacity of the signal queue (only generated when the model emits signals). Default 16. */
  signalQueue?: number;
  /** Microsteps per init/reset/process call before giving up with ERR_LIVELOCK; 0 disables the check. Default 10000. */
  maxMicrosteps?: number;
  /** Base name of the files: `<file>.h` and `<file>.c`. Default: the prefix without its trailing "_". */
  file?: string;
}

export interface CFiles {
  headerName: string;
  sourceName: string;
  header: string;
  source: string;
}

export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodegenError";
  }
}

/**
 * Stated in every generated file: generator output is not covered by uFSM's
 * GPL (see LICENSE-EXCEPTION in the repository root).
 */
export const OUTPUT_NOTICE = "May be used, modified and distributed under any terms (uFSM output exception).";

export const C_DEFAULTS = { signalQueue: 16, maxMicrosteps: 10000 } as const;

const C_KEYWORDS = new Set(
  (
    "auto break case char const continue default do double else enum extern float for goto if inline int long register " +
    "restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex " +
    "_Imaginary _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local bool true false NULL " +
    "alignas alignof static_assert thread_local typeof constexpr nullptr"
  ).split(" "),
);

/** Turn free text into a C identifier ("New model" -> "New_model"). */
export function cIdentifier(text: string): string {
  let s = text.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(s)) s = `m${s}`;
  return s;
}

/**
 * Read `targets.c` of a document. Unknown keys and wrong types are reported,
 * not fatal: the defaults are used instead.
 */
export function cOptionsFromTargets(doc: UfsmDocument): { options: COptions; problems: string[] } {
  const t = doc.targets?.["c"] ?? {};
  const options: COptions = {};
  const problems: string[] = [];
  for (const [k, v] of Object.entries(t)) {
    switch (k) {
      case "prefix":
      case "file":
        if (typeof v === "string") options[k] = v;
        else problems.push(`targets.c.${k}: expected a string`);
        break;
      case "signalQueue":
      case "maxMicrosteps":
        if (typeof v === "number" && Number.isInteger(v) && v >= 0) options[k] = v;
        else problems.push(`targets.c.${k}: expected a whole number >= 0`);
        break;
      default:
        problems.push(`targets.c.${k}: unknown option (ignored)`);
    }
  }
  return { options, problems };
}

/** Smallest unsigned fixed-width type that holds 0..max. */
function uintType(max: number): string {
  return max <= 0xff ? "uint8_t" : max <= 0xffff ? "uint16_t" : "uint32_t";
}

/** Text that is safe inside a C block comment. */
function comment(text: string): string {
  return text.replace(/\*\//g, "* /").replace(/[\r\n]+/g, " ");
}

/** Precedence of a printed expression: 0 `||`, 1 `&&`, 2 comparison, 3 primary/unary. */
interface Printed {
  s: string;
  p: number;
}

export function generateC(ir: IrModule, options: COptions = {}): CFiles {
  const prefix = options.prefix ?? `${cIdentifier(ir.name)}_`;
  if (prefix !== "" && !IDENTIFIER.test(prefix)) throw new CodegenError(`C prefix '${prefix}' is not a C identifier`);
  const file = options.file ?? (prefix.replace(/_+$/, "") || cIdentifier(ir.name));
  const P = prefix.toUpperCase();
  const queueCap = options.signalQueue ?? C_DEFAULTS.signalQueue;
  const maxSteps = options.maxMicrosteps ?? C_DEFAULTS.maxMicrosteps;
  const machine = `struct ${prefix}machine`;

  // ------------------------------------------------------------ analysis

  const fnByName = new Map(ir.functions.map((f) => [f.name, f]));
  const walk = (stmts: Stmt[], f: (s: Stmt) => void): void => {
    for (const s of stmts) {
      f(s);
      if (s.op === "if") {
        walk(s.then, f);
        if (s.else) walk(s.else, f);
      } else if (s.op === "switch") for (const c of s.cases) walk(c.body, f);
    }
  };
  const anyStmt = (pred: (s: Stmt) => boolean): boolean => {
    let found = false;
    const check = (s: Stmt): void => void (found ||= pred(s));
    walk(ir.start, check);
    for (const f of ir.functions) walk(f.body, check);
    return found;
  };
  const hasQueue = ir.signals.length > 0 && anyStmt((s) => s.op === "emit");
  const hasTerminate = anyStmt((s) => s.op === "terminate");
  const checkSteps = maxSteps > 0;
  if (hasQueue && queueCap < 1) throw new CodegenError("the model emits signals: signalQueue must be at least 1");

  // Functions reachable from the runtime loop; signal steps only when signals can be queued.
  const roots = [...Object.values(ir.onEvent), ...(ir.eventless ? [ir.eventless] : []), ...(hasQueue ? Object.values(ir.onSignal) : [])];
  const reachable = new Set<string>();
  const visit = (name: string): void => {
    if (reachable.has(name)) return;
    reachable.add(name);
    walk(fnByName.get(name)!.body, (s) => s.op === "invoke" && visit(s.fn));
  };
  walk(ir.start, (s) => s.op === "invoke" && visit(s.fn));
  roots.forEach(visit);
  const functions = ir.functions.filter((f) => reachable.has(f.name));

  // A function can fail if it emits, counts a microstep, or invokes one that can fail.
  const fallible = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of functions) {
      if (fallible.has(f.name)) continue;
      let fails = false;
      walk(f.body, (s) => {
        if (s.op === "emit" || (s.op === "microstep" && checkSteps) || (s.op === "invoke" && fallible.has(s.fn))) fails = true;
      });
      if (fails) {
        fallible.add(f.name);
        changed = true;
      }
    }
  }
  const needsRc = (body: Stmt[]): boolean => {
    let need = false;
    walk(body, (s) => void (need ||= s.op === "emit" || (s.op === "invoke" && fallible.has(s.fn))));
    return need;
  };

  // ------------------------------------------------------------ names

  const histIndex = new Map(ir.history.map((h, k) => [h.region, k]));
  const deepRegions = ir.history.filter((h) => h.kind === "deep" && h.snapshotTo! > h.snapshotFrom!);
  const maxSlot = Math.max(0, ...ir.states.map((s) => s.slot));
  const slotT = uintType(maxSlot);
  const sigT = uintType(Math.max(0, ir.signals.length - 1));
  const queueT = uintType(queueCap);
  const stepsT = uintType(maxSteps + 1);
  const name = new Map<string, string>();
  for (const d of [...ir.events, ...ir.signals]) name.set(d.id, `${P}${d.name}`);
  for (const d of [...ir.actions, ...ir.guards]) name.set(d.id, `${prefix}${d.name}`);
  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const stateName = (region: number, slot: number): string => comment(stateAt.get(`${region}:${slot}`) ?? `slot ${slot}`);

  const status = { ok: `${P}OK`, queue: `${P}ERR_QUEUE_FULL`, livelock: `${P}ERR_LIVELOCK`, event: `${P}ERR_EVENT` };
  // Every identifier the files define, to catch clashes with declaration names.
  const fixed = new Map<string, string>([
    [`${prefix}machine`, "the machine struct"],
    [`${prefix}event`, "the event enum"],
    [`${prefix}status`, "the status enum"],
    [`${prefix}init`, "the init function"],
    [`${prefix}reset`, "the reset function"],
    [`${prefix}process`, "the process function"],
    [status.ok, "a status code"],
    [status.queue, "a status code"],
    [status.livelock, "a status code"],
    [status.event, "a status code"],
    [`UFSM_${cIdentifier(file).toUpperCase()}_H`, "the include guard"],
    ...["settle", "push_signal", "pop_signal", "m", "rc", "user", "event", "signal", "r", "uint8_t", "uint16_t", "uint32_t"].map(
      (n): [string, string] => [n, "an internal name"],
    ),
    ...functions.map((f): [string, string] => [f.name, "an internal function"]),
    ...functions.flatMap((f) => f.flags.map((x): [string, string] => [x, "an internal variable"])),
  ]);
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [kind, list] of [["event", ir.events], ["signal", ir.signals], ["action", ir.actions], ["guard", ir.guards]] as const) {
    for (const d of list) {
      const id = name.get(d.id)!;
      const what = `${kind} '${d.name}'`;
      if (C_KEYWORDS.has(id)) problems.push(`${what} becomes '${id}', a C keyword`);
      else if (fixed.has(id)) problems.push(`${what} becomes '${id}', which is ${fixed.get(id)}`);
      else if (seen.has(id)) problems.push(`${what} becomes '${id}', like ${seen.get(id)}`);
      seen.set(id, what);
    }
  }
  if (problems.length) throw new CodegenError(`name clash in the generated C (rename, or set targets.c.prefix):\n  ${problems.join("\n  ")}`);

  // ------------------------------------------------------------ expressions

  const guardCall = (g: string): string => `${name.get(g)}(m->user)`;
  const wrap = (x: Printed, min: number): string => (x.p < min ? `(${x.s})` : x.s);

  const expr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "true", p: 3 };
      case "active":
        return { s: `m->cfg[${e.region}] == ${e.slot}u`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "false", p: 3 };
        if (e.slots.length === 1) return { s: `m->cfg[${e.region}] == ${e.slots[0]}u`, p: 2 };
        return { s: e.slots.map((x) => `m->cfg[${e.region}] == ${x}u`).join(" || "), p: 0 };
      case "hasHistory":
        return { s: `m->hist[${histIndex.get(e.region)}] != 0u`, p: 2 };
      case "guard":
        return { s: guardCall(e.guard), p: 3 };
      case "flag":
        return { s: e.name, p: 3 };
      case "not":
        return notExpr(e.expr);
      case "and":
        // `||` inside `&&` needs parentheses; comparisons do not
        return { s: e.exprs.map((x) => wrap(expr(x), 1)).join(" && "), p: 1 };
      case "or":
        // gcc asks for parentheses around `&&` inside `||`
        return { s: e.exprs.map((x) => { const y = expr(x); return y.p === 1 ? `(${y.s})` : y.s; }).join(" || "), p: 0 };
    }
  };
  const notExpr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "false", p: 3 };
      case "active":
        return { s: `m->cfg[${e.region}] != ${e.slot}u`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "true", p: 3 };
        if (e.slots.length === 1) return { s: `m->cfg[${e.region}] != ${e.slots[0]}u`, p: 2 };
        return { s: e.slots.map((x) => `m->cfg[${e.region}] != ${x}u`).join(" && "), p: 1 };
      case "hasHistory":
        return { s: `m->hist[${histIndex.get(e.region)}] == 0u`, p: 2 };
      case "not":
        return expr(e.expr);
      default:
        return { s: `!${wrap(expr(e), 3)}`, p: 3 };
    }
  };
  const cond = (e: Expr): string => expr(e).s;

  // ------------------------------------------------------------ statements

  const out: string[] = [];
  const line = (depth: number, text: string): void => void out.push(text === "" ? "" : `${"    ".repeat(depth)}${text}`);
  const check = (d: number, call: string): void => {
    line(d, `rc = ${call};`);
    line(d, "if (rc != 0) {");
    line(d + 1, "return rc;");
    line(d, "}");
  };
  const switchOn = (o: SwitchOn): string =>
    o.kind === "cfg" ? `m->cfg[${o.region}]` : o.kind === "hist" ? `m->hist[${histIndex.get(o.region)}]` : `m->deep_r${o.history}[${o.index}]`;
  const caseRegion = (o: SwitchOn): number => (o.kind === "deep" ? ir.history.find((h) => h.region === o.history)!.snapshotFrom! + o.index : o.region);

  const stmts = (list: Stmt[], d: number): void => {
    for (const s of list) {
      switch (s.op) {
        case "if": {
          if (s.then.length === 0 && !s.else) {
            line(d, `(void)(${cond(s.cond)});`); // kept for the guard calls it makes
            break;
          }
          line(d, `if (${cond(s.cond)}) {`);
          stmts(s.then, d + 1);
          let els = s.else;
          while (els && els.length === 1 && els[0]!.op === "if") {
            const e = els[0] as Extract<Stmt, { op: "if" }>;
            line(d, `} else if (${cond(e.cond)}) {`);
            stmts(e.then, d + 1);
            els = e.else;
          }
          if (els && els.length) {
            line(d, "} else {");
            stmts(els, d + 1);
          }
          line(d, "}");
          break;
        }
        case "switch": {
          line(d, `switch (${switchOn(s.on)}) {`);
          const region = caseRegion(s.on);
          for (const c of s.cases) {
            line(d, `case ${c.slot}u: /* ${stateName(region, c.slot)} */`);
            stmts(c.body, d + 1);
            const last = c.body[c.body.length - 1];
            if (last?.op !== "return") line(d + 1, "break;");
          }
          line(d, "default:");
          line(d + 1, "break;");
          line(d, "}");
          break;
        }
        case "set":
          line(d, s.slot === 0 ? `m->cfg[${s.region}] = 0u;` : `m->cfg[${s.region}] = ${s.slot}u; /* ${stateName(s.region, s.slot)} */`);
          break;
        case "call":
          line(d, `${name.get(s.action)}(m->user);`);
          break;
        case "emit":
          check(d, `push_signal(m, ${name.get(s.signal)})`);
          break;
        case "setFlag":
          line(d, `${s.name} = true;`);
          break;
        case "invoke":
          if (fallible.has(s.fn)) check(d, `${s.fn}(m)`);
          else line(d, `${s.fn}(m);`);
          break;
        case "saveHistory":
          line(d, `m->hist[${histIndex.get(s.region)}] = m->cfg[${s.region}];`);
          break;
        case "clearHistory":
          line(d, `m->hist[${histIndex.get(s.region)}] = 0u;`);
          break;
        case "saveDeep": {
          const h = ir.history.find((x) => x.region === s.region)!;
          for (let k = 0; k < h.snapshotTo! - h.snapshotFrom!; k++) line(d, `m->deep_r${s.region}[${k}] = m->cfg[${h.snapshotFrom! + k}];`);
          break;
        }
        case "microstep":
          if (!checkSteps) break;
          line(d, `if (++m->steps > ${maxSteps}u) {`);
          line(d + 1, `return ${status.livelock};`);
          line(d, "}");
          break;
        case "terminate":
          line(d, "m->terminated = true;");
          break;
        case "return":
          line(d, `return ${s.value ? 1 : 0};`);
          break;
      }
    }
  };

  const signature = (f: IrFunction): string => `static ${f.returns === "bool" || fallible.has(f.name) ? "int" : "void"} ${f.name}(${machine} *m)`;

  // ------------------------------------------------------------ header

  const guard = `UFSM_${cIdentifier(file).toUpperCase()}_H`;
  const h: string[] = [];
  const hl = (text = ""): void => void h.push(text);
  hl(`/* Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit. */`);
  hl(`/* ${OUTPUT_NOTICE} */`);
  hl(`#ifndef ${guard}`);
  hl(`#define ${guard}`);
  hl();
  hl("#include <stdint.h>");
  if (hasTerminate || ir.guards.length) hl("#include <stdbool.h>");
  hl();
  hl("#ifdef __cplusplus");
  hl('extern "C" {');
  hl("#endif");
  hl();
  hl("/*");
  hl(` * Usage: call ${prefix}init() once, then ${ir.events.length ? `${prefix}process() for every event` : `${prefix}reset() to restart`}.`);
  hl(` * They return ${status.ok} or a negative ${P}ERR_* code; after an error the`);
  hl(` * machine is in an undefined state until ${prefix}reset() is called.`);
  hl(" * The application implements the actions and guards declared at the end");
  hl(` * of this file; each gets the user pointer passed to ${prefix}init().`);
  hl(" */");
  hl();
  hl(`enum ${prefix}status {`);
  hl(`    ${status.ok} = 0,`);
  hl(`    ${status.queue} = -1, /* signal queue full */`);
  hl(`    ${status.livelock} = -2, /* too many microsteps in one call */`);
  hl(`    ${status.event} = -3, /* unknown event */`);
  hl("};");
  hl();
  if (ir.events.length) {
    hl(`enum ${prefix}event {`);
    ir.events.forEach((e, i) => hl(`    ${name.get(e.id)} = ${i},`));
    hl("};");
    hl();
  }
  hl(`/* Treat as opaque; zero-initialized storage is fine before ${prefix}init(). */`);
  hl(`${machine} {`);
  hl(`    ${slotT} cfg[${ir.regions}]; /* active state per region, 0 = none */`);
  if (ir.history.length) hl(`    ${slotT} hist[${ir.history.length}]; /* recorded history per history region, 0 = none */`);
  for (const dh of deepRegions) hl(`    ${slotT} deep_r${dh.region}[${dh.snapshotTo! - dh.snapshotFrom!}]; /* deep history of region ${dh.region} */`);
  if (hasQueue) {
    hl(`    ${sigT} queue[${queueCap}]; /* pending signals (FIFO) */`);
    hl(`    ${queueT} queue_head;`);
    hl(`    ${queueT} queue_len;`);
  }
  if (checkSteps) hl(`    ${stepsT} steps; /* microsteps in the current call */`);
  if (hasTerminate) hl("    bool terminated;");
  hl("    void *user;");
  hl("};");
  hl();
  hl(`int ${prefix}init(${machine} *m, void *user);`);
  hl(`int ${prefix}reset(${machine} *m);`);
  if (ir.events.length) hl(`int ${prefix}process(${machine} *m, enum ${prefix}event event);`);
  if (ir.actions.length || ir.guards.length) {
    hl();
    hl("/* Implemented by the application */");
    for (const a of ir.actions) hl(`void ${name.get(a.id)}(void *user);`);
    for (const g of ir.guards) hl(`bool ${name.get(g.id)}(void *user);`);
  }
  hl();
  hl("#ifdef __cplusplus");
  hl("}");
  hl("#endif");
  hl();
  hl(`#endif /* ${guard} */`);

  // ------------------------------------------------------------ source

  const headerName = `${file}.h`;
  line(0, `/* Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit. */`);
  line(0, `/* ${OUTPUT_NOTICE} */`);
  line(0, `#include "${headerName}"`);
  line(0, "");
  line(0, "#include <stdbool.h>");
  line(0, "");
  line(0, "/*");
  line(0, " * Regions and their states (cfg value: state):");
  ir.regionNames.forEach((n, r) => {
    const slots = ir.states.filter((s) => s.region === r).map((s) => `${s.slot}: ${comment(s.name)}`).join(", ");
    const hk = histIndex.get(r);
    const hd = hk === undefined ? "" : ` [${ir.history[hk]!.kind} history: hist[${hk}]]`;
    line(0, ` *   ${r} ${comment(n)}: ${slots}${hd}`);
  });
  line(0, " */");
  if (hasQueue) {
    line(0, "");
    line(0, "enum {");
    ir.signals.forEach((s, i) => line(1, `${name.get(s.id)} = ${i},`));
    line(0, "};");
  }
  const settleBody = hasTerminate || ir.eventless !== undefined || hasQueue;
  line(0, "");
  for (const f of functions) line(0, `${signature(f)};`);
  if (hasQueue) {
    line(0, "");
    line(0, `static int push_signal(${machine} *m, ${sigT} signal)`);
    line(0, "{");
    line(1, `if (m->queue_len == ${queueCap}u) {`);
    line(2, `return ${status.queue};`);
    line(1, "}");
    line(1, `m->queue[(m->queue_head + m->queue_len) % ${queueCap}u] = signal;`);
    line(1, "m->queue_len++;");
    line(1, `return ${status.ok};`);
    line(0, "}");
    line(0, "");
    line(0, `static ${sigT} pop_signal(${machine} *m)`);
    line(0, "{");
    line(1, `${sigT} signal = m->queue[m->queue_head];`);
    line(1, `m->queue_head = (${queueT})((m->queue_head + 1u) % ${queueCap}u);`);
    line(1, "m->queue_len--;");
    line(1, "return signal;");
    line(0, "}");
  }
  for (const f of functions) {
    line(0, "");
    if (f.doc) line(0, `/* ${comment(f.doc)} */`);
    line(0, signature(f));
    line(0, "{");
    if (needsRc(f.body)) line(1, "int rc;");
    for (const x of f.flags) line(1, `bool ${x} = false;`);
    stmts(f.body, 1);
    if (f.returns === "void" && fallible.has(f.name)) line(1, `return ${status.ok};`);
    line(0, "}");
  }
  if (settleBody) {
    line(0, "");
    line(0, "/* Run eventless transitions and queued signals until the machine is stable. */");
    line(0, `static int settle(${machine} *m)`);
    line(0, "{");
    const settleRc = ir.eventless !== undefined || (hasQueue && ir.signals.some((x) => ir.onSignal[x.id]));
    if (settleRc) line(1, "int rc;");
    line(1, "for (;;) {");
    if (hasTerminate) {
      line(2, "if (m->terminated) {");
      line(3, `for (unsigned int r = 0u; r < ${ir.regions}u; r++) {`);
      line(4, "m->cfg[r] = 0u;");
      line(3, "}");
      if (hasQueue) line(3, "m->queue_len = 0u;");
      line(3, `return ${status.ok};`);
      line(2, "}");
    }
    if (ir.eventless !== undefined) {
      line(2, `rc = ${ir.eventless}(m);`);
      line(2, "if (rc < 0) {");
      line(3, "return rc;");
      line(2, "}");
      line(2, "if (rc > 0) {");
      line(3, "continue;");
      line(2, "}");
    }
    if (hasQueue) {
      line(2, "if (m->queue_len == 0u) {");
      line(3, `return ${status.ok};`);
      line(2, "}");
      const reacting = ir.signals.filter((s) => ir.onSignal[s.id]);
      if (reacting.length) {
        line(2, "switch (pop_signal(m)) {");
        for (const s of reacting) {
          line(2, `case ${name.get(s.id)}:`);
          line(3, `rc = ${ir.onSignal[s.id]}(m);`);
          line(3, "break;");
        }
        line(2, "default:");
        line(3, "rc = 0;");
        line(3, "break;");
        line(2, "}");
        line(2, "if (rc < 0) {");
        line(3, "return rc;");
        line(2, "}");
      } else line(2, "(void)pop_signal(m);");
    } else {
      line(2, `return ${status.ok};`);
    }
    line(1, "}");
    line(0, "}");
  }
  const finish = (d: number): void => line(d, settleBody ? "return settle(m);" : `return ${status.ok};`);

  line(0, "");
  line(0, `int ${prefix}init(${machine} *m, void *user)`);
  line(0, "{");
  line(1, "m->user = user;");
  line(1, `return ${prefix}reset(m);`);
  line(0, "}");

  line(0, "");
  line(0, `int ${prefix}reset(${machine} *m)`);
  line(0, "{");
  if (needsRc(ir.start)) line(1, "int rc;");
  line(1, `for (unsigned int r = 0u; r < ${ir.regions}u; r++) {`);
  line(2, "m->cfg[r] = 0u;");
  line(1, "}");
  if (ir.history.length) {
    line(1, `for (unsigned int r = 0u; r < ${ir.history.length}u; r++) {`);
    line(2, "m->hist[r] = 0u;");
    line(1, "}");
  }
  if (hasQueue) {
    line(1, "m->queue_head = 0u;");
    line(1, "m->queue_len = 0u;");
  }
  if (checkSteps) line(1, "m->steps = 0u;");
  if (hasTerminate) line(1, "m->terminated = false;");
  stmts(ir.start, 1);
  finish(1);
  line(0, "}");

  if (ir.events.length) {
    line(0, "");
    line(0, `int ${prefix}process(${machine} *m, enum ${prefix}event event)`);
    line(0, "{");
    const reacting = ir.events.filter((e) => ir.onEvent[e.id]);
    const idle = ir.events.filter((e) => !ir.onEvent[e.id]);
    if (reacting.length) line(1, "int rc;");
    if (hasTerminate) {
      line(1, "if (m->terminated) {");
      line(2, `return ${status.ok};`);
      line(1, "}");
    }
    if (checkSteps) line(1, "m->steps = 0u;");
    line(1, "switch (event) {");
    for (const e of reacting) {
      line(1, `case ${name.get(e.id)}:`);
      line(2, `rc = ${ir.onEvent[e.id]}(m);`);
      line(2, "break;");
    }
    if (idle.length) {
      for (const e of idle) line(1, `case ${name.get(e.id)}:`);
      line(2, reacting.length ? "rc = 0;" : "break;");
      if (reacting.length) line(2, "break;");
    }
    line(1, "default:");
    line(2, `return ${status.event};`);
    line(1, "}");
    if (reacting.length) {
      line(1, "if (rc < 0) {");
      line(2, "return rc;");
      line(1, "}");
    }
    finish(1);
    line(0, "}");
  }

  return { headerName, sourceName: `${file}.c`, header: `${h.join("\n")}\n`, source: `${out.join("\n")}\n` };
}
