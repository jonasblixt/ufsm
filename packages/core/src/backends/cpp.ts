// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * C++ backend: prints an IrModule as one header-only C++11 file.
 *
 * Everything lives in a namespace (`targets.cpp.namespace`, default: the model name in lower case). The machine is a
 * class template over the application's handler type, so actions and guards are plain member calls the compiler can
 * inline: no virtual functions, no heap, no exceptions thrown, no RTTI, nothing beyond <cstdint>. It is as static as the
 * C output and builds with `-fno-exceptions -fno-rtti`. The runtime loop (reset/process/settle) is the one described
 * in ir/ir.ts; errors are returned as `Status` values, every private function that can fail returns a negative code
 * upwards (as in the C backend). An exception from the handler is not caught: it leaves the machine busy until
 * reset(), as in the interpreter.
 *
 * Always: the `State` enum (document order) and `fingerprint`. With `debugInfo`: name lookup for events, signals,
 * states and timers and `is_active()`. With `trace` (decided by the IR): `TraceKind` and a call to the handler's
 * `trace(kind, id)`. With timers in the model: the `Timer` enum, the handler's `timer_start()` and `timer_stop()`, and
 * `timer_event()`, the event to process when a timer expires.
 */
import type { UfsmDocument } from "../format/model";
import { IDENTIFIER } from "../format/model";
import { UFSM_VERSION } from "../version";
import type { Expr, IrHistory, IrModule, Stmt, SwitchOn } from "../ir/ir";
import { TRACE_KINDS } from "../ir/ir";
import { walkStmts } from "../ir/analyze";
import { hex32, utf8 } from "../ir/ids";
import {
  CodegenError,
  OUTPUT_NOTICE,
  identifier,
  lines,
  pascalCase,
  prepare,
  readTargetOptions,
  type CommonOptions,
  type Lines,
  type Prepared,
  type Printed,
} from "./common";

export interface CppOptions extends CommonOptions {
  /** Name of the machine class template. Default: the model name in PascalCase. */
  className?: string;
  /** The namespace everything is declared in. Default: the model name as an identifier, in lower case. */
  namespace?: string;
  /** Base name of the file: `<file>.hpp`. Default: the namespace. */
  file?: string;
}

export interface CppFiles {
  fileName: string;
  source: string;
}

const CPP_KEYWORDS = new Set(
  (
    "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl " +
    "concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete " +
    "do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable " +
    "namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast " +
    "requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw " +
    "true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq final override " +
    "import module NULL"
  ).split(" "),
);

/** Macros <cstdint> may define: a declaration with one of these names would be replaced by the preprocessor. */
const CSTDINT_MACRO =
  /^(U?INT(_LEAST|_FAST)?(8|16|32|64)_(MIN|MAX|C)|U?INT(MAX|PTR)_(MIN|MAX|C)|SIZE_MAX|PTRDIFF_(MIN|MAX)|SIG_ATOMIC_(MIN|MAX)|WCHAR_(MIN|MAX)|WINT_(MIN|MAX))$/;

/** The keys of `targets.cpp` besides the API options. */
export const CPP_TARGET_KEYS = ["className", "namespace", "file"] as const;

/** Read `targets.cpp`. Unknown keys and wrong types are reported, not fatal: the defaults are used instead. */
export function cppOptionsFromTargets(doc: UfsmDocument): { options: CppOptions; problems: string[] } {
  return readTargetOptions(doc, "cpp", CPP_TARGET_KEYS);
}

/** Name of a declaration in C++: as written, a keyword with a trailing underscore (`not` -> `not_`). */
export function cppName(name: string): string {
  return CPP_KEYWORDS.has(name) ? `${name}_` : name;
}

/** The default namespace of a model: "Dimmer" -> "dimmer", "New model" -> "new_model". */
export function cppNamespace(text: string): string {
  return identifier(text).toLowerCase();
}

/** Smallest unsigned fixed-width type that holds 0..max. */
function uintType(max: number): string {
  return max <= 0xff ? "std::uint8_t" : max <= 0xffff ? "std::uint16_t" : "std::uint32_t";
}

/** A C++ string literal; `"`, `\`, control characters, non-ASCII bytes (UTF-8) and trigraph starts are escaped. */
function cppString(text: string): string {
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

/** Text that is safe in a `//` comment (no line breaks, no backslash at the end that would continue it). */
function comment(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/\\+$/, "");
}

