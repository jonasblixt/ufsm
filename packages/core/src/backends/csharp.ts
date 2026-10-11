// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * C# backend: prints an IrModule as one C# source file.
 *
 * The file needs C# 8 or newer (it enables nullable reference types for itself) and nothing beyond `System`, which it
 * names as `global::System` so no `using` can change what it means. It declares `<Class>Event`, `<Class>State`,
 * `I<Class>Handler` (one method per action and guard), `<Class>Exception` (with a `Code`) and the machine class
 * `<Class>`, `sealed partial` so an application can add members in a file of its own; in `targets.csharp.namespace`
 * when set. Every public member has an XML doc comment, so the file builds with `GenerateDocumentationFile` and
 * warnings as errors. The runtime loop (reset/process/settle) is the one described in ir/ir.ts; errors are exceptions,
 * as in the interpreter. Exceptions from the handler are not caught: they leave the machine busy until Reset(), as in
 * the interpreter. The machine allocates its arrays once, in the constructor.
 *
 * Always: `<Class>State` (document order) and `<Class>.Fingerprint`. With `debugInfo`: `EventNames`, `SignalNames`,
 * `StateNames` (and `TimerNames`) and `IsActive()`. With `trace` (decided by the IR): `<Class>TraceKind` and a
 * `Trace(kind, id)` method on the handler. With timers in the model: `<Class>Timer`, `TimerStart()` and `TimerStop()`
 * on the handler, and `<Class>.TimerEvent()`, the event to process when a timer expires.
 */
import type { UfsmDocument } from "../format/model";
import { IDENTIFIER } from "../format/model";
import { UFSM_VERSION } from "../version";
import type { Expr, IrHistory, IrModule, Stmt, SwitchOn } from "../ir/ir";
import { TRACE_KINDS } from "../ir/ir";
import { hex32 } from "../ir/ids";
import { BUSY_MESSAGE } from "../runtime/contract";
import {
  CodegenError,
  OUTPUT_NOTICE,
  lines,
  pascalCase,
  prepare,
  readTargetOptions,
  type CommonOptions,
  type Lines,
  type Prepared,
  type Printed,
} from "./common";

export interface CsharpOptions extends CommonOptions {
  /** Name of the machine class; also the prefix of the other type names. Default: the model name in PascalCase. */
  className?: string;
  /** Namespace of every type (dotted). Default: none (the global namespace). */
  namespace?: string;
  /** Base name of the file: `<file>.cs`. Default: the class name. */
  file?: string;
}

export interface CsharpFiles {
  fileName: string;
  source: string;
}

const CS_KEYWORDS = new Set(
  (
    "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double " +
    "else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is " +
    "lock long namespace new null object operator out override params private protected public readonly ref return " +
    "sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked " +
    "unsafe ushort using virtual void volatile while"
  ).split(" "),
);

/** Names every object already has: a handler method with one of these names would hide or clash with it. */
const OBJECT_MEMBERS = new Set(["Equals", "GetHashCode", "GetType", "ToString", "Finalize", "MemberwiseClone"]);

/** The keys of `targets.csharp` besides the API options. */
export const CSHARP_TARGET_KEYS = ["className", "namespace", "file"] as const;

/** Read `targets.csharp`. Unknown keys and wrong types are reported, not fatal: the defaults are used instead. */
export function csharpOptionsFromTargets(doc: UfsmDocument): { options: CsharpOptions; problems: string[] } {
  return readTargetOptions(doc, "csharp", CSHARP_TARGET_KEYS);
}

/** Name of a declaration in C#: as written, a keyword as a verbatim identifier (`event` -> `@event`). */
export function csharpName(name: string): string {
  return CS_KEYWORDS.has(name) ? `@${name}` : name;
}

/** Text that is safe in a `//` comment. */
function comment(text: string): string {
  return text.replace(/[\r\n\u2028\u2029\u0085]+/g, " ");
}

