// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Go backend: prints an IrModule as one Go source file, a package of its own.
 *
 * The package is the namespace (one machine per package, as Go code is usually laid out): `dimmer.New(handler)`,
 * `dimmer.EventEButton`, `dimmer.Handler`. The file imports nothing, is exactly what gofmt prints and passes `go vet`.
 * Declaration names become exported Go names, their first letter capitalized (`lamp_off` -> `Lamp_off`, event
 * `eButton` -> `EventEButton`): an interface implemented in another package needs exported methods.
 *
 * It exports `Error` (with `Code()`) and the sentinel errors `ErrQueueOverflow`, `ErrLivelock`, `ErrUnknownEvent`,
 * `ErrNotStarted` and `ErrBusy`, the `Event` type and its constants, the `Handler` interface (one method per action and
 * guard), the machine type (`Machine` unless `className` says otherwise) and `New`. The runtime loop
 * (reset/process/settle) is the one described in ir/ir.ts; errors are returned, every function that can fail returns
 * its error upwards. A panic from the handler is not recovered: it leaves the machine busy until Reset, as in the
 * interpreter. The machine is a fixed-size value (arrays, no slices or maps), so it allocates nothing after New.
 *
 * Always: `State` (document order) and `Fingerprint`. With `debugInfo`: `String()` on events, signals, states and
 * timers (names as in the model) and `IsActive()`. With `trace` (decided by the IR): `TraceKind` and a
 * `Trace(kind, id)` method on the handler. With timers in the model: `Timer`, `TimerStart()` and `TimerStop()` on the
 * handler, and `Timer.Event()`, the event to process when a timer expires.
 */
import type { UfsmDocument } from "../format/model";
import { UFSM_VERSION } from "../version";
import type { Expr, IrFunction, IrHistory, IrModule, Stmt, SwitchOn } from "../ir/ir";
import { TRACE_KINDS } from "../ir/ir";
import { hex32 } from "../ir/ids";
import { BUSY_MESSAGE } from "../runtime/contract";
import {
  CodegenError,
  OUTPUT_NOTICE,
  identifier,
  lines,
  prepare,
  readTargetOptions,
  type CommonOptions,
  type Lines,
  type Prepared,
  type Printed,
} from "./common";

export interface GoOptions extends CommonOptions {
  /** Name of the machine type. Default: `Machine` (the package names the machine). */
  className?: string;
  /** Name of the package. Default: the model name as an identifier, in lower case. */
  package?: string;
  /** Base name of the file: `<file>.go`. Default: the package name. */
  file?: string;
}

export interface GoFiles {
  fileName: string;
  source: string;
}

const GO_KEYWORDS = new Set(
  (
    "break case chan const continue default defer else fallthrough for func go goto if import interface map package " +
    "range return select struct switch type var"
  ).split(" "),
);

/** The keys of `targets.go` besides the API options. */
export const GO_TARGET_KEYS = ["className", "package", "file"] as const;

/** Read `targets.go`. Unknown keys and wrong types are reported, not fatal: the defaults are used instead. */
export function goOptionsFromTargets(doc: UfsmDocument): { options: GoOptions; problems: string[] } {
  return readTargetOptions(doc, "go", GO_TARGET_KEYS);
}

/**
 * A declaration name as an exported Go name: the first letter capitalized, the rest as written ("lamp_off" ->
 * "Lamp_off", "eButton" -> "EButton"), so names that differ only in case further on stay apart; "X" in front of a
 * name that starts with "_".
 */
export function goName(name: string): string {
  return /^[A-Za-z]/.test(name) ? name[0]!.toUpperCase() + name.slice(1) : `X${name}`;
}

/** The default package name of a model: "Dimmer" -> "dimmer", "New model" -> "new_model". */
export function goPackageName(text: string): string {
  return identifier(text).toLowerCase();
}

/** Text that is safe in a `//` comment. */
function comment(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ");
}

/** A Go string literal (Go source is UTF-8, so only quotes, backslashes and control characters are escaped). */
function goString(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === "\\") out += `\\${ch}`;
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else if (c === 0x2028 || c === 0x2029 || c === 0xfeff) out += `\\u${c.toString(16)}`;
    else out += ch;
  }
  return `"${out}"`;
}

/** Smallest unsigned type that holds 0..max. */
function uintType(max: number): string {
  return max <= 0xff ? "uint8" : max <= 0xffff ? "uint16" : "uint32";
}

