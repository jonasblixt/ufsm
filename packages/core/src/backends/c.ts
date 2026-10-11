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
 *
 * Always in the header: the state enum (document order) and the model
 * fingerprint. With `debugInfo`: name lookup for events, signals and states
 * and `is_active()`. With `trace` (decided by the IR, see ir/ir.ts): calls to
 * `<prefix>trace(user, kind, id)`, which the application implements.
 * With timers in the model: a timer enum, `<prefix>timer_start()` and
 * `<prefix>timer_stop()` for the application to implement, and
 * `<prefix>timer_event()`, the event to process when a timer expires.
 */
import type { UfsmDocument } from "../v1/model";
import { IDENTIFIER } from "../v1/model";
import { UFSM_VERSION } from "../version";
import type { Expr, IrFunction, IrHistory, IrModule, Stmt, SwitchOn, TraceKind } from "../ir/ir";
import { TRACE_KINDS } from "../ir/ir";
import { walkStmts } from "../ir/analyze";
import { hex32, utf8 } from "../ir/ids";
import { CodegenError, OUTPUT_NOTICE, identifier, lines, prepare, readTargetOptions, type CommonOptions, type Lines, type Prepared, type Printed } from "./common";

export interface COptions extends CommonOptions {
  /** Prefix of every public identifier. Default: the model name as an identifier, plus "_". */
  prefix?: string;
  /** Base name of the files: `<file>.h` and `<file>.c`. Default: the prefix without its trailing "_". */
  file?: string;
}

export interface CFiles {
  headerName: string;
  sourceName: string;
  header: string;
  source: string;
}

const C_KEYWORDS = new Set(
  (
    "auto break case char const continue default do double else enum extern float for goto if inline int long register " +
    "restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex " +
    "_Imaginary _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local bool true false NULL " +
    "alignas alignof static_assert thread_local typeof constexpr nullptr"
  ).split(" "),
);

/** The keys of `targets.c` besides the API options. */
export const C_TARGET_KEYS = ["prefix", "file"] as const;

/**
 * Read `targets.c` of a document. Unknown keys and wrong types are reported,
 * not fatal: the defaults are used instead.
 */
export function cOptionsFromTargets(doc: UfsmDocument): { options: COptions; problems: string[] } {
  return readTargetOptions(doc, "c", C_TARGET_KEYS);
}

/** Smallest unsigned fixed-width type that holds 0..max. */
function uintType(max: number): string {
  return max <= 0xff ? "uint8_t" : max <= 0xffff ? "uint16_t" : "uint32_t";
}

/** A C string literal; `"`, `\`, control characters, non-ASCII bytes (UTF-8) and trigraph starts are escaped. */
export function cString(text: string): string {
  let out = "";
  for (const b of utf8(text)) {
    const c = String.fromCharCode(b);
    if (c === '"' || c === "\\") out += `\\${c}`;
    else if (c === "?" && out.endsWith("?")) out += "\\?";
    else if (b < 0x20 || b >= 0x7f) out += `\\${b.toString(8).padStart(3, "0")}`;
    else out += c;
  }
  return `"${out}"`;
}

