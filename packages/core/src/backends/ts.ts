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
 */
import type { UfsmDocument } from "../v1/model";
import { IDENTIFIER } from "../v1/model";
import { UFSM_VERSION } from "../version";
import type { Expr, IrModule, Stmt, SwitchOn } from "../ir/ir";
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
}

export interface TsFiles {
  fileName: string;
  source: string;
}

export const TS_DEFAULTS = { signalQueue: 16, maxMicrosteps: 10000 } as const;

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
  const t = doc.targets?.["ts"] ?? {};
  const options: TsOptions = {};
  const problems: string[] = [];
  for (const [k, v] of Object.entries(t)) {
    switch (k) {
      case "className":
      case "module":
        if (typeof v === "string") options[k] = v;
        else problems.push(`targets.ts.${k}: expected a string`);
        break;
      case "signalQueue":
      case "maxMicrosteps":
        if (typeof v === "number" && Number.isInteger(v) && v >= 0) options[k] = v;
        else problems.push(`targets.ts.${k}: expected a whole number >= 0`);
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
  const queueCap = options.signalQueue ?? TS_DEFAULTS.signalQueue;
  const maxSteps = options.maxMicrosteps ?? TS_DEFAULTS.maxMicrosteps;
  const errorCls = `${cls}Error`;
  const codeT = `${cls}ErrorCode`;
  const eventCls = `${cls}Event`;
  const handlerT = `${cls}Handler`;

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
    for (const d of list) if (OBJECT_MEMBERS.has(d.name)) problems.push(`${kind} '${d.name}' is a name every JavaScript object already has`);
  }
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
  line(0, "");
  line(0, `export type ${codeT} = "queue-overflow" | "livelock" | "unknown-event" | "not-started";`);
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
  line(0, "/** Actions and guards the machine calls. Guards may be called more than once per event and in any order. */");
  if (ir.actions.length || ir.guards.length) {
    line(0, `export interface ${handlerT} {`);
    for (const a of ir.actions) line(1, `${a.name}(): void;`);
    for (const g of ir.guards) line(1, `${g.name}(): boolean;`);
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
  const usesHandler = ir.actions.length + ir.guards.length > 0;
  line(1, `private readonly h: ${handlerT};`);
  line(1, "private started = false;");
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
  if (hasTerminate) {
    line(2, "if (this.terminated) {");
    line(3, "return;");
    line(2, "}");
  }
  if (countSteps) line(2, "this.steps = 0;");
  if (eventSteps) line(2, "this.onEvent[e]?.();");
  if (settleBody) line(2, "this.settle();");
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