/** Names and facts every part of the Go printer uses. */
interface GoContext extends Prepared {
  ir: IrModule;
  pkg: string;
  file: string;
  /** The machine type. */
  cls: string;
  /** Go name of every action and guard (handler methods), by id. */
  method: Map<string, string>;
  /** Event and signal constants, by id. */
  constant: Map<string, string>;
  stateConst: string[];
  timerConst: string[];
  signalNo: Map<string, number>;
  /** Index into `hist` of each history region. */
  histIndex: Map<number, number>;
  /** Deep history regions with something to snapshot. */
  deepRegions: IrHistory[];
  slotT: string;
  sigT: string;
  /** Signals get a public type when the application sees their numbers (trace hook, name lookup). */
  publicSignals: boolean;
  /** settle() has something to do: eventless transitions, queued signals or terminate. */
  settleBody: boolean;
  /** A state's name for a comment, by region and slot. */
  stateName(region: number, slot: number): string;
}

const TRACE_CONST: Record<string, string> = {
  event: "TraceEvent",
  signal: "TraceSignal",
  transition: "TraceTransition",
  enter: "TraceEnter",
  exit: "TraceExit",
};

function goContext(ir: IrModule, options: GoOptions): GoContext {
  const cls = options.className ?? "Machine";
  const pkg = options.package ?? goPackageName(ir.name);
  const file = options.file ?? pkg;
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(cls))
    throw new CodegenError(`Go type name '${cls}' is not an exported identifier (it must start with a capital letter)`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pkg) || GO_KEYWORDS.has(pkg) || pkg === "_")
    throw new CodegenError(`Go package name '${pkg}' is not a usable identifier`);
  if (!/^[A-Za-z0-9_.-]+$/.test(file) || /_test$/.test(file))
    throw new CodegenError(`Go file name '${file}' is not a plain file name (or ends in _test)`);
  const prepared = prepare(ir, options);
  const { trace, debugInfo, hasQueue, hasTerminate, hasTimers, signalQueue } = prepared;
  const publicSignals = (trace || debugInfo) && ir.signals.length > 0;

  const method = new Map<string, string>();
  for (const d of [...ir.actions, ...ir.guards]) method.set(d.id, goName(d.name));
  const constant = new Map<string, string>();
  for (const e of ir.events) constant.set(e.id, `Event${goName(e.name)}`);
  for (const s of ir.signals) constant.set(s.id, `Signal${goName(s.name)}`);
  const stateConst = ir.states.map((st) => `State${goName(st.ident)}`);
  const timerConst = ir.timers.map((t) => `Timer${goName(t.name)}`);

  // Every exported name of the package, and every handler method: a declaration name must not become one of these.
  const problems: string[] = [];
  const top = new Map<string, string>(
    [
      [cls, "the machine type"],
      ["Event", "the event type"],
      ["State", "the state type"],
      ["Handler", "the handler interface"],
      ["Error", "the error type"],
      ["New", "the constructor"],
      ["Fingerprint", "the fingerprint"],
      ...["ErrQueueOverflow", "ErrLivelock", "ErrUnknownEvent", "ErrNotStarted", "ErrBusy"].map((n) => [n, "an error"]),
      ...(publicSignals ? [["Signal", "the signal type"]] : []),
      ...(hasTimers ? [["Timer", "the timer type"]] : []),
      ...(trace
        ? [["TraceKind", "the trace kind type"], ...TRACE_KINDS.map((k) => [TRACE_CONST[k]!, "a trace kind"])]
        : []),
    ].map(([k, v]) => [k!, v!]),
  );
  const claim = (seen: Map<string, string>, name: string, what: string): void => {
    if (seen.has(name)) problems.push(`${what} becomes '${name}', like ${seen.get(name)}`);
    else seen.set(name, what);
  };
  if (top.get(cls) !== "the machine type") problems.push(`the type name '${cls}' is ${top.get(cls)}`);
  for (const e of ir.events) claim(top, constant.get(e.id)!, `event '${e.name}'`);
  if (publicSignals) for (const s of ir.signals) claim(top, constant.get(s.id)!, `signal '${s.name}'`);
  ir.states.forEach((st, i) => claim(top, stateConst[i]!, `state '${st.label}'`));
  ir.timers.forEach((t, i) => claim(top, timerConst[i]!, `timer '${t.name}'`));
  const methods = new Map<string, string>([
    ...(hasTimers
      ? ([
          ["TimerStart", "a timer method"],
          ["TimerStop", "a timer method"],
        ] as [string, string][])
      : []),
    ...(trace ? ([["Trace", "the trace hook"]] as [string, string][]) : []),
  ]);
  for (const [kind, list] of [
    ["action", ir.actions],
    ["guard", ir.guards],
  ] as const)
    for (const d of list) claim(methods, method.get(d.id)!, `${kind} '${d.name}'`);
  if (problems.length)
    throw new CodegenError(`names that clash in the generated Go (rename them):\n  ${problems.join("\n  ")}`);

  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const maxSlot = Math.max(0, ...ir.states.map((s) => s.slot));
  return {
    ...prepared,
    ...{ ir, pkg, file, cls, method, constant, stateConst, timerConst },
    signalNo: new Map(ir.signals.map((s, i) => [s.id, i])),
    histIndex: new Map(ir.history.map((h, k) => [h.region, k])),
    deepRegions: ir.history.filter((h) => h.kind === "deep" && h.snapshotTo! > h.snapshotFrom!),
    slotT: uintType(maxSlot),
    sigT: uintType(Math.max(0, ir.signals.length - 1)),
    publicSignals,
    settleBody: hasTerminate || ir.eventless !== undefined || hasQueue,
    stateName: (region, slot) => comment(stateAt.get(`${region}:${slot}`) ?? `slot ${slot}`),
    ...{ signalQueue },
  };
}