/** Text that is safe inside a C block comment. */
function comment(text: string): string {
  return text.replace(/\*\//g, "* /").replace(/[\r\n]+/g, " ");
}

/** Names, sizes and facts every part of the C printer uses. */
interface CContext extends Prepared {
  ir: IrModule;
  prefix: string;
  /** The prefix in upper case: enum constants and macros. */
  P: string;
  file: string;
  /** `struct <prefix>machine` */
  machine: string;
  /** Index into `hist[]` of each history region. */
  histIndex: Map<number, number>;
  /** Deep history regions with something to snapshot. */
  deepRegions: IrHistory[];
  slotT: string;
  sigT: string;
  queueT: string;
  stepsT: string;
  /** C name of every declaration, by id. */
  name: Map<string, string>;
  /** A state's name for a comment, by region and slot. */
  stateName(region: number, slot: number): string;
  stateConst: Map<number, string>;
  timerConst(i: number): string;
  traceConst(k: TraceKind): string;
  /** Signals get a public enum when the application sees their numbers (trace hook, name lookup). */
  publicSignals: boolean;
  status: { ok: string; queue: string; livelock: string; event: string; busy: string };
  /** The busy latch guards process(); without events there is no process(). */
  hasBusy: boolean;
  /** settle() has something to do: eventless transitions, queued signals or terminate. */
  settleBody: boolean;
}

function cContext(ir: IrModule, options: COptions): CContext {
  const prefix = options.prefix ?? `${identifier(ir.name)}_`;
  if (prefix !== "" && !IDENTIFIER.test(prefix)) throw new CodegenError(`C prefix '${prefix}' is not a C identifier`);
  const file = options.file ?? (prefix.replace(/_+$/, "") || identifier(ir.name));
  const P = prefix.toUpperCase();
  const prepared = prepare(ir, options);
  const { signalQueue, maxMicrosteps, trace, debugInfo, hasQueue, hasTerminate } = prepared;
  const histIndex = new Map(ir.history.map((h, k) => [h.region, k]));
  const deepRegions = ir.history.filter((h) => h.kind === "deep" && h.snapshotTo! > h.snapshotFrom!);
  const maxSlot = Math.max(0, ...ir.states.map((s) => s.slot));
  const slotT = uintType(maxSlot);
  const sigT = uintType(Math.max(0, ir.signals.length - 1));
  const queueT = uintType(signalQueue);
  const stepsT = uintType(maxMicrosteps + 1);
  const name = new Map<string, string>();
  for (const d of [...ir.events, ...ir.signals]) name.set(d.id, `${P}${d.name}`);
  for (const d of [...ir.actions, ...ir.guards]) name.set(d.id, `${prefix}${d.name}`);
  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const stateName = (region: number, slot: number): string => comment(stateAt.get(`${region}:${slot}`) ?? `slot ${slot}`);

  const stateConst = new Map(ir.states.map((st, i) => [i, `${P}STATE_${st.ident}`]));
  const timerConst = (i: number): string => `${P}TIMER_${ir.timers[i]!.name}`;
  const traceConst = (k: TraceKind): string => `${P}TRACE_${k.toUpperCase()}`;
  const publicSignals = (trace || debugInfo) && ir.signals.length > 0;
  const status = { ok: `${P}OK`, queue: `${P}ERR_QUEUE_FULL`, livelock: `${P}ERR_LIVELOCK`, event: `${P}ERR_EVENT`, busy: `${P}ERR_BUSY` };
  const hasBusy = ir.events.length > 0;
  // Every identifier the files define, to catch clashes with declaration names.
  const ctx: CContext = {
    ...prepared,
    ...{ ir, prefix, P, file, machine: `struct ${prefix}machine`, histIndex, deepRegions, slotT, sigT, queueT, stepsT, name, stateName },
    ...{ stateConst, timerConst, traceConst, publicSignals, status, hasBusy, settleBody: hasTerminate || ir.eventless !== undefined || hasQueue },
  };
  checkNames(ctx);
  return ctx;
}

/** Refuse declaration, state and timer names that become a C keyword, a fixed identifier or another name. */
function checkNames(ctx: CContext): void {
  const {
    ir, prefix, P, file, name, stateConst, timerConst, traceConst, publicSignals, status, debugInfo, trace,
    hasTimers,
  } = ctx;
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
    [status.busy, "a status code"],
    [`UFSM_${identifier(file).toUpperCase()}_H`, "the include guard"],
    [`${prefix}state`, "the state enum"],
    [`${P}FINGERPRINT`, "the fingerprint"],
    ...(publicSignals ? [[`${prefix}signal`, "the signal enum"] as [string, string]] : []),
    ...(trace
      ? ([[`${prefix}trace`, "the trace hook"], [`${prefix}trace_kind`, "the trace kind enum"], ...TRACE_KINDS.map((k) => [traceConst(k), "a trace kind"])] as [string, string][])
      : []),
    ...(debugInfo
      ? ([`${prefix}event_name`, `${prefix}signal_name`, `${prefix}state_name`, `${prefix}is_active`, ...(hasTimers ? [`${prefix}timer_name`] : [])].map((n) => [
          n,
          "a debugInfo function",
        ]) as [string, string][])
      : []),
    ...(hasTimers
      ? ([
          [`${prefix}timer`, "the timer enum"],
          [`${P}TIMER_COUNT`, "the number of timers"],
          [`${prefix}timer_start`, "the timer start function"],
          [`${prefix}timer_stop`, "the timer stop function"],
          [`${prefix}timer_event`, "the timer event function"],
        ] as [string, string][])
      : []),
    ...[
      "settle", "push_signal", "pop_signal", "m", "rc", "user", "event", "signal", "r", "uint8_t", "uint16_t", "uint32_t",
      "sig", "kind", "id", "state", "event_names", "signal_names", "state_names", "state_region", "state_slot",
      "timer", "ms", "periodic", "timer_events", "timer_names",
    ].map(
      (n): [string, string] => [n, "an internal name"],
    ),
    ...ir.functions.map((f): [string, string] => [f.name, "an internal function"]),
    ...ir.functions.flatMap((f) => f.flags.map((x): [string, string] => [x, "an internal variable"])),
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
  for (const [i, c] of stateConst) {
    const what = `state '${ir.states[i]!.label}'`;
    if (fixed.has(c)) problems.push(`${what} becomes '${c}', which is ${fixed.get(c)}`);
    else if (seen.has(c)) problems.push(`${what} becomes '${c}', like ${seen.get(c)}`);
    seen.set(c, what);
  }
  ir.timers.forEach((t, i) => {
    const c = timerConst(i);
    const what = `timer '${t.name}'`;
    if (fixed.has(c)) problems.push(`${what} becomes '${c}', which is ${fixed.get(c)}`);
    else if (seen.has(c)) problems.push(`${what} becomes '${c}', like ${seen.get(c)}`);
    seen.set(c, what);
  });
  if (problems.length) throw new CodegenError(`name clash in the generated C (rename, or set targets.c.prefix):\n  ${problems.join("\n  ")}`);
}

export function generateC(ir: IrModule, options: COptions = {}): CFiles {
  const ctx = cContext(ir, options);
  return { headerName: `${ctx.file}.h`, sourceName: `${ctx.file}.c`, header: cHeader(ctx), source: cSource(ctx) };
}

/** The C text of an IR condition. */
function cExpressions(ctx: CContext): (e: Expr) => string {
  const { histIndex, name } = ctx;
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
  return (e: Expr): string => expr(e).s;
}

interface CStatements {
  /** Print statements at depth `d`. */
  stmts(list: Stmt[], d: number): void;
  /** The C signature of an IR function. */
  signature(f: IrFunction): string;
  /** Does a body need the `rc` variable (it calls something that can fail)? */
  needsRc(body: Stmt[]): boolean;
}

/** The statement printer, writing into `w`. */
function cStatements(ctx: CContext, w: Lines): CStatements {
  const {
    ir, prefix, machine, histIndex, name, stateName, stateConst, timerConst, traceConst, status, maxMicrosteps,
    checkSteps, fallible,
  } = ctx;
  const { line } = w;
  const cond = cExpressions(ctx);
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
          line(d, `if (++m->steps > ${maxMicrosteps}u) {`);
          line(d + 1, `return ${status.livelock};`);
          line(d, "}");
          break;
        case "trace":
          if (s.hook === "transition") line(d, `${prefix}trace(m->user, ${traceConst(s.hook)}, ${s.index}u); /* ${comment(ir.transitions[s.index]!.label)} */`);
          else line(d, `${prefix}trace(m->user, ${traceConst(s.hook)}, ${stateConst.get(s.index)});`);
          break;
        case "timerStart": {
          const t = ir.timers[s.timer]!;
          line(d, `${prefix}timer_start(m->user, ${timerConst(s.timer)}, ${t.ms}u, ${t.periodic});`);
          break;
        }
        case "timerStop":
          line(d, `${prefix}timer_stop(m->user, ${timerConst(s.timer)});`);
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
  const needsRc = (body: Stmt[]): boolean => {
    let need = false;
    walkStmts(body, (s) => void (need ||= s.op === "emit" || (s.op === "invoke" && fallible.has(s.fn))));
    return need;
  };
  return { stmts, signature, needsRc };
}

/** The header file: usage, enums, the machine struct, the API and what the application implements. */
function cHeader(ctx: CContext): string {
  const {
    ir, prefix, P, file, machine, deepRegions, slotT, sigT, queueT, stepsT, name, stateConst, timerConst, traceConst,
    publicSignals, status, hasBusy, signalQueue, debugInfo, trace, hasQueue, hasTerminate, hasTimers, checkSteps,
  } = ctx;
  const guard = `UFSM_${identifier(file).toUpperCase()}_H`;
  const h: string[] = [];
  const hl = (text = ""): void => void h.push(text);
  hl(`/* Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit. */`);
  hl(`/* ${OUTPUT_NOTICE} */`);
  hl(`#ifndef ${guard}`);
  hl(`#define ${guard}`);
  hl();
  hl("#include <stdint.h>");
  if (hasTerminate || hasBusy || hasTimers || ir.guards.length || (debugInfo && ir.states.length)) hl("#include <stdbool.h>");
  hl();
  hl("#ifdef __cplusplus");
  hl('extern "C" {');
  hl("#endif");
  hl();
  hl("/*");
  hl(` * Usage: call ${prefix}init() once, then ${ir.events.length ? `${prefix}process() for every event` : `${prefix}reset() to restart`}.`);
  hl(` * They return ${status.ok} or a negative ${P}ERR_* code; after an error the`);
  hl(` * machine is in an undefined state until ${prefix}reset() is called.`);
  if (hasBusy) {
    hl(` * Until then ${prefix}process() returns ${status.busy}, as it does when`);
    hl(" * called while another call runs (from an action or guard, or from an");
    hl(" * interrupt handler); such a call changes nothing and the event is lost.");
  }
  const extras = [...(hasTimers ? ["the timer functions"] : []), ...(trace ? ["the trace hook"] : [])];
  hl(` * The application implements the actions and guards${extras.length ? ` (and ${extras.join(" and ")})` : ""} declared at the end`);
  hl(` * of this file; each gets the user pointer passed to ${prefix}init().`);
  if (hasTimers) {
    hl(` * ${prefix}timer_start() starts a timer (periodic: it expires every ms until stopped,`);
    hl(` * the application re-arms it); ${prefix}timer_stop() stops it and does nothing for a`);
    hl(" * timer that is not running. After it returns, no expiry of the earlier start");
    hl(` * should be delivered. On expiry, pass ${prefix}timer_event(timer) to ${prefix}process().`);
    hl(` * Both are called inside ${prefix}init(), ${prefix}reset() and ${prefix}process(): they must not`);
    hl(" * block or call the machine.");
  }
  if (trace) {
    hl(` * ${prefix}trace() is called inside ${prefix}init(), ${prefix}reset() and ${prefix}process()`);
    hl(" * with ids only (event, signal, transition, entered and exited state); it must");
    hl(" * not block or call the machine. Timestamps and transport are up to it.");
  }
  hl(` * ${P}FINGERPRINT identifies the numbering of events, signals, states and`);
  hl(" * transitions (`ufsm info` prints it for a model file).");
  hl(" */");
  hl();
  hl(`enum ${prefix}status {`);
  hl(`    ${status.ok} = 0,`);
  hl(`    ${status.queue} = -1, /* signal queue full */`);
  hl(`    ${status.livelock} = -2, /* too many microsteps in one call */`);
  hl(`    ${status.event} = -3, /* unknown event */`);
  hl(`    ${status.busy} = -4, /* an earlier call failed, or this one was made from inside a call */`);
  hl("};");
  hl();
  if (ir.events.length) {
    hl(`enum ${prefix}event {`);
    ir.events.forEach((e, i) => hl(`    ${name.get(e.id)} = ${i},`));
    hl("};");
    hl();
  }
  if (publicSignals) {
    hl(`enum ${prefix}signal {`);
    ir.signals.forEach((x, i) => hl(`    ${name.get(x.id)} = ${i},`));
    hl("};");
    hl();
  }
  if (ir.states.length) {
    hl("/* States in document order. */");
    hl(`enum ${prefix}state {`);
    ir.states.forEach((st, i) => hl(`    ${stateConst.get(i)} = ${i},${st.label !== st.ident ? ` /* ${comment(st.label)} */` : ""}`));
    hl("};");
    hl();
  }
  hl(`#define ${P}FINGERPRINT ${hex32(ir.fingerprint)}u`);
  hl();
  if (hasTimers) {
    hl("/* Timers: started when their state is entered, stopped when it is left. */");
    hl(`enum ${prefix}timer {`);
    ir.timers.forEach((t, i) => hl(`    ${timerConst(i)} = ${i}, /* ${t.periodic ? "every" : "after"} ${t.ms} ms -> ${comment(ir.events[t.event]!.name)} */`));
    hl("};");
    hl(`#define ${P}TIMER_COUNT ${ir.timers.length}`);
    hl();
  }
  if (trace) {
    hl(`enum ${prefix}trace_kind {`);
    hl(`    ${traceConst("event")} = 0, /* id: enum ${prefix}event; process() accepted it */`);
    hl(`    ${traceConst("signal")} = 1, /* id: ${publicSignals ? `enum ${prefix}signal` : "signal number"}; taken from the queue */`);
    hl(`    ${traceConst("transition")} = 2, /* id: transition number (below); before its actions */`);
    hl(`    ${traceConst("enter")} = 3, /* id: enum ${prefix}state; before its entry actions */`);
    hl(`    ${traceConst("exit")} = 4, /* id: enum ${prefix}state; before its exit actions */`);
    hl("};");
    hl();
    if (ir.transitions.length) {
      hl("/*");
      hl(" * Transition numbers:");
      ir.transitions.forEach((t, i) => hl(` *   ${i} ${comment(t.label)}`));
      hl(" */");
      hl();
    }
  }
  hl(`/* Treat as opaque; zero-initialized storage is fine before ${prefix}init(). */`);
  hl(`${machine} {`);
  hl(`    ${slotT} cfg[${ir.regions}]; /* active state per region, 0 = none */`);
  if (ir.history.length) hl(`    ${slotT} hist[${ir.history.length}]; /* recorded history per history region, 0 = none */`);
  for (const dh of deepRegions) hl(`    ${slotT} deep_r${dh.region}[${dh.snapshotTo! - dh.snapshotFrom!}]; /* deep history of region ${dh.region} */`);
  if (hasQueue) {
    hl(`    ${sigT} queue[${signalQueue}]; /* pending signals (FIFO) */`);
    hl(`    ${queueT} queue_head;`);
    hl(`    ${queueT} queue_len;`);
  }
  if (checkSteps) hl(`    ${stepsT} steps; /* microsteps in the current call */`);
  if (hasTerminate) hl("    bool terminated;");
  if (hasBusy) hl("    bool busy; /* a call is running, or one did not finish */");
  hl("    void *user;");
  hl("};");
  hl();
  hl(`int ${prefix}init(${machine} *m, void *user);`);
  hl(`int ${prefix}reset(${machine} *m);`);
  if (ir.events.length) hl(`int ${prefix}process(${machine} *m, enum ${prefix}event event);`);
  if (hasTimers) {
    hl();
    hl("/* The event to process when a timer expires. */");
    hl(`enum ${prefix}event ${prefix}timer_event(enum ${prefix}timer timer);`);
  }
  if (debugInfo && (ir.events.length || ir.signals.length || ir.states.length)) {
    hl();
    hl("/* Names as in the model; NULL for a number out of range. */");
    if (ir.events.length) hl(`const char *${prefix}event_name(uint16_t event);`);
    if (ir.signals.length) hl(`const char *${prefix}signal_name(uint16_t signal);`);
    if (ir.states.length) {
      hl(`const char *${prefix}state_name(uint16_t state);`);
      hl(`bool ${prefix}is_active(const ${machine} *m, uint16_t state);`);
    }
    if (hasTimers) hl(`const char *${prefix}timer_name(uint16_t timer);`);
  }
  if (ir.actions.length || ir.guards.length || trace || hasTimers) {
    hl();
    hl("/* Implemented by the application */");
    for (const a of ir.actions) hl(`void ${name.get(a.id)}(void *user);`);
    for (const g of ir.guards) hl(`bool ${name.get(g.id)}(void *user);`);
    if (hasTimers) {
      hl(`void ${prefix}timer_start(void *user, enum ${prefix}timer timer, uint32_t ms, bool periodic);`);
      hl(`void ${prefix}timer_stop(void *user, enum ${prefix}timer timer);`);
    }
    if (trace) hl(`void ${prefix}trace(void *user, enum ${prefix}trace_kind kind, uint16_t id);`);
  }
  hl();
  hl("#ifdef __cplusplus");
  hl("}");
  hl("#endif");
  hl();
  hl(`#endif /* ${guard} */`);
  return `${h.join("\n")}\n`;
}

/** The source file: the runtime (queue, settle, init/reset/process), one C function per IR function, lookups. */
function cSource(ctx: CContext): string {
  const w = lines("    ");
  const st = cStatements(ctx, w);
  cSourceTop(ctx, w, st);
  cFunctions(ctx, w, st);
  cSettle(ctx, w);
  cEntryPoints(ctx, w, st);
  cDebugInfo(ctx, w);
  return w.text();
}

/** Includes, the region map, private signal numbers, prototypes and the signal queue. */
function cSourceTop(ctx: CContext, w: Lines, { signature }: CStatements): void {
  const { ir, file, machine, histIndex, sigT, queueT, name, publicSignals, status, signalQueue, hasQueue } = ctx;
  const { line } = w;
  line(0, `/* Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit. */`);
  line(0, `/* ${OUTPUT_NOTICE} */`);
  line(0, `#include "${file}.h"`);
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
  if (hasQueue && !publicSignals) {
    line(0, "");
    line(0, "enum {");
    ir.signals.forEach((s, i) => line(1, `${name.get(s.id)} = ${i},`));
    line(0, "};");
  }
  line(0, "");
  for (const f of ir.functions) line(0, `${signature(f)};`);
  if (hasQueue) {
    line(0, "");
    line(0, `static int push_signal(${machine} *m, ${sigT} signal)`);
    line(0, "{");
    line(1, `if (m->queue_len == ${signalQueue}u) {`);
    line(2, `return ${status.queue};`);
    line(1, "}");
    line(1, `m->queue[(m->queue_head + m->queue_len) % ${signalQueue}u] = signal;`);
    line(1, "m->queue_len++;");
    line(1, `return ${status.ok};`);
    line(0, "}");
    line(0, "");
    line(0, `static ${sigT} pop_signal(${machine} *m)`);
    line(0, "{");
    line(1, `${sigT} signal = m->queue[m->queue_head];`);
    line(1, `m->queue_head = (${queueT})((m->queue_head + 1u) % ${signalQueue}u);`);
    line(1, "m->queue_len--;");
    line(1, "return signal;");
    line(0, "}");
  }
}

/** One static function per IR function. */
function cFunctions(ctx: CContext, w: Lines, { stmts, signature, needsRc }: CStatements): void {
  const { ir, status, fallible } = ctx;
  const { line } = w;
  for (const f of ir.functions) {
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
}

/** settle(): eventless transitions and queued signals until the machine is stable. */
function cSettle(ctx: CContext, w: Lines): void {
  const { ir, prefix, machine, sigT, name, traceConst, status, settleBody, trace, hasQueue, hasTerminate } = ctx;
  const { line } = w;
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
      let popped = "pop_signal(m)";
      if (trace) {
        line(2, `${sigT} sig = pop_signal(m);`);
        line(2, `${prefix}trace(m->user, ${traceConst("signal")}, (uint16_t)sig);`);
        popped = "sig";
      }
      if (reacting.length) {
        line(2, `switch (${popped}) {`);
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
      } else if (!trace) line(2, "(void)pop_signal(m);");
    } else {
      line(2, `return ${status.ok};`);
    }
    line(1, "}");
    line(0, "}");
  }
}

