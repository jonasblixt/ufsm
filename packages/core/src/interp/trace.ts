// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Conformance traces: language-neutral expectations for a model, replayed
 * against the reference interpreter here and against every generated
 * backend by its own small runner. Format: docs/semantics.md#traces.
 *
 *   { "model": "../models/test_guard1.ufsm",
 *     "steps": [
 *       { "reset": true, "expect": ["eA"] },
 *       { "guards": { "g1": true }, "send": "e1", "expect": ["xA", "eB"], "active": ["B"] } ] }
 */
import { UfsmFormatError } from "../errors";
import type { Id, UfsmDocument } from "../v1/model";
import { Interpreter, InterpreterError, type InterpreterHost, type InterpreterOptions } from "./interpreter";

/** What a trace drives: the interpreter, the flat runner, or a wrapper around generated code. */
export interface TraceMachine {
  reset(): void;
  process(event: string): unknown;
  isActive(id: Id): boolean;
  activeIds(): Id[];
}

export type MachineFactory = (doc: UfsmDocument, host: InterpreterHost, options: InterpreterOptions) => TraceMachine;

const interpreterFactory: MachineFactory = (doc, host, options) => new Interpreter(doc, host, options);

export interface TraceStep {
  /** Start or restart the machine (no exit actions run). */
  reset?: true;
  /** Event name to process. */
  send?: string;
  /** Guard values to use from this step on (applied before reset/send; every guard starts false). */
  guards?: Record<string, boolean>;
  /** Action names called by this step, in order. Required with reset/send. */
  expect?: string[];
  /** States (name, or id where names repeat) that must be active afterwards; others may be too. */
  active?: string[];
  /** States (name, or id where names repeat) that must not be active afterwards. */
  inactive?: string[];
  /** Expected InterpreterError / backend error code instead of `expect`, e.g. "queue-overflow". */
  error?: string;
  doc?: string;
}

export interface TraceOptions {
  /** Bounded signal queue; emitting into a full queue is a `queue-overflow` error. */
  signalQueue?: number;
  /** Livelock limit: microsteps per reset()/process() call. */
  maxMicrosteps?: number;
}

export interface Trace {
  /** Model path relative to the trace file. */
  model: string;
  doc?: string;
  /** Machine options the trace needs: a signal queue size, a smaller livelock limit. */
  options?: TraceOptions;
  steps: TraceStep[];
}

const STEP_KEYS = new Set(["reset", "send", "guards", "expect", "active", "inactive", "error", "doc"]);
const OPTION_KEYS = ["signalQueue", "maxMicrosteps"] as const;