/** Text that is safe in an XML doc comment. */
function xml(text: string): string {
  return comment(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A C# string literal. */
function csString(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === "\\") out += `\\${ch}`;
    else if (c < 0x20 || c === 0x7f || c === 0x85 || c === 0x2028 || c === 0x2029)
      out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `"${out}"`;
}

/** Names and facts every part of the C# printer uses. */
interface CsContext extends Prepared {
  ir: IrModule;
  cls: string;
  ns: string | undefined;
  file: string;
  eventT: string;
  stateT: string;
  signalT: string;
  timerT: string;
  kindT: string;
  handlerT: string;
  errorT: string;
  /** C# name of every declaration, by id. */
  name: Map<string, string>;
  stateConst: string[];
  timerConst: string[];
  signalNo: Map<string, number>;
  /** Index into `hist` of each history region. */
  histIndex: Map<number, number>;
  /** Deep history regions with something to snapshot. */
  deepRegions: IrHistory[];
  /** Element type of cfg and hist. */
  slotT: string;
  /** Signals get a public enum when the application sees their numbers (trace hook, name lookup). */
  publicSignals: boolean;
  /** settle() has something to do: eventless transitions, queued signals or terminate. */
  settleBody: boolean;
  /** A state's name for a comment, by region and slot. */
  stateName(region: number, slot: number): string;
}

const TRACE_NAMES: Record<string, string> = {
  event: "Event",
  signal: "Signal",
  transition: "Transition",
  enter: "Enter",
  exit: "Exit",
};

function csContext(ir: IrModule, options: CsharpOptions): CsContext {
  const cls = options.className ?? pascalCase(ir.name);
  const ns = options.namespace;
  const file = options.file ?? cls;
  if (!IDENTIFIER.test(cls) || CS_KEYWORDS.has(cls) || !/^[A-Za-z]/.test(cls))
    throw new CodegenError(`C# class name '${cls}' is not a usable identifier`);
  if (ns !== undefined && !ns.split(".").every((p) => IDENTIFIER.test(p) && !CS_KEYWORDS.has(p) && p !== "global"))
    throw new CodegenError(`C# namespace '${ns}' is not a usable dotted name`);
  if (!/^[A-Za-z0-9_.-]+$/.test(file)) throw new CodegenError(`C# file name '${file}' is not a plain file name`);
  const prepared = prepare(ir, options);
  const { trace, debugInfo, hasQueue, hasTerminate, hasTimers } = prepared;
  const publicSignals = (trace || debugInfo) && ir.signals.length > 0;
  const types = {
    eventT: `${cls}Event`,
    stateT: `${cls}State`,
    signalT: `${cls}Signal`,
    timerT: `${cls}Timer`,
    kindT: `${cls}TraceKind`,
    handlerT: `I${cls}Handler`,
    errorT: `${cls}Exception`,
  };

  const name = new Map<string, string>();
  for (const d of [...ir.events, ...ir.signals, ...ir.actions, ...ir.guards]) name.set(d.id, csharpName(d.name));
  const stateConst = ir.states.map((st) => csharpName(st.ident));
  const timerConst = ir.timers.map((t) => csharpName(t.name));

  // Handler methods must not be named like the fixed ones, or like what every object has.
  const problems: string[] = [];
  const fixed = new Map<string, string>([
    ...(hasTimers
      ? ([
          ["TimerStart", "a timer method of the handler"],
          ["TimerStop", "a timer method of the handler"],
        ] as [string, string][])
      : []),
    ...(trace ? ([["Trace", "the trace hook"]] as [string, string][]) : []),
  ]);
  for (const [kind, list] of [
    ["action", ir.actions],
    ["guard", ir.guards],
  ] as const) {
    for (const d of list) {
      if (OBJECT_MEMBERS.has(d.name)) problems.push(`${kind} '${d.name}' is a name every C# object already has`);
      else if (fixed.has(d.name)) problems.push(`${kind} '${d.name}' is ${fixed.get(d.name)}`);
    }
  }
  if (problems.length)
    throw new CodegenError(`names that cannot be used in the generated C# (rename them):\n  ${problems.join("\n  ")}`);

  const stateAt = new Map(ir.states.map((s) => [`${s.region}:${s.slot}`, s.name]));
  const maxSlot = Math.max(0, ...ir.states.map((s) => s.slot));
  return {
    ...prepared,
    ...types,
    ...{ ir, cls, ns, file, name, stateConst, timerConst },
    signalNo: new Map(ir.signals.map((s, i) => [s.id, i])),
    histIndex: new Map(ir.history.map((h, k) => [h.region, k])),
    deepRegions: ir.history.filter((h) => h.kind === "deep" && h.snapshotTo! > h.snapshotFrom!),
    slotT: maxSlot <= 0xff ? "byte" : "ushort",
    publicSignals,
    settleBody: hasTerminate || ir.eventless !== undefined || hasQueue,
    stateName: (region, slot) => comment(stateAt.get(`${region}:${slot}`) ?? `slot ${slot}`),
  };
}

export function generateCsharp(ir: IrModule, options: CsharpOptions = {}): CsharpFiles {
  const ctx = csContext(ir, options);
  const w = lines("    ");
  // Inside a namespace everything is indented one more level.
  const d0 = ctx.ns === undefined ? 0 : 1;
  csPreamble(ctx, w);
  csTypes(ctx, w, d0);
  csHandler(ctx, w, d0);
  csMachine(ctx, w, d0);
  if (ctx.ns !== undefined) w.line(0, "}");
  return { fileName: `${ctx.file}.cs`, source: w.text() };
}

/** The C# text of IR conditions. */
function csExpressions(ctx: CsContext): { expr(e: Expr): Printed; notExpr(e: Expr): Printed } {
  const { name, histIndex } = ctx;
  const cfg = (r: number): string => `cfg[${r}]`;
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
        return { s: `hist[${histIndex.get(e.region)}] != 0`, p: 2 };
      case "guard":
        return { s: `h.${name.get(e.guard)}()`, p: 3 };
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
        return { s: `hist[${histIndex.get(e.region)}] == 0`, p: 2 };
      case "not":
        return expr(e.expr);
      default:
        return { s: `!${wrap(expr(e), 3)}`, p: 3 };
    }
  };
  return { expr, notExpr };
}

