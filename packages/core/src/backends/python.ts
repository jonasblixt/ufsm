// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Python backend: prints an IrModule as one typed Python module.
 *
 * The module is fully typed (it passes `pyright --strict` for Python 3.8)
 * and imports only `enum` and `typing` from the standard library. It
 * defines `<Class>Error`, `<Class>Event` (an IntEnum), `<Class>Handler` (a
 * Protocol with one method per action and guard) and the machine class
 * `<Class>`, which calls the actions and guards on the handler given to its
 * constructor. The runtime loop (reset/process/settle) is the one described
 * in ir/ir.ts.
 *
 * Errors (full signal queue, livelock, unknown event, process() before
 * reset(), process() while busy) raise `<Class>Error`, whose `code` is the
 * interpreter's error code. Exceptions from the handler are not caught: they
 * leave the machine busy until reset(), as the interpreter does. Only what
 * the model uses is emitted, as in the C backend.
 *
 * Always: `<Class>State` (an IntEnum, document order) and `<Class>.FINGERPRINT`.
 * With `debugInfo`: `EVENT_NAMES`, `SIGNAL_NAMES`, `STATE_NAMES` and
 * `is_active()` on the machine class. With `trace` (decided by the IR):
 * `<Class>TraceKind` and a `trace(kind, id)` method on the handler. With
 * timers in the model: `<Class>Timer` (an IntEnum), `timer_start()` and
 * `timer_stop()` on the handler, and the module function `<module>_timer_event()`.
 */
import type { UfsmDocument } from "../v1/model";
import { IDENTIFIER } from "../v1/model";
import { OPTION_DEFAULTS, targetSection } from "../v1/options";
import { UFSM_VERSION } from "../version";
import type { Expr, IrModule, Stmt, SwitchOn } from "../ir/ir";
import { TRACE_KINDS } from "../ir/ir";
import { hex32 } from "../ir/ids";
import { BUSY_MESSAGE } from "../interp/interpreter";
import { CodegenError, OUTPUT_NOTICE, cIdentifier } from "./c";

