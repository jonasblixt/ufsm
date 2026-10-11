// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodegenError, formatFailure, loadModel, parseTrace, pascalCase, runTrace, type UfsmDocument, traceOptions } from "../src";
import { flatten, generatePython, lowerToIr, pythonOptionsFromTargets, type Expr, type IrModule } from "../src/pipeline";
import { DIFF_QUEUE, assertMatchesInterpreter, expressionModel, hookDiffs, joinAgreementModel, randomScript, replayResults, type BackendDiff } from "./harness";
import { removeTempDir } from "./c-harness";
import { MIN_PYTHON, findPyright, findPython, runPyright, runPython } from "./py-harness";
import { randomModel } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
const modelFiles = ["examples", "tests/models"].flatMap((d) =>
  existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
);
// The Python tests skip without Python 3.8+; UFSM_REQUIRE_PYTHON=1 (CI) turns that into a failure.
const { python, problem } = findPython();
if (!python && process.env["UFSM_REQUIRE_PYTHON"]) throw new Error(`UFSM_REQUIRE_PYTHON is set but ${problem}`);
const skip = python ? false : (problem ?? "no Python");
// The type check skips without pyright; UFSM_REQUIRE_PYRIGHT=1 (CI) turns that into a failure.
const { pyright, problem: pyrightProblem } = findPyright();
if (!pyright && process.env["UFSM_REQUIRE_PYRIGHT"]) throw new Error(`UFSM_REQUIRE_PYRIGHT is set but ${pyrightProblem}`);
const skipPyright = pyright ? false : (pyrightProblem ?? "no pyright");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));
const load = (path: string): UfsmDocument => loadModel(readFileSync(path, "utf8")).doc;
const MAX_STEPS = 300;

/** Differential runs; with `hooks`, generated with debugInfo and trace, comparing hook calls and is_active() too. */
function compareAll(diffs: BackendDiff[], hooks = false): void {
  const irs = diffs.map((d) => lowerToIr(flatten(d.doc), { trace: hooks }));
  const results = runPython(
    python!,
    diffs.map((d, k) => ({ ir: irs[k]!, options: { maxMicrosteps: MAX_STEPS, signalQueue: d.signalQueue ?? DIFF_QUEUE, debugInfo: hooks }, script: d.script, autoReset: true })),
  );
  assertMatchesInterpreter(diffs, results, MAX_STEPS, "Python", hooks ? irs : undefined);
}

/** Run a Python snippet in a directory; returns stdout. */
function py(dir: string, code: string): string {
  const [cmd, ...args] = python!;
  return execFileSync(cmd!, [...args, "-B", "-c", code], { cwd: dir, encoding: "utf8", stdio: "pipe" });
}

describe("Python backend: conformance traces", { skip }, () => {
  const files = existsSync(traceDir) ? readdirSync(traceDir).filter((x) => x.endsWith(".json")).sort() : [];
  it(`${files.length} traces`, () => {
    const traces = files.map((f) => {
      const path = join(traceDir, f);
      const trace = parseTrace(readFileSync(path, "utf8"));
      return { f, trace, doc: load(resolve(dirname(path), trace.model)) };
    });
    const results = runPython(python!, traces.map(({ trace, doc }) => ({ ir: ir(doc), options: traceOptions(doc, trace), script: trace.steps, autoReset: false })));
    const failures = traces.flatMap(({ f, trace, doc }, k) => runTrace(doc, trace, {}, replayResults(results[k]!, "Python driver")).map((x) => `${f}: ${formatFailure(trace, x)}`));
    assert.equal(failures.length, 0, failures.join("\n"));
  });
});