/** The statement printer, writing into `w`. */
function csStatements(ctx: CsContext, w: Lines): (list: Stmt[], d: number) => void {
  const { ir, name, stateT, timerT, kindT, stateConst, timerConst, signalNo, histIndex, countSteps } = ctx;
  const { line } = w;
  const { expr, notExpr } = csExpressions(ctx);
  const switchOn = (o: SwitchOn): string =>
    o.kind === "cfg"
      ? `cfg[${o.region}]`
      : o.kind === "hist"
        ? `hist[${histIndex.get(o.region)}]`
        : `deep_r${o.history}[${o.index}]`;
  const caseRegion = (o: SwitchOn): number =>
    o.kind === "deep" ? ir.history.find((h) => h.region === o.history)!.snapshotFrom! + o.index : o.region;
  const block = (d: number, head: string, body: () => void): void => {
    line(d, head);
    line(d, "{");
    body();
    line(d, "}");
  };

  const stmts = (list: Stmt[], d: number): void => {
    for (const s of list) {
      switch (s.op) {
        case "if": {
          const hasElse = !!s.else && s.else.length > 0;
          if (s.then.length === 0 && !hasElse) break; // nothing to do; guards have no side effects (semantics.md)
          if (s.then.length === 0) {
            block(d, `if (${notExpr(s.cond).s})`, () => stmts(s.else!, d + 1));
            break;
          }
          block(d, `if (${expr(s.cond).s})`, () => stmts(s.then, d + 1));
          let els = s.else;
          while (els && els.length === 1 && els[0]!.op === "if" && els[0]!.then.length > 0) {
            const e = els[0] as Extract<Stmt, { op: "if" }>;
            block(d, `else if (${expr(e.cond).s})`, () => stmts(e.then, d + 1));
            els = e.else;
          }
          if (els && els.length) {
            const rest = els;
            block(d, "else", () => stmts(rest, d + 1));
          }
          break;
        }
        case "switch": {
          const cases = s.cases.filter((c) => c.body.length > 0);
          if (!cases.length) break;
          const region = caseRegion(s.on);
          block(d, `switch (${switchOn(s.on)})`, () => {
            for (const c of cases) {
              line(d + 1, `case ${c.slot}: // ${ctx.stateName(region, c.slot)}`);
              stmts(c.body, d + 2);
              if (c.body[c.body.length - 1]?.op !== "return") line(d + 2, "break;");
            }
          });
          break;
        }
        case "set":
          line(
            d,
            s.slot === 0
              ? `cfg[${s.region}] = 0;`
              : `cfg[${s.region}] = ${s.slot}; // ${ctx.stateName(s.region, s.slot)}`,
          );
          break;
        case "call":
          line(d, `h.${name.get(s.action)}();`);
          break;
        case "emit":
          line(d, `Push(${signalNo.get(s.signal)}); // ${ir.signals[signalNo.get(s.signal)!]!.name}`);
          break;
        case "setFlag":
          line(d, `${s.name} = true;`);
          break;
        case "invoke":
          line(d, `${s.fn}();`);
          break;
        case "saveHistory":
          line(d, `hist[${histIndex.get(s.region)}] = cfg[${s.region}];`);
          break;
        case "clearHistory":
          line(d, `hist[${histIndex.get(s.region)}] = 0;`);
          break;
        case "saveDeep": {
          const h = ir.history.find((x) => x.region === s.region)!;
          const n = h.snapshotTo! - h.snapshotFrom!;
          if (n > 0) line(d, `global::System.Array.Copy(cfg, ${h.snapshotFrom}, deep_r${s.region}, 0, ${n});`);
          break;
        }
        case "microstep":
          if (countSteps) line(d, "Microstep();");
          break;
        case "trace":
          if (s.hook === "transition")
            line(d, `h.Trace(${kindT}.Transition, ${s.index}); // ${comment(ir.transitions[s.index]!.label)}`);
          else line(d, `h.Trace(${kindT}.${TRACE_NAMES[s.hook]}, (int)${stateT}.${stateConst[s.index]});`);
          break;
        case "timerStart": {
          const t = ir.timers[s.timer]!;
          line(d, `h.TimerStart(${timerT}.${timerConst[s.timer]}, ${t.ms}u, ${t.periodic});`);
          break;
        }
        case "timerStop":
          line(d, `h.TimerStop(${timerT}.${timerConst[s.timer]});`);
          break;
        case "terminate":
          line(d, "terminated = true;");
          break;
        case "return":
          line(d, `return ${s.value};`);
          break;
      }
    }
  };
  return stmts;
}

