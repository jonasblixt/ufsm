// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Differential testing: drive two engines with the same random inputs and
 * compare what they do (action calls, configuration after each step,
 * errors). Used for the flat tables, the IR and, later, generated code.
 */
import assert from "node:assert/strict";
import {
  Interpreter,
  InterpreterError,
  type InterpreterErrorCode,
  type InterpreterHost,
  type InterpreterOptions,
  type IrModule,
  type MachineFactory,
  type TraceEntry,
  behaviourOptions,
  TraceRaise,
  type TraceMachine,
  type UfsmDocument,
} from "../src/index";
import { randomModel, rng } from "./random-model";

export type Engine = (doc: UfsmDocument, host: InterpreterHost, options: InterpreterOptions) => TraceMachine;

export const interpreterEngine: Engine = (doc, host, options) => new Interpreter(doc, host, options);

/** One step of a scripted run: set guard values, then reset or send an event. `raise`/`reenter` as in TraceStep. */
export interface ScriptStep {
  guards?: Record<string, boolean>;
  reset?: true;
  send?: string;
  raise?: string;
  reenter?: string;
}

/**
 * Driver protocol lines for a script step (the C, Python and Rust drivers share it):
 *   g <guard> <0|1>        set a guard value (index into the guards)
 *   x raise <name>         the action or guard <name> raises when called in the next r/e
 *   x reenter <name>       the action <name> calls process() with the same event in the next e
 *   r                      reset (init the first time in C)
 *   e <event>              process (index into the events; -1 = unknown)
 */
export function driverLines(s: ScriptStep, guardIndex: Map<string, number>, eventIndex: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [g, v] of Object.entries(s.guards ?? {})) if (guardIndex.has(g)) out.push(`g ${guardIndex.get(g)} ${v ? 1 : 0}`);
  if (s.raise !== undefined) out.push(`x raise ${s.raise}`);
  if (s.reenter !== undefined) out.push(`x reenter ${s.reenter}`);
  if (s.reset) out.push("r");
  else if (s.send !== undefined) out.push(`e ${eventIndex.get(s.send) ?? -1}`);
  return out;
}

/**
 * Parse a driver's output: "#u <unit>" starts a unit; every other line is "calls<TAB>active ids<TAB>error<TAB>nested",
 * where error is "-", "raised" or an error code (C's negative numbers go through `codes`) and nested is the outcome of
 * the nested process() call of `x reenter` ("-" when none was made, "ok" or an error code).
 */
export function parseDriverOutput(output: string, units: number, codes: Record<string, string> = {}): StepResult[][] {
  const results: StepResult[][] = Array.from({ length: units }, () => []);
  let cur: StepResult[] | undefined;
  const code = (c: string): string => codes[c] ?? (/^-?\d+$/.test(c) ? `code ${c}` : c);
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("#u ")) cur = results[Number(line.slice(3))];
    else if (line !== "") {
      const [calls = "", active = "", err = "-", nested = "-"] = line.split("\t");
      const res: StepResult = { calls: calls ? calls.split(" ") : [], active: active ? active.split(",") : [] };
      if (err !== "-") res.error = code(err);
      if (nested !== "-") res.nested = nested === "0" ? "ok" : code(nested);
      cur!.push(res);
    }
  }
  return results;
}

/** Random script: a reset, then `steps` steps; guards get fresh random values before every step. */
export function randomScript(doc: UfsmDocument, seed: number, steps: number): ScriptStep[] {
  const r = rng(seed);
  const script: ScriptStep[] = [{ reset: true }];
  const events = doc.declarations.events.map((e) => e.name);
  for (let i = 0; i < steps && events.length; i++) {
    const guards: Record<string, boolean> = {};
    for (const g of doc.declarations.guards) guards[g.name] = r() < 0.5;
    const step: ScriptStep = doc.declarations.guards.length ? { guards } : {};
    if (r() < 0.04) step.reset = true;
    else step.send = events[Math.floor(r() * events.length)]!;
    script.push(step);
  }
  return script;
}