/** Parse and validate a trace file. Throws UfsmFormatError. */
export function parseTrace(text: string): Trace {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UfsmFormatError("", `not valid JSON (${(e as Error).message})`);
  }
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  const strings = (x: unknown, path: string): string[] => {
    if (!Array.isArray(x) || !x.every((s) => typeof s === "string")) throw new UfsmFormatError(path, "expected a list of strings");
    return x as string[];
  };
  if (!isObj(data)) throw new UfsmFormatError("", "expected an object");
  for (const k of Object.keys(data)) if (!["model", "doc", "options", "steps"].includes(k)) throw new UfsmFormatError(k, "unknown key");
  if (typeof data["model"] !== "string") throw new UfsmFormatError("model", "expected a string");
  if (!Array.isArray(data["steps"])) throw new UfsmFormatError("steps", "expected a list");
  const trace: Trace = { model: data["model"], steps: [] };
  if (typeof data["doc"] === "string") trace.doc = data["doc"];
  if (data["options"] !== undefined) {
    const o = data["options"];
    const valid = isObj(o) && Object.entries(o).every(([k, v]) => (OPTION_KEYS as readonly string[]).includes(k) && Number.isInteger(v) && (v as number) >= 0);
    if (!valid) throw new UfsmFormatError("options", "expected { signalQueue?: integer, maxMicrosteps?: integer }");
    const options: TraceOptions = {};
    for (const k of OPTION_KEYS) if (o[k] !== undefined) options[k] = o[k] as number;
    trace.options = options;
  }
  data["steps"].forEach((s: unknown, i: number) => {
    const p = `steps[${i}]`;
    if (!isObj(s)) throw new UfsmFormatError(p, "expected an object");
    for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) throw new UfsmFormatError(`${p}.${k}`, "unknown key");
    const step: TraceStep = {};
    if (s["reset"] !== undefined) {
      if (s["reset"] !== true) throw new UfsmFormatError(`${p}.reset`, "expected true");
      step.reset = true;
    }
    if (s["send"] !== undefined) {
      if (typeof s["send"] !== "string") throw new UfsmFormatError(`${p}.send`, "expected an event name");
      step.send = s["send"];
    }
    if (step.reset && step.send !== undefined) throw new UfsmFormatError(p, "a step either resets or sends, not both");
    if (s["guards"] !== undefined) {
      const g = s["guards"];
      if (!isObj(g) || !Object.values(g).every((v) => typeof v === "boolean")) {
        throw new UfsmFormatError(`${p}.guards`, "expected { name: true | false } (guards return a boolean)");
      }
      step.guards = g as Record<string, boolean>;
    }
    if (s["expect"] !== undefined) step.expect = strings(s["expect"], `${p}.expect`);
    if (s["active"] !== undefined) step.active = strings(s["active"], `${p}.active`);
    if (s["inactive"] !== undefined) step.inactive = strings(s["inactive"], `${p}.inactive`);
    if (s["error"] !== undefined) {
      if (typeof s["error"] !== "string") throw new UfsmFormatError(`${p}.error`, "expected an error code");
      step.error = s["error"];
    }
    if (typeof s["doc"] === "string") step.doc = s["doc"];
    const acts = step.reset || step.send !== undefined;
    if (acts && step.expect === undefined && step.error === undefined) throw new UfsmFormatError(p, "a reset or send step needs `expect` (or `error`)");
    if (!acts && (step.expect !== undefined || step.error !== undefined)) throw new UfsmFormatError(p, "`expect`/`error` need a reset or send");
    if (!acts && !step.guards && !step.active && !step.inactive) throw new UfsmFormatError(p, "empty step");
    trace.steps.push(step);
  });
  return trace;
}

export interface TraceFailure {
  step: number;
  message: string;
  expected?: string[];
  actual?: string[];
}

/** Resolve state references in `active` (unique name, or id) against a model. */
export function resolveStateRef(doc: UfsmDocument, ref: string): Id | string {
  const found: Id[] = [];
  let byId: Id | undefined;
  const walk = (states: UfsmDocument["machine"]["root"]["states"]): void => {
    for (const v of states) {
      if (v.id === ref) byId = v.id;
      if (v.name === ref && (v.kind === "state" || v.kind === "final")) found.push(v.id);
      if (v.kind === "state") for (const r of v.regions ?? []) walk(r.states);
    }
  };
  walk(doc.machine.root.states);
  if (found.length === 1) return found[0]!;
  if (byId) return byId;
  return found.length === 0 ? `no state named '${ref}'` : `state name '${ref}' is ambiguous; use its id`;
}