/** The generated-code marker, usage and the namespace. */
function csPreamble(ctx: CsContext, w: Lines): void {
  const { ir, cls, ns, eventT, handlerT, errorT } = ctx;
  const { line } = w;
  line(0, "// <auto-generated/>");
  line(0, `// Generated by uFSM ${UFSM_VERSION} from model "${comment(ir.name)}". Do not edit.`);
  line(0, `// ${OUTPUT_NOTICE}`);
  line(0, "//");
  line(0, `//     var machine = new ${cls}(handler); // handler: implements ${handlerT}`);
  line(0, "//     machine.Reset(); // start; also restarts (no exit actions run)");
  if (ir.events.length) line(0, `//     machine.Process(${eventT}.${ctx.name.get(ir.events[0]!.id)});`);
  line(0, "//");
  line(0, `// Reset() and Process() throw ${errorT} on errors; after one, call Reset().`);
  line(0, "// An exception from an action or guard passes through unchanged and leaves the");
  line(0, `// machine half-way: until Reset(), Process() throws ${errorT} "busy", as it`);
  line(0, "// does when an action or guard calls it. A machine is not thread-safe.");
  line(0, "#nullable enable");
  if (ns !== undefined) {
    line(0, "");
    line(0, `namespace ${ns}`);
    line(0, "{");
  }
}