/**
 * Differential runs with `debugInfo` and `trace` on: every trace hook call is logged among the action calls as a
 * pseudo-call, so its order relative to the actions is compared too. Generated code logs `@event:<name>` and
 * `@signal:<name>` (names from its own lookup), `@t:<n>`, `@enter:<n>` and `@exit:<n>` (numbers); `decodeHooks`
 * turns the numbers into ids, which is what `interpreterHooks` logs.
 */
export function decodeHooks(calls: string[], ir: IrModule): string[] {
  return calls.map((c) => {
    const m = /^@(t|enter|exit):(\d+)$/.exec(c);
    if (!m) return c;
    const n = Number(m[2]);
    const id = m[1] === "t" ? ir.transitions[n]?.id : ir.states[n]?.id;
    return `@${m[1]}:${id ?? `BAD_NUMBER_${n}`}`;
  });
}

/** The interpreter's trace entries as the pseudo-calls of decodeHooks, logged through the host. */
export function interpreterHooks(host: InterpreterHost): (e: TraceEntry) => void {
  const log = (s: string): void => host.call?.(s, s);
  return (e) => {
    if (e.type === "event") log(`@${e.signal ? "signal" : "event"}:${e.name}`);
    else if (e.type === "transition") log(`@t:${e.id}`);
    else if (e.type === "enter" || e.type === "exit") log(`@${e.type}:${e.state}`);
  };
}

/** Outcome of one reset/send step. */
export interface StepResult {
  calls: string[];
  active: string[];
  /** An error code, or "raised" when the step's `raise` action or guard ended it. */
  error?: string;
  /** Outcome of the nested process() call of `reenter`: "ok" or an error code. */
  nested?: string;
}

/** Log line of a step, as compared between engines. */
export function logLine(step: ScriptStep, res: StepResult): string {
  const what = step.reset ? "reset" : step.send!;
  return res.error ? `${what}: ${res.calls.join(" ")} ERROR ${res.error}` : `${what}: ${res.calls.join(" ")} | ${res.active.join(",")}`;
}

/**
 * Run a script. After an error the machine is reset (not logged); if that
 * reset fails too, the machine is dead and the remaining steps are skipped.
 */
export function runScript(make: (host: InterpreterHost) => TraceMachine, script: ScriptStep[]): string[] {
  const guards = new Map<string, boolean>();
  const log: string[] = [];
  let calls: string[] = [];
  const m = make({ call: (n) => void calls.push(n), guard: (n) => guards.get(n) ?? false });
  for (const step of script) {
    for (const [k, v] of Object.entries(step.guards ?? {})) guards.set(k, v);
    calls = [];
    try {
      if (step.reset) m.reset();
      else m.process(step.send!);
      log.push(logLine(step, { calls, active: m.activeIds() }));
    } catch (e) {
      if (!(e instanceof InterpreterError)) throw e;
      log.push(logLine(step, { calls, active: [], error: e.code }));
      try {
        m.reset();
      } catch {
        break;
      }
    }
  }
  return log;
}

/**
 * A TraceMachine that replays results recorded from generated code (C, Python, ...), so that
 * runTrace can check them against a trace: every reset/send step consumes one result.
 */
export function replayResults(results: StepResult[], backend: string): MachineFactory {
  return (_doc, host) => {
    let i = 0;
    let active: string[] = [];
    /** The result being replayed: a process() call made while replaying its calls is the step's nested call. */
    let replaying: StepResult | undefined;
    const next = (): void => {
      if (replaying) {
        // the trace runner's `reenter` action calls process(): give it the nested outcome the driver recorded
        const nested = replaying.nested ?? "ok";
        if (nested !== "ok") throw new InterpreterError(nested as InterpreterErrorCode, nested);
        return;
      }
      const r = results[i++];
      if (!r) throw new Error(`${backend} produced fewer results than the trace has steps`);
      active = r.active;
      replaying = r;
      try {
        // the recorded calls end with the `raise` action, if one raised: the runner's host throws again there
        for (const c of r.calls) host.call?.(c, c);
      } finally {
        replaying = undefined;
      }
      if (r.error === "raised") throw new TraceRaise("(recorded)"); // a guard raised
      if (r.error) throw new InterpreterError(r.error as InterpreterErrorCode, r.error);
    };
    return { reset: next, process: next, isActive: (id) => active.includes(id), activeIds: () => active };
  };
}