/** init(), reset() and process(), and the timer event lookup. */
function cEntryPoints(ctx: CContext, w: Lines, { stmts, needsRc }: CStatements): void {
  const {
    ir, prefix, machine, name, traceConst, status, hasBusy, settleBody, trace, hasQueue, hasTerminate, hasTimers,
    checkSteps,
  } = ctx;
  const { line } = w;
  // End of reset/process: settle, then clear the busy latch (an error returns early and leaves it set).
  const finish = (d: number): void => {
    if (!hasBusy) {
      line(d, settleBody ? "return settle(m);" : `return ${status.ok};`);
      return;
    }
    if (settleBody) {
      line(d, "rc = settle(m);");
      line(d, "if (rc < 0) {");
      line(d + 1, "return rc;");
      line(d, "}");
    }
    line(d, "m->busy = false;");
    line(d, `return ${status.ok};`);
  };

  line(0, "");
  line(0, `int ${prefix}init(${machine} *m, void *user)`);
  line(0, "{");
  line(1, "m->user = user;");
  line(1, `return ${prefix}reset(m);`);
  line(0, "}");

  line(0, "");
  line(0, `int ${prefix}reset(${machine} *m)`);
  line(0, "{");
  if (needsRc(ir.start) || (hasBusy && settleBody)) line(1, "int rc;");
  if (hasBusy) line(1, "m->busy = true;");
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
    if (reacting.length || settleBody) line(1, "int rc;");
    line(1, `if ((int)event < 0 || (int)event >= ${ir.events.length}) {`);
    line(2, `return ${status.event};`);
    line(1, "}");
    line(1, "if (m->busy) {");
    line(2, `return ${status.busy};`);
    line(1, "}");
    if (hasTerminate) {
      line(1, "if (m->terminated) {");
      line(2, `return ${status.ok};`);
      line(1, "}");
    }
    line(1, "m->busy = true;");
    if (checkSteps) line(1, "m->steps = 0u;");
    if (trace) line(1, `${prefix}trace(m->user, ${traceConst("event")}, (uint16_t)event);`);
    if (reacting.length) {
      line(1, "switch (event) {");
      for (const e of reacting) {
        line(1, `case ${name.get(e.id)}:`);
        line(2, `rc = ${ir.onEvent[e.id]}(m);`);
        line(2, "break;");
      }
      line(1, "default:");
      line(2, "rc = 0;");
      line(2, "break;");
      line(1, "}");
      line(1, "if (rc < 0) {");
      line(2, "return rc;");
      line(1, "}");
    }
    finish(1);
    line(0, "}");
  }

  if (hasTimers) {
    line(0, "");
    line(0, `static const enum ${prefix}event timer_events[${ir.timers.length}] = {`);
    for (const t of ir.timers) line(1, `${name.get(ir.events[t.event]!.id)},`);
    line(0, "};");
    line(0, "");
    line(0, `enum ${prefix}event ${prefix}timer_event(enum ${prefix}timer timer)`);
    line(0, "{");
    line(1, "return timer_events[timer];");
    line(0, "}");
  }
}

