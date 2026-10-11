// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodegenError, generateFiles, type UfsmDocument } from "../src";
import {
  flatten,
  generateRust,
  lowerToIr,
  rustModuleName,
  rustOptionsFromTargets,
  type Expr,
  type IrModule,
} from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { buildLib, CLIPPY_FLAGS, findRust, RUSTC_FLAGS, runRust } from "./rust-harness";
import { randomModel } from "./random-model";
import { describeBackend, keywordModel, load, modelFiles, repoRoot } from "./backend-contract";

// The Rust tests skip without rustc; UFSM_REQUIRE_RUST=1 (CI) turns that into a failure, and also requires
// clippy-driver and rustfmt (both in rustup's default profile).
const tools = findRust();
if (process.env["UFSM_REQUIRE_RUST"]) {
  if (!tools.rustc) throw new Error(`UFSM_REQUIRE_RUST is set but ${tools.problem}`);
  if (!tools.clippy)
    throw new Error(
      "UFSM_REQUIRE_RUST is set but clippy-driver was not found (rustup component add clippy, or set CLIPPY_DRIVER)",
    );
  if (!tools.rustfmt)
    throw new Error(
      "UFSM_REQUIRE_RUST is set but rustfmt was not found (rustup component add rustfmt, or set RUSTFMT)",
    );
}
const skip = tools.rustc ? false : (tools.problem ?? "no rustc");
const skipClippy = skip || (tools.clippy ? false : "clippy-driver not found");
const skipFmt = skip || (tools.rustfmt ? false : "rustfmt not found");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));
const baseName = (f: string): string => f.replace(/^.*[\\/]/, "").replace(/\.ufsm$/, "");