export function generateGo(ir: IrModule, options: GoOptions = {}): GoFiles {
  const ctx = goContext(ir, options);
  const w = lines("\t");
  goPreamble(ctx, w);
  goTypes(ctx, w);
  goHandler(ctx, w);
  goMachine(ctx, w);
  goEntryPoints(ctx, w);
  goRuntime(ctx, w);
  goFunctions(ctx, w);
  goDebugInfo(ctx, w);
  return { fileName: `${ctx.file}.go`, source: w.text() };
}

/** The Go text of IR conditions. */
function goExpressions(ctx: GoContext): { expr(e: Expr): Printed; notExpr(e: Expr): Printed } {
  const { method, histIndex } = ctx;
  const cfg = (r: number): string => `m.cfg[${r}]`;
  const wrap = (x: Printed, min: number): string => (x.p < min ? `(${x.s})` : x.s);
  const expr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "true", p: 3 };
      case "active":
        return { s: `${cfg(e.region)} == ${e.slot}`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "false", p: 3 };
        if (e.slots.length === 1) return { s: `${cfg(e.region)} == ${e.slots[0]}`, p: 2 };
        return { s: e.slots.map((x) => `${cfg(e.region)} == ${x}`).join(" || "), p: 0 };
      case "hasHistory":
        return { s: `m.hist[${histIndex.get(e.region)}] != 0`, p: 2 };
      case "guard":
        return { s: `m.h.${method.get(e.guard)}()`, p: 3 };
      case "flag":
        return { s: e.name, p: 3 };
      case "not":
        return notExpr(e.expr);
      case "and":
        return { s: e.exprs.map((x) => wrap(expr(x), 1)).join(" && "), p: 1 };
      case "or":
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
        return { s: `${cfg(e.region)} != ${e.slot}`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "true", p: 3 };
        if (e.slots.length === 1) return { s: `${cfg(e.region)} != ${e.slots[0]}`, p: 2 };
        return { s: e.slots.map((x) => `${cfg(e.region)} != ${x}`).join(" && "), p: 1 };
      case "hasHistory":
        return { s: `m.hist[${histIndex.get(e.region)}] == 0`, p: 2 };
      case "not":
        return expr(e.expr);
      default:
        return { s: `!${wrap(expr(e), 3)}`, p: 3 };
    }
  };
  return { expr, notExpr };
}

/** How a function returns: `ok(v)` for an IR `return v`, `fail` for an error from a call. */
interface Returns {
  ok(value: boolean): string;
  fail(err: string): string;
}

/** The returns of an IR function: step functions return a bool, fallible ones an error too. */
function returnsOf(ctx: GoContext, f: IrFunction): Returns {
  const fallible = ctx.fallible.has(f.name);
  if (f.returns === "bool")
    return fallible
      ? { ok: (v) => `return ${v}, nil`, fail: (e) => `return false, ${e}` }
      : { ok: (v) => `return ${v}`, fail: (e) => `return ${e}` };
  return { ok: () => "return", fail: (e) => `return ${e}` };
}