/** Names, sizes and facts every part of the C++ printer uses. */
interface CppContext extends Prepared {
  ir: IrModule;
  ns: string;
  file: string;
  cls: string;
  /** C++ name of every declaration, by id. */
  name: Map<string, string>;
  stateConst: string[];
  timerConst: string[];
  /** Index into `hist_` of each history region. */
  histIndex: Map<number, number>;
  /** Deep history regions with something to snapshot. */
  deepRegions: IrHistory[];
  slotT: string;
  sigT: string;
  queueT: string;
  stepsT: string;
  /** Signals get a public enum when the application sees their numbers (trace hook, name lookup). */
  publicSignals: boolean;
  /** settle() has something to do: eventless transitions, queued signals or terminate. */
  settleBody: boolean;
  /** A state's name for a comment, by region and slot. */
  stateName(region: number, slot: number): string;
}

function cppContext(ir: IrModule, options: CppOptions): CppContext {
  const cls = options.className ?? pascalCase(ir.name);
  const ns = options.namespace ?? cppNamespace(ir.name);
  const file = options.file ?? ns;
  const prepared = prepare(ir, options);
  const { signalQueue, maxMicrosteps, trace, debugInfo, hasQueue, hasTerminate, hasTimers } = prepared;
  const publicSignals = (trace || debugInfo) && ir.signals.length > 0;
  // Names the namespace declares besides the machine class.
  const fixed = new Map<string, string>([
    ["Status", "the status enum"],
    ["status_code", "the status code function"],
    ["Event", "the event enum"],
    ["State", "the state enum"],
    ["fingerprint", "the fingerprint"],
    ...(publicSignals ? ([["Signal", "the signal enum"]] as [string, string][]) : []),
    ...(trace ? ([["TraceKind", "the trace kind enum"]] as [string, string][]) : []),
    ...(hasTimers
      ? ([
          ["Timer", "the timer enum"],
          ["timer_count", "the number of timers"],
          ["timer_event", "the timer event function"],
        ] as [string, string][])
      : []),
    ...(debugInfo
      ? (["event_name", "signal_name", "state_name", "timer_name"].map((n) => [n, "a debugInfo function"]) as [
          string,
          string,
        ][])
      : []),
  ]);
  for (const [what, id] of [
    ["class name", cls],
    ["namespace", ns],
  ] as const)
    if (!IDENTIFIER.test(id) || CPP_KEYWORDS.has(id) || CSTDINT_MACRO.test(id) || id === "std")
      throw new CodegenError(`C++ ${what} '${id}' is not a usable identifier`);
  if (fixed.has(cls)) throw new CodegenError(`C++ class name '${cls}' is ${fixed.get(cls)}`);
  if (!/^[A-Za-z0-9_.-]+$/.test(file)) throw new CodegenError(`C++ file name '${file}' is not a plain file name`);

  const name = new Map<string, string>();
  for (const d of [...ir.events, ...ir.signals, ...ir.actions, ...ir.guards]) name.set(d.id, cppName(d.name));
  const stateConst = ir.states.map((st) => cppName(st.ident));
  const timerConst = ir.timers.map((t) => cppName(t.name));

  // Names within one enum, and the handler's methods, must stay apart after the keyword underscore.
  const problems: string[] = [];
  const group = (entries: [string, string][], taken: [string, string][] = []): void => {
    const seen = new Map<string, string>(taken);
    for (const [id, what] of entries) {
      if (CSTDINT_MACRO.test(id)) problems.push(`${what} is a macro of <cstdint>`);
      else if (seen.has(id)) problems.push(`${what} becomes '${id}', like ${seen.get(id)}`);
      else seen.set(id, what);
    }
  };
  group(ir.events.map((e) => [name.get(e.id)!, `event '${e.name}'`]));
  group(ir.signals.map((s) => [name.get(s.id)!, `signal '${s.name}'`]));
  group(ir.states.map((st, i) => [stateConst[i]!, `state '${st.label}'`]));
  group(ir.timers.map((t, i) => [timerConst[i]!, `timer '${t.name}'`]));
  group(
    [
      ...ir.actions.map((a): [string, string] => [name.get(a.id)!, `action '${a.name}'`]),
      ...ir.guards.map((g): [string, string] => [name.get(g.id)!, `guard '${g.name}'`]),
    ],
    [
      ...(hasTimers
        ? ([
            ["timer_start", "a timer function of the handler"],
            ["timer_stop", "a timer function of the handler"],
          ] as [string, string][])
        : []),
      ...(trace ? ([["trace", "the trace hook"]] as [string, string][]) : []),
    ],
  );
  if (problems.length)
    throw new CodegenError(`names that clash in the generated C++ (rename them):\n  ${problems.join("\n  ")}`);

  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const maxSlot = Math.max(0, ...ir.states.map((s) => s.slot));
  return {
    ...prepared,
    ...{ ir, ns, file, cls, name, stateConst, timerConst },
    histIndex: new Map(ir.history.map((h, k) => [h.region, k])),
    deepRegions: ir.history.filter((h) => h.kind === "deep" && h.snapshotTo! > h.snapshotFrom!),
    slotT: uintType(maxSlot),
    sigT: uintType(Math.max(0, ir.signals.length - 1)),
    queueT: uintType(signalQueue),
    stepsT: uintType(maxMicrosteps + 1),
    publicSignals,
    settleBody: hasTerminate || ir.eventless !== undefined || hasQueue,
    stateName: (region, slot) => comment(stateAt.get(`${region}:${slot}`) ?? `slot ${slot}`),
  };
}

