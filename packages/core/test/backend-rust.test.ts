// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodegenError,
  flatten,
  formatFailure,
  generateFiles,
  generateRust,
  loadModel,
  lowerToIr,
  parseTrace,
  runTrace,
  rustModuleName,
  rustOptionsFromTargets,
  type Expr,
  type IrModule,
  type UfsmDocument,
} from "../src/index";
import { assertMatchesInterpreter, expressionModel, joinAgreementModel, randomScript, replayResults, type BackendDiff, type ScriptStep } from "./harness";
import { removeTempDir } from "./c-harness";
import { buildLib, CLIPPY_FLAGS, findRust, RUSTC_FLAGS, runRust, type RustUnit } from "./rust-harness";
import { randomModel } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
const modelFiles = ["examples", "tests/models"].flatMap((d) =>
  existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
);
// The Rust tests skip without rustc; UFSM_REQUIRE_RUST=1 (CI) turns that into a failure, and also requires
// clippy-driver and rustfmt (both in rustup's default profile).
const tools = findRust();
if (process.env["UFSM_REQUIRE_RUST"]) {
  if (!tools.rustc) throw new Error(`UFSM_REQUIRE_RUST is set but ${tools.problem}`);
  if (!tools.clippy) throw new Error("UFSM_REQUIRE_RUST is set but clippy-driver was not found (rustup component add clippy, or set CLIPPY_DRIVER)");
  if (!tools.rustfmt) throw new Error("UFSM_REQUIRE_RUST is set but rustfmt was not found (rustup component add rustfmt, or set RUSTFMT)");
}
const skip = tools.rustc ? false : (tools.problem ?? "no rustc");
const skipClippy = skip || (tools.clippy ? false : "clippy-driver not found");
const skipFmt = skip || (tools.rustfmt ? false : "rustfmt not found");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));
const load = (path: string): UfsmDocument => loadModel(readFileSync(path, "utf8")).doc;
const baseName = (f: string): string => f.replace(/^.*[\\/]/, "").replace(/\.ufsm$/, "");
const MAX_STEPS = 300;

async function compareAll(diffs: BackendDiff[]): Promise<void> {
  const units: RustUnit[] = diffs.map((d) => ({
    ir: ir(d.doc),
    options: { maxMicrosteps: MAX_STEPS, signalQueue: d.signalQueue ?? 4096 },
    script: d.script,
    autoReset: true,
  }));
  assertMatchesInterpreter(diffs, await runRust(tools, units), MAX_STEPS, "Rust");
}

/** Every repo model as a module of one `#![no_std]` library crate; one of them through `include!`. */
function writeRepoCrate(dir: string): string[] {
  const mods: string[] = [];
  const lib = ["//! Every repository model.", "#![no_std]", "#![forbid(unsafe_code)]", ""];
  const docs: [string, UfsmDocument][] = modelFiles.map((f) => [`${rustModuleName(baseName(f))}${f.includes("examples") ? "_example" : ""}`, load(f)]);
  docs.push(["keywords", keywordModel()]);
  for (const [name, doc] of docs) {
    const out = generateRust(ir(doc), { module: name });
    writeFileSync(join(dir, out.fileName), out.source);
    mods.push(out.fileName);
    if (mods.length === 1) lib.push("/// Included.", `pub mod ${name} {`, `    include!("${out.fileName}");`, "}");
    else lib.push("/// A machine.", `pub mod ${name};`);
  }
  writeFileSync(join(dir, "lib.rs"), `${lib.join("\n")}\n`);
  return mods;
}

function docExample(): string {
  const doc = readFileSync(join(repoRoot, "docs/backend-rust.md"), "utf8");
  const example = /## Example\n\n```rust\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(example, "docs/backend-rust.md has an Example section with a rust block");
  return example;
}

describe("Rust backend: conformance traces", { skip }, () => {
  const files = existsSync(traceDir) ? readdirSync(traceDir).filter((x) => x.endsWith(".json")).sort() : [];
  it(`${files.length} traces`, async () => {
    const traces = files.map((f) => {
      const path = join(traceDir, f);
      const trace = parseTrace(readFileSync(path, "utf8"));
      return { f, trace, doc: load(resolve(dirname(path), trace.model)) };
    });
    const results = await runRust(
      tools,
      traces.map(({ trace, doc }) => ({ ir: ir(doc), options: trace.options ?? {}, script: trace.steps, autoReset: false })),
    );
    const failures = traces.flatMap(({ f, trace, doc }, k) => runTrace(doc, trace, {}, replayResults(results[k]!, "Rust driver")).map((x) => `${f}: ${formatFailure(trace, x)}`));
    assert.equal(failures.length, 0, failures.join("\n"));
  });
});