/** Replay a trace against the reference interpreter (or another engine). Returns the failures (empty: passed). */
export function runTrace(doc: UfsmDocument, trace: Trace, options: InterpreterOptions = {}, make: MachineFactory = interpreterFactory): TraceFailure[] {
  const failures: TraceFailure[] = [];
  const guards = new Map<string, boolean>();
  let calls: string[] = [];
  const m = make(doc, { call: (name) => void calls.push(name), guard: (name) => guards.get(name) ?? false }, { ...options, ...trace.options });
  const names = new Map<Id, string>();
  const walk = (states: UfsmDocument["machine"]["root"]["states"]): void => {
    for (const v of states) {
      names.set(v.id, v.name ?? v.kind);
      if (v.kind === "state") for (const r of v.regions ?? []) walk(r.states);
    }
  };
  walk(doc.machine.root.states);
  trace.steps.forEach((step, i) => {
    for (const [k, v] of Object.entries(step.guards ?? {})) guards.set(k, v);
    calls = [];
    let error: string | undefined;
    try {
      if (step.reset) m.reset();
      else if (step.send !== undefined) m.process(step.send);
    } catch (e) {
      if (!(e instanceof InterpreterError)) throw e;
      error = e.code;
      if (step.error === undefined) failures.push({ step: i, message: `unexpected error: ${e.message}` });
    }
    if (step.error !== undefined && error !== step.error) {
      failures.push({ step: i, message: `expected error '${step.error}', got ${error ? `'${error}'` : "none"}` });
    }
    if (step.expect && error === undefined) {
      const same = calls.length === step.expect.length && calls.every((c, j) => c === step.expect![j]);
      if (!same) failures.push({ step: i, message: "action trace differs", expected: step.expect, actual: calls });
    }
    for (const ref of step.active ?? []) {
      const id = resolveStateRef(doc, ref);
      if (!names.has(id)) failures.push({ step: i, message: id });
      else if (!m.isActive(id)) failures.push({ step: i, message: `'${ref}' is not active (active: ${m.activeIds().map((a) => names.get(a)).join(", ")})` });
    }
    for (const ref of step.inactive ?? []) {
      const id = resolveStateRef(doc, ref);
      if (!names.has(id)) failures.push({ step: i, message: id });
      else if (m.isActive(id)) failures.push({ step: i, message: `'${ref}' is active but should not be` });
    }
  });
  return failures;
}

/** One-line description of a failure, for test output and the CLI. */
export function formatFailure(trace: Trace, f: TraceFailure): string {
  const step = trace.steps[f.step];
  const what = step?.reset ? "reset" : step?.send !== undefined ? `send ${step.send}` : "step";
  let s = `step ${f.step} (${what}): ${f.message}`;
  if (f.expected && f.actual) s += `\n    expected: ${f.expected.join(" ") || "(nothing)"}\n    actual:   ${f.actual.join(" ") || "(nothing)"}`;
  return s;
}

const STEP_ORDER = ["reset", "guards", "send", "expect", "active", "inactive", "error", "doc"] as const;

/**
 * Write a trace as JSON in the layout of the files in tests/traces: one key per line at the top, each step on one
 * line when it fits in `width` columns (else one key per line), lists and guard maps inline. parseTrace reads it back
 * unchanged.
 */
export function formatTrace(trace: Trace, width = 120): string {
  const j = (v: unknown): string => JSON.stringify(v);
  const value = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(j).join(", ")}]`;
    if (typeof v === "object" && v !== null) {
      const entries = Object.entries(v);
      return entries.length ? `{ ${entries.map(([k, x]) => `${j(k)}: ${j(x)}`).join(", ")} }` : "{}";
    }
    return j(v);
  };
  const pairs = (o: object, keys: readonly string[]): string[] =>
    keys.filter((k) => (o as Record<string, unknown>)[k] !== undefined).map((k) => `${j(k)}: ${value((o as Record<string, unknown>)[k])}`);
  const top: string[] = [`  "model": ${j(trace.model)}`];
  if (trace.doc !== undefined) top.push(`  "doc": ${j(trace.doc)}`);
  if (trace.options && Object.keys(trace.options).length) top.push(`  "options": ${value(trace.options)}`);
  const steps = trace.steps.map((s) => {
    const ps = pairs(s, STEP_ORDER);
    const one = `    { ${ps.join(", ")} }`;
    return one.length <= width ? one : `    {\n${ps.map((p) => `      ${p}`).join(",\n")}\n    }`;
  });
  top.push(steps.length ? `  "steps": [\n${steps.join(",\n")}\n  ]` : `  "steps": []`);
  return `{\n${top.join(",\n")}\n}\n`;
}