export function generateCpp(ir: IrModule, options: CppOptions = {}): CppFiles {
  const ctx = cppContext(ir, options);
  const w = lines("    ");
  cppPreamble(ctx, w);
  cppEnums(ctx, w);
  cppClass(ctx, w);
  cppEnd(ctx, w);
  return { fileName: `${ctx.file}.hpp`, source: w.text() };
}

/** The C++ text of an IR condition. */
function cppExpressions(ctx: CppContext): (e: Expr) => string {
  const { histIndex, name } = ctx;
  const wrap = (x: Printed, min: number): string => (x.p < min ? `(${x.s})` : x.s);
  const expr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "true", p: 3 };
      case "active":
        return { s: `cfg_[${e.region}] == ${e.slot}u`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "false", p: 3 };
        if (e.slots.length === 1) return { s: `cfg_[${e.region}] == ${e.slots[0]}u`, p: 2 };
        return { s: e.slots.map((x) => `cfg_[${e.region}] == ${x}u`).join(" || "), p: 0 };
      case "hasHistory":
        return { s: `hist_[${histIndex.get(e.region)}] != 0u`, p: 2 };
      case "guard":
        return { s: `h_.${name.get(e.guard)}()`, p: 3 };
      case "flag":
        return { s: e.name, p: 3 };
      case "not":
        return notExpr(e.expr);
      case "and":
        return { s: e.exprs.map((x) => wrap(expr(x), 1)).join(" && "), p: 1 };
      case "or":
        // gcc asks for parentheses around `&&` inside `||`
        return {
          s: e.exprs
            .map((x) => {
              const y = expr(x);
              return y.p === 1 ? `(${y.s})` : y.s;
            })
            .join(" || "),
          p: 0,
        };
    }
  };
  const notExpr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "false", p: 3 };
      case "active":
        return { s: `cfg_[${e.region}] != ${e.slot}u`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "true", p: 3 };
        if (e.slots.length === 1) return { s: `cfg_[${e.region}] != ${e.slots[0]}u`, p: 2 };
        return { s: e.slots.map((x) => `cfg_[${e.region}] != ${x}u`).join(" && "), p: 1 };
      case "hasHistory":
        return { s: `hist_[${histIndex.get(e.region)}] == 0u`, p: 2 };
      case "not":
        return expr(e.expr);
      default:
        return { s: `!${wrap(expr(e), 3)}`, p: 3 };
    }
  };
  return (e) => expr(e).s;
}

/** What a function returns for an error code in `rc`, and for a livelock: an int inside, a Status in reset(). */
interface Fail {
  rc: string;
  livelock: string;
}
const INTERNAL: Fail = { rc: "return rc;", livelock: "return rc_livelock;" };
const PUBLIC: Fail = { rc: "return static_cast<Status>(rc);", livelock: "return Status::livelock;" };

interface CppStatements {
  stmts(list: Stmt[], d: number, fail: Fail): void;
  /** Does a body need the `rc` variable (it calls something that can fail)? */
  needsRc(body: Stmt[]): boolean;
}