/** Signal queue of differential runs that set none: large, so random models rarely overflow it. */
export const DIFF_QUEUE = 4096;

/** One differential unit for generated code; the queue is DIFF_QUEUE unless one is given. */
export interface BackendDiff {
  label: string;
  doc: UfsmDocument;
  script: ScriptStep[];
  signalQueue?: number;
}

/**
 * Assert that results recorded from generated code (one list per diff, autoReset on) equal the interpreter's. With
 * `hooks` (the IR of each diff, generated with debugInfo and trace), the trace hook calls are compared too.
 */
export function assertMatchesInterpreter(diffs: BackendDiff[], results: StepResult[][], maxMicrosteps: number, backend: string, hooks?: IrModule[]): void {
  diffs.forEach((d, k) => {
    const ir = hooks?.[k];
    const expected = runScript(
      (h) => new Interpreter(d.doc, h, { maxMicrosteps, signalQueue: d.signalQueue ?? DIFF_QUEUE, ...(ir ? { onTrace: interpreterHooks(h) } : {}) }),
      d.script,
    );
    const steps = d.script.filter((s) => s.reset || s.send !== undefined);
    const actual = (results[k] ?? []).map((r, i) => logLine(steps[i]!, ir ? { ...r, calls: decodeHooks(r.calls, ir) } : r));
    const i = expected.findIndex((x, j) => x !== actual[j]);
    assert.ok(i < 0 && expected.length === actual.length, `${d.label}, step ${i}:\n  interpreter: ${expected[i]}\n  ${`${backend}:`.padEnd(13)}${actual[i]}`);
  });
}

/**
 * The differential runs with debugInfo and trace on, for backends that run scripts (C, Python, Rust): every given
 * model with two seeds, and random models with two signals (so signal hooks are exercised).
 */
export function hookDiffs(models: { label: string; doc: UfsmDocument }[], random: number): BackendDiff[] {
  return [
    ...models.flatMap(({ label, doc }) => [1, 2].map((seed) => ({ label: `${label} seed ${seed} (hooks)`, doc, script: randomScript(doc, seed, 120) }))),
    ...Array.from({ length: random }, (_, i) => {
      const doc = randomModel(i + 1, { signals: 2, transitions: 16 });
      return { label: `random model ${i + 1} (hooks)`, doc, script: randomScript(doc, (i + 1) * 37, 40) };
    }),
  ];
}

/** Log of one random run (see randomScript and runScript). */
export function drive(make: (host: InterpreterHost) => TraceMachine, doc: UfsmDocument, seed: number, steps: number): string[] {
  return runScript(make, randomScript(doc, seed, steps));
}

/**
 * Assert that `engine` behaves exactly like the reference interpreter on one random run. With `hooks`, the engine logs
 * its trace hook calls as decoded pseudo-calls (decodeHooks) and they are compared too.
 */
export function compareWithInterpreter(engine: Engine, doc: UfsmDocument, seed: number, steps: number, options: InterpreterOptions = {}, hooks = false): void {
  const opts = { ...behaviourOptions(doc), maxMicrosteps: 300, ...options };
  const a = drive((h) => new Interpreter(doc, h, hooks ? { ...opts, onTrace: interpreterHooks(h) } : opts), doc, seed, steps);
  const b = drive((h) => engine(doc, h, opts), doc, seed, steps);
  const i = a.findIndex((x, k) => x !== b[k]);
  assert.ok(i < 0 && a.length === b.length, `${doc.name}, seed ${seed}, step ${i}:\n  interpreter: ${a[i]}\n  engine:      ${b[i]}`);
}

/**
 * P has regions with A and B; joins J1 and J2 both lead out of {A, B} on e1.
 * A lists J2 first, B lists J1 first: the sources disagree, nothing fires.
 * With A's order swapped they agree on J1.
 */