/** Name lookups and is_active() (debugInfo). */
function cDebugInfo(ctx: CContext, w: Lines): void {
  const { ir, prefix, machine, slotT, debugInfo, hasTimers } = ctx;
  const { line } = w;
  if (debugInfo) {
    const lookup = (fn: string, param: string, table: string, names: string[]): void => {
      line(0, "");
      line(0, `static const char *const ${table}[${names.length}] = {`);
      for (const n of names) line(1, `${cString(n)},`);
      line(0, "};");
      line(0, "");
      line(0, `const char *${prefix}${fn}(uint16_t ${param})`);
      line(0, "{");
      line(1, `return ${param} < ${names.length} ? ${table}[${param}] : (const char *)0;`);
      line(0, "}");
    };
    if (ir.events.length) lookup("event_name", "event", "event_names", ir.events.map((e) => e.name));
    if (ir.signals.length) lookup("signal_name", "signal", "signal_names", ir.signals.map((x) => x.name));
    if (ir.states.length) {
      lookup("state_name", "state", "state_names", ir.states.map((st) => st.label));
      line(0, "");
      line(0, `static const ${uintType(ir.regions - 1)} state_region[${ir.states.length}] = {${ir.states.map((st) => `${st.region}u`).join(", ")}};`);
      line(0, `static const ${slotT} state_slot[${ir.states.length}] = {${ir.states.map((st) => `${st.slot}u`).join(", ")}};`);
      line(0, "");
      line(0, `bool ${prefix}is_active(const ${machine} *m, uint16_t state)`);
      line(0, "{");
      line(1, `return state < ${ir.states.length} && m->cfg[state_region[state]] == state_slot[state];`);
      line(0, "}");
    }
    if (hasTimers) lookup("timer_name", "timer", "timer_names", ir.timers.map((t) => t.name));
  }
}
