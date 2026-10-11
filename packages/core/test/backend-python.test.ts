// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodegenError, pascalCase, type UfsmDocument } from "../src";
import { flatten, generatePython, lowerToIr, pythonOptionsFromTargets } from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { MIN_PYTHON, findPyright, findPython, runPyright, runPython } from "./py-harness";
import { describeBackend, load, modelFiles, repoRoot } from "./backend-contract";

// The Python tests skip without Python 3.8+; UFSM_REQUIRE_PYTHON=1 (CI) turns that into a failure.
const { python, problem } = findPython();
if (!python && process.env["UFSM_REQUIRE_PYTHON"]) throw new Error(`UFSM_REQUIRE_PYTHON is set but ${problem}`);
const skip = python ? false : (problem ?? "no Python");
// The type check skips without pyright; UFSM_REQUIRE_PYRIGHT=1 (CI) turns that into a failure.
const { pyright, problem: pyrightProblem } = findPyright();
if (!pyright && process.env["UFSM_REQUIRE_PYRIGHT"]) throw new Error(`UFSM_REQUIRE_PYRIGHT is set but ${pyrightProblem}`);
const skipPyright = pyright ? false : (pyrightProblem ?? "no pyright");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));

/** Run a Python snippet in a directory; returns stdout. */
function py(dir: string, code: string): string {
  const [cmd, ...args] = python!;
  return execFileSync(cmd!, [...args, "-B", "-c", code], { cwd: dir, encoding: "utf8", stdio: "pipe" });
}

describeBackend({
  name: "Python",
  target: "python",
  randomEnv: "UFSM_PY_RANDOM",
  skip,
  run: async (units) => runPython(python!, units),
  timerApi: /def timer_start\(self/,
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