export function joinAgreementModel(agree: boolean): UfsmDocument {
  const doc: UfsmDocument = {
    format: "ufsm",
    version: 1,
    name: "joins",
    declarations: {
      events: [{ id: "ev1", name: "e1" }],
      signals: [],
      actions: [{ id: "a1", name: "j1" }, { id: "a2", name: "j2" }],
      guards: [],
    },
    machine: {
      root: {
        id: "r0",
        states: [
          { id: "i0", kind: "initial" },
          {
            id: "P",
            kind: "state",
            name: "P",
            regions: [
              { id: "r1", states: [{ id: "i1", kind: "initial" }, { id: "A", kind: "state", name: "A" }] },
              { id: "r2", states: [{ id: "i2", kind: "initial" }, { id: "B", kind: "state", name: "B" }] },
            ],
          },
          { id: "X", kind: "state", name: "X" },
          { id: "J1", kind: "join" },
          { id: "J2", kind: "join" },
        ],
      },
      transitions: [
        { id: "t0", from: "i0", to: "P" },
        { id: "t1", from: "i1", to: "A" },
        { id: "t2", from: "i2", to: "B" },
        { id: "ta2", from: "A", to: "J2" },
        { id: "ta1", from: "A", to: "J1" },
        { id: "tb1", from: "B", to: "J1" },
        { id: "tb2", from: "B", to: "J2" },
        { id: "tj1", from: "J1", to: "X", on: "ev1", do: [{ call: "a1" }] },
        { id: "tj2", from: "J2", to: "X", on: "ev1", do: [{ call: "a2" }] },
      ],
    },
  };
  if (agree) doc.machine.transitions.sort((x, y) => (x.id === "ta1" ? -1 : y.id === "ta1" ? 1 : 0));
  return doc;
}

export function checkJoinAgreement(engine: Engine): void {
  for (const agree of [false, true]) {
    const doc = joinAgreementModel(agree);
    const expected = agree ? ["j1"] : [];
    for (const make of [interpreterEngine, engine]) {
      const calls: string[] = [];
      const m = make(doc, { call: (n) => void calls.push(n) }, {});
      m.reset();
      m.process("e1");
      assert.deepEqual(calls, expected, agree ? "sources agree on J1" : "sources disagree");
    }
  }
}

/**
 * Small model that needs every expression form a backend prints:
 * completion of P = "r1 rests in F1 or F2" AND "r2 rests in F3" (an `||`
 * inside `&&`), and a join J whose source A has an earlier candidate guarded
 * by `!g1 && g2` (negated when the join checks A's first enabled transition).
 */
export function expressionModel(): UfsmDocument {
  return {
    format: "ufsm",
    version: 1,
    name: "expressions",
    declarations: {
      events: [{ id: "ev1", name: "e1" }, { id: "ev2", name: "e2" }, { id: "ev3", name: "e3" }],
      signals: [],
      actions: [{ id: "a1", name: "done" }, { id: "a2", name: "joined" }, { id: "a3", name: "early" }],
      guards: [{ id: "g1", name: "g1" }, { id: "g2", name: "g2" }],
    },
    machine: {
      root: {
        id: "r0",
        states: [
          { id: "i0", kind: "initial" },
          {
            id: "P",
            kind: "state",
            name: "P",
            regions: [
              { id: "r1", states: [{ id: "i1", kind: "initial" }, { id: "A", kind: "state", name: "A" }, { id: "F1", kind: "final" }, { id: "F2", kind: "final" }] },
              { id: "r2", states: [{ id: "i2", kind: "initial" }, { id: "B", kind: "state", name: "B" }, { id: "F3", kind: "final" }] },
            ],
          },
          { id: "X", kind: "state", name: "X" },
          { id: "J", kind: "join" },
        ],
      },
      transitions: [
        { id: "t0", from: "i0", to: "P" },
        { id: "t1", from: "i1", to: "A" },
        { id: "t2", from: "i2", to: "B" },
        { id: "ta1", from: "A", to: "F1", on: "ev1", guard: [{ call: "g1", not: true }, { call: "g2" }], do: [{ call: "a3" }] },
        { id: "ta2", from: "A", to: "F2", on: "ev2", guard: [{ call: "g1" }] },
        { id: "ta3", from: "A", to: "J" },
        { id: "tb1", from: "B", to: "J" },
        { id: "tb2", from: "B", to: "F3", on: "ev2" },
        { id: "tj", from: "J", to: "X", on: "ev1", do: [{ call: "a2" }] },
        { id: "tp", from: "P", to: "X", completion: true, do: [{ call: "a1" }] },
        { id: "tx", from: "X", to: "P", on: "ev3" },
      ],
    },
  };
}
