// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * TypeScript backend: prints an IrModule as one typed TypeScript module.
 *
 * The module imports nothing and uses only erasable syntax (no enums,
 * namespaces or parameter properties), so Node's type stripping, esbuild,
 * Vite or tsc can all run it, and stripping the types gives plain modern
 * JavaScript. It type-checks under `strict` plus `noUncheckedIndexedAccess`,
 * `exactOptionalPropertyTypes`, `noUnusedLocals`/`Parameters`,
 * `noImplicitReturns` and `erasableSyntaxOnly`.
 *
 * It exports `<Class>Error` (with a `code`), `<Class>ErrorCode`,
 * `<Class>Event` (a const object and the matching union type),
 * `<Class>Handler` (an interface with one method per action and guard) and
 * the machine class `<Class>`. The runtime loop (reset/process/settle) is the
 * one described in ir/ir.ts; errors are exceptions, as in the interpreter.
 * Exceptions from the handler are not caught: they leave the machine busy
 * until reset(), as in the interpreter.
 *
 * Always: `<Class>State` (document order) and `<Class>.FINGERPRINT`. With
 * `debugInfo`: `EVENT_NAMES`, `SIGNAL_NAMES`, `STATE_NAMES` and `isActive()`.
 * With `trace` (decided by the IR): `<Class>TraceKind` and a
 * `trace(kind, id)` method on the handler. With timers in the model:
 * `<Class>Timer`, `timer_start()` and `timer_stop()` on the handler, and
 * `<class>TimerEvent()`, the event to process when a timer expires.
 */
import type { UfsmDocument } from "../v1/model";
import { IDENTIFIER } from "../v1/model";
import { OPTION_DEFAULTS, targetSection } from "../v1/options";
import { UFSM_VERSION } from "../version";
import type { Expr, IrModule, Stmt, SwitchOn } from "../ir/ir";
import { TRACE_KINDS } from "../ir/ir";
import { hex32 } from "../ir/ids";
import { BUSY_MESSAGE } from "../runtime/contract";
import { CodegenError, OUTPUT_NOTICE, cIdentifier } from "./c";
import { pythonClassName } from "./python";

export interface TsOptions {
  /** Name of the machine class; also the prefix of the other exported names. Default: the model name in PascalCase. */
  className?: string;
  /** Base name of the file: `<module>.ts`. Default: the model name as an identifier. */
  module?: string;
  /** Capacity of the signal queue (only generated when the model emits signals). Default 16, as in C. */
  signalQueue?: number;
  /** Microsteps per reset()/process() call before a "livelock" error; 0 disables the check. Default 10000. */
  maxMicrosteps?: number;
  /** Name tables for events, signals and states, and `is_active()`. Default false. */
  debugInfo?: boolean;
  /** Must equal the IR's `trace` when given (the trace calls are emitted by the lowering). */
  trace?: boolean;
}

export interface TsFiles {
  fileName: string;
  source: string;
}

/** Words that cannot name the class (declaration names are only used as properties, where any identifier works). */
const TS_RESERVED = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends false finally for function if " +
    "import in instanceof new null return super switch this throw true try typeof var void while with implements interface let " +
    "package private protected public static yield any boolean number string symbol never unknown object undefined await"
  ).split(" "),
);