/** The exception and the enumerations: events, signals, states, timers, trace kinds. */
function csTypes(ctx: CsContext, w: Lines, d: number): void {
  const { ir, name, eventT, stateT, signalT, timerT, kindT, errorT, stateConst, timerConst, publicSignals } = ctx;
  const { trace, hasTimers, cls } = ctx;
  const { line } = w;
  line(0, "");
  line(d, `/// <summary>What <see cref="${cls}.Reset"/> and <see cref="${cls}.Process"/> throw.</summary>`);
  line(d, `public sealed class ${errorT} : global::System.Exception`);
  line(d, "{");
  line(d + 1, "/// <summary>Creates the exception.</summary>");
  line(d + 1, `public ${errorT}(string code, string message)`);
  line(d + 2, ": base(message)");
  line(d + 1, "{");
  line(d + 2, "Code = code;");
  line(d + 1, "}");
  line(0, "");
  line(d + 1, "/// <summary>");
  line(d + 1, '/// The error code every uFSM target uses: "queue-overflow", "livelock", "unknown-event",');
  line(d + 1, '/// "not-started" or "busy".');
  line(d + 1, "/// </summary>");
  line(d + 1, "public string Code { get; }");
  line(d, "}");
  /** An enum numbered from 0, with doc comments. */
  const enumeration = (type: string, doc: string, items: [string, string][]): void => {
    line(0, "");
    line(d, `/// <summary>${doc}</summary>`);
    line(d, `public enum ${type}`);
    line(d, "{");
    items.forEach(([n, c], i) => {
      line(d + 1, `/// <summary>${c}</summary>`);
      line(d + 1, `${n} = ${i},`);
    });
    line(d, "}");
  };
  enumeration(
    eventT,
    `The events <see cref="${cls}.Process"/> takes.`,
    ir.events.map((e) => [name.get(e.id)!, `Event <c>${xml(e.name)}</c>.`]),
  );
  if (publicSignals)
    enumeration(
      signalT,
      "Signal numbers, as the trace hook reports them.",
      ir.signals.map((s) => [name.get(s.id)!, `Signal <c>${xml(s.name)}</c>.`]),
    );
  enumeration(
    stateT,
    "States in document order.",
    ir.states.map((st, i) => [stateConst[i]!, `State <c>${xml(st.label)}</c>.`]),
  );
  if (hasTimers)
    enumeration(
      timerT,
      "Timers: started when their state is entered, stopped when it is left.",
      ir.timers.map((t, i) => [
        timerConst[i]!,
        `Timer <c>${xml(t.name)}</c>: ${t.periodic ? "every" : "after"} ${t.ms} ms, then <c>${xml(ir.events[t.event]!.name)}</c>.`,
      ]),
    );
  if (trace) {
    const what: Record<string, string> = {
      event: `an <see cref="${eventT}"/>; Process() accepted it.`,
      signal: publicSignals
        ? `a <see cref="${signalT}"/>; taken from the queue.`
        : "a signal number; taken from the queue.",
      transition: `a transition number (listed in <see cref="${cls}"/>); before its actions.`,
      enter: `a <see cref="${stateT}"/>; before its entry actions.`,
      exit: `a <see cref="${stateT}"/>; before its exit actions.`,
    };
    enumeration(
      kindT,
      "What the trace hook reports; the id is a number of the type named here.",
      TRACE_KINDS.map((k) => [TRACE_NAMES[k]!, `The id is ${what[k]}`]),
    );
  }
}

/** The handler interface: one method per action and guard, the timer methods and the trace hook. */
function csHandler(ctx: CsContext, w: Lines, d: number): void {
  const { ir, name, handlerT, timerT, kindT, cls, trace, hasTimers } = ctx;
  const { line } = w;
  line(0, "");
  line(d, "/// <summary>");
  line(d, `/// The actions and guards <see cref="${cls}"/> calls. Guards may be called more than once per event`);
  line(d, "/// and in any order.");
  line(d, "/// </summary>");
  line(d, `public interface ${handlerT}`);
  line(d, "{");
  const members: (() => void)[] = [];
  for (const a of ir.actions)
    members.push(() => {
      line(d + 1, `/// <summary>Action <c>${xml(a.name)}</c>.</summary>`);
      line(d + 1, `void ${name.get(a.id)}();`);
    });
  for (const g of ir.guards)
    members.push(() => {
      line(d + 1, `/// <summary>Guard <c>${xml(g.name)}</c>.</summary>`);
      line(d + 1, `bool ${name.get(g.id)}();`);
    });
  if (hasTimers) {
    members.push(() => {
      line(d + 1, "/// <summary>");
      line(d + 1, '/// Starts a timer: it expires once, or every <paramref name="ms"/> until stopped (the handler');
      line(d + 1, `/// re-arms it). On expiry, pass <see cref="${cls}.TimerEvent"/> of it to Process(). Called inside`);
      line(d + 1, "/// Reset() and Process(): must not block or call the machine.");
      line(d + 1, "/// </summary>");
      line(d + 1, '/// <param name="timer">The timer.</param>');
      line(d + 1, '/// <param name="ms">Its duration in milliseconds.</param>');
      line(d + 1, '/// <param name="periodic">Whether it repeats.</param>');
      line(d + 1, `void TimerStart(${timerT} timer, uint ms, bool periodic);`);
    });
    members.push(() => {
      line(d + 1, "/// <summary>");
      line(
        d + 1,
        "/// Stops a timer; does nothing if it is not running. No expiry of the earlier start should follow.",
      );
      line(d + 1, "/// </summary>");
      line(d + 1, '/// <param name="timer">The timer.</param>');
      line(d + 1, `void TimerStop(${timerT} timer);`);
    });
  }
  if (trace)
    members.push(() => {
      line(d + 1, "/// <summary>");
      line(d + 1, "/// Called inside Reset() and Process() with ids only; must not block or call the machine.");
      line(d + 1, "/// </summary>");
      line(d + 1, '/// <param name="kind">What happened.</param>');
      line(d + 1, `/// <param name="id">A number of the type <paramref name="kind"/> names.</param>`);
      line(d + 1, `void Trace(${kindT} kind, int id);`);
    });
  members.forEach((m, i) => {
    if (i > 0) line(0, "");
    m();
  });
  line(d, "}");
}