/** The statement printer, writing into `w`. */
function goStatements(ctx: GoContext, w: Lines): (list: Stmt[], d: number, r: Returns) => void {
  const { ir, method, constant, stateConst, timerConst, signalNo, histIndex, maxMicrosteps, countSteps, fallible } =
    ctx;
  const { line } = w;
  const { expr, notExpr } = goExpressions(ctx);
  const switchOn = (o: SwitchOn): string =>
    o.kind === "cfg"
      ? `m.cfg[${o.region}]`
      : o.kind === "hist"
        ? `m.hist[${histIndex.get(o.region)}]`
        : `m.deepR${o.history}[${o.index}]`;
  const caseRegion = (o: SwitchOn): number =>
    o.kind === "deep" ? ir.history.find((h) => h.region === o.history)!.snapshotFrom! + o.index : o.region;
  const check = (d: number, call: string, r: Returns): void => {
    line(d, `if err := ${call}; err != nil {`);
    line(d + 1, r.fail("err"));
    line(d, "}");
  };

  const stmts = (list: Stmt[], d: number, r: Returns): void => {
    for (const s of list) {
      switch (s.op) {
        case "if": {
          const hasElse = !!s.else && s.else.length > 0;
          if (s.then.length === 0 && !hasElse) break; // nothing to do; guards have no side effects (semantics.md)
          if (s.then.length === 0) {
            line(d, `if ${notExpr(s.cond).s} {`);
            stmts(s.else!, d + 1, r);
            line(d, "}");
            break;
          }
          line(d, `if ${expr(s.cond).s} {`);
          stmts(s.then, d + 1, r);
          let els = s.else;
          while (els && els.length === 1 && els[0]!.op === "if" && els[0]!.then.length > 0) {
            const e = els[0] as Extract<Stmt, { op: "if" }>;
            line(d, `} else if ${expr(e.cond).s} {`);
            stmts(e.then, d + 1, r);
            els = e.else;
          }
          if (els && els.length) {
            line(d, "} else {");
            stmts(els, d + 1, r);
          }
          line(d, "}");
          break;
        }
        case "switch": {
          const cases = s.cases.filter((c) => c.body.length > 0);
          if (!cases.length) break;
          const region = caseRegion(s.on);
          line(d, `switch ${switchOn(s.on)} {`);
          for (const c of cases) {
            line(d, `case ${c.slot}: // ${ctx.stateName(region, c.slot)}`);
            stmts(c.body, d + 1, r);
          }
          line(d, "}");
          break;
        }
        case "set":
          line(d, `m.cfg[${s.region}] = ${s.slot}`);
          break;
        case "call":
          line(d, `m.h.${method.get(s.action)}()`);
          break;
        case "emit":
          check(d, `m.push(${signalNo.get(s.signal)})`, r);
          break;
        case "setFlag":
          line(d, `${s.name} = true`);
          break;
        case "invoke":
          if (fallible.has(s.fn)) check(d, `m.${s.fn}()`, r);
          else line(d, `m.${s.fn}()`);
          break;
        case "saveHistory":
          line(d, `m.hist[${histIndex.get(s.region)}] = m.cfg[${s.region}]`);
          break;
        case "clearHistory":
          line(d, `m.hist[${histIndex.get(s.region)}] = 0`);
          break;
        case "saveDeep": {
          const h = ir.history.find((x) => x.region === s.region)!;
          if (h.snapshotTo! > h.snapshotFrom!)
            line(d, `copy(m.deepR${s.region}[:], m.cfg[${h.snapshotFrom}:${h.snapshotTo}])`);
          break;
        }
        case "microstep":
          if (!countSteps) break;
          line(d, "m.steps++");
          line(d, `if m.steps > ${maxMicrosteps} {`);
          line(d + 1, r.fail("ErrLivelock"));
          line(d, "}");
          break;
        case "trace":
          if (s.hook === "transition") line(d, `m.h.Trace(TraceTransition, ${s.index})`);
          else line(d, `m.h.Trace(${TRACE_CONST[s.hook]}, int(${stateConst[s.index]}))`);
          break;
        case "timerStart": {
          const t = ir.timers[s.timer]!;
          line(d, `m.h.TimerStart(${timerConst[s.timer]}, ${t.ms}, ${t.periodic})`);
          break;
        }
        case "timerStop":
          line(d, `m.h.TimerStop(${timerConst[s.timer]})`);
          break;
        case "terminate":
          line(d, "m.terminated = true");
          break;
        case "return":
          line(d, r.ok(s.value));
          break;
      }
    }
    void constant;
  };
  return stmts;
}