/** Every repo model as a module of one `#![no_std]` library crate; one of them through `include!`. */
function writeRepoCrate(dir: string): string[] {
  const mods: string[] = [];
  const lib = ["//! Every repository model.", "#![no_std]", "#![forbid(unsafe_code)]", ""];
  const docs: [string, UfsmDocument][] = modelFiles.map((f) => [
    `${rustModuleName(baseName(f))}${f.includes("examples") ? "_example" : ""}`,
    load(f),
  ]);
  docs.push(["keywords", keywordModel()]);
  for (const [name, doc] of docs) {
    const out = generateRust(ir(doc), { module: name });
    writeFileSync(join(dir, out.fileName), out.source);
    mods.push(out.fileName);
    if (mods.length === 1) lib.push("/// Included.", `pub mod ${name} {`, `    include!("${out.fileName}");`, "}");
    else lib.push("/// A machine.", `pub mod ${name};`);
    // and with debugInfo and trace
    const debug = generateRust(lowerToIr(flatten(doc), { trace: true }), { module: `${name}_debug`, debugInfo: true });
    writeFileSync(join(dir, debug.fileName), debug.source);
    mods.push(debug.fileName);
    lib.push("/// A machine with debugInfo and trace.", `pub mod ${name}_debug;`);
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

describeBackend({
  name: "Rust",
  target: "rust",
  randomEnv: "UFSM_RUST_RANDOM",
  skip,
  run: (units) => runRust(tools, units),
  timerApi: /fn timer_start\(&mut self/,
});

describe("Rust backend: generated files", () => {
  it(
    "build without warnings in a #![no_std] crate, as module files and through include!, editions 2021 and 2024",
    { skip },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
      try {
        writeRepoCrate(dir);
        await buildLib(tools.rustc!, dir, RUSTC_FLAGS, "2021", "repo");
        await buildLib(tools.rustc!, dir, RUSTC_FLAGS, "2024", "repo");
      } finally {
        removeTempDir(dir);
      }
    },
  );

  it("pass clippy's default and pedantic lints", { skip: skipClippy }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
    try {
      writeRepoCrate(dir);
      await buildLib(tools.clippy!, dir, CLIPPY_FLAGS, "2021", "repo");
    } finally {
      removeTempDir(dir);
    }
  });

  it(
    "are formatted as rustfmt formats them (repo models, random models, long conditions and patterns)",
    { skip: skipFmt },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
      try {
        const files = writeRepoCrate(dir).map((f) => join(dir, f));
        for (let seed = 1; seed <= 60; seed++) {
          const out = generateRust(ir(randomModel(seed, { transitions: 24, signals: seed % 3 })), {
            module: `random${seed}`,
          });
          writeFileSync(join(dir, out.fileName), out.source);
          files.push(join(dir, out.fileName));
        }
        const wide = generateRust(wideModule(), { module: "wide" });
        writeFileSync(join(dir, wide.fileName), wide.source);
        files.push(join(dir, wide.fileName));
        assert.match(
          wide.source,
          /^ {8}if Handler::a_rather_long_guard_name_number_0\(&mut self\.handler\)\n {12}&& /m,
          "the wide module has broken lines",
        );
        const r = spawnSync(tools.rustfmt!, ["--edition", "2021", "--check", ...files], {
          encoding: "utf8",
          maxBuffer: 1 << 26,
        });
        assert.equal(
          r.status,
          0,
          `rustfmt would change the generated code:\n${(r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 4000)}`,
        );
      } finally {
        removeTempDir(dir);
      }
    },
  );

  it("run the dimmer example from docs/backend-rust.md", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
    try {
      writeFileSync(join(dir, "dimmer.rs"), generateRust(ir(load(join(repoRoot, "examples/dimmer.ufsm")))).source);
      writeFileSync(join(dir, "main.rs"), docExample());
      execFileSync(
        tools.rustc!,
        [
          "--edition",
          "2021",
          ...RUSTC_FLAGS,
          "-A",
          "missing_docs",
          "main.rs",
          "-o",
          process.platform === "win32" ? "example.exe" : "example",
        ],
        { cwd: dir, stdio: "pipe" },
      );
      const out = execFileSync(join(dir, process.platform === "win32" ? "example.exe" : "example"), [], {
        encoding: "utf8",
      });
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
      const r = spawnSync(tools.rustc!, ["--edition", "2021", "main.rs", "-o", "wrong"], {
        cwd: dir,
        encoding: "utf8",
      });
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
    assert.doesNotMatch(
      out.source,
      /^\s*(use|extern crate)\b|\bstd::|^[^/]*\bunsafe\b|^\s*#!\[|^\s*\/\/!/m,
      "no imports, std, unsafe or inner attributes",
    );
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
    const custom = generateRust(ir(load(join(repoRoot, "examples/dimmer.ufsm"))), {
      className: "Lamp",
      module: "lamp_fsm",
    });
    assert.equal(custom.fileName, "lamp_fsm.rs");
    assert.match(custom.source, /^impl<H: Handler> Lamp<H> \{$/m);
    assert.equal(rustModuleName("New model"), "new_model");
    assert.equal(rustModuleName("myMachine"), "my_machine");
  });

  it("generate only what the model uses", () => {
    const plain = generateRust(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm")))).source;
    assert.doesNotMatch(plain, /self\.queue|self\.hist|terminated|settle/);
    const signals = generateRust(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), {
      signalQueue: 5,
    }).source;
    assert.match(signals, /^ {4}queue: \[u8; 5\],$/m);
    assert.match(
      signals,
      /if self\.queue_len == 5 \{\n\s+return Err\(Error::QueueOverflow\);/,
      "the last free slot can be used (B3)",
    );
    const one = generateRust(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), {
      signalQueue: 1,
    }).source;
    assert.doesNotMatch(one, /queue_head|% 1\b/, "a queue of one has no head to move (clippy denies `% 1`)");
    const noCheck = generateRust(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), {
      maxMicrosteps: 0,
    }).source;
    assert.doesNotMatch(noCheck, /self\.steps|fn microstep/);
  });

  it("emit the timer API only for a model with timers", () => {
    const none = generateRust(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { debugInfo: true }).source;
    assert.doesNotMatch(none, /timer/i);
    const src = generateRust(ir(load(join(repoRoot, "tests/models/test_timers.ufsm"))), { debugInfo: true }).source;
    assert.match(src, /^pub enum Timer \{$/m);
    assert.match(src, /^ {4}pub const COUNT: usize = 4;$/m);
    assert.match(src, /^ {4}pub fn event\(self\) -> Event \{$/m);
    assert.match(src, /^ {12}Timer::poll => Event::eTick,$/m);
    assert.match(src, /^ {4}fn timer_start\(&mut self, timer: Timer, ms: u32, periodic: bool\);$/m);
    assert.match(src, /^ {4}fn timer_stop\(&mut self, timer: Timer\);$/m);
    assert.match(
      src,
      /^impl Timer \{\n {4}\/\/\/ The timer's name as in the model\.$/m,
      "name() and from_index() with debugInfo",
    );
    assert.match(
      src,
      /Handler::timer_start\(&mut self\.handler, Timer::long, 3_600_000, false\);/,
      "digits grouped for clippy",
    );
  });

  it("reject names that cannot be used in Rust", () => {
    const timers = load(join(repoRoot, "tests/models/test_timers.ufsm"));
    timers.declarations.actions[0]!.name = "timer_start";
    assert.throws(
      () => generateRust(ir(timers)),
      /handler method 'timer_start' becomes 'timer_start', like 'timer_start' \(a timer function\)/,
    );
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.declarations.actions[0]!.name = "self";
    doc.declarations.actions[1]!.name = "self_";
    assert.throws(
      () => generateRust(ir(doc)),
      (e: unknown) =>
        e instanceof CodegenError && /handler method 'self_' becomes 'self_', like 'self'/.test(e.message),
    );
    const ok = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    for (const name of ["Event", "Error", "Handler", "Result", "match", "9x"])
      assert.throws(() => generateRust(ir(ok), { className: name }), /not a usable identifier/, name);
    assert.throws(() => generateRust(ir(ok), { module: "a/b" }), /not a plain file name/);
  });

  it("read targets.rust: its own settings, never behaviour options", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.targets = { rust: { className: "G", signalQueue: 8, colour: "red", module: 3 } };
    const { options, problems } = rustOptionsFromTargets(doc);
    assert.deepEqual(options, { className: "G" }, "behaviour options are not read from targets");
    assert.deepEqual(problems, [
      "targets.rust.signalQueue: changes behaviour, so it is set in options for every target (ignored)",
      "targets.rust.colour: unknown option (ignored)",
      "targets.rust.module: expected a string",
    ]);
    const files = generateFiles(doc, "rust", { className: "Other" });
    assert.equal(files.files[0]!.name, "test_guard1.rs");
    assert.match(files.files[0]!.text, /^pub struct Other<H> \{$/m);
  });
});

const g = (n: string): Expr => ({ op: "guard", guard: n });

/** Long names everywhere: conditions, else-if chains and match arms too wide for one line. */
function wideModule(): IrModule {
  const guards = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, name: `a_rather_long_guard_name_number_${i}` }));
  const events = Array.from({ length: 12 }, (_, i) => ({
    id: `e${i}`,
    name: `an_event_with_a_long_descriptive_name_${i}`,
  }));
  const G = (i: number): Expr => g(`g${i}`);
  const long: Expr = {
    op: "and",
    exprs: [
      G(0),
      { op: "or", exprs: [G(1), G(2), { op: "and", exprs: [G(3), G(4)] }] },
      { op: "not", expr: { op: "or", exprs: [G(5), G(6), G(7)] } },
    ],
  };
  const elseIf: Expr = { op: "or", exprs: [G(5), G(6), G(7), G(0), G(1)] };
  return {
    name: "wide",
    regions: 1,
    regionNames: ["root"],
    states: [{ id: "s1", name: "A", ident: "A", label: "A", region: 0, slot: 1, final: false }],
    history: [],
    transitions: [],
    trace: false,
    fingerprint: 0,
    timers: [],
    events,
    signals: [],
    actions: [
      { id: "act1", name: "hit" },
      { id: "act2", name: "other" },
    ],
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
          {
            op: "if",
            cond: long,
            then: [{ op: "call", action: "act1" }],
            else: [{ op: "if", cond: elseIf, then: [{ op: "call", action: "act2" }] }],
          },
          { op: "return", value: false },
        ],
      },
    ],
  };
}
