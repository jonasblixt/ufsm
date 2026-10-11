// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { CodegenError, type UfsmDocument } from "../src";
import { flatten, generateTypeScript, lowerToIr, tsOptionsFromTargets } from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { recordScript } from "./harness";
import { loadTs } from "./ts-harness";
import { describeBackend, load, modelFiles, repoRoot } from "./backend-contract";

const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));

/** The strictest settings a consumer is likely to use; generated code must compile under all of them. */
const STRICT: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noImplicitReturns: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  noPropertyAccessFromIndexSignature: true,
  erasableSyntaxOnly: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  allowImportingTsExtensions: true,
  noEmit: true,
  types: [],
};

function typeCheck(files: string[], lib: string[]): { file: string; line: number; message: string }[] {
  const program = ts.createProgram(files, { ...STRICT, lib: lib.map((l) => `lib.${l.toLowerCase()}.d.ts`) });
  return ts.getPreEmitDiagnostics(program).map((d) => ({
    file: d.file ? d.file.fileName.replace(/^.*[\\/]/, "") : "",
    line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
    message: ts.flattenDiagnosticMessageText(d.messageText, " "),
  }));
}

describeBackend({
  name: "TypeScript",
  target: "ts",
  randomEnv: "UFSM_TS_RANDOM",
  skip: false,
  run: async (units) => {
    const { units: loaded, cleanup } = await loadTs(units);
    try {
      return units.map((u, k) => recordScript((host) => loaded[k]!.make(host), u.script, u.autoReset));
    } finally {
      cleanup();
    }
  },
  machines: async (units) => {
    const { units: loaded, cleanup } = await loadTs(units);
    return { make: (k, host) => loaded[k]!.make(host), cleanup };
  },
  timerApi: /timer_start\(timer:/,
});

describe("TypeScript backend: generated files", () => {
  it("type-check under strict settings with only the ES2020 library (no DOM, no Node types)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-tsc-"));
    try {
      const written = new Map<string, string>();
      for (const f of modelFiles) {
        const out = generateTypeScript(ir(load(f)));
        if (written.has(out.fileName)) continue; // examples/ and tests/models/ both have a test_model1
        written.set(out.fileName, join(dir, out.fileName));
        writeFileSync(join(dir, out.fileName), out.source);
        // and with debugInfo and trace
        const debug = generateTypeScript(lowerToIr(flatten(load(f)), { trace: true }), { debugInfo: true, module: out.fileName.replace(/\.ts$/, "_debug") });
        written.set(debug.fileName, join(dir, debug.fileName));
        writeFileSync(join(dir, debug.fileName), debug.source);
      }
      const diags = typeCheck([...written.values()], ["ES2020"]);
      assert.deepEqual(diags, [], diags.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n"));
    } finally {
      removeTempDir(dir);
    }
  });

  it("let typed callers use them and reject wrong handlers and events", () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-tsc-"));
    try {
      writeFileSync(join(dir, "dimmer.ts"), generateTypeScript(ir(load(join(repoRoot, "examples/dimmer.ufsm")))).source);
      writeFileSync(join(dir, "example.ts"), docExample());
      writeFileSync(
        join(dir, "wrong.ts"),
        'import { Dimmer, DimmerEvent } from "./dimmer.ts";\n\n' +
          "const machine = new Dimmer({ lamp_off() {} }); // lamp_10_percent() etc. are missing\n" +
          "machine.process(5); // not a DimmerEvent\n" +
          "machine.process(DimmerEvent.eOffButton);\n",
      );
      const diags = typeCheck([join(dir, "example.ts"), join(dir, "wrong.ts")], ["ES2020", "DOM"]);
      const other = diags.filter((d) => d.file !== "wrong.ts");
      assert.deepEqual(other, [], other.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n"));
      assert.deepEqual(diags.filter((d) => d.file === "wrong.ts").map((d) => d.line), [3, 4], diags.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n"));
    } finally {
      removeTempDir(dir);
    }
  });

  it("run the dimmer example from docs/backend-ts.md with plain Node (type stripping)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-ts-"));
    try {
      writeFileSync(join(dir, "dimmer.ts"), generateTypeScript(ir(load(join(repoRoot, "examples/dimmer.ufsm")))).source);
      writeFileSync(join(dir, "example.ts"), docExample());
      writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
      const out = execFileSync(process.execPath, ["--no-warnings", "example.ts"], { cwd: dir, encoding: "utf8", stdio: "pipe" });
      assert.equal(out.trim(), "lamp at 30%");
    } finally {
      removeTempDir(dir);
    }
  });

  it("import nothing and keep public names as declared", () => {
    const out = generateTypeScript(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
    assert.equal(out.fileName, "dimmer.ts");
    assert.doesNotMatch(out.source, /^\s*import\b/m);
    assert.match(out.source, /^export class Dimmer \{$/m);
    assert.match(out.source, /^export const DimmerEvent = \{\n {2}eButton: 0,\n {2}eOffButton: 1,\n\} as const;$/m);
    assert.match(out.source, /^export interface DimmerHandler \{\n {2}lamp_off\(\): void;$/m);
    assert.match(out.source, /^ {2}process\(event: DimmerEvent\): void \{$/m);
    const guards = generateTypeScript(ir(load(join(repoRoot, "tests/models/test_guard_terms.ufsm")))).source;
    assert.match(guards, /^ {2}not: 1,$/m, "JavaScript keywords are fine as property names");
    assert.match(guards, /^ {2}g\(\): boolean;$/m);
    const custom = generateTypeScript(ir(load(join(repoRoot, "examples/dimmer.ufsm"))), { className: "Lamp", module: "lamp-fsm" });
    assert.equal(custom.fileName, "lamp-fsm.ts");
    assert.match(custom.source, /^export interface LampHandler \{$/m);
  });

  it("generate only what the model uses", () => {
    const plain = generateTypeScript(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm")))).source;
    assert.doesNotMatch(plain, /this\.queue|this\.hist|terminated|settle/);
    const signals = generateTypeScript(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), { signalQueue: 5 }).source;
    assert.match(signals, /if \(this\.queue\.length >= 5\) \{/);
    const noCheck = generateTypeScript(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { maxMicrosteps: 0 }).source;
    assert.doesNotMatch(noCheck, /steps|microstep/);
  });

  it("emit the timer API only for a model with timers, usable by a typed caller", () => {
    const none = generateTypeScript(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { debugInfo: true }).source;
    assert.doesNotMatch(none, /timer/i);
    const timers = ir(load(join(repoRoot, "tests/models/test_timers.ufsm")));
    const src = generateTypeScript(timers, { debugInfo: true }).source;
    assert.match(src, /^export const TestTimersTimer = \{$/m);
    assert.match(src, /^ {2}poll: 1, \/\/ every 100 ms -> eTick$/m);
    assert.match(src, /^export function testTimersTimerEvent\(timer: TestTimersTimer\): TestTimersEvent \{$/m);
    assert.match(src, /^ {2}timer_start\(timer: TestTimersTimer, ms: number, periodic: boolean\): void;$/m);
    assert.match(src, /^ {2}timer_stop\(timer: TestTimersTimer\): void;$/m);
    assert.match(src, /^ {2}static readonly TIMER_NAMES: readonly string\[\] = \["travel", "poll", "blink", "long"\];$/m);
    assert.match(src, /this\.h\.timer_start\(TestTimersTimer\.long, 3600000, false\);/);
    const dir = mkdtempSync(join(tmpdir(), "ufsm-tsc-"));
    try {
      writeFileSync(join(dir, "test_timers.ts"), src);
      writeFileSync(
        join(dir, "caller.ts"),
        [
          'import { TestTimers, type TestTimersTimer, testTimersTimerEvent } from "./test_timers.ts";',
          "",
          "const running = new Set<TestTimersTimer>();",
          "const machine = new TestTimers({",
          ...timers.actions.map((a) => `  ${a.name}() {},`),
          "  timer_start(timer: TestTimersTimer, ms: number, periodic: boolean) {",
          "    void ms;",
          "    void periodic;",
          "    running.add(timer);",
          "  },",
          "  timer_stop(timer: TestTimersTimer) {",
          "    running.delete(timer);",
          "  },",
          "});",
          "machine.reset();",
          "for (const t of running) machine.process(testTimersTimerEvent(t));",
          "",
        ].join("\n"),
      );
      const diags = typeCheck([join(dir, "caller.ts")], ["ES2020"]);
      assert.deepEqual(diags, [], diags.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n"));
    } finally {
      removeTempDir(dir);
    }
  });

  it("reject an action named like a timer function of the handler", () => {
    const doc = load(join(repoRoot, "tests/models/test_timers.ufsm"));
    doc.declarations.actions[0]!.name = "timer_start";
    assert.throws(() => generateTypeScript(ir(doc)), /action 'timer_start' is the name of a timer function of the handler/);
  });

  it("reject names that every JavaScript object has", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.declarations.actions[0]!.name = "toString";
    assert.throws(() => generateTypeScript(ir(doc)), (e: unknown) => e instanceof CodegenError && /action 'toString'/.test(e.message));
    assert.throws(() => generateTypeScript(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { className: "class" }), /not a usable identifier/);
  });

  it("read targets.ts: its own settings, never behaviour options", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.targets = { ts: { className: "G", signalQueue: 8, colour: "red", module: 3 } };
    const { options, problems } = tsOptionsFromTargets(doc);
    assert.deepEqual(options, { className: "G" }, "behaviour options are not read from targets");
    assert.deepEqual(problems, [
      "targets.ts.signalQueue: changes behaviour, so it is set in options for every target (ignored)",
      "targets.ts.colour: unknown option (ignored)",
      "targets.ts.module: expected a string",
    ]);
  });
});

function docExample(): string {
  const doc = readFileSync(join(repoRoot, "docs/backend-ts.md"), "utf8");
  const example = /## Example\n\n```ts\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(example, "docs/backend-ts.md has an Example section with a ts block");
  return example;
}
