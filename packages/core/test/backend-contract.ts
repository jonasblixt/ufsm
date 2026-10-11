// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The contract every backend's generated code is held to, written once. A backend's test file describes how to run its
 * code (a BackendSpec) and calls describeBackend; it keeps only what is truly about its language (compiler flags, type
 * checkers, linters, the API's names). A new backend gets the whole checklist by writing a spec.
 *
 *   conformance traces        every trace in tests/traces, on generated code
 *   matches the interpreter   joins, every expression form, every repo model and the keyword model, random models,
 *                             debugInfo + trace (hook calls compared too), a small signal queue, hand-built IR
 *                             (expression shapes the models rarely produce, a step that ends in `return false`)
 *   generated files           deterministic, a timer API only with timers, targets.<name> read as documented,
 *                             model problems reported as CodegenError
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodegenError,
  formatFailure,
  generateFiles,
  loadModel,
  parseTrace,
  runTrace,
  traceOptions,
  type CodeTarget,
  type CommonOptions,
  type MachineHost,
  type RunningMachine,
  type UfsmDocument,
} from "../src";
import { flatten, lowerToIr, type Expr, type IrModule } from "../src/pipeline";
import {
  DIFF_QUEUE,
  assertMatchesInterpreter,
  expressionModel,
  hookDiffs,
  joinAgreementModel,
  randomScript,
  replayResults,
  type BackendDiff,
  type ScriptStep,
  type StepResult,
} from "./harness";
import { randomModel } from "./random-model";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
export const modelFiles = ["examples", "tests/models"].flatMap((d) =>
  existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
);
export const load = (path: string): UfsmDocument => loadModel(readFileSync(path, "utf8")).doc;
/** The livelock limit of differential runs, on both sides. */
export const MAX_STEPS = 300;

/** One machine to run: an IR, the options to generate it with, and a script. */
export interface RunUnit {
  ir: IrModule;
  options?: CommonOptions;
  script: ScriptStep[];
  /** After a failed step, reset (not recorded) and go on, as the differential runs expect. */
  autoReset: boolean;
}

export interface BackendSpec {
  /** "C", "Python", ...: in test names and messages. */
  name: string;
  target: CodeTarget;
  /** The environment variable that sets the number of random models (default 300). */
  randomEnv: string;
  /** Why the tests that run generated code are skipped (no compiler, ...), or false. */
  skip: false | string;
  /** Generate, build and run every unit; one result per reset/send step of each script. */
  run(units: RunUnit[]): Promise<StepResult[][]>;
  /**
   * In-process backends: live machines the trace runner drives itself (traces with `raise` and `reenter` call back into
   * the machine). Without it, traces are replayed from `run`'s results; the drivers implement raise/reenter.
   */
  machines?(units: { ir: IrModule; options?: CommonOptions }[]): Promise<{ make(k: number, host: MachineHost): RunningMachine; cleanup(): void }>;
  /** Matches the generated text of a model with timers, and not that of a model without: the timer API. */
  timerApi: RegExp;
}

/** test_guard1 with keywords of the target languages and blanket-impl method names as declaration names. */
export function keywordModel(): UfsmDocument {
  const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
  const names: Record<string, string> = { e1: "type", e2: "self", eA: "match", xA: "into", eB: "clone", xB: "Self", g1: "async", g2: "gen" };
  const d = doc.declarations;
  for (const x of [...d.events, ...d.signals, ...d.actions, ...d.guards]) x.name = names[x.name] ?? x.name;
  return doc;
}

const g = (n: string): Expr => ({ op: "guard", guard: n });