describe("Python backend matches the interpreter", { skip }, () => {
  it("on joins whose sources agree or disagree", () => {
    compareAll([false, true].map((agree) => ({ label: `joins ${agree}`, doc: joinAgreementModel(agree), script: [{ reset: true }, { send: "e1" }, { send: "e1" }] })));
  });
  it("on a model that needs every expression form", () => {
    const doc = expressionModel();
    compareAll([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ label: `expressions seed ${seed}`, doc, script: randomScript(doc, seed, 80) })));
  });
  it("on random events in every repo model", () => {
    compareAll(
      modelFiles.flatMap((f) => {
        const doc = load(f);
        return [1, 2, 3, 4, 5].map((seed) => ({ label: `${f.slice(repoRoot.length + 1)} seed ${seed}`, doc, script: randomScript(doc, seed, 120) }));
      }),
    );
  });
  // UFSM_PY_RANDOM=<n> runs more random models (default 300).
  const count = Number(process.env["UFSM_PY_RANDOM"] ?? 300);
  it(`on ${count} random models`, () => {
    for (let from = 1; from <= count; from += 150) {
      compareAll(
        Array.from({ length: Math.min(150, count - from + 1) }, (_, i) => {
          const seed = from + i;
          const doc = randomModel(seed, { transitions: 16 });
          return { label: `random model ${seed}`, doc, script: randomScript(doc, seed * 31, 40) };
        }),
      );
    }
  });
  it(`with debugInfo and trace: hooks, names and is_active() on every repo model and ${Math.ceil(count / 3)} random models`, () => {
    compareAll(hookDiffs(modelFiles.map((f) => ({ label: f.slice(repoRoot.length + 1), doc: load(f) })), Math.ceil(count / 3)), true);
  });
  it("on expression shapes the models rarely or never produce (hand-built IR)", () => {
    // One step function per expression; it calls `hit` when the expression is true. Guards a, b, c take every true/false value.
    const g = (n: string): Expr => ({ op: "guard", guard: n });
    const cases: [string, Expr, (a: boolean, b: boolean, c: boolean) => boolean][] = [
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
    const mod: IrModule = {
      name: "precedence",
      regions: 1,
      regionNames: ["root"],
      states: [{ id: "s1", name: "A", ident: "A", label: "A", region: 0, slot: 1, final: false }],
      history: [],
      transitions: [],
      trace: false,
      fingerprint: 0,
      timers: [],
      events: cases.map(([n]) => ({ id: `ev_${n}`, name: n })),
      signals: [],
      actions: [{ id: "act1", name: "hit" }],
      guards: ["a", "b", "c"].map((n) => ({ id: n, name: n })),
      start: [{ op: "set", region: 0, slot: 1 }],
      onEvent: Object.fromEntries(cases.map(([n]) => [`ev_${n}`, `step_${n}`])),
      onSignal: {},
      eventless: undefined,
      functions: cases.map(([n, cond]) => ({ name: `step_${n}`, returns: "bool" as const, flags: [], body: [{ op: "if" as const, cond, then: [{ op: "call" as const, action: "act1" }] }, { op: "return" as const, value: false }] })),
    };
    const script: { reset?: true; send?: string; guards?: Record<string, boolean> }[] = [{ reset: true }];
    const expected: string[] = [];
    for (let bits = 0; bits < 8; bits++) {
      const [a, b, c] = [(bits & 1) === 1, ((bits >> 1) & 1) === 1, ((bits >> 2) & 1) === 1];
      for (const [n, , truth] of cases) {
        script.push({ guards: { a, b, c }, send: n });
        expected.push(`${n} a=${a} b=${b} c=${c}: ${truth(a, b, c) ? "hit" : "-"}`);
      }
    }
    const [res] = runPython(python!, [{ ir: mod, script, autoReset: false }]);
    const sends = script.filter((x) => x.send !== undefined);
    const actual = res!.slice(1).map((r, i) => `${sends[i]!.send} a=${sends[i]!.guards!["a"]} b=${sends[i]!.guards!["b"]} c=${sends[i]!.guards!["c"]}: ${r.calls.length ? r.calls.join(" ") : "-"}`);
    assert.deepEqual(actual, expected);
  });
  it("on random models with a small signal queue", () => {
    compareAll(
      Array.from({ length: 100 }, (_, i) => {
        const doc = randomModel(i + 1, { signals: 2, transitions: 18 });
        return { label: `random model ${i + 1}, queue 2`, doc, script: randomScript(doc, i + 1, 30), signalQueue: 2 };
      }),
    );
  });
});