export interface PythonOptions {
  /** Name of the machine class; also the prefix of `<Class>Event`, `<Class>Handler` and `<Class>Error`. Default: the model name in PascalCase. */
  className?: string;
  /** Base name of the file: `<module>.py`. Default: the model name as an identifier. */
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

export interface PythonFiles {
  fileName: string;
  source: string;
}

export const PYTHON_KEYWORDS = new Set(
  (
    "False None True and as assert async await break class continue def del elif else except finally for from global " +
    "if import in is lambda nonlocal not or pass raise return try while with yield"
  ).split(" "),
);

/** Name of a declaration in Python: a keyword gets a trailing underscore (`not` -> `not_`). */
export function pythonName(name: string): string {
  return PYTHON_KEYWORDS.has(name) ? `${name}_` : name;
}

/** "test_guard1" -> "TestGuard1", "New model" -> "NewModel". */
export function pythonClassName(text: string): string {
  const parts = cIdentifier(text).split("_").filter((p) => p !== "");
  const s = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  return /^[A-Za-z]/.test(s) ? s : `M${s}`;
}

/** Read `targets.python`. Unknown keys and wrong types are reported, not fatal: the defaults are used instead. */
export function pythonOptionsFromTargets(doc: UfsmDocument): { options: PythonOptions; problems: string[] } {
  const { api, own, problems } = targetSection(doc, "python");
  const options: PythonOptions = { ...api };
  for (const [k, v] of own) {
    switch (k) {
      case "className":
      case "module":
        if (typeof v === "string") options[k] = v;
        else problems.push(`targets.python.${k}: expected a string`);
        break;
      default:
        problems.push(`targets.python.${k}: unknown option (ignored)`);
    }
  }
  return { options, problems };
}

/** Text that is safe in a `#` comment. */
function comment(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

/** Precedence of a printed expression: 0 `or`, 1 `and`, 2 `not`, 3 comparison, 4 primary. */
interface Printed {
  s: string;
  p: number;
}

export function generatePython(ir: IrModule, options: PythonOptions = {}): PythonFiles {
  const cls = options.className ?? pythonClassName(ir.name);
  const module = options.module ?? cIdentifier(ir.name);
  for (const [what, v] of [["class name", cls], ["module name", module]] as const) {
    if (!IDENTIFIER.test(v) || PYTHON_KEYWORDS.has(v)) throw new CodegenError(`Python ${what} '${v}' is not a Python identifier`);
  }
  const queueCap = options.signalQueue ?? OPTION_DEFAULTS.signalQueue;
  const maxSteps = options.maxMicrosteps ?? OPTION_DEFAULTS.maxMicrosteps;
  const errorCls = `${cls}Error`;
  const eventCls = `${cls}Event`;
  const handlerCls = `${cls}Handler`;
  const stateCls = `${cls}State`;
  const signalCls = `${cls}Signal`;
  const kindCls = `${cls}TraceKind`;
  const timerCls = `${cls}Timer`;
  const hasTimers = ir.timers.length > 0;
  const timerEventFn = `${module}_timer_event`;
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

  // ------------------------------------------------------------ names

  // Declaration names are C identifiers. A Python keyword gets a trailing underscore (PEP 8: `not` -> `not_`);
  // a leading "__" cannot be used, Python would mangle it inside the class body.
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [kind, list] of [["event", ir.events], ["signal", ir.signals], ["action", ir.actions], ["guard", ir.guards]] as const) {
    for (const d of list) {
      const py = pythonName(d.name);
      const what = `${kind} '${d.name}'`;
      if (d.name.startsWith("__")) problems.push(`${what} starts with '__' (Python would mangle it)`);
      else if (seen.has(py)) problems.push(`${what} becomes '${py}', like ${seen.get(py)}`);
      else if (trace && py === "trace" && (kind === "action" || kind === "guard")) problems.push(`${what} is the name of the trace hook`);
      else if (hasTimers && (py === "timer_start" || py === "timer_stop") && (kind === "action" || kind === "guard")) {
        problems.push(`${what} is the name of a timer function of the handler`);
      }
      seen.set(py, what);
    }
  }
  const stateMember = ir.states.map((st) => pythonName(st.ident));
  const timerMember = ir.timers.map((t) => pythonName(t.name));
  for (const t of ir.timers) if (t.name.startsWith("__")) problems.push(`timer '${t.name}' starts with '__' (Python would mangle it)`);
  if (problems.length) throw new CodegenError(`names that cannot be used in the generated Python (rename them):\n  ${problems.join("\n  ")}`);

  const decl = new Map<string, string>();
  for (const d of [...ir.events, ...ir.signals, ...ir.actions, ...ir.guards]) decl.set(d.id, pythonName(d.name));
  const signalNo = new Map(ir.signals.map((s, i) => [s.id, i]));
  const histIndex = new Map(ir.history.map((h, k) => [h.region, k]));
  const deepRegions = ir.history.filter((h) => h.kind === "deep" && h.snapshotTo! > h.snapshotFrom!);
  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const stateName = (region: number, slot: number): string => comment(stateAt.get(`${region}:${slot}`) ?? `slot ${slot}`);
  const method = (fn: string): string => `_${fn}`;

  // ------------------------------------------------------------ expressions

  const guardCall = (g: string): string => `self._h.${decl.get(g)}()`;
  const wrap = (x: Printed, min: number): string => (x.p < min ? `(${x.s})` : x.s);
  const tuple = (xs: number[]): string => `(${xs.join(", ")}${xs.length === 1 ? "," : ""})`;

  const expr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "True", p: 4 };
      case "active":
        return { s: `self._cfg[${e.region}] == ${e.slot}`, p: 3 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "False", p: 4 };
        if (e.slots.length === 1) return { s: `self._cfg[${e.region}] == ${e.slots[0]}`, p: 3 };
        return { s: `self._cfg[${e.region}] in ${tuple(e.slots)}`, p: 3 };
      case "hasHistory":
        return { s: `self._hist[${histIndex.get(e.region)}] != 0`, p: 3 };
      case "guard":
        return { s: guardCall(e.guard), p: 4 };
      case "flag":
        return { s: e.name, p: 4 };
      case "not":
        return notExpr(e.expr);
      case "and":
        return { s: e.exprs.map((x) => wrap(expr(x), 1)).join(" and "), p: 1 };
      case "or":
        return { s: e.exprs.map((x) => wrap(expr(x), 0)).join(" or "), p: 0 };
    }
  };
  const notExpr = (e: Expr): Printed => {
    switch (e.op) {
      case "true":
        return { s: "False", p: 4 };
      case "active":
        return { s: `self._cfg[${e.region}] != ${e.slot}`, p: 3 };
      case "activeIn":
        if (e.slots.length === 0) return { s: "True", p: 4 };
        if (e.slots.length === 1) return { s: `self._cfg[${e.region}] != ${e.slots[0]}`, p: 3 };
        return { s: `self._cfg[${e.region}] not in ${tuple(e.slots)}`, p: 3 };
      case "hasHistory":
        return { s: `self._hist[${histIndex.get(e.region)}] == 0`, p: 3 };
      case "not":
        return expr(e.expr);
      default:
        return { s: `not ${wrap(expr(e), 2)}`, p: 2 };
    }
  };

  // ------------------------------------------------------------ statements

  const out: string[] = [];
  const line = (depth: number, text: string): void => void out.push(text === "" ? "" : `${"    ".repeat(depth)}${text}`);
  const switchOn = (o: SwitchOn): string =>
    o.kind === "cfg" ? `self._cfg[${o.region}]` : o.kind === "hist" ? `self._hist[${histIndex.get(o.region)}]` : `self._deep_r${o.history}[${o.index}]`;
  const caseRegion = (o: SwitchOn): number => (o.kind === "deep" ? ir.history.find((h) => h.region === o.history)!.snapshotFrom! + o.index : o.region);

  /** Print a block; a block that prints nothing gets `pass`. */
  const block = (list: Stmt[], d: number): void => {
    const before = out.length;
    stmts(list, d);
    if (out.length === before) line(d, "pass");
  };

  const stmts = (list: Stmt[], d: number): void => {
    for (const s of list) {
      switch (s.op) {
        case "if": {
          const hasElse = !!s.else && s.else.length > 0;
          if (s.then.length === 0 && !hasElse) break; // nothing to do; guards have no side effects (semantics.md)
          if (s.then.length === 0) {
            line(d, `if ${notExpr(s.cond).s}:`);
            block(s.else!, d + 1);
            break;
          }
          line(d, `if ${expr(s.cond).s}:`);
          block(s.then, d + 1);
          let els = s.else;
          while (els && els.length === 1 && els[0]!.op === "if" && els[0]!.then.length > 0) {
            const e = els[0] as Extract<Stmt, { op: "if" }>;
            line(d, `elif ${expr(e.cond).s}:`);
            block(e.then, d + 1);
            els = e.else;
          }
          if (els && els.length) {
            line(d, "else:");
            block(els, d + 1);
          }
          break;
        }
        case "switch": {
          const on = switchOn(s.on);
          const region = caseRegion(s.on);
          let first = true;
          for (const c of s.cases) {
            if (c.body.length === 0) continue;
            line(d, `${first ? "if" : "elif"} ${on} == ${c.slot}:  # ${stateName(region, c.slot)}`);
            block(c.body, d + 1);
            first = false;
          }
          break;
        }
        case "set":
          line(d, s.slot === 0 ? `self._cfg[${s.region}] = 0` : `self._cfg[${s.region}] = ${s.slot}  # ${stateName(s.region, s.slot)}`);
          break;
        case "call":
          line(d, `self._h.${decl.get(s.action)}()`);
          break;
        case "emit":
          line(d, `self._push(${signalNo.get(s.signal)})  # ${decl.get(s.signal)}`);
          break;
        case "setFlag":
          line(d, `${s.name} = True`);
          break;
        case "invoke":
          line(d, `self.${method(s.fn)}()`);
          break;
        case "saveHistory":
          line(d, `self._hist[${histIndex.get(s.region)}] = self._cfg[${s.region}]`);
          break;
        case "clearHistory":
          line(d, `self._hist[${histIndex.get(s.region)}] = 0`);
          break;
        case "saveDeep": {
          const h = ir.history.find((x) => x.region === s.region)!;
          if (h.snapshotTo! > h.snapshotFrom!) line(d, `self._deep_r${s.region} = self._cfg[${h.snapshotFrom}:${h.snapshotTo}]`);
          break;
        }
        case "microstep":
          if (checkSteps) line(d, "self._microstep()");
          break;
        case "trace":
          if (s.hook === "transition") line(d, `self._h.trace(${kindCls}.transition, ${s.index})  # ${comment(ir.transitions[s.index]!.label)}`);
          else line(d, `self._h.trace(${kindCls}.${s.hook}, ${stateCls}.${stateMember[s.index]})`);
          break;
        case "timerStart": {
          const t = ir.timers[s.timer]!;
          line(d, `self._h.timer_start(${timerCls}.${timerMember[s.timer]}, ${t.ms}, ${t.periodic ? "True" : "False"})`);
          break;
        }
        case "timerStop":
          line(d, `self._h.timer_stop(${timerCls}.${timerMember[s.timer]})`);
          break;
        case "terminate":
          line(d, "self._terminated = True");
          break;
        case "return":
          line(d, `return ${s.value ? "True" : "False"}`);
          break;
      }
    }
  };

  // ------------------------------------------------------------ module

  const eventNames = ir.events.map((e) => pythonName(e.name));
  const R = ir.regions;
  line(0, `# Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit.`);
  line(0, `# ${OUTPUT_NOTICE}`);
  line(0, "#");
  line(0, `#     machine = ${cls}(handler)  # handler: any object that implements ${handlerCls}`);
  line(0, "#     machine.reset()  # start; also restarts (no exit actions run)");
  if (eventNames.length) line(0, `#     machine.process(${eventCls}.${eventNames[0]})`);
  line(0, "#");
  line(0, `# reset() and process() raise ${errorCls} on errors; after one, call reset().`);
  line(0, "# An exception from an action or guard passes through unchanged and leaves the");
  line(0, `# machine half-way: until reset(), process() raises ${errorCls} "busy", as it`);
  line(0, "# does when an action or guard calls it.");
  line(0, "");
  line(0, "from enum import IntEnum");
  line(0, "from typing import Callable, List, Optional, Protocol, Tuple");
  line(0, "");
  line(0, "");
  line(0, `class ${errorCls}(Exception):`);
  line(1, '"""code: "queue-overflow", "livelock", "unknown-event", "not-started" or "busy"."""');
  line(0, "");
  line(1, "def __init__(self, code: str, message: str) -> None:");
  line(2, "super().__init__(message)");
  line(2, "self.code = code");
  line(0, "");
  line(0, "");
  line(0, `class ${eventCls}(IntEnum):`);
  if (ir.events.length) ir.events.forEach((e, i) => line(1, `${pythonName(e.name)} = ${i}`));
  else line(1, "pass");
  line(0, "");
  line(0, "");
  if (publicSignals) {
    line(0, `class ${signalCls}(IntEnum):`);
    ir.signals.forEach((x, i) => line(1, `${pythonName(x.name)} = ${i}`));
    line(0, "");
    line(0, "");
  }
  line(0, `class ${stateCls}(IntEnum):`);
  line(1, '"""States in document order."""');
  if (ir.states.length) line(0, "");
  ir.states.forEach((st, i) => line(1, `${stateMember[i]} = ${i}${st.label !== st.ident ? `  # ${comment(st.label)}` : ""}`));
  line(0, "");
  line(0, "");
  if (hasTimers) {
    line(0, `class ${timerCls}(IntEnum):`);
    line(1, '"""Timers: started when their state is entered, stopped when it is left."""');
    line(0, "");
    ir.timers.forEach((t, i) => line(1, `${timerMember[i]} = ${i}  # ${t.periodic ? "every" : "after"} ${t.ms} ms -> ${comment(ir.events[t.event]!.name)}`));
    line(0, "");
    line(0, "");
    line(0, `_TIMER_EVENTS: Tuple[${eventCls}, ...] = (${ir.timers.map((t) => `${eventCls}.${eventNames[t.event]}`).join(", ")}${ir.timers.length === 1 ? "," : ""})`);
    line(0, "");
    line(0, "");
    line(0, `def ${timerEventFn}(timer: ${timerCls}) -> ${eventCls}:`);
    line(1, '"""The event to process when a timer expires."""');
    line(1, "return _TIMER_EVENTS[timer]");
    line(0, "");
    line(0, "");
  }
  if (trace) {
    line(0, `class ${kindCls}(IntEnum):`);
    line(1, `"""What ${handlerCls}.trace() reports; the id is a number of the type named here."""`);
    line(0, "");
    const what = {
      event: `${eventCls}; process() accepted it`,
      signal: `${publicSignals ? signalCls : "signal number"}; taken from the queue`,
      transition: "transition number (see the machine class); before its actions",
      enter: `${stateCls}; before its entry actions`,
      exit: `${stateCls}; before its exit actions`,
    };
    TRACE_KINDS.forEach((k, i) => line(1, `${k} = ${i}  # ${what[k]}`));
    line(0, "");
    line(0, "");
  }
  line(0, `class ${handlerCls}(Protocol):`);
  line(1, '"""Actions and guards the machine calls. Guards return a bool and may be called more than once per event."""');
  for (const a of ir.actions) {
    line(0, "");
    line(1, `def ${pythonName(a.name)}(self) -> None: ...`);
  }
  for (const g of ir.guards) {
    line(0, "");
    line(1, `def ${pythonName(g.name)}(self) -> bool: ...`);
  }
  if (hasTimers) {
    line(0, "");
    line(1, `def timer_start(self, timer: ${timerCls}, ms: int, periodic: bool) -> None:`);
    line(2, '"""Start a timer: it expires once, or every ms until stopped (the handler re-arms it).');
    line(0, "");
    line(2, `On expiry, pass ${timerEventFn}(timer) to process(). Called inside reset() and process():`);
    line(2, 'it must not block or call the machine."""');
    line(2, "...");
    line(0, "");
    line(1, `def timer_stop(self, timer: ${timerCls}) -> None:`);
    line(2, '"""Stop a timer; does nothing if it is not running. No expiry of the earlier start should follow."""');
    line(2, "...");
  }
  if (trace) {
    line(0, "");
    line(1, `def trace(self, kind: ${kindCls}, id: int) -> None:`);
    line(2, '"""Called inside reset() and process() with ids only; must not block or call the machine."""');
    line(2, "...");
  }
  line(0, "");
  line(0, "");
  line(0, `class ${cls}:`);
  line(1, "# Regions and their states (cfg value: state):");
  ir.regionNames.forEach((n, r) => {
    const slots = ir.states.filter((s) => s.region === r).map((s) => `${s.slot}: ${comment(s.name)}`).join(", ");
    const hk = histIndex.get(r);
    const hd = hk === undefined ? "" : ` [${ir.history[hk]!.kind} history: hist[${hk}]]`;
    line(1, `#   ${r} ${comment(n)}: ${slots}${hd}`);
  });
  if (hasQueue) line(1, `# Signals: ${ir.signals.map((s, i) => `${i} ${s.name}`).join(", ")}`);
  if (trace && ir.transitions.length) {
    line(1, "# Transition numbers (trace):");
    ir.transitions.forEach((t, i) => line(1, `#   ${i} ${comment(t.label)}`));
  }
  line(0, "");
  line(1, "# Identifies the numbering of events, signals, states and transitions (`ufsm info` prints it for a model file).");
  line(1, `FINGERPRINT = ${hex32(ir.fingerprint)}`);
  if (debugInfo) {
    const tup = (items: string[]): string => `(${items.join(", ")}${items.length === 1 ? "," : ""})`;
    const names = (list: string[]): string => tup(list.map((n) => JSON.stringify(n)));
    line(1, "# Names as in the model, by number.");
    line(1, `EVENT_NAMES: Tuple[str, ...] = ${names(ir.events.map((e) => e.name))}`);
    line(1, `SIGNAL_NAMES: Tuple[str, ...] = ${names(ir.signals.map((x) => x.name))}`);
    line(1, `STATE_NAMES: Tuple[str, ...] = ${names(ir.states.map((st) => st.label))}`);
    if (hasTimers) line(1, `TIMER_NAMES: Tuple[str, ...] = ${names(ir.timers.map((t) => t.name))}`);
    if (ir.states.length) line(1, `_STATE_AT: Tuple[Tuple[int, int], ...] = ${tup(ir.states.map((st) => `(${st.region}, ${st.slot})`))}`);
  }
  line(0, "");
  line(1, `def __init__(self, handler: ${handlerCls}) -> None:`);
  line(2, "self._h = handler");
  line(2, "self._started = False");
  line(2, "self._busy = False  # a reset()/process() call is running, or one did not finish");
  line(2, `self._cfg: List[int] = [0] * ${R}`);
  if (ir.history.length) line(2, `self._hist: List[int] = [0] * ${ir.history.length}`);
  for (const dh of deepRegions) line(2, `self._deep_r${dh.region}: List[int] = [0] * ${dh.snapshotTo! - dh.snapshotFrom!}`);
  if (hasQueue) line(2, "self._queue: List[int] = []");
  if (checkSteps) line(2, "self._steps = 0");
  if (hasTerminate) line(2, "self._terminated = False");
  // Step method per event and signal number, bound to this machine (None: nothing reacts to it).
  const table = (ids: { id: string }[], steps: Record<string, string>): string => {
    const items = ids.map((d) => (steps[d.id] && reachable.has(steps[d.id]!) ? `self.${method(steps[d.id]!)}` : "None"));
    return `(${items.join(", ")}${items.length === 1 ? "," : ""})`;
  };
  const stepT = "Tuple[Optional[Callable[[], bool]], ...]";
  line(2, `self._on_event: ${stepT} = ${table(ir.events, ir.onEvent)}`);
  if (hasQueue) line(2, `self._on_signal: ${stepT} = ${table(ir.signals, ir.onSignal)}`);
  line(0, "");

  // reset
  line(1, "def reset(self) -> None:");
  line(2, "self._busy = True");
  line(2, "self._started = True");
  line(2, `self._cfg = [0] * ${ir.regions}`);
  if (ir.history.length) line(2, `self._hist = [0] * ${ir.history.length}`);
  for (const dh of deepRegions) line(2, `self._deep_r${dh.region} = [0] * ${dh.snapshotTo! - dh.snapshotFrom!}`);
  if (hasQueue) line(2, "self._queue = []");
  if (checkSteps) line(2, "self._steps = 0");
  if (hasTerminate) line(2, "self._terminated = False");
  stmts(ir.start, 2);
  const settleBody = hasTerminate || ir.eventless !== undefined || hasQueue;
  if (settleBody) line(2, "self._settle()");
  line(2, "self._busy = False");
  line(0, "");

  // process
  line(1, `def process(self, event: ${eventCls}) -> None:`);
  line(2, "if not self._started:");
  line(3, `raise ${errorCls}("not-started", "call reset() before process()")`);
  line(2, `if not 0 <= event < ${ir.events.length}:`);
  line(3, `raise ${errorCls}("unknown-event", "unknown event %r" % (event,))`);
  line(2, "if self._busy:");
  line(3, `raise ${errorCls}("busy", ${JSON.stringify(BUSY_MESSAGE)})`);
  if (hasTerminate) {
    line(2, "if self._terminated:");
    line(3, "return");
  }
  line(2, "self._busy = True");
  if (checkSteps) line(2, "self._steps = 0");
  if (trace) line(2, `self._h.trace(${kindCls}.event, event)`);
  if (ir.events.some((e) => ir.onEvent[e.id])) {
    line(2, "step = self._on_event[event]");
    line(2, "if step is not None:");
    line(3, "step()");
  }
  if (settleBody) line(2, "self._settle()");
  line(2, "self._busy = False");

  // runtime helpers
  if (settleBody) {
    line(0, "");
    line(1, "def _settle(self) -> None:");
    line(2, "# Run eventless transitions and queued signals until the machine is stable.");
    line(2, "while True:");
    if (hasTerminate) {
      line(3, "if self._terminated:");
      line(4, `self._cfg = [0] * ${ir.regions}`);
      if (hasQueue) line(4, "self._queue = []");
      line(4, "return");
    }
    if (ir.eventless !== undefined) {
      line(3, `if self.${method(ir.eventless)}():`);
      line(4, "continue");
    }
    if (hasQueue) {
      line(3, "if not self._queue:");
      line(4, "return");
      const reacts = ir.signals.some((s) => ir.onSignal[s.id]);
      if (trace) {
        line(3, "signal = self._queue.pop(0)");
        line(3, `self._h.trace(${kindCls}.signal, signal)`);
      }
      const popped = trace ? "signal" : "self._queue.pop(0)";
      if (reacts) {
        line(3, `step = self._on_signal[${popped}]`);
        line(3, "if step is not None:");
        line(4, "step()");
      } else if (!trace) line(3, popped);
    } else line(3, "return");
  }
  if (hasQueue) {
    line(0, "");
    line(1, "def _push(self, signal: int) -> None:");
    line(2, `if len(self._queue) >= ${queueCap}:`);
    line(3, `raise ${errorCls}("queue-overflow", "signal queue full (${queueCap})")`);
    line(2, "self._queue.append(signal)");
  }
  if (debugInfo && ir.states.length) {
    line(0, "");
    line(1, `def is_active(self, state: ${stateCls}) -> bool:`);
    line(2, "region, slot = self._STATE_AT[state]");
    line(2, "return self._cfg[region] == slot");
  }
  if (checkSteps) {
    line(0, "");
    line(1, "def _microstep(self) -> None:");
    line(2, "self._steps += 1");
    line(2, `if self._steps > ${maxSteps}:`);
    line(3, `raise ${errorCls}("livelock", "more than ${maxSteps} microsteps in one call")`);
  }

  for (const f of functions) {
    line(0, "");
    line(1, `def ${method(f.name)}(self) -> ${f.returns === "bool" ? "bool" : "None"}:`);
    if (f.doc) line(2, `# ${comment(f.doc)}`);
    for (const x of f.flags) line(2, `${x} = False`);
    block(f.body, 2);
  }

  return { fileName: `${module}.py`, source: `${out.join("\n")}\n` };
}