/** The generated-code marker, the package documentation and the package clause. */
function goPreamble(ctx: GoContext, w: Lines): void {
  const { ir, pkg, cls, hasTimers, trace } = ctx;
  const { line } = w;
  line(0, `// Code generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". DO NOT EDIT.`);
  line(0, `// ${OUTPUT_NOTICE}`);
  line(0, "");
  line(0, `// Package ${pkg} is the state machine "${comment(ir.name)}".`);
  line(0, "//");
  line(0, `//	m := ${pkg}.New(handler) // handler implements ${pkg}.Handler`);
  line(0, "//	err := m.Reset()        // start; also restarts (no exit actions run)");
  if (ir.events.length) line(0, `//	err = m.Process(${pkg}.${ctx.constant.get(ir.events[0]!.id)})`);
  line(0, "//");
  line(0, `// Reset and Process return an *Error (compare with ErrBusy, ...); after one, call Reset.`);
  line(0, "// A panic from an action or guard passes through unchanged and leaves the machine");
  line(0, "// half-way: until Reset, Process returns ErrBusy, as it does when an action or guard");
  line(0, `// calls it. A ${cls} is not safe for concurrent use.`);
  if (hasTimers || trace) {
    line(0, "//");
    line(0, "// The handler's TimerStart, TimerStop and Trace (when generated) run inside Reset and");
    line(0, "// Process: they must not block or call the machine.");
  }
  line(0, `package ${pkg}`);
}

/** A run of `name type` lines, aligned as gofmt aligns struct fields. */
function aligned(rows: [string, string][]): string[] {
  const n = Math.max(0, ...rows.map(([a]) => a.length));
  return rows.map(([a, b]) => `${a.padEnd(n)} ${b}`);
}

/** Error, the error values, and the enumerations: events, signals, states, timers, trace kinds. */
function goTypes(ctx: GoContext, w: Lines): void {
  const { ir, cls, constant, stateConst, timerConst, publicSignals, signalQueue, maxMicrosteps, hasTimers, trace } =
    ctx;
  const { line } = w;
  line(0, "");
  line(0, "// Error is what Reset and Process return; compare it with the Err values.");
  line(0, "type Error struct {");
  for (const f of aligned([
    ["code", "string"],
    ["message", "string"],
  ]))
    line(1, f);
  line(0, "}");
  line(0, "");
  line(0, "// Error returns the message.");
  line(0, "func (e *Error) Error() string {");
  line(1, "return e.message");
  line(0, "}");
  line(0, "");
  line(0, `// Code returns the error code every uFSM target uses ("queue-overflow", "livelock", "unknown-event",`);
  line(0, `// "not-started" or "busy").`);
  line(0, "func (e *Error) Code() string {");
  line(1, "return e.code");
  line(0, "}");
  const errors: [string, string, string, string][] = [
    [
      "ErrQueueOverflow",
      "queue-overflow",
      `signal queue full (${signalQueue})`,
      "more signals were queued at once than fit.",
    ],
    ["ErrLivelock", "livelock", `more than ${maxMicrosteps} microsteps in one call`, "a call ran too many microsteps."],
    ["ErrUnknownEvent", "unknown-event", "unknown event", "Process was given a value that is not an Event."],
    ["ErrNotStarted", "not-started", "call Reset before Process", "Process was called before Reset."],
    ["ErrBusy", "busy", BUSY_MESSAGE, "an earlier call failed, or this one was made from inside a call."],
  ];
  for (const [name, code, message, doc] of errors) {
    line(0, "");
    line(0, `// ${name}: ${doc}`);
    line(0, `var ${name} = &Error{code: ${goString(code)}, message: ${goString(message)}}`);
  }
  /** A typed enumeration numbered from 0, with a comment line before each constant that has one. */
  const enumeration = (type: string, doc: string, items: [string, string?][]): void => {
    line(0, "");
    line(0, `// ${doc}`);
    line(0, `type ${type} int`);
    if (!items.length) return;
    line(0, "");
    line(0, "const (");
    items.forEach(([name, c], i) => {
      if (c) line(1, `// ${comment(c)}`);
      line(1, i === 0 ? `${name} ${type} = iota` : name);
    });
    line(0, ")");
  };
  enumeration(
    "Event",
    "Event is what Process takes.",
    ir.events.map((e) => [constant.get(e.id)!, constant.get(e.id) === `Event${e.name}` ? undefined : e.name]),
  );
  if (publicSignals)
    enumeration(
      "Signal",
      "Signal numbers, as the trace hook reports them.",
      ir.signals.map((s) => [constant.get(s.id)!, constant.get(s.id) === `Signal${s.name}` ? undefined : s.name]),
    );
  enumeration(
    "State",
    "State numbers, in document order.",
    ir.states.map((st, i) => [stateConst[i]!, stateConst[i] === `State${st.label}` ? undefined : st.label]),
  );
  line(0, "");
  line(0, "// Fingerprint identifies the numbering of events, signals, states and transitions (`ufsm info`");
  line(0, "// prints it for a model file).");
  line(0, `const Fingerprint uint32 = ${hex32(ir.fingerprint)}`);
  if (hasTimers) {
    enumeration(
      "Timer",
      "Timer numbers. A timer is started when its state is entered and stopped when it is left.",
      ir.timers.map((t, i) => [
        timerConst[i]!,
        `${t.name}: ${t.periodic ? "every" : "after"} ${t.ms} ms -> ${ir.events[t.event]!.name}`,
      ]),
    );
    line(0, "");
    line(0, `var timerEvents = [...]Event{${ir.timers.map((t) => constant.get(ir.events[t.event]!.id)).join(", ")}}`);
    line(0, "");
    line(0, "// Event returns the event to process when the timer expires.");
    line(0, "func (t Timer) Event() Event {");
    line(1, "return timerEvents[t]");
    line(0, "}");
  }
  if (trace) {
    const what: Record<string, string> = {
      event: "an Event; Process accepted it",
      signal: `${publicSignals ? "a Signal" : "a signal number"}; taken from the queue`,
      transition: `a transition number (listed at ${cls}); before its actions`,
      enter: "a State; before its entry actions",
      exit: "a State; before its exit actions",
    };
    enumeration(
      "TraceKind",
      "TraceKind says what Handler.Trace reports; the id is a number of the type named here.",
      TRACE_KINDS.map((k) => [TRACE_CONST[k]!, `${TRACE_CONST[k]}: the id is ${what[k]}.`]),
    );
  }
}