describe("Rust backend matches the interpreter", { skip }, () => {
  it("on joins whose sources agree or disagree", async () => {
    await compareAll([false, true].map((agree) => ({ label: `joins ${agree}`, doc: joinAgreementModel(agree), script: [{ reset: true }, { send: "e1" }, { send: "e1" }] })));
  });
  it("on a model whose names are Rust keywords", async () => {
    const doc = keywordModel();
    await compareAll([1, 2, 3].map((seed) => ({ label: `keywords seed ${seed}`, doc, script: randomScript(doc, seed, 40) })));
  });
  it("on a model that needs every expression form", async () => {
    const doc = expressionModel();
    await compareAll([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ label: `expressions seed ${seed}`, doc, script: randomScript(doc, seed, 80) })));
  });
  it("on random events in every repo model", async () => {
    await compareAll(
      modelFiles.flatMap((f) => {
        const doc = load(f);
        return [1, 2, 3, 4, 5].map((seed) => ({ label: `${f.slice(repoRoot.length + 1)} seed ${seed}`, doc, script: randomScript(doc, seed, 120) }));
      }),
    );
  });
  // UFSM_RUST_RANDOM=<n> runs more random models (default 300), e.g. as a longer fuzz run before a release.
  const count = Number(process.env["UFSM_RUST_RANDOM"] ?? 300);
  it(`on ${count} random models`, async () => {
    for (let from = 1; from <= count; from += 150) {
      await compareAll(
        Array.from({ length: Math.min(150, count - from + 1) }, (_, i) => {
          const seed = from + i;
          const doc = randomModel(seed, { transitions: 16 });
          return { label: `random model ${seed}`, doc, script: randomScript(doc, seed * 31, 40) };
        }),
      );
    }
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
    const mod = shapesModule();
    const script: ScriptStep[] = [{ reset: true }];
    const expected: string[] = ["|s1|-"];
    for (let bits = 0; bits < 8; bits++) {
      const [a, b, c] = [(bits & 1) === 1, ((bits >> 1) & 1) === 1, ((bits >> 2) & 1) === 1];
      for (const [n, , truth] of SHAPES) {
        script.push({ guards: { a, b, c }, send: n });
        expected.push(`${truth(a, b, c) ? "hit" : ""}|s1|-`);
      }
    }
    const [results] = await runRust(tools, [{ ir: mod, script, autoReset: false }]);
    assert.deepEqual(results!.map((r) => `${r.calls.join(" ")}|${r.active.join(",")}|${r.error ?? "-"}`), expected);
  });
  it("keep the value of a final return (hand-built eventless step that ends in `return false`)", async () => {
    // eventless: count a microstep; in A with g set, go to B and return true; else return false (the tail).
    // Printed as `true`, settle would loop until the livelock limit.
    const mod: IrModule = {
      name: "tail",
      regions: 1,
      regionNames: ["root"],
      states: [{ id: "a", name: "A", region: 0, slot: 1, final: false }, { id: "b", name: "B", region: 0, slot: 2, final: false }],
      history: [],
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
    const script: ScriptStep[] = [{ reset: true }, { send: "e1" }, { guards: { g: true }, send: "e1" }, { send: "e1" }];
    const [results] = await runRust(tools, [{ ir: mod, options: { maxMicrosteps: 5 }, script, autoReset: false }]);
    assert.deepEqual(results!.map((r) => `${r.calls.join(" ")}|${r.active.join(",")}|${r.error ?? "-"}`), ["|a|-", "|a|-", "moved|b|-", "|b|-"]);
  });
});