/** The machine class. */
function csMachine(ctx: CsContext, w: Lines, d: number): void {
  const { ir, cls, name, eventT, stateT, timerT, kindT, handlerT, errorT, histIndex, deepRegions, slotT } = ctx;
  const { signalQueue, maxMicrosteps, settleBody, debugInfo, trace, hasQueue, hasTerminate, hasTimers, countSteps } =
    ctx;
  const { line } = w;
  const stmts = csStatements(ctx, w);
  const usesHandler = ir.actions.length + ir.guards.length > 0 || trace || hasTimers;
  const strings = (list: string[]): string =>
    list.length
      ? `global::System.Array.AsReadOnly(new string[] { ${list.map(csString).join(", ")} })`
      : "global::System.Array.AsReadOnly(global::System.Array.Empty<string>())";
  const names = "global::System.Collections.Generic.IReadOnlyList<string>";
  line(0, "");
  line(d, "/// <summary>");
  line(d, `/// The state machine "${xml(ir.name)}". Construct it with a handler, then call <see cref="Reset"/>.`);
  line(d, "/// </summary>");
  line(d, `public sealed partial class ${cls}`);
  line(d, "{");
  const b = d + 1;
  line(b, "// Regions and their states (cfg value: state):");
  ir.regionNames.forEach((n, r) => {
    const slots = ir.states
      .filter((s) => s.region === r)
      .map((s) => `${s.slot}: ${comment(s.name)}`)
      .join(", ");
    const hk = histIndex.get(r);
    const hd = hk === undefined ? "" : ` [${ir.history[hk]!.kind} history: hist[${hk}]]`;
    line(b, `//   ${r} ${comment(n)}: ${slots}${hd}`);
  });
  if (hasQueue) line(b, `// Signals: ${ir.signals.map((s, i) => `${i} ${s.name}`).join(", ")}`);
  if (trace && ir.transitions.length) {
    line(b, "// Transition numbers (trace):");
    ir.transitions.forEach((t, i) => line(b, `//   ${i} ${comment(t.label)}`));
  }
  line(0, "");
  line(
    b,
    "/// <summary>Identifies the numbering of events, signals, states and transitions (`ufsm info` prints it).</summary>",
  );
  line(b, `public const uint Fingerprint = ${hex32(ir.fingerprint)}u;`);
  if (debugInfo) {
    const table = (what: string, prop: string, list: string[]): void => {
      line(0, "");
      line(b, `/// <summary>${what} names as in the model, by number.</summary>`);
      line(b, `public static ${names} ${prop} { get; } = ${strings(list)};`);
    };
    table(
      "Event",
      "EventNames",
      ir.events.map((e) => e.name),
    );
    table(
      "Signal",
      "SignalNames",
      ir.signals.map((s) => s.name),
    );
    table(
      "State",
      "StateNames",
      ir.states.map((st) => st.label),
    );
    if (hasTimers)
      table(
        "Timer",
        "TimerNames",
        ir.timers.map((t) => t.name),
      );
  }
  if (debugInfo && ir.states.length) {
    line(0, "");
    line(b, `private static readonly int[] StateRegion = { ${ir.states.map((s) => s.region).join(", ")} };`);
    line(b, `private static readonly int[] StateSlot = { ${ir.states.map((s) => s.slot).join(", ")} };`);
  }
  if (hasTimers) {
    line(0, "");
    line(
      b,
      `private static readonly ${eventT}[] TimerEvents = { ${ir.timers.map((t) => `${eventT}.${name.get(ir.events[t.event]!.id)}`).join(", ")} };`,
    );
  }
  line(0, "");
  if (usesHandler) line(b, `private readonly ${handlerT} h;`);
  line(b, "private bool started;");
  line(b, "private bool busy; // a Reset()/Process() call is running, or one did not finish");
  line(b, `private readonly ${slotT}[] cfg = new ${slotT}[${ir.regions}];`);
  if (ir.history.length) line(b, `private readonly ${slotT}[] hist = new ${slotT}[${ir.history.length}];`);
  for (const dh of deepRegions)
    line(b, `private readonly ${slotT}[] deep_r${dh.region} = new ${slotT}[${dh.snapshotTo! - dh.snapshotFrom!}];`);
  if (hasQueue) {
    line(b, `private readonly int[] queue = new int[${signalQueue}];`);
    line(b, "private int queueHead;");
    line(b, "private int queueLen;");
  }
  if (countSteps) line(b, "private int steps;");
  if (hasTerminate) line(b, "private bool terminated;");
  line(0, "");
  line(b, '/// <summary>Creates the machine; it runs nothing until <see cref="Reset"/>.</summary>');
  line(b, '/// <param name="handler">The actions and guards.</param>');
  line(b, `public ${cls}(${handlerT} handler)`);
  line(b, "{");
  line(b + 1, usesHandler ? "h = handler;" : "_ = handler;");
  line(b, "}");

  // Reset
  line(0, "");
  line(b, "/// <summary>Starts the machine, or restarts it: no exit actions run.</summary>");
  line(b, `/// <exception cref="${errorT}">The signal queue overflowed, or a livelock.</exception>`);
  line(b, "public void Reset()");
  line(b, "{");
  line(b + 1, "busy = true;");
  line(b + 1, "started = true;");
  line(b + 1, "global::System.Array.Clear(cfg, 0, cfg.Length);");
  if (ir.history.length) line(b + 1, "global::System.Array.Clear(hist, 0, hist.Length);");
  for (const dh of deepRegions)
    line(b + 1, `global::System.Array.Clear(deep_r${dh.region}, 0, deep_r${dh.region}.Length);`);
  if (hasQueue) {
    line(b + 1, "queueHead = 0;");
    line(b + 1, "queueLen = 0;");
  }
  if (countSteps) line(b + 1, "steps = 0;");
  if (hasTerminate) line(b + 1, "terminated = false;");
  stmts(ir.start, b + 1);
  if (settleBody) line(b + 1, "Settle();");
  line(b + 1, "busy = false;");
  line(b, "}");

  // Process
  line(0, "");
  line(b, "/// <summary>Runs the machine on one event.</summary>");
  line(b, '/// <param name="event">The event.</param>');
  line(b, `/// <exception cref="${errorT}">Not started, unknown event, busy, queue overflow or livelock.</exception>`);
  line(b, `public void Process(${eventT} @event)`);
  line(b, "{");
  line(b + 1, "int e = (int)@event;");
  line(b + 1, "if (!started)");
  line(b + 1, "{");
  line(b + 2, `throw new ${errorT}("not-started", "call Reset() before Process()");`);
  line(b + 1, "}");
  line(b + 1, `if (e < 0 || e >= ${ir.events.length})`);
  line(b + 1, "{");
  line(b + 2, `throw new ${errorT}("unknown-event", "unknown event " + e);`);
  line(b + 1, "}");
  line(b + 1, "if (busy)");
  line(b + 1, "{");
  line(b + 2, `throw new ${errorT}("busy", ${csString(BUSY_MESSAGE)});`);
  line(b + 1, "}");
  if (hasTerminate) {
    line(b + 1, "if (terminated)");
    line(b + 1, "{");
    line(b + 2, "return;");
    line(b + 1, "}");
  }
  line(b + 1, "busy = true;");
  if (countSteps) line(b + 1, "steps = 0;");
  if (trace) line(b + 1, `h.Trace(${kindT}.Event, e);`);
  const reacting = ir.events.filter((ev) => ir.onEvent[ev.id]);
  if (reacting.length) {
    line(b + 1, "switch (@event)");
    line(b + 1, "{");
    for (const ev of reacting) {
      line(b + 2, `case ${eventT}.${name.get(ev.id)}:`);
      line(b + 3, `${ir.onEvent[ev.id]}();`);
      line(b + 3, "break;");
    }
    line(b + 1, "}");
  }
  if (settleBody) line(b + 1, "Settle();");
  line(b + 1, "busy = false;");
  line(b, "}");

  if (debugInfo && ir.states.length) {
    line(0, "");
    line(b, "/// <summary>Whether a state is active.</summary>");
    line(b, '/// <param name="state">The state.</param>');
    line(b, "/// <returns>True when it is active.</returns>");
    line(b, `public bool IsActive(${stateT} state)`);
    line(b, "{");
    line(b + 1, "int i = (int)state;");
    line(b + 1, `return i >= 0 && i < ${ir.states.length} && cfg[StateRegion[i]] == StateSlot[i];`);
    line(b, "}");
  }
  if (hasTimers) {
    line(0, "");
    line(b, "/// <summary>The event to process when a timer expires.</summary>");
    line(b, '/// <param name="timer">The timer.</param>');
    line(b, "/// <returns>Its event.</returns>");
    line(b, `public static ${eventT} TimerEvent(${timerT} timer)`);
    line(b, "{");
    line(b + 1, "return TimerEvents[(int)timer];");
    line(b, "}");
  }

  // runtime helpers
  if (settleBody) {
    line(0, "");
    line(b, "// Run eventless transitions and queued signals until the machine is stable.");
    line(b, "private void Settle()");
    line(b, "{");
    line(b + 1, "for (;;)");
    line(b + 1, "{");
    const c = b + 2;
    if (hasTerminate) {
      line(c, "if (terminated)");
      line(c, "{");
      line(c + 1, "global::System.Array.Clear(cfg, 0, cfg.Length);");
      if (hasQueue) line(c + 1, "queueLen = 0;");
      line(c + 1, "return;");
      line(c, "}");
    }
    if (ir.eventless !== undefined) {
      line(c, `if (${ir.eventless}())`);
      line(c, "{");
      line(c + 1, "continue;");
      line(c, "}");
    }
    if (hasQueue) {
      line(c, "if (queueLen == 0)");
      line(c, "{");
      line(c + 1, "return;");
      line(c, "}");
      const reactingSignals = ir.signals.filter((s) => ir.onSignal[s.id]);
      if (trace || reactingSignals.length) line(c, "int signal = Pop();");
      else line(c, "Pop();");
      if (trace) line(c, `h.Trace(${kindT}.Signal, signal);`);
      if (reactingSignals.length) {
        line(c, "switch (signal)");
        line(c, "{");
        for (const s of reactingSignals) {
          line(c + 1, `case ${ir.signals.indexOf(s)}: // ${s.name}`);
          line(c + 2, `${ir.onSignal[s.id]}();`);
          line(c + 2, "break;");
        }
        line(c, "}");
      }
    } else line(c, "return;");
    line(b + 1, "}");
    line(b, "}");
  }
  if (hasQueue) {
    line(0, "");
    line(b, "private void Push(int signal)");
    line(b, "{");
    line(b + 1, `if (queueLen == ${signalQueue})`);
    line(b + 1, "{");
    line(b + 2, `throw new ${errorT}("queue-overflow", "signal queue full (${signalQueue})");`);
    line(b + 1, "}");
    line(b + 1, `queue[(queueHead + queueLen) % ${signalQueue}] = signal;`);
    line(b + 1, "queueLen++;");
    line(b, "}");
    line(0, "");
    line(b, "private int Pop()");
    line(b, "{");
    line(b + 1, "int signal = queue[queueHead];");
    line(b + 1, `queueHead = (queueHead + 1) % ${signalQueue};`);
    line(b + 1, "queueLen--;");
    line(b + 1, "return signal;");
    line(b, "}");
  }
  if (countSteps) {
    line(0, "");
    line(b, "private void Microstep()");
    line(b, "{");
    line(b + 1, `if (++steps > ${maxMicrosteps})`);
    line(b + 1, "{");
    line(b + 2, `throw new ${errorT}("livelock", "more than ${maxMicrosteps} microsteps in one call");`);
    line(b + 1, "}");
    line(b, "}");
  }
  for (const f of ir.functions) {
    line(0, "");
    if (f.doc) line(b, `// ${comment(f.doc)}`);
    line(b, `private ${f.returns === "bool" ? "bool" : "void"} ${f.name}()`);
    line(b, "{");
    for (const x of f.flags) line(b + 1, `bool ${x} = false;`);
    stmts(f.body, b + 1);
    line(b, "}");
  }
  line(d, "}");
}