/** The handler interface: one method per action and guard, the timer methods and the trace hook. */
function goHandler(ctx: GoContext, w: Lines): void {
  const { ir, method, hasTimers, trace } = ctx;
  const { line } = w;
  line(0, "");
  line(0, "// Handler is implemented by the application: the actions and guards the machine calls.");
  line(0, "// Guards may be called more than once per event and in any order.");
  if (!ir.actions.length && !ir.guards.length && !hasTimers && !trace) {
    line(0, "type Handler interface{}");
    return;
  }
  line(0, "type Handler interface {");
  for (const a of ir.actions) {
    line(1, `// ${method.get(a.id)} is action ${a.name}.`);
    line(1, `${method.get(a.id)}()`);
  }
  for (const g of ir.guards) {
    line(1, `// ${method.get(g.id)} is guard ${g.name}.`);
    line(1, `${method.get(g.id)}() bool`);
  }
  if (hasTimers) {
    line(1, "// TimerStart starts a timer: it expires once, or every ms until stopped (the");
    line(1, "// handler re-arms it). On expiry, pass timer.Event() to Process.");
    line(1, "TimerStart(timer Timer, ms uint32, periodic bool)");
    line(1, "// TimerStop stops a timer; it does nothing if the timer is not running. No expiry");
    line(1, "// of the earlier start should follow.");
    line(1, "TimerStop(timer Timer)");
  }
  if (trace) {
    line(1, "// Trace is called with ids only (see TraceKind).");
    line(1, "Trace(kind TraceKind, id int)");
  }
  line(0, "}");
}

/** The machine type and New. */
function goMachine(ctx: GoContext, w: Lines): void {
  const { ir, cls, histIndex, deepRegions, slotT, sigT, signalQueue, trace, hasQueue, hasTerminate, countSteps } = ctx;
  const { line } = w;
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
  line(0, "");
  line(0, `// ${cls} is the state machine; make one with New.`);
  line(0, `type ${cls} struct {`);
  const fields: [string, string][] = [
    ["h", "Handler"],
    ["started", "bool"],
    ["busy", "bool"],
    ["cfg", `[${ir.regions}]${slotT}`],
  ];
  if (ir.history.length) fields.push(["hist", `[${ir.history.length}]${slotT}`]);
  for (const dh of deepRegions) fields.push([`deepR${dh.region}`, `[${dh.snapshotTo! - dh.snapshotFrom!}]${slotT}`]);
  if (hasQueue) fields.push(["queue", `[${signalQueue}]${sigT}`], ["queueHead", "int"], ["queueLen", "int"]);
  if (countSteps) fields.push(["steps", "int"]);
  if (hasTerminate) fields.push(["terminated", "bool"]);
  for (const f of aligned(fields)) line(1, f);
  line(0, "}");
  line(0, "");
  line(0, `// New returns a machine that calls handler; it runs nothing until Reset.`);
  line(0, `func New(handler Handler) *${cls} {`);
  line(1, `return &${cls}{h: handler}`);
  line(0, "}");
}