/** The statement printer, writing into `w`. */
function cppStatements(ctx: CppContext, w: Lines): CppStatements {
  const { ir, name, stateConst, timerConst, histIndex, maxMicrosteps, checkSteps, fallible } = ctx;
  const { line } = w;
  const cond = cppExpressions(ctx);
  const check = (d: number, call: string, fail: Fail): void => {
    line(d, `rc = ${call};`);
    line(d, "if (rc < 0) {");
    line(d + 1, fail.rc);
    line(d, "}");
  };
  const switchOn = (o: SwitchOn): string =>
    o.kind === "cfg"
      ? `cfg_[${o.region}]`
      : o.kind === "hist"
        ? `hist_[${histIndex.get(o.region)}]`
        : `deep_r${o.history}_[${o.index}]`;
  const caseRegion = (o: SwitchOn): number =>
    o.kind === "deep" ? ir.history.find((h) => h.region === o.history)!.snapshotFrom! + o.index : o.region;

  const stmts = (list: Stmt[], d: number, fail: Fail): void => {
    for (const s of list) {
      switch (s.op) {
        case "if": {
          if (s.then.length === 0 && !s.else) {
            line(d, `static_cast<void>(${cond(s.cond)});`); // kept for the guard calls it makes, as in C
            break;
          }
          line(d, `if (${cond(s.cond)}) {`);
          stmts(s.then, d + 1, fail);
          let els = s.else;
          while (els && els.length === 1 && els[0]!.op === "if") {
            const e = els[0] as Extract<Stmt, { op: "if" }>;
            line(d, `} else if (${cond(e.cond)}) {`);
            stmts(e.then, d + 1, fail);
            els = e.else;
          }
          if (els && els.length) {
            line(d, "} else {");
            stmts(els, d + 1, fail);
          }
          line(d, "}");
          break;
        }
        case "switch": {
          line(d, `switch (${switchOn(s.on)}) {`);
          const region = caseRegion(s.on);
          for (const c of s.cases) {
            line(d, `case ${c.slot}u: // ${ctx.stateName(region, c.slot)}`);
            stmts(c.body, d + 1, fail);
            if (c.body[c.body.length - 1]?.op !== "return") line(d + 1, "break;");
          }
          line(d, "default:");
          line(d + 1, "break;");
          line(d, "}");
          break;
        }
        case "set":
          line(
            d,
            s.slot === 0
              ? `cfg_[${s.region}] = 0u;`
              : `cfg_[${s.region}] = ${s.slot}u; // ${ctx.stateName(s.region, s.slot)}`,
          );
          break;
        case "call":
          line(d, `h_.${name.get(s.action)}();`);
          break;
        case "emit":
          check(d, `push_signal_(${ir.signals.findIndex((x) => x.id === s.signal)}u)`, fail);
          break;
        case "setFlag":
          line(d, `${s.name} = true;`);
          break;
        case "invoke":
          if (fallible.has(s.fn)) check(d, `${s.fn}()`, fail);
          else line(d, `${s.fn}();`);
          break;
        case "saveHistory":
          line(d, `hist_[${histIndex.get(s.region)}] = cfg_[${s.region}];`);
          break;
        case "clearHistory":
          line(d, `hist_[${histIndex.get(s.region)}] = 0u;`);
          break;
        case "saveDeep": {
          const h = ir.history.find((x) => x.region === s.region)!;
          for (let k = 0; k < h.snapshotTo! - h.snapshotFrom!; k++)
            line(d, `deep_r${s.region}_[${k}] = cfg_[${h.snapshotFrom! + k}];`);
          break;
        }
        case "microstep":
          if (!checkSteps) break;
          line(d, `if (++steps_ > ${maxMicrosteps}u) {`);
          line(d + 1, fail.livelock);
          line(d, "}");
          break;
        case "trace":
          if (s.hook === "transition")
            line(d, `h_.trace(TraceKind::transition, ${s.index}u); // ${comment(ir.transitions[s.index]!.label)}`);
          else line(d, `h_.trace(TraceKind::${s.hook}, static_cast<std::uint16_t>(State::${stateConst[s.index]}));`);
          break;
        case "timerStart": {
          const t = ir.timers[s.timer]!;
          line(d, `h_.timer_start(Timer::${timerConst[s.timer]}, ${t.ms}u, ${t.periodic});`);
          break;
        }
        case "timerStop":
          line(d, `h_.timer_stop(Timer::${timerConst[s.timer]});`);
          break;
        case "terminate":
          line(d, "terminated_ = true;");
          break;
        case "return":
          line(d, `return ${s.value ? 1 : 0};`);
          break;
      }
    }
  };
  const needsRc = (body: Stmt[]): boolean => {
    let need = false;
    walkStmts(body, (s) => void (need ||= s.op === "emit" || (s.op === "invoke" && fallible.has(s.fn))));
    return need;
  };
  return { stmts, needsRc };
}