/** Event name, condition, and what it should be for guard values a, b, c. */
export const SHAPES: [string, Expr, (a: boolean, b: boolean, c: boolean) => boolean][] = [
  ["or_in_and", { op: "and", exprs: [{ op: "or", exprs: [g("a"), g("b")] }, g("c")] }, (a, b, c) => (a || b) && c],
  ["and_in_or", { op: "or", exprs: [g("a"), { op: "and", exprs: [g("b"), g("c")] }] }, (a, b, c) => a || (b && c)],
  ["not_and", { op: "not", expr: { op: "and", exprs: [g("a"), g("b")] } }, (a, b) => !(a && b)],
  ["not_or_in_and", { op: "and", exprs: [{ op: "not", expr: { op: "or", exprs: [g("a"), g("b")] } }, g("c")] }, (a, b, c) => !(a || b) && c],
  ["not_in_or", { op: "or", exprs: [g("a"), { op: "not", expr: g("b") }] }, (a, b) => a || !b],
  ["not_guard", { op: "not", expr: g("a") }, (a) => !a],
  ["nots_in_and", { op: "and", exprs: [{ op: "not", expr: g("a") }, { op: "not", expr: g("c") }] }, (a, _b, c) => !a && !c],
  // cfg[0] is 1 (state A) throughout
  ["in_slots", { op: "and", exprs: [{ op: "activeIn", region: 0, slots: [1, 2] }, g("a")] }, (a) => a],
  ["not_in_slots", { op: "and", exprs: [{ op: "not", expr: { op: "activeIn", region: 0, slots: [2, 3] } }, g("a")] }, (a) => a],
  ["not_active", { op: "or", exprs: [{ op: "not", expr: { op: "active", region: 0, slot: 1 } }, g("b")] }, (_a, b) => b],
];

/** One step function per shape; it calls `hit` when its condition is true. */
export function shapesModule(): IrModule {
  return {
    name: "shapes",
    regions: 1,
    regionNames: ["root"],
    states: [{ id: "s1", name: "A", ident: "A", label: "A", region: 0, slot: 1, final: false }],
    history: [],
    transitions: [],
    trace: false,
    fingerprint: 0,
    timers: [],
    events: SHAPES.map(([n]) => ({ id: `ev_${n}`, name: n })),
    signals: [],
    actions: [{ id: "act1", name: "hit" }],
    guards: ["a", "b", "c"].map((n) => ({ id: n, name: n })),
    start: [{ op: "set", region: 0, slot: 1 }],
    onEvent: Object.fromEntries(SHAPES.map(([n]) => [`ev_${n}`, `step_${n}`])),
    onSignal: {},
    eventless: undefined,
    functions: SHAPES.map(([n, cond]) => ({
      name: `step_${n}`,
      returns: "bool" as const,
      flags: [],
      body: [{ op: "if" as const, cond, then: [{ op: "call" as const, action: "act1" }] }, { op: "return" as const, value: false }],
    })),
  };
}

/** An eventless step that counts a microstep and ends in `return false`: printed as `true`, settle would loop forever. */
function tailModule(): IrModule {
  return {
    name: "tail",
    regions: 1,
    regionNames: ["root"],
    states: [{ id: "a", name: "A", ident: "A", label: "A", region: 0, slot: 1, final: false }, { id: "b", name: "B", ident: "B", label: "B", region: 0, slot: 2, final: false }],
    history: [],
    transitions: [],
    trace: false,
    fingerprint: 0,
    timers: [],
    events: [{ id: "ev1", name: "e1" }],
    signals: [],
    actions: [{ id: "act1", name: "moved" }],
    guards: [{ id: "g", name: "g" }],
    start: [{ op: "set", region: 0, slot: 1 }],
    onEvent: {},
    onSignal: {},
    eventless: "eventless",
    functions: [
      {
        name: "eventless",
        returns: "bool",
        flags: [],
        body: [
          { op: "microstep" },
          {
            op: "if",
            cond: { op: "and", exprs: [{ op: "active", region: 0, slot: 1 }, g("g")] },
            then: [{ op: "set", region: 0, slot: 2 }, { op: "call", action: "act1" }, { op: "return", value: true }],
          },
          { op: "return", value: false },
        ],
      },
    ],
  };
}

const outcome = (r: StepResult): string => `${r.calls.join(" ")}|${r.active.join(",")}|${r.error ?? "-"}`;