/** Reset and Process. */
function goEntryPoints(ctx: GoContext, w: Lines): void {
  const { ir, cls, constant, deepRegions, slotT, settleBody, trace, hasQueue, hasTerminate, countSteps, fallible } =
    ctx;
  const { line } = w;
  const stmts = goStatements(ctx, w);
  const pub: Returns = { ok: () => "return nil", fail: (e) => `return ${e}` };
  const finish = (): void => {
    if (settleBody) {
      line(1, "if err := m.settle(); err != nil {");
      line(2, "return err");
      line(1, "}");
    }
    line(1, "m.busy = false");
    line(1, "return nil");
  };
  line(0, "");
  line(0, "// Reset starts the machine, or restarts it: no exit actions run.");
  line(0, `func (m *${cls}) Reset() error {`);
  line(1, "m.busy = true");
  line(1, "m.started = true");
  line(1, `m.cfg = [${ir.regions}]${slotT}{}`);
  if (ir.history.length) line(1, `m.hist = [${ir.history.length}]${slotT}{}`);
  for (const dh of deepRegions) line(1, `m.deepR${dh.region} = [${dh.snapshotTo! - dh.snapshotFrom!}]${slotT}{}`);
  if (hasQueue) {
    line(1, "m.queueHead = 0");
    line(1, "m.queueLen = 0");
  }
  if (countSteps) line(1, "m.steps = 0");
  if (hasTerminate) line(1, "m.terminated = false");
  stmts(ir.start, 1, pub);
  finish();
  line(0, "}");

  line(0, "");
  line(0, "// Process runs the machine on one event.");
  line(0, `func (m *${cls}) Process(event Event) error {`);
  line(1, "if !m.started {");
  line(2, "return ErrNotStarted");
  line(1, "}");
  line(1, `if event < 0 || event >= ${ir.events.length} {`);
  line(2, "return ErrUnknownEvent");
  line(1, "}");
  line(1, "if m.busy {");
  line(2, "return ErrBusy");
  line(1, "}");
  if (hasTerminate) {
    line(1, "if m.terminated {");
    line(2, "return nil");
    line(1, "}");
  }
  line(1, "m.busy = true");
  if (countSteps) line(1, "m.steps = 0");
  if (trace) line(1, "m.h.Trace(TraceEvent, int(event))");
  const reacting = ir.events.filter((e) => ir.onEvent[e.id]);
  if (reacting.length) {
    line(1, "switch event {");
    for (const e of reacting) {
      const fn = ir.onEvent[e.id]!;
      line(1, `case ${constant.get(e.id)}:`);
      if (fallible.has(fn)) {
        line(2, `if _, err := m.${fn}(); err != nil {`);
        line(3, "return err");
        line(2, "}");
      } else line(2, `m.${fn}()`);
    }
    line(1, "}");
  }
  finish();
  line(0, "}");
}