/** The include guard, usage, the include and the namespace. */
function cppPreamble(ctx: CppContext, w: Lines): void {
  const { ir, ns, file, cls, hasTimers, trace } = ctx;
  const { line } = w;
  const guard = `UFSM_${identifier(file).toUpperCase()}_HPP`;
  line(0, `// Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit.`);
  line(0, `// ${OUTPUT_NOTICE}`);
  line(0, `#ifndef ${guard}`);
  line(0, `#define ${guard}`);
  line(0, "");
  line(0, "#include <cstdint>");
  line(0, "");
  line(0, "// Usage (C++11 or later):");
  line(0, "//");
  const make = `${ns}::${cls}<MyHandler> machine(handler);`;
  const start = `${ns}::Status s = machine.reset();`;
  const width = Math.max(make.length, start.length) + 1;
  line(0, `//     ${make.padEnd(width)}// MyHandler has the actions and guards`);
  line(0, `//     ${start.padEnd(width)}// start; also restarts (no exit actions run)`);
  if (ir.events.length) line(0, `//     s = machine.process(${ns}::Event::${ctx.name.get(ir.events[0]!.id)});`);
  line(0, "//");
  line(0, "// reset() and process() return Status::ok or an error; after an error the machine is in");
  line(0, "// an undefined state until reset(), and process() returns Status::busy until then, as it");
  line(0, "// does when called from inside an action or guard (such a call changes nothing). The");
  line(0, "// handler is any class with one method per action (void) and guard (bool), named as in");
  line(0, "// the model; a missing one is a compile error where the class template is instantiated.");
  if (hasTimers || trace) {
    line(0, "// The handler also has these; they run inside reset() and process() and must not block or");
    line(0, "// call the machine:");
    if (hasTimers) {
      line(0, "//     void timer_start(Timer timer, std::uint32_t ms, bool periodic);");
      line(0, "//     void timer_stop(Timer timer);");
    }
    if (trace) line(0, "//     void trace(TraceKind kind, std::uint16_t id);");
  }
  line(0, "");
  line(0, `namespace ${ns} {`);
}

