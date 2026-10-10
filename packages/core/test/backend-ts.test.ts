// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  CodegenError,
  flatten,
  formatFailure,
  generateTypeScript,
  loadModel,
  lowerToIr,
  parseTrace,
  runTrace,
  tsOptionsFromTargets,
  type Expr,
  type IrModule,
  type UfsmDocument,
  traceOptions,
} from "../src/index";
import { DIFF_QUEUE, compareWithInterpreter, expressionModel, joinAgreementModel, randomScript, runScript } from "./harness";
import { removeTempDir } from "./c-harness";
import { loadTs } from "./ts-harness";
import { randomModel } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
const modelFiles = ["examples", "tests/models"].flatMap((d) =>
  existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
);
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));
const load = (path: string): UfsmDocument => loadModel(readFileSync(path, "utf8")).doc;
const MAX_STEPS = 300;

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

/**
 * Differential runs: every doc gets a generated machine with the interpreter's limits. With `hooks`, the machines are
 * generated with debugInfo and trace, and the trace hook calls, names and isActive() are compared too.
 */
async function compareAll(cases: { doc: UfsmDocument; seeds: number[]; steps: number; signalQueue?: number }[], hooks = false): Promise<void> {
  const { units, cleanup } = await loadTs(
    cases.map((c) => ({
      ir: lowerToIr(flatten(c.doc), { trace: hooks }),
      options: { maxMicrosteps: MAX_STEPS, signalQueue: c.signalQueue ?? DIFF_QUEUE, debugInfo: hooks },
    })),
  );
  try {
    cases.forEach((c, k) => {
      for (const seed of c.seeds) compareWithInterpreter((_doc, host) => units[k]!.make(host), c.doc, seed, c.steps, { signalQueue: c.signalQueue ?? DIFF_QUEUE }, hooks);
    });
  } finally {
    cleanup();
  }
}

describe("TypeScript backend: conformance traces", () => {
  const files = existsSync(traceDir) ? readdirSync(traceDir).filter((x) => x.endsWith(".json")).sort() : [];
  it(`${files.length} traces`, async () => {
    const traces = files.map((f) => {
      const path = join(traceDir, f);
      const trace = parseTrace(readFileSync(path, "utf8"));
      return { f, trace, doc: load(resolve(dirname(path), trace.model)) };
    });
    const { units, cleanup } = await loadTs(traces.map(({ trace, doc }) => ({ ir: ir(doc), options: traceOptions(doc, trace) })));
    try {
      const failures = traces.flatMap(({ f, trace, doc }, k) => runTrace(doc, trace, {}, (_d, host) => units[k]!.make(host)).map((x) => `${f}: ${formatFailure(trace, x)}`));
      assert.equal(failures.length, 0, failures.join("\n"));
    } finally {
      cleanup();
    }
  });
});

describe("TypeScript backend matches the interpreter", () => {
  it("on joins whose sources agree or disagree", async () => {
    await compareAll([false, true].map((agree) => ({ doc: joinAgreementModel(agree), seeds: [1, 2, 3], steps: 20 })));
  });
  it("on a model that needs every expression form", async () => {
    await compareAll([{ doc: expressionModel(), seeds: [1, 2, 3, 4, 5, 6, 7, 8], steps: 80 }]);
  });
  it("on random events in every repo model", async () => {
    await compareAll(modelFiles.map((f) => ({ doc: load(f), seeds: [1, 2, 3, 4, 5], steps: 120 })));
  });
  // UFSM_TS_RANDOM=<n> runs more random models (default 300).
  const count = Number(process.env["UFSM_TS_RANDOM"] ?? 300);
  it(`on ${count} random models`, async () => {
    await compareAll(Array.from({ length: count }, (_, i) => ({ doc: randomModel(i + 1, { transitions: 16 }), seeds: [(i + 1) * 31], steps: 40 })));
  });
  it(`with debugInfo and trace: hooks, names and isActive() on every repo model and ${Math.ceil(count / 3)} random models`, async () => {
    await compareAll(
      [
        ...modelFiles.map((f) => ({ doc: load(f), seeds: [1, 2], steps: 120 })),
        ...Array.from({ length: Math.ceil(count / 3) }, (_, i) => ({ doc: randomModel(i + 1, { signals: 2, transitions: 16 }), seeds: [(i + 1) * 37], steps: 40 })),
      ],
      true,
    );
  });
  it("on random models with a small signal queue", async () => {
    await compareAll(Array.from({ length: 100 }, (_, i) => ({ doc: randomModel(i + 1, { signals: 2, transitions: 18 }), seeds: [i + 1], steps: 30, signalQueue: 2 })));
  });
  it("on expression shapes the models rarely or never produce (hand-built IR)", async () => {
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
    const { units, cleanup } = await loadTs([{ ir: mod }]);
    try {
      const script: { reset?: true; send?: string; guards?: Record<string, boolean> }[] = [{ reset: true }];
      const expected: string[] = ["reset:  | s1"];
      for (let bits = 0; bits < 8; bits++) {
        const [a, b, c] = [(bits & 1) === 1, ((bits >> 1) & 1) === 1, ((bits >> 2) & 1) === 1];
        for (const [n, , truth] of cases) {
          script.push({ guards: { a, b, c }, send: n });
          expected.push(`${n}: ${truth(a, b, c) ? "hit" : ""} | s1`);
        }
      }
      assert.deepEqual(runScript((host) => units[0]!.make(host), script), expected);
    } finally {
      cleanup();
    }
  });
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

  it("are the same for the same input", () => {
    const doc = load(join(repoRoot, "tests/models/canvas.ufsm"));
    assert.deepEqual(generateTypeScript(ir(doc)), generateTypeScript(ir(doc)));
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