/** Names every object already has: a handler method or event key with one of these names would collide. */
const OBJECT_MEMBERS = new Set([
  "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf",
  "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);

/** Read `targets.ts`. Unknown keys and wrong types are reported, not fatal: the defaults are used instead. */
export function tsOptionsFromTargets(doc: UfsmDocument): { options: TsOptions; problems: string[] } {
  const { api, own, problems } = targetSection(doc, "ts");
  const options: TsOptions = { ...api };
  for (const [k, v] of own) {
    switch (k) {
      case "className":
      case "module":
        if (typeof v === "string") options[k] = v;
        else problems.push(`targets.ts.${k}: expected a string`);
        break;
      default:
        problems.push(`targets.ts.${k}: unknown option (ignored)`);
    }
  }
  return { options, problems };
}

/** Text that is safe in a `//` comment. */
function comment(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ");
}


/** Precedence of a printed expression: 0 `||`, 1 `&&`, 2 comparison, 3 unary/primary. */
interface Printed {
  s: string;
  p: number;
}

export function generateTypeScript(ir: IrModule, options: TsOptions = {}): TsFiles {
  const cls = options.className ?? pythonClassName(ir.name);
  const module = options.module ?? cIdentifier(ir.name);
  if (!IDENTIFIER.test(cls) || TS_RESERVED.has(cls)) throw new CodegenError(`TypeScript class name '${cls}' is not a usable identifier`);
  if (!/^[A-Za-z0-9_.-]+$/.test(module)) throw new CodegenError(`TypeScript module name '${module}' is not a plain file name`);
  const queueCap = options.signalQueue ?? OPTION_DEFAULTS.signalQueue;
  const maxSteps = options.maxMicrosteps ?? OPTION_DEFAULTS.maxMicrosteps;
  const errorCls = `${cls}Error`;
  const codeT = `${cls}ErrorCode`;
  const eventCls = `${cls}Event`;
  const handlerT = `${cls}Handler`;
  const stateCls = `${cls}State`;
  const signalCls = `${cls}Signal`;
  const kindCls = `${cls}TraceKind`;
  const timerCls = `${cls}Timer`;
  const timerEventFn = `${cls[0]!.toLowerCase()}${cls.slice(1)}TimerEvent`;
  const hasTimers = ir.timers.length > 0;
  if (options.trace !== undefined && options.trace !== ir.trace) throw new CodegenError("options.trace differs from the IR's: lower the model with { trace }");
  const trace = ir.trace;
  const debugInfo = options.debugInfo ?? false;
  const publicSignals = (trace || debugInfo) && ir.signals.length > 0;

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
  // the microstep counter only exists if something counts microsteps (noUnusedLocals rejects a write-only field)
  let counts = false;
  for (const f of functions) walk(f.body, (x) => void (counts ||= x.op === "microstep"));
  const countSteps = checkSteps && counts;

  // ------------------------------------------------------------ names

  // Declaration names are C identifiers and become property names (event keys, handler methods), where JavaScript
  // keywords are fine; names every object already has (constructor, toString, ...) are not.
  const problems: string[] = [];
  for (const [kind, list] of [["event", ir.events], ["signal", ir.signals], ["action", ir.actions], ["guard", ir.guards]] as const) {
    for (const d of list) {
      if (OBJECT_MEMBERS.has(d.name)) problems.push(`${kind} '${d.name}' is a name every JavaScript object already has`);
      else if (trace && d.name === "trace" && (kind === "action" || kind === "guard")) problems.push(`${kind} 'trace' is the name of the trace hook`);
      else if (hasTimers && (d.name === "timer_start" || d.name === "timer_stop") && (kind === "action" || kind === "guard")) {
        problems.push(`${kind} '${d.name}' is the name of a timer function of the handler`);
      }
    }
  }
  for (const t of ir.timers) if (OBJECT_MEMBERS.has(t.name)) problems.push(`timer '${t.name}' is a name every JavaScript object already has`);
  for (const st of ir.states) if (OBJECT_MEMBERS.has(st.ident)) problems.push(`state '${st.label}' is a name every JavaScript object already has`);
  if (problems.length) throw new CodegenError(`names that cannot be used in the generated TypeScript (rename them):\n  ${problems.join("\n  ")}`);

  const decl = new Map<string, string>();
  for (const d of [...ir.events, ...ir.signals, ...ir.actions, ...ir.guards]) decl.set(d.id, d.name);
  const signalNo = new Map(ir.signals.map((s, i) => [s.id, i]));
  const histIndex = new Map(ir.history.map((h, k) => [h.region, k]));
  const deepRegions = ir.history.filter((h) => h.kind === "deep" && h.snapshotTo! > h.snapshotFrom!);
  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const stateName = (region: number, slot: number): string => comment(stateAt.get(`${region}:${slot}`) ?? `slot ${slot}`);

  // ------------------------------------------------------------ expressions

  const guardCall = (g: string): string => `this.h.${decl.get(g)}()`;
  const wrap = (x: Printed, min: number): string => (x.p < min ? `(${x.s})` : x.s);
  const cfg = (r: number): string => `this.cfg[${r}]`;

  const expr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "true", p: 3 };
      case "active":
        return { s: `${cfg(e.region)} === ${e.slot}`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "false", p: 3 };
        if (e.slots.length === 1) return { s: `${cfg(e.region)} === ${e.slots[0]}`, p: 2 };
        return { s: e.slots.map((x) => `${cfg(e.region)} === ${x}`).join(" || "), p: 0 };
      case "hasHistory":
        return { s: `this.hist[${histIndex.get(e.region)}] !== 0`, p: 2 };
      case "guard":
        return { s: guardCall(e.guard), p: 3 };
      case "flag":
        return { s: e.name, p: 3 };
      case "not":
        return notExpr(e.expr);
      case "and":
        return { s: e.exprs.map((x) => wrap(expr(x), 1)).join(" && "), p: 1 };
      case "or":
        return { s: e.exprs.map((x) => { const y = expr(x); return y.p === 1 ? `(${y.s})` : y.s; }).join(" || "), p: 0 };
    }
  };
  const notExpr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "false", p: 3 };
      case "active":
        return { s: `${cfg(e.region)} !== ${e.slot}`, p: 2 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "true", p: 3 };
        if (e.slots.length === 1) return { s: `${cfg(e.region)} !== ${e.slots[0]}`, p: 2 };
        return { s: e.slots.map((x) => `${cfg(e.region)} !== ${x}`).join(" && "), p: 1 };
      case "hasHistory":
        return { s: `this.hist[${histIndex.get(e.region)}] === 0`, p: 2 };
      case "not":
        return expr(e.expr);
      default:
        return { s: `!${wrap(expr(e), 3)}`, p: 3 };
    }
  };

  // ------------------------------------------------------------ statements

  const out: string[] = [];
  const line = (depth: number, text: string): void => void out.push(text === "" ? "" : `${"  ".repeat(depth)}${text}`);
  const switchOn = (o: SwitchOn): string =>
    o.kind === "cfg" ? cfg(o.region) : o.kind === "hist" ? `this.hist[${histIndex.get(o.region)}]` : `this.deep_r${o.history}[${o.index}]`;
  const caseRegion = (o: SwitchOn): number => (o.kind === "deep" ? ir.history.find((h) => h.region === o.history)!.snapshotFrom! + o.index : o.region);

  const stmts = (list: Stmt[], d: number): void => {
    for (const s of list) {
      switch (s.op) {
        case "if": {
          const hasElse = !!s.else && s.else.length > 0;
          if (s.then.length === 0 && !hasElse) break; // nothing to do; guards have no side effects (semantics.md)
          if (s.then.length === 0) {
            line(d, `if (${notExpr(s.cond).s}) {`);
            stmts(s.else!, d + 1);
            line(d, "}");
            break;
          }
          line(d, `if (${expr(s.cond).s}) {`);
          stmts(s.then, d + 1);
          let els = s.else;
          while (els && els.length === 1 && els[0]!.op === "if" && els[0]!.then.length > 0) {
            const e = els[0] as Extract<Stmt, { op: "if" }>;
            line(d, `} else if (${expr(e.cond).s}) {`);
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
          const cases = s.cases.filter((c) => c.body.length > 0);
          if (!cases.length) break;
          const region = caseRegion(s.on);
          line(d, `switch (${switchOn(s.on)}) {`);
          for (const c of cases) {
            line(d + 1, `case ${c.slot}: // ${stateName(region, c.slot)}`);
            stmts(c.body, d + 2);
            if (c.body[c.body.length - 1]?.op !== "return") line(d + 2, "break;");
          }
          line(d, "}");
          break;
        }
        case "set":
          line(d, s.slot === 0 ? `${cfg(s.region)} = 0;` : `${cfg(s.region)} = ${s.slot}; // ${stateName(s.region, s.slot)}`);
          break;
        case "call":
          line(d, `this.h.${decl.get(s.action)}();`);
          break;
        case "emit":
          line(d, `this.push(${signalNo.get(s.signal)}); // ${decl.get(s.signal)}`);
          break;
        case "setFlag":
          line(d, `${s.name} = true;`);
          break;
        case "invoke":
          line(d, `this.${s.fn}();`);
          break;
        case "saveHistory":
          line(d, `this.hist[${histIndex.get(s.region)}] = ${cfg(s.region)} ?? 0;`);
          break;
        case "clearHistory":
          line(d, `this.hist[${histIndex.get(s.region)}] = 0;`);
          break;
        case "saveDeep": {
          const h = ir.history.find((x) => x.region === s.region)!;
          if (h.snapshotTo! > h.snapshotFrom!) line(d, `this.deep_r${s.region} = this.cfg.slice(${h.snapshotFrom}, ${h.snapshotTo});`);
          break;
        }
        case "microstep":
          if (countSteps) line(d, "this.microstep();");
          break;
        case "trace":
          if (s.hook === "transition") line(d, `this.h.trace(${kindCls}.transition, ${s.index}); // ${comment(ir.transitions[s.index]!.label)}`);
          else line(d, `this.h.trace(${kindCls}.${s.hook}, ${stateCls}.${ir.states[s.index]!.ident});`);
          break;
        case "timerStart": {
          const t = ir.timers[s.timer]!;
          line(d, `this.h.timer_start(${timerCls}.${t.name}, ${t.ms}, ${t.periodic});`);
          break;
        }
        case "timerStop":
          line(d, `this.h.timer_stop(${timerCls}.${ir.timers[s.timer]!.name});`);
          break;
        case "terminate":
          line(d, "this.terminated = true;");
          break;
        case "return":
          line(d, `return ${s.value};`);
          break;
      }
    }
  };

  // ------------------------------------------------------------ module

  const zeros = (n: number): string => (n <= 8 ? `[${Array.from({ length: n }, () => "0").join(", ")}]` : `new Array<number>(${n}).fill(0)`);
  line(0, `// Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit.`);
  line(0, `// ${OUTPUT_NOTICE}`);
  line(0, "//");
  line(0, `//     const machine = new ${cls}(handler); // handler: implements ${handlerT}`);
  line(0, "//     machine.reset(); // start; also restarts (no exit actions run)");
  if (ir.events.length) line(0, `//     machine.process(${eventCls}.${ir.events[0]!.name});`);
  line(0, "//");
  line(0, `// reset() and process() throw ${errorCls} on errors; after one, call reset().`);
  line(0, "// An exception from an action or guard passes through unchanged and leaves the");
  line(0, `// machine half-way: until reset(), process() throws ${errorCls} "busy", as it`);
  line(0, "// does when an action or guard calls it.");
  line(0, "");
  line(0, `export type ${codeT} = "queue-overflow" | "livelock" | "unknown-event" | "not-started" | "busy";`);
  line(0, "");
  line(0, `export class ${errorCls} extends Error {`);
  line(1, `readonly code: ${codeT};`);
  line(0, "");
  line(1, `constructor(code: ${codeT}, message: string) {`);
  line(2, "super(message);");
  line(2, `this.name = "${errorCls}";`);
  line(2, "this.code = code;");
  line(1, "}");
  line(0, "}");
  line(0, "");
  if (ir.events.length) {
    line(0, `export const ${eventCls} = {`);
    ir.events.forEach((e, i) => line(1, `${e.name}: ${i},`));
    line(0, "} as const;");
    line(0, `export type ${eventCls} = (typeof ${eventCls})[keyof typeof ${eventCls}];`);
  } else {
    line(0, `export const ${eventCls} = {} as const;`);
    line(0, `export type ${eventCls} = never;`);
  }
  line(0, "");
  /** A const object of numbered names and its union type. */
  const constEnum = (name: string, doc: string | undefined, keys: [string, string?][]): void => {
    if (doc) line(0, `/** ${doc} */`);
    if (keys.length) {
      line(0, `export const ${name} = {`);
      keys.forEach(([k, c], i) => line(1, `${k}: ${i},${c ? ` // ${comment(c)}` : ""}`));
      line(0, "} as const;");
      line(0, `export type ${name} = (typeof ${name})[keyof typeof ${name}];`);
    } else {
      line(0, `export const ${name} = {} as const;`);
      line(0, `export type ${name} = never;`);
    }
    line(0, "");
  };
  if (publicSignals) constEnum(signalCls, undefined, ir.signals.map((x) => [x.name]));
  constEnum(stateCls, "States in document order.", ir.states.map((st) => [st.ident, st.label !== st.ident ? st.label : undefined]));
  if (hasTimers) {
    constEnum(
      timerCls,
      "Timers: started when their state is entered, stopped when it is left.",
      ir.timers.map((t) => [t.name, `${t.periodic ? "every" : "after"} ${t.ms} ms -> ${ir.events[t.event]!.name}`]),
    );
    line(0, "/** The event to process when a timer expires. */");
    line(0, `export function ${timerEventFn}(timer: ${timerCls}): ${eventCls} {`);
    line(1, `const events = [${ir.timers.map((t) => `${eventCls}.${ir.events[t.event]!.name}`).join(", ")}] as const;`);
    line(1, "return events[timer];");
    line(0, "}");
    line(0, "");
  }
  if (trace) {
    const what = {
      event: `${eventCls}; process() accepted it`,
      signal: `${publicSignals ? signalCls : "signal number"}; taken from the queue`,
      transition: "transition number (see the machine class); before its actions",
      enter: `${stateCls}; before its entry actions`,
      exit: `${stateCls}; before its exit actions`,
    };
    constEnum(kindCls, `What ${handlerT}.trace() reports; the id is a number of the type named here.`, TRACE_KINDS.map((k) => [k, what[k]]));
  }
  line(0, "/** Actions and guards the machine calls. Guards may be called more than once per event and in any order. */");
  if (ir.actions.length || ir.guards.length || trace || hasTimers) {
    line(0, `export interface ${handlerT} {`);
    for (const a of ir.actions) line(1, `${a.name}(): void;`);
    for (const g of ir.guards) line(1, `${g.name}(): boolean;`);
    if (hasTimers) {
      line(1, "/**");
      line(1, " * Start a timer: it expires once, or every `ms` until stopped (the handler re-arms it). On expiry, pass");
      line(1, ` * ${timerEventFn}(timer) to process(). Called inside reset() and process(): must not block or call the machine.`);
      line(1, " */");
      line(1, `timer_start(timer: ${timerCls}, ms: number, periodic: boolean): void;`);
      line(1, "/** Stop a timer; does nothing if it is not running. No expiry of the earlier start should follow. */");
      line(1, `timer_stop(timer: ${timerCls}): void;`);
    }
    if (trace) {
      line(1, "/** Called inside reset() and process() with ids only; must not block or call the machine. */");
      line(1, `trace(kind: ${kindCls}, id: number): void;`);
    }
    line(0, "}");
  } else line(0, `export type ${handlerT} = object;`);
  line(0, "");
  line(0, `export class ${cls} {`);
  line(1, "// Regions and their states (cfg value: state):");
  ir.regionNames.forEach((n, r) => {
    const slots = ir.states.filter((s) => s.region === r).map((s) => `${s.slot}: ${comment(s.name)}`).join(", ");
    const hk = histIndex.get(r);
    const hd = hk === undefined ? "" : ` [${ir.history[hk]!.kind} history: hist[${hk}]]`;
    line(1, `//   ${r} ${comment(n)}: ${slots}${hd}`);
  });
  if (hasQueue) line(1, `// Signals: ${ir.signals.map((s, i) => `${i} ${s.name}`).join(", ")}`);
  if (trace && ir.transitions.length) {
    line(1, "// Transition numbers (trace):");
    ir.transitions.forEach((t, i) => line(1, `//   ${i} ${comment(t.label)}`));
  }
  line(1, "/** Identifies the numbering of events, signals, states and transitions (`ufsm info` prints it for a model file). */");
  line(1, `static readonly FINGERPRINT = ${hex32(ir.fingerprint)};`);
  if (debugInfo) {
    const names = (list: string[]): string => `[${list.map((n) => JSON.stringify(n)).join(", ")}]`;
    line(1, "/** Event names as in the model, by number. */");
    line(1, `static readonly EVENT_NAMES: readonly string[] = ${names(ir.events.map((e) => e.name))};`);
    line(1, "/** Signal names as in the model, by number. */");
    line(1, `static readonly SIGNAL_NAMES: readonly string[] = ${names(ir.signals.map((x) => x.name))};`);
    line(1, "/** State names as in the model (qualified when not unique), by number. */");
    line(1, `static readonly STATE_NAMES: readonly string[] = ${names(ir.states.map((st) => st.label))};`);
    if (hasTimers) {
      line(1, "/** Timer names as in the model, by number. */");
      line(1, `static readonly TIMER_NAMES: readonly string[] = ${names(ir.timers.map((t) => t.name))};`);
    }
    if (ir.states.length) {
      line(1, `private static readonly STATE_AT: readonly (readonly [number, number])[] = [${ir.states.map((st) => `[${st.region}, ${st.slot}]`).join(", ")}];`);
    }
  }
  const usesHandler = ir.actions.length + ir.guards.length > 0 || trace || hasTimers;
  line(1, `private readonly h: ${handlerT};`);
  line(1, "private started = false;");
  line(1, "/** A reset()/process() call is running, or one did not finish. */");
  line(1, "private busy = false;");
  line(1, `private cfg: number[] = ${zeros(ir.regions)};`);
  if (ir.history.length) line(1, `private hist: number[] = ${zeros(ir.history.length)};`);
  for (const dh of deepRegions) line(1, `private deep_r${dh.region}: number[] = ${zeros(dh.snapshotTo! - dh.snapshotFrom!)};`);
  if (hasQueue) line(1, "private queue: number[] = [];");
  if (countSteps) line(1, "private steps = 0;");
  if (hasTerminate) line(1, "private terminated = false;");
  const table = (ids: { id: string }[], steps: Record<string, string>): string =>
    `[${ids.map((d) => (steps[d.id] && reachable.has(steps[d.id]!) ? `() => this.${steps[d.id]}()` : "undefined")).join(", ")}]`;
  const eventSteps = ir.events.some((ev) => ir.onEvent[ev.id]);
  const signalSteps = hasQueue && ir.signals.some((sg) => ir.onSignal[sg.id]);
  if (eventSteps || signalSteps) line(1, "// Step method per event and signal number (undefined: nothing reacts to it).");
  if (eventSteps) line(1, `private readonly onEvent: readonly ((() => boolean) | undefined)[] = ${table(ir.events, ir.onEvent)};`);
  if (signalSteps) line(1, `private readonly onSignal: readonly ((() => boolean) | undefined)[] = ${table(ir.signals, ir.onSignal)};`);
  line(0, "");
  line(1, `constructor(handler: ${handlerT}) {`);
  line(2, "this.h = handler;");
  if (!usesHandler) line(2, "void this.h;");
  line(1, "}");
  line(0, "");

  // reset
  line(1, "reset(): void {");
  line(2, "this.busy = true;");
  line(2, "this.started = true;");
  line(2, `this.cfg = ${zeros(ir.regions)};`);
  if (ir.history.length) line(2, `this.hist = ${zeros(ir.history.length)};`);
  for (const dh of deepRegions) line(2, `this.deep_r${dh.region} = ${zeros(dh.snapshotTo! - dh.snapshotFrom!)};`);
  if (hasQueue) line(2, "this.queue = [];");
  if (countSteps) line(2, "this.steps = 0;");
  if (hasTerminate) line(2, "this.terminated = false;");
  stmts(ir.start, 2);
  const settleBody = hasTerminate || ir.eventless !== undefined || hasQueue;
  if (settleBody) line(2, "this.settle();");
  line(2, "this.busy = false;");
  line(1, "}");
  line(0, "");

  // process
  line(1, `process(event: ${eventCls}): void {`);
  line(2, "const e: number = event;");
  line(2, "if (!this.started) {");
  line(3, `throw new ${errorCls}("not-started", "call reset() before process()");`);
  line(2, "}");
  line(2, `if (!Number.isInteger(e) || e < 0 || e >= ${ir.events.length}) {`);
  line(3, `throw new ${errorCls}("unknown-event", \`unknown event \${String(event)}\`);`);
  line(2, "}");
  line(2, "if (this.busy) {");
  line(3, `throw new ${errorCls}("busy", ${JSON.stringify(BUSY_MESSAGE)});`);
  line(2, "}");
  if (hasTerminate) {
    line(2, "if (this.terminated) {");
    line(3, "return;");
    line(2, "}");
  }
  line(2, "this.busy = true;");
  if (countSteps) line(2, "this.steps = 0;");
  if (trace) line(2, `this.h.trace(${kindCls}.event, e);`);
  if (eventSteps) line(2, "this.onEvent[e]?.();");
  if (settleBody) line(2, "this.settle();");
  line(2, "this.busy = false;");
  line(1, "}");

  // runtime helpers
  if (settleBody) {
    line(0, "");
    line(1, "/** Run eventless transitions and queued signals until the machine is stable. */");
    line(1, "private settle(): void {");
    line(2, "for (;;) {");
    if (hasTerminate) {
      line(3, "if (this.terminated) {");
      line(4, `this.cfg = ${zeros(ir.regions)};`);
      if (hasQueue) line(4, "this.queue = [];");
      line(4, "return;");
      line(3, "}");
    }
    if (ir.eventless !== undefined) {
      line(3, `if (this.${ir.eventless}()) {`);
      line(4, "continue;");
      line(3, "}");
    }
    if (hasQueue) {
      line(3, "const signal = this.queue.shift();");
      line(3, "if (signal === undefined) {");
      line(4, "return;");
      line(3, "}");
      if (trace) line(3, `this.h.trace(${kindCls}.signal, signal);`);
      if (signalSteps) line(3, "this.onSignal[signal]?.();");
    } else line(3, "return;");
    line(2, "}");
    line(1, "}");
  }
  if (hasQueue) {
    line(0, "");
    line(1, "private push(signal: number): void {");
    line(2, `if (this.queue.length >= ${queueCap}) {`);
    line(3, `throw new ${errorCls}("queue-overflow", "signal queue full (${queueCap})");`);
    line(2, "}");
    line(2, "this.queue.push(signal);");
    line(1, "}");
  }
  if (debugInfo && ir.states.length) {
    line(0, "");
    line(1, "/** Whether `state` is active. */");
    line(1, `isActive(state: ${stateCls}): boolean {`);
    line(2, `const at = ${cls}.STATE_AT[state];`);
    line(2, "return at !== undefined && this.cfg[at[0]] === at[1];");
    line(1, "}");
  }
  if (countSteps) {
    line(0, "");
    line(1, "private microstep(): void {");
    line(2, `if (++this.steps > ${maxSteps}) {`);
    line(3, `throw new ${errorCls}("livelock", "more than ${maxSteps} microsteps in one call");`);
    line(2, "}");
    line(1, "}");
  }

  for (const f of functions) {
    line(0, "");
    if (f.doc) line(1, `/** ${comment(f.doc).replace(/\*\//g, "* /")} */`);
    line(1, `private ${f.name}(): ${f.returns === "bool" ? "boolean" : "void"} {`);
    for (const x of f.flags) line(2, `let ${x} = false;`);
    stmts(f.body, 2);
    line(1, "}");
  }
  line(0, "}");

  return { fileName: `${module}.ts`, source: `${out.join("\n")}\n` };
}