/** Status, the enumerations, the fingerprint, timer events and name lookup. */
function cppEnums(ctx: CppContext, w: Lines): void {
  const { ir, name, stateConst, timerConst, publicSignals, debugInfo, hasTimers, trace, cls } = ctx;
  const { line } = w;
  line(0, "");
  line(0, "enum class Status : std::int8_t {");
  line(1, "ok = 0,");
  line(1, "queue_overflow = -1, // signal queue full");
  line(1, "livelock = -2, // too many microsteps in one call");
  line(1, "unknown_event = -3, // not an Event");
  line(1, "busy = -4, // an earlier call failed, or this one was made from inside a call");
  line(1, "not_started = -5, // process() before reset()");
  line(0, "};");
  line(0, "");
  line(0, '// The error code every uFSM target uses ("queue-overflow", "livelock", ...); "ok" for Status::ok.');
  line(0, "inline const char *status_code(Status status)");
  line(0, "{");
  line(1, "switch (status) {");
  for (const [k, v] of [
    ["ok", "ok"],
    ["queue_overflow", "queue-overflow"],
    ["livelock", "livelock"],
    ["unknown_event", "unknown-event"],
    ["busy", "busy"],
    ["not_started", "not-started"],
  ]) {
    line(1, `case Status::${k}:`);
    line(2, `return "${v}";`);
  }
  line(1, "}");
  line(1, 'return "unknown";');
  line(0, "}");
  /** An enum class numbered from 0, with comments. */
  const enumeration = (type: string, base: string, doc: string | undefined, items: [string, string?][]): void => {
    line(0, "");
    if (doc) line(0, `// ${doc}`);
    line(0, `enum class ${type} : ${base} {`);
    items.forEach(([n, c], i) => line(1, `${n} = ${i},${c ? ` // ${comment(c)}` : ""}`));
    line(0, "};");
  };
  enumeration(
    "Event",
    "std::uint16_t",
    undefined,
    ir.events.map((e) => [name.get(e.id)!]),
  );
  if (publicSignals)
    enumeration(
      "Signal",
      "std::uint16_t",
      undefined,
      ir.signals.map((s) => [name.get(s.id)!]),
    );
  enumeration(
    "State",
    "std::uint16_t",
    "States in document order.",
    ir.states.map((st, i) => [stateConst[i]!, st.label !== stateConst[i] ? st.label : undefined]),
  );
  line(0, "");
  line(0, "// Identifies the numbering of events, signals, states and transitions (`ufsm info` prints it).");
  line(0, `constexpr std::uint32_t fingerprint = ${hex32(ir.fingerprint)}u;`);
  if (hasTimers) {
    enumeration(
      "Timer",
      "std::uint16_t",
      "Timers: started when their state is entered, stopped when it is left.",
      ir.timers.map((t, i) => [
        timerConst[i]!,
        `${t.periodic ? "every" : "after"} ${t.ms} ms -> ${ir.events[t.event]!.name}`,
      ]),
    );
    line(0, "");
    line(0, `constexpr std::uint16_t timer_count = ${ir.timers.length}u;`);
    line(0, "");
    line(0, "// The event to process when a timer expires.");
    line(0, "inline Event timer_event(Timer timer)");
    line(0, "{");
    line(1, `static const Event events[${ir.timers.length}] = {`);
    for (const t of ir.timers) line(2, `Event::${name.get(ir.events[t.event]!.id)},`);
    line(1, "};");
    line(1, "return events[static_cast<std::uint16_t>(timer)];");
    line(0, "}");
  }
  if (trace) {
    const what = {
      event: "Event; process() accepted it",
      signal: `${publicSignals ? "Signal" : "signal number"}; taken from the queue`,
      transition: `transition number (listed in ${cls}); before its actions`,
      enter: "State; before its entry actions",
      exit: "State; before its exit actions",
    };
    enumeration(
      "TraceKind",
      "std::uint8_t",
      "What the handler's trace(kind, id) reports; the id is a number of the type named here.",
      TRACE_KINDS.map((k) => [k, what[k]]),
    );
  }
  if (debugInfo) {
    const lookup = (fn: string, type: string, names: string[]): void => {
      if (!names.length) return;
      line(0, "");
      line(0, `inline const char *${fn}(${type} value)`);
      line(0, "{");
      line(1, `static const char *const names[${names.length}] = {`);
      for (const n of names) line(2, `${cppString(n)},`);
      line(1, "};");
      line(1, "const std::uint16_t i = static_cast<std::uint16_t>(value);");
      line(1, `return i < ${names.length}u ? names[i] : nullptr;`);
      line(0, "}");
    };
    line(0, "");
    line(0, "// Names as in the model; nullptr for a value out of range.");
    lookup(
      "event_name",
      "Event",
      ir.events.map((e) => e.name),
    );
    if (publicSignals)
      lookup(
        "signal_name",
        "Signal",
        ir.signals.map((s) => s.name),
      );
    lookup(
      "state_name",
      "State",
      ir.states.map((st) => st.label),
    );
    if (hasTimers)
      lookup(
        "timer_name",
        "Timer",
        ir.timers.map((t) => t.name),
      );
  }
}

/** The machine class template. */
function cppClass(ctx: CppContext, w: Lines): void {
  const {
    ir,
    cls,
    name,
    histIndex,
    deepRegions,
    slotT,
    sigT,
    queueT,
    stepsT,
    signalQueue,
    settleBody,
    debugInfo,
    trace,
    hasQueue,
    hasTerminate,
    checkSteps,
    fallible,
  } = ctx;
  const { line } = w;
  const st = cppStatements(ctx, w);
  line(0, "");
  line(0, "// Regions and their states (cfg value: state):");
  ir.regionNames.forEach((n, r) => {
    const slots = ir.states
      .filter((s) => s.region === r)
      .map((s) => `${s.slot}: ${comment(s.name)}`)
      .join(", ");
    const hk = histIndex.get(r);
    const hd = hk === undefined ? "" : ` [${ir.history[hk]!.kind} history: hist[${hk}]]`;
    line(0, `//   ${r} ${comment(n)}: ${slots}${hd}`);
  });
  if (hasQueue) line(0, `// Signals: ${ir.signals.map((s, i) => `${i} ${s.name}`).join(", ")}`);
  if (trace && ir.transitions.length) {
    line(0, "// Transition numbers (trace):");
    ir.transitions.forEach((t, i) => line(0, `//   ${i} ${comment(t.label)}`));
  }
  line(0, "template <typename Handler>");
  line(0, `class ${cls} {`);
  line(0, "public:");
  line(1, "// Stores a reference to the handler; runs nothing until reset().");
  line(1, `explicit ${cls}(Handler &handler) : h_(handler) {}`);
  line(0, "");
  line(1, "Handler &handler() { return h_; }");
  line(0, "");

  // reset
  const finish = (d: number): void => {
    if (settleBody) {
      line(d, "rc = settle_();");
      line(d, "if (rc < 0) {");
      line(d + 1, "return static_cast<Status>(rc);");
      line(d, "}");
    }
    line(d, "busy_ = false;");
    line(d, "return Status::ok;");
  };
  line(1, "// Starts the machine, or restarts it: no exit actions run.");
  line(1, "Status reset()");
  line(1, "{");
  if (st.needsRc(ir.start) || settleBody) line(2, "int rc;");
  line(2, "busy_ = true;");
  line(2, "started_ = true;");
  line(2, `for (unsigned int r = 0u; r < ${ir.regions}u; r++) {`);
  line(3, "cfg_[r] = 0u;");
  line(2, "}");
  if (ir.history.length) {
    line(2, `for (unsigned int r = 0u; r < ${ir.history.length}u; r++) {`);
    line(3, "hist_[r] = 0u;");
    line(2, "}");
  }
  if (hasQueue) {
    line(2, "queue_head_ = 0u;");
    line(2, "queue_len_ = 0u;");
  }
  if (checkSteps) line(2, "steps_ = 0u;");
  if (hasTerminate) line(2, "terminated_ = false;");
  st.stmts(ir.start, 2, PUBLIC);
  finish(2);
  line(1, "}");
  line(0, "");

  // process
  line(1, "// Runs the machine on one event.");
  line(1, "Status process(Event event)");
  line(1, "{");
  const reacting = ir.events.filter((e) => ir.onEvent[e.id]);
  if (reacting.length || settleBody) line(2, "int rc;");
  line(2, "if (!started_) {");
  line(3, "return Status::not_started;");
  line(2, "}");
  if (!ir.events.length) {
    line(2, "static_cast<void>(event);");
    line(2, "return Status::unknown_event;");
  } else {
    line(2, `if (static_cast<std::uint16_t>(event) >= ${ir.events.length}u) {`);
    line(3, "return Status::unknown_event;");
    line(2, "}");
    line(2, "if (busy_) {");
    line(3, "return Status::busy;");
    line(2, "}");
    if (hasTerminate) {
      line(2, "if (terminated_) {");
      line(3, "return Status::ok;");
      line(2, "}");
    }
    line(2, "busy_ = true;");
    if (checkSteps) line(2, "steps_ = 0u;");
    if (trace) line(2, "h_.trace(TraceKind::event, static_cast<std::uint16_t>(event));");
    if (reacting.length) {
      line(2, "switch (event) {");
      for (const e of reacting) {
        line(2, `case Event::${name.get(e.id)}:`);
        line(3, `rc = ${ir.onEvent[e.id]}();`);
        line(3, "break;");
      }
      line(2, "default:");
      line(3, "rc = 0;");
      line(3, "break;");
      line(2, "}");
      line(2, "if (rc < 0) {");
      line(3, "return static_cast<Status>(rc);");
      line(2, "}");
    }
    finish(2);
  }
  line(1, "}");

  if (debugInfo && ir.states.length) {
    line(0, "");
    line(1, "// Whether `state` is active.");
    line(1, "bool is_active(State state) const");
    line(1, "{");
    line(
      2,
      `static const ${uintType(ir.regions - 1)} region[${ir.states.length}] = {${ir.states.map((s) => `${s.region}u`).join(", ")}};`,
    );
    line(2, `static const ${slotT} slot[${ir.states.length}] = {${ir.states.map((s) => `${s.slot}u`).join(", ")}};`);
    line(2, "const std::uint16_t i = static_cast<std::uint16_t>(state);");
    line(2, `return i < ${ir.states.length}u && cfg_[region[i]] == slot[i];`);
    line(1, "}");
  }

  line(0, "");
  line(0, "private:");
  if (hasQueue || checkSteps) {
    line(1, "enum : int {");
    if (hasQueue) line(2, "rc_queue_overflow = -1,");
    if (checkSteps) line(2, "rc_livelock = -2,");
    line(1, "};");
    line(0, "");
  }
  line(1, "Handler &h_;");
  line(1, "bool started_ = false;");
  line(1, "bool busy_ = false; // a call is running, or one did not finish");
  line(1, `${slotT} cfg_[${ir.regions}] = {}; // active state per region, 0 = none`);
  if (ir.history.length) line(1, `${slotT} hist_[${ir.history.length}] = {}; // recorded history per history region`);
  for (const dh of deepRegions)
    line(
      1,
      `${slotT} deep_r${dh.region}_[${dh.snapshotTo! - dh.snapshotFrom!}] = {}; // deep history of region ${dh.region}`,
    );
  if (hasQueue) {
    line(1, `${sigT} queue_[${signalQueue}] = {}; // pending signals (FIFO)`);
    line(1, `${queueT} queue_head_ = 0u;`);
    line(1, `${queueT} queue_len_ = 0u;`);
  }
  if (checkSteps) line(1, `${stepsT} steps_ = 0u; // microsteps in the current call`);
  if (hasTerminate) line(1, "bool terminated_ = false;");

  if (hasQueue) {
    line(0, "");
    line(1, `int push_signal_(${sigT} signal)`);
    line(1, "{");
    line(2, `if (queue_len_ == ${signalQueue}u) {`);
    line(3, "return rc_queue_overflow;");
    line(2, "}");
    line(2, `queue_[(queue_head_ + queue_len_) % ${signalQueue}u] = signal;`);
    line(2, "queue_len_++;");
    line(2, "return 0;");
    line(1, "}");
    line(0, "");
    line(1, `${sigT} pop_signal_()`);
    line(1, "{");
    line(2, `const ${sigT} signal = queue_[queue_head_];`);
    line(2, `queue_head_ = static_cast<${queueT}>((queue_head_ + 1u) % ${signalQueue}u);`);
    line(2, "queue_len_--;");
    line(2, "return signal;");
    line(1, "}");
  }

  if (settleBody) {
    line(0, "");
    line(1, "// Run eventless transitions and queued signals until the machine is stable.");
    line(1, "int settle_()");
    line(1, "{");
    const reactingSignals = ir.signals.filter((x) => ir.onSignal[x.id]);
    if (ir.eventless !== undefined || (hasQueue && reactingSignals.length)) line(2, "int rc;");
    line(2, "for (;;) {");
    if (hasTerminate) {
      line(3, "if (terminated_) {");
      line(4, `for (unsigned int r = 0u; r < ${ir.regions}u; r++) {`);
      line(5, "cfg_[r] = 0u;");
      line(4, "}");
      if (hasQueue) line(4, "queue_len_ = 0u;");
      line(4, "return 0;");
      line(3, "}");
    }
    if (ir.eventless !== undefined) {
      line(3, `rc = ${ir.eventless}();`);
      line(3, "if (rc < 0) {");
      line(4, "return rc;");
      line(3, "}");
      line(3, "if (rc > 0) {");
      line(4, "continue;");
      line(3, "}");
    }
    if (hasQueue) {
      line(3, "if (queue_len_ == 0u) {");
      line(4, "return 0;");
      line(3, "}");
      let popped = "pop_signal_()";
      if (trace) {
        line(3, `const ${sigT} sig = pop_signal_();`);
        line(3, "h_.trace(TraceKind::signal, sig);");
        popped = "sig";
      }
      if (reactingSignals.length) {
        line(3, `switch (${popped}) {`);
        for (const s of reactingSignals) {
          line(3, `case ${ir.signals.indexOf(s)}u: // ${s.name}`);
          line(4, `rc = ${ir.onSignal[s.id]}();`);
          line(4, "break;");
        }
        line(3, "default:");
        line(4, "rc = 0;");
        line(4, "break;");
        line(3, "}");
        line(3, "if (rc < 0) {");
        line(4, "return rc;");
        line(3, "}");
      } else if (!trace) line(3, "static_cast<void>(pop_signal_());");
    } else line(3, "return 0;");
    line(2, "}");
    line(1, "}");
  }

  for (const f of ir.functions) {
    const ret = f.returns === "bool" || fallible.has(f.name) ? "int" : "void";
    line(0, "");
    if (f.doc) line(1, `// ${comment(f.doc)}`);
    line(1, `${ret} ${f.name}()`);
    line(1, "{");
    if (st.needsRc(f.body)) line(2, "int rc;");
    for (const x of f.flags) line(2, `bool ${x} = false;`);
    st.stmts(f.body, 2, INTERNAL);
    if (f.returns === "void" && fallible.has(f.name)) line(2, "return 0;");
    line(1, "}");
  }
  line(0, "};");
}

function cppEnd(ctx: CppContext, w: Lines): void {
  const { ns, file } = ctx;
  w.line(0, "");
  w.line(0, `} // namespace ${ns}`);
  w.line(0, "");
  w.line(0, `#endif // UFSM_${identifier(file).toUpperCase()}_HPP`);
}