describe("Python backend: generated files", () => {
  it(`use only Python ${MIN_PYTHON.join(".")} grammar and import only enum and typing`, { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-py-"));
    try {
      const names = modelFiles.map((f) => {
        const out = generatePython(ir(load(f)));
        writeFileSync(join(dir, out.fileName), out.source);
        return out.fileName;
      });
      const report = py(
        dir,
        `import ast, sys
bad = []
for name in ${JSON.stringify(names)}:
    with open(name) as f:
        tree = ast.parse(f.read(), name, feature_version=(${MIN_PYTHON.join(", ")}))
    for n in ast.walk(tree):
        if isinstance(n, ast.Import) or (isinstance(n, ast.ImportFrom) and n.module not in ("enum", "typing")):
            bad.append(name)
print(bad)`,
      );
      assert.equal(report.trim(), "[]");
    } finally {
      removeTempDir(dir);
    }
  });

  it(`pass pyright --strict (Python ${MIN_PYTHON.join(".")}), and so do typed callers; wrong handlers and events do not`, { skip: skipPyright }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-pyright-"));
    try {
      const written = new Set<string>();
      for (const f of modelFiles) {
        const out = generatePython(ir(load(f)));
        if (written.has(out.fileName)) continue; // examples/ and tests/models/ both have a test_model1
        written.add(out.fileName);
        writeFileSync(join(dir, out.fileName), out.source);
        // and with debugInfo and trace
        const debug = generatePython(lowerToIr(flatten(load(f)), { trace: true }), { debugInfo: true, module: out.fileName.replace(/\.py$/, "_debug") });
        writeFileSync(join(dir, debug.fileName), debug.source);
      }
      const docText = readFileSync(join(repoRoot, "docs/backend-python.md"), "utf8");
      writeFileSync(join(dir, "doc_example.py"), /## Example\n\n```python\n([\s\S]*?)```/.exec(docText)![1]!);
      writeFileSync(
        join(dir, "wrong_caller.py"),
        "from dimmer import Dimmer, DimmerEvent\n\n\nclass Lamp:\n    def lamp_off(self) -> None: ...\n\n\n" +
          "machine = Dimmer(Lamp())  # lamp_10_percent() etc. are missing\nmachine.process(1)  # an int, not a DimmerEvent\nmachine.process(DimmerEvent.eOffButton)\n",
      );
      const diags = runPyright(pyright!, dir).filter((d) => d.severity !== "information");
      const generated = diags.filter((d) => d.file !== "wrong_caller.py");
      assert.deepEqual(generated, [], generated.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n"));
      const wrong = diags.filter((d) => d.file === "wrong_caller.py").map((d) => d.line).sort();
      assert.deepEqual(wrong, [8, 9], diags.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n"));
    } finally {
      removeTempDir(dir);
    }
  });

  it("run the dimmer example from docs/backend-python.md", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-py-"));
    try {
      const out = generatePython(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
      writeFileSync(join(dir, out.fileName), out.source);
      const doc = readFileSync(join(repoRoot, "docs/backend-python.md"), "utf8");
      const example = /## Example\n\n```python\n([\s\S]*?)```/.exec(doc)?.[1];
      assert.ok(example, "docs/backend-python.md has an Example section with a python block");
      assert.equal(py(dir, example).trim(), "lamp at 30%");
    } finally {
      removeTempDir(dir);
    }
  });

  it("name the class after the model and keep public names as declared", () => {
    const out = generatePython(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
    assert.equal(out.fileName, "dimmer.py");
    assert.match(out.source, /^class Dimmer:$/m);
    assert.match(out.source, /^class DimmerEvent\(IntEnum\):\n {4}eButton = 0\n {4}eOffButton = 1$/m);
    assert.match(out.source, /^class DimmerHandler\(Protocol\):$/m);
    assert.match(out.source, /^ {4}def lamp_off\(self\) -> None: \.\.\.$/m);
    assert.match(out.source, /^ {4}def __init__\(self, handler: DimmerHandler\) -> None:$/m);
    assert.match(out.source, /^ {4}def process\(self, event: DimmerEvent\) -> None:$/m);
    assert.match(out.source, /^class DimmerError\(Exception\):$/m);
    assert.match(out.source, /self\._h\.lamp_off\(\)/);
    assert.equal(pascalCase("test_guard1"), "TestGuard1");
    assert.equal(pascalCase("New model"), "NewModel");
    assert.equal(pascalCase("3d"), "M3d");
    const custom = generatePython(ir(load(join(repoRoot, "examples/dimmer.ufsm"))), { className: "Lamp", module: "lamp_fsm" });
    assert.equal(custom.fileName, "lamp_fsm.py");
    assert.match(custom.source, /^class LampEvent\(IntEnum\):$/m);
    assert.match(custom.source, /^class LampHandler\(Protocol\):$/m);
  });

  it("give Python keywords a trailing underscore", () => {
    const out = generatePython(ir(load(join(repoRoot, "tests/models/test_guard_terms.ufsm"))));
    assert.match(out.source, /^ {4}not_ = 1$/m);
    assert.match(out.source, /^ {4}def g\(self\) -> bool: \.\.\.$/m, "guards return a bool");
  });

  it("generate only what the model uses", () => {
    const plain = generatePython(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm")))).source;
    assert.doesNotMatch(plain, /_queue|_hist|_terminated|_settle/);
    const signals = generatePython(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), { signalQueue: 5 }).source;
    assert.match(signals, /if len\(self\._queue\) >= 5:/);
    const noCheck = generatePython(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { maxMicrosteps: 0 }).source;
    assert.doesNotMatch(noCheck, /_steps|_microstep/);
  });

  it("emit the timer API only for a model with timers", () => {
    const none = generatePython(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { debugInfo: true }).source;
    assert.doesNotMatch(none, /timer/i);
    const src = generatePython(ir(load(join(repoRoot, "tests/models/test_timers.ufsm"))), { debugInfo: true }).source;
    assert.match(src, /^class TestTimersTimer\(IntEnum\):$/m);
    assert.match(src, /^ {4}poll = 1 {2}# every 100 ms -> eTick$/m);
    assert.match(src, /^def test_timers_timer_event\(timer: TestTimersTimer\) -> TestTimersEvent:$/m);
    assert.match(src, /^ {4}def timer_start\(self, timer: TestTimersTimer, ms: int, periodic: bool\) -> None:$/m);
    assert.match(src, /^ {4}def timer_stop\(self, timer: TestTimersTimer\) -> None:$/m);
    assert.match(src, /^ {4}TIMER_NAMES: Tuple\[str, \.\.\.\] = \("travel", "poll", "blink", "long"\)$/m);
    assert.match(src, /self\._h\.timer_start\(TestTimersTimer\.long, 3600000, False\)/);
  });

  it("reject an action named like a timer function of the handler", () => {
    const doc = load(join(repoRoot, "tests/models/test_timers.ufsm"));
    doc.declarations.actions[0]!.name = "timer_stop";
    assert.throws(() => generatePython(ir(doc)), /action 'timer_stop' is the name of a timer function of the handler/);
  });

  it("are the same for the same input", () => {
    const doc = load(join(repoRoot, "tests/models/canvas.ufsm"));
    assert.deepEqual(generatePython(ir(doc)), generatePython(ir(doc)));
  });

  it("reject names Python cannot use", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.declarations.actions[0]!.name = "__secret";
    assert.throws(() => generatePython(ir(doc)), (e: unknown) => e instanceof CodegenError && /'__secret' starts with '__'/.test(e.message));
    doc.declarations.actions[0]!.name = "while";
    doc.declarations.actions[1]!.name = "while_";
    assert.throws(() => generatePython(ir(doc)), /action 'while_' becomes 'while_', like action 'while'/);
    assert.throws(() => generatePython(ir(doc), { className: "class" }), /not a Python identifier/);
    assert.throws(() => generatePython(ir(doc), { module: "my-fsm" }), /not a Python identifier/);
  });

  it("read targets.python: its own settings, never behaviour options", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.targets = { python: { className: "G", signalQueue: 8, colour: "red", module: 3 } };
    const { options, problems } = pythonOptionsFromTargets(doc);
    assert.deepEqual(options, { className: "G" }, "behaviour options are not read from targets");
    assert.deepEqual(problems, [
      "targets.python.signalQueue: changes behaviour, so it is set in options for every target (ignored)",
      "targets.python.colour: unknown option (ignored)",
      "targets.python.module: expected a string",
    ]);
  });
});