export function describeBackend(spec: BackendSpec): void {
  const { name, skip } = spec;

  /** Differential runs; with `hooks`, generated with debugInfo and trace, comparing hook calls and is-active too. */
  const compareAll = async (diffs: BackendDiff[], hooks = false): Promise<void> => {
    for (let from = 0; from < diffs.length; from += 150) {
      const part = diffs.slice(from, from + 150);
      const irs = part.map((d) => lowerToIr(flatten(d.doc), { trace: hooks }));
      const units = part.map((d, k) => ({
        ir: irs[k]!,
        options: { maxMicrosteps: MAX_STEPS, signalQueue: d.signalQueue ?? DIFF_QUEUE, debugInfo: hooks },
        script: d.script,
        autoReset: true,
      }));
      assertMatchesInterpreter(part, await spec.run(units), MAX_STEPS, name, hooks ? irs : undefined);
    }
  };
  const seeded = (label: string, doc: UfsmDocument, seeds: number[], steps: number): BackendDiff[] =>
    seeds.map((seed) => ({ label: `${label} seed ${seed}`, doc, script: randomScript(doc, seed, steps) }));
  const repoModels = (): { label: string; doc: UfsmDocument }[] => [
    ...modelFiles.map((f) => ({ label: f.slice(repoRoot.length + 1), doc: load(f) })),
    { label: "keyword names", doc: keywordModel() },
  ];

  describe(`${name} backend: conformance traces`, { skip }, () => {
    const files = existsSync(traceDir) ? readdirSync(traceDir).filter((x) => x.endsWith(".json")).sort() : [];
    it(`${files.length} traces`, async () => {
      const traces = files.map((f) => {
        const path = join(traceDir, f);
        const trace = parseTrace(readFileSync(path, "utf8"));
        const doc = load(resolve(dirname(path), trace.model));
        return { f, trace, doc, ir: lowerToIr(flatten(doc)), options: traceOptions(doc, trace) };
      });
      let failures: string[];
      if (spec.machines) {
        const { make, cleanup } = await spec.machines(traces);
        try {
          failures = traces.flatMap(({ f, trace, doc }, k) => runTrace(doc, trace, {}, (_d, host) => make(k, host)).map((x) => `${f}: ${formatFailure(trace, x)}`));
        } finally {
          cleanup();
        }
      } else {
        const results = await spec.run(traces.map(({ ir, options, trace }) => ({ ir, options, script: trace.steps, autoReset: false })));
        failures = traces.flatMap(({ f, trace, doc }, k) => runTrace(doc, trace, {}, replayResults(results[k]!, `${name} driver`)).map((x) => `${f}: ${formatFailure(trace, x)}`));
      }
      assert.equal(failures.length, 0, failures.join("\n"));
    });
  });

  describe(`${name} backend matches the interpreter`, { skip }, () => {
    it("on joins whose sources agree or disagree", async () => {
      await compareAll([false, true].map((agree) => ({ label: `joins ${agree}`, doc: joinAgreementModel(agree), script: [{ reset: true }, { send: "e1" }, { send: "e1" }] })));
    });
    it("on a model that needs every expression form", async () => {
      await compareAll(seeded("expressions", expressionModel(), [1, 2, 3, 4, 5, 6, 7, 8], 80));
    });
    it("on random events in every repo model and the keyword model", async () => {
      await compareAll(repoModels().flatMap(({ label, doc }) => seeded(label, doc, [1, 2, 3, 4, 5], 120)));
    });
    // <randomEnv>=<n> runs more random models (default 300), e.g. as a longer fuzz run before a release.
    const count = Number(process.env[spec.randomEnv] ?? 300);
    it(`on ${count} random models`, async () => {
      await compareAll(
        Array.from({ length: count }, (_, i) => {
          const doc = randomModel(i + 1, { transitions: 16 });
          return { label: `random model ${i + 1}`, doc, script: randomScript(doc, (i + 1) * 31, 40) };
        }),
      );
    });
    it(`with debugInfo and trace: hooks, names and is-active on every repo model, the keyword model and ${Math.ceil(count / 3)} random models`, async () => {
      await compareAll(hookDiffs(repoModels(), Math.ceil(count / 3)), true);
    });
    it("on random models with a small signal queue", async () => {
      await compareAll(
        Array.from({ length: 100 }, (_, i) => {
          const doc = randomModel(i + 1, { signals: 2, transitions: 18 });
          return { label: `random model ${i + 1}, queue 2`, doc, script: randomScript(doc, i + 1, 30), signalQueue: 2 };
        }),
      );
    });
    it("on expression shapes the models rarely or never produce (hand-built IR)", async () => {
      const script: ScriptStep[] = [{ reset: true }];
      const expected: string[] = ["|s1|-"];
      for (let bits = 0; bits < 8; bits++) {
        const [a, b, c] = [(bits & 1) === 1, ((bits >> 1) & 1) === 1, ((bits >> 2) & 1) === 1];
        for (const [n, , truth] of SHAPES) {
          script.push({ guards: { a, b, c }, send: n });
          expected.push(`${truth(a, b, c) ? "hit" : ""}|s1|-`);
        }
      }
      const [results] = await spec.run([{ ir: shapesModule(), script, autoReset: false }]);
      assert.deepEqual(results!.map(outcome), expected);
    });
    it("keep the value of a final return (hand-built eventless step that ends in `return false`)", async () => {
      const script: ScriptStep[] = [{ reset: true }, { send: "e1" }, { guards: { g: true }, send: "e1" }, { send: "e1" }];
      const [results] = await spec.run([{ ir: tailModule(), options: { maxMicrosteps: 5 }, script, autoReset: false }]);
      assert.deepEqual(results!.map(outcome), ["|a|-", "|a|-", "moved|b|-", "|b|-"]);
    });
  });

  describe(`${name} backend: generated files (contract)`, () => {
    it("are the same for the same input", () => {
      for (const f of modelFiles) {
        const doc = load(f);
        for (const options of [{}, { debugInfo: true, trace: true }]) {
          assert.deepEqual(generateFiles(doc, spec.target, options), generateFiles(load(f), spec.target, options), f);
        }
      }
    });
    it("have a timer API only for a model with timers", () => {
      const text = (file: string): string => generateFiles(load(join(repoRoot, "tests/models", file)), spec.target).files.map((x) => x.text).join("\n");
      assert.match(text("test_timers.ufsm"), spec.timerApi);
      assert.doesNotMatch(text("test_guard1.ufsm"), spec.timerApi);
    });
    it(`read the API options of targets.${spec.target}, never behaviour options, and report what they ignore`, () => {
      const doc = load(join(repoRoot, "tests/models/test_signals.ufsm"));
      doc.targets = { [spec.target]: { signalQueue: 0, debugInfo: true, trace: "yes", unknownKey: 1 } };
      const { files, problems } = generateFiles(doc, spec.target);
      assert.equal(problems.length, 3, problems.join("\n"));
      assert.ok(problems.some((p) => p.includes(`targets.${spec.target}.signalQueue`)), "a behaviour option is ignored");
      assert.ok(problems.some((p) => p.includes(`targets.${spec.target}.trace`)), "an API option of the wrong type is ignored");
      assert.ok(problems.some((p) => p.includes(`targets.${spec.target}.unknownKey`)), "an unknown key is reported");
      const plain = generateFiles(load(join(repoRoot, "tests/models/test_signals.ufsm")), spec.target, { debugInfo: true });
      assert.deepEqual(files, plain.files, "debugInfo from targets is used, signalQueue is not");
    });
    it("report what cannot be generated as CodegenError", () => {
      const doc = load(join(repoRoot, "tests/models/test_signals.ufsm"));
      assert.throws(() => generateFiles(doc, spec.target, { signalQueue: 0 }), CodegenError, "a model that emits needs a queue");
      doc.declarations.events.push({ id: "dup", name: doc.declarations.events[0]!.name });
      assert.throws(() => generateFiles(doc, spec.target), CodegenError, "a model with errors");
    });
  });
}