/** settle(), push() and pop(). */
function goRuntime(ctx: GoContext, w: Lines): void {
  const { ir, cls, slotT, sigT, signalQueue, settleBody, trace, hasQueue, hasTerminate, fallible } = ctx;
  const { line } = w;
  if (settleBody) {
    line(0, "");
    line(0, "// settle runs eventless transitions and queued signals until the machine is stable.");
    line(0, `func (m *${cls}) settle() error {`);
    line(1, "for {");
    if (hasTerminate) {
      line(2, "if m.terminated {");
      line(3, `m.cfg = [${ir.regions}]${slotT}{}`);
      if (hasQueue) line(3, "m.queueLen = 0");
      line(3, "return nil");
      line(2, "}");
    }
    if (ir.eventless !== undefined) {
      if (fallible.has(ir.eventless)) {
        line(2, `moved, err := m.${ir.eventless}()`);
        line(2, "if err != nil {");
        line(3, "return err");
        line(2, "}");
        line(2, "if moved {");
      } else line(2, `if m.${ir.eventless}() {`);
      line(3, "continue");
      line(2, "}");
    }
    if (hasQueue) {
      line(2, "if m.queueLen == 0 {");
      line(3, "return nil");
      line(2, "}");
      const reacting = ir.signals.filter((s) => ir.onSignal[s.id]);
      let popped = "m.pop()";
      if (trace) {
        line(2, "signal := m.pop()");
        line(2, "m.h.Trace(TraceSignal, int(signal))");
        popped = "signal";
      }
      if (reacting.length) {
        line(2, `switch ${popped} {`);
        for (const s of reacting) {
          const fn = ir.onSignal[s.id]!;
          line(2, `case ${ir.signals.indexOf(s)}: // ${s.name}`);
          if (fallible.has(fn)) {
            line(3, `if _, err := m.${fn}(); err != nil {`);
            line(4, "return err");
            line(3, "}");
          } else line(3, `m.${fn}()`);
        }
        line(2, "}");
      } else if (!trace) line(2, "m.pop()");
    } else line(2, "return nil");
    line(1, "}");
    line(0, "}");
  }
  if (hasQueue) {
    line(0, "");
    line(0, `func (m *${cls}) push(signal ${sigT}) error {`);
    line(1, `if m.queueLen == ${signalQueue} {`);
    line(2, "return ErrQueueOverflow");
    line(1, "}");
    line(1, "i := m.queueHead + m.queueLen");
    line(1, `if i >= ${signalQueue} {`);
    line(2, `i -= ${signalQueue}`);
    line(1, "}");
    line(1, "m.queue[i] = signal");
    line(1, "m.queueLen++");
    line(1, "return nil");
    line(0, "}");
    line(0, "");
    line(0, `func (m *${cls}) pop() ${sigT} {`);
    line(1, "signal := m.queue[m.queueHead]");
    line(1, "m.queueHead++");
    line(1, `if m.queueHead == ${signalQueue} {`);
    line(2, "m.queueHead = 0");
    line(1, "}");
    line(1, "m.queueLen--");
    line(1, "return signal");
    line(0, "}");
  }
}

/** One method per IR function. */
function goFunctions(ctx: GoContext, w: Lines): void {
  const { ir, cls, fallible } = ctx;
  const { line } = w;
  const stmts = goStatements(ctx, w);
  for (const f of ir.functions) {
    const fails = fallible.has(f.name);
    const result = f.returns === "bool" ? (fails ? " (bool, error)" : " bool") : fails ? " error" : "";
    line(0, "");
    if (f.doc) line(0, `// ${f.name}: ${comment(f.doc)}`);
    line(0, `func (m *${cls}) ${f.name}()${result} {`);
    for (const x of f.flags) line(1, `${x} := false`);
    stmts(f.body, 1, returnsOf(ctx, f));
    if (f.returns === "void" && fails) line(1, "return nil");
    line(0, "}");
  }
}

/** Names as in the model and IsActive (debugInfo). */
function goDebugInfo(ctx: GoContext, w: Lines): void {
  const { ir, cls, slotT, publicSignals, debugInfo, hasTimers } = ctx;
  const { line } = w;
  if (!debugInfo) return;
  const lookup = (type: string, v: string, table: string, names: string[]): void => {
    line(0, "");
    line(0, `var ${table} = [...]string{${names.map(goString).join(", ")}}`);
    line(0, "");
    line(0, `// String returns the ${type.toLowerCase()}'s name as in the model ("" for a number out of range).`);
    line(0, `func (${v} ${type}) String() string {`);
    line(1, `if ${v} < 0 || int(${v}) >= len(${table}) {`);
    line(2, `return ""`);
    line(1, "}");
    line(1, `return ${table}[${v}]`);
    line(0, "}");
  };
  if (ir.events.length)
    lookup(
      "Event",
      "e",
      "eventNames",
      ir.events.map((e) => e.name),
    );
  if (publicSignals)
    lookup(
      "Signal",
      "s",
      "signalNames",
      ir.signals.map((s) => s.name),
    );
  if (ir.states.length) {
    lookup(
      "State",
      "s",
      "stateNames",
      ir.states.map((st) => st.label),
    );
    line(0, "");
    line(0, `var stateRegion = [...]int{${ir.states.map((st) => st.region).join(", ")}}`);
    line(0, "");
    line(0, `var stateSlot = [...]${slotT}{${ir.states.map((st) => st.slot).join(", ")}}`);
    line(0, "");
    line(0, "// IsActive reports whether state is active.");
    line(0, `func (m *${cls}) IsActive(state State) bool {`);
    line(1, "return state >= 0 && int(state) < len(stateSlot) && m.cfg[stateRegion[state]] == stateSlot[state]");
    line(0, "}");
  }
  if (hasTimers)
    lookup(
      "Timer",
      "t",
      "timerNames",
      ir.timers.map((t) => t.name),
    );
}