describe("Rust backend: generated files", () => {
  it("build without warnings in a #![no_std] crate, as module files and through include!, editions 2021 and 2024", { skip }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
    try {
      writeRepoCrate(dir);
      await buildLib(tools.rustc!, dir, RUSTC_FLAGS, "2021", "repo");
      await buildLib(tools.rustc!, dir, RUSTC_FLAGS, "2024", "repo");
    } finally {
      removeTempDir(dir);
    }
  });

  it("pass clippy's default and pedantic lints", { skip: skipClippy }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
    try {
      writeRepoCrate(dir);
      await buildLib(tools.clippy!, dir, CLIPPY_FLAGS, "2021", "repo");
    } finally {
      removeTempDir(dir);
    }
  });

  it("are formatted as rustfmt formats them (repo models, random models, long conditions and patterns)", { skip: skipFmt }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
    try {
      const files = writeRepoCrate(dir).map((f) => join(dir, f));
      for (let seed = 1; seed <= 60; seed++) {
        const out = generateRust(ir(randomModel(seed, { transitions: 24, signals: seed % 3 })), { module: `random${seed}` });
        writeFileSync(join(dir, out.fileName), out.source);
        files.push(join(dir, out.fileName));
      }
      const wide = generateRust(wideModule(), { module: "wide" });
      writeFileSync(join(dir, wide.fileName), wide.source);
      files.push(join(dir, wide.fileName));
      assert.match(wide.source, /^ {8}if Handler::a_rather_long_guard_name_number_0\(&mut self\.handler\)\n {12}&& /m, "the wide module has broken lines");
      const r = spawnSync(tools.rustfmt!, ["--edition", "2021", "--check", ...files], { encoding: "utf8", maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, `rustfmt would change the generated code:\n${(r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 4000)}`);
    } finally {
      removeTempDir(dir);
    }
  });

  it("run the dimmer example from docs/backend-rust.md", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
    try {
      writeFileSync(join(dir, "dimmer.rs"), generateRust(ir(load(join(repoRoot, "examples/dimmer.ufsm")))).source);
      writeFileSync(join(dir, "main.rs"), docExample());
      execFileSync(tools.rustc!, ["--edition", "2021", ...RUSTC_FLAGS, "-A", "missing_docs", "main.rs", "-o", process.platform === "win32" ? "example.exe" : "example"], { cwd: dir, stdio: "pipe" });
      const out = execFileSync(join(dir, process.platform === "win32" ? "example.exe" : "example"), [], { encoding: "utf8" });
      assert.equal(out.trim(), "lamp at 30%");
    } finally {
      removeTempDir(dir);
    }
  });

  it("reject a handler that misses an action, and a value that is not an Event", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
    try {
      writeFileSync(join(dir, "dimmer.rs"), generateRust(ir(load(join(repoRoot, "examples/dimmer.ufsm")))).source);
      writeFileSync(
        join(dir, "main.rs"),
        "mod dimmer;\nuse dimmer::{Dimmer, Event, Handler};\nstruct Lamp;\nimpl Handler for Lamp {\n    fn lamp_off(&mut self) {}\n}\n" +
          "fn main() {\n    let mut m = Dimmer::new(Lamp);\n    let _ = m.process(5);\n    let _ = m.process(Event::eButton);\n}\n",
      );
      const r = spawnSync(tools.rustc!, ["--edition", "2021", "main.rs", "-o", "wrong"], { cwd: dir, encoding: "utf8" });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /error\[E0046\]: not all trait items implemented, missing: `lamp_10_percent`/);
      assert.match(r.stderr, /error\[E0308\]: mismatched types/);
    } finally {
      removeTempDir(dir);
    }
  });

  it("keep names as declared, raw identifiers for keywords", () => {
    const out = generateRust(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
    assert.equal(out.fileName, "dimmer.rs");
    assert.doesNotMatch(out.source, /^\s*(use|extern crate)\b|\bstd::|^[^/]*\bunsafe\b|^\s*#!\[|^\s*\/\/!/m, "no imports, std, unsafe or inner attributes");
    assert.match(out.source, /^pub struct Dimmer<H> \{$/m);
    assert.match(out.source, /^pub enum Event \{\n {4}\/\/\/ Event `eButton`\.\n {4}eButton,$/m);
    assert.match(out.source, /^pub trait Handler \{\n {4}\/\/\/ Action `lamp_off`\.\n {4}fn lamp_off\(&mut self\);$/m);
    assert.match(out.source, /^ {4}pub fn process\(&mut self, event: Event\) -> Result<\(\), Error> \{$/m);
    const keywords = generateRust(ir(keywordModel())).source;
    assert.match(keywords, /^ {4}r#type,$/m, "keywords become raw identifiers");
    assert.match(keywords, /^ {4}fn r#match\(&mut self\);$/m);
    assert.match(keywords, /^ {4}fn r#async\(&mut self\) -> bool;$/m);
    assert.match(keywords, /Handler::into\(&mut self\.handler\);/, "calls are fully qualified");
    const external = generateRust(ir(load(join(repoRoot, "tests/models/test_external_transitions.ufsm")))).source;
    assert.match(external, /^ {4}self_,$/m, "self cannot be raw: it gets an underscore");
    const custom = generateRust(ir(load(join(repoRoot, "examples/dimmer.ufsm"))), { className: "Lamp", module: "lamp_fsm" });
    assert.equal(custom.fileName, "lamp_fsm.rs");
    assert.match(custom.source, /^impl<H: Handler> Lamp<H> \{$/m);
    assert.equal(rustModuleName("New model"), "new_model");
    assert.equal(rustModuleName("myMachine"), "my_machine");
  });

  it("generate only what the model uses", () => {
    const plain = generateRust(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm")))).source;
    assert.doesNotMatch(plain, /self\.queue|self\.hist|terminated|settle/);
    const signals = generateRust(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), { signalQueue: 5 }).source;
    assert.match(signals, /^ {4}queue: \[u8; 5\],$/m);
    assert.match(signals, /if self\.queue_len == 5 \{\n\s+return Err\(Error::QueueOverflow\);/, "the last free slot can be used (B3)");
    const noCheck = generateRust(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { maxMicrosteps: 0 }).source;
    assert.doesNotMatch(noCheck, /self\.steps|fn microstep/);
  });

  it("are the same for the same input", () => {
    const doc = load(join(repoRoot, "tests/models/canvas.ufsm"));
    assert.deepEqual(generateRust(ir(doc)), generateRust(ir(doc)));
  });

  it("reject names that cannot be used in Rust", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.declarations.actions[0]!.name = "self";
    doc.declarations.actions[1]!.name = "self_";
    assert.throws(() => generateRust(ir(doc)), (e: unknown) => e instanceof CodegenError && /handler method 'self_' becomes 'self_', like 'self'/.test(e.message));
    const ok = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    for (const name of ["Event", "Error", "Handler", "Result", "match", "9x"]) assert.throws(() => generateRust(ir(ok), { className: name }), /not a usable identifier/, name);
    assert.throws(() => generateRust(ir(ok), { module: "a/b" }), /not a plain file name/);
  });

  it("read targets.rust", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.targets = { rust: { className: "G", signalQueue: 8, maxMicrosteps: 50, colour: "red", module: 3 } };
    const { options, problems } = rustOptionsFromTargets(doc);
    assert.deepEqual(options, { className: "G", signalQueue: 8, maxMicrosteps: 50 });
    assert.deepEqual(problems, ["targets.rust.colour: unknown option (ignored)", "targets.rust.module: expected a string"]);
    const files = generateFiles(doc, "rust", { className: "Other" });
    assert.equal(files.files[0]!.name, "test_guard1.rs");
    assert.match(files.files[0]!.text, /^pub struct Other<H> \{$/m);
  });
});

const g = (n: string): Expr => ({ op: "guard", guard: n });

/** Event name, condition, and what it should be for guard values a, b, c. */
const SHAPES: [string, Expr, (a: boolean, b: boolean, c: boolean) => boolean][] = [
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

function shapesModule(): IrModule {
  return {
    name: "shapes",
    regions: 1,
    regionNames: ["root"],
    states: [{ id: "s1", name: "A", region: 0, slot: 1, final: false }],
    history: [],
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

/** Long names everywhere: conditions, else-if chains and match arms too wide for one line. */
function wideModule(): IrModule {
  const guards = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, name: `a_rather_long_guard_name_number_${i}` }));
  const events = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, name: `an_event_with_a_long_descriptive_name_${i}` }));
  const G = (i: number): Expr => g(`g${i}`);
  const long: Expr = {
    op: "and",
    exprs: [G(0), { op: "or", exprs: [G(1), G(2), { op: "and", exprs: [G(3), G(4)] }] }, { op: "not", expr: { op: "or", exprs: [G(5), G(6), G(7)] } }],
  };
  const elseIf: Expr = { op: "or", exprs: [G(5), G(6), G(7), G(0), G(1)] };
  return {
    name: "wide",
    regions: 1,
    regionNames: ["root"],
    states: [{ id: "s1", name: "A", region: 0, slot: 1, final: false }],
    history: [],
    events,
    signals: [],
    actions: [{ id: "act1", name: "hit" }, { id: "act2", name: "other" }],
    guards,
    start: [{ op: "set", region: 0, slot: 1 }],
    onEvent: { e0: "step_an_event_with_a_long_descriptive_name_0" },
    onSignal: {},
    eventless: undefined,
    functions: [
      {
        name: "step_an_event_with_a_long_descriptive_name_0",
        returns: "bool",
        flags: [],
        body: [
          { op: "if", cond: long, then: [{ op: "call", action: "act1" }], else: [{ op: "if", cond: elseIf, then: [{ op: "call", action: "act2" }] }] },
          { op: "return", value: false },
        ],
      },
    ],
  };
}

/** test_guard1 with Rust keywords and blanket-impl method names as declaration names. */
function keywordModel(): UfsmDocument {
  const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
  const names: Record<string, string> = { e1: "type", e2: "self", eA: "match", xA: "into", eB: "clone", xB: "Self", g1: "async", g2: "gen" };
  const d = doc.declarations;
  for (const x of [...d.events, ...d.signals, ...d.actions, ...d.guards]) x.name = names[x.name] ?? x.name;
  return doc;
}
