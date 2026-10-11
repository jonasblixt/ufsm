// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CodegenError, generateFiles, loadModel, modelIr, type UfsmDocument } from "../src";
import {
  flatten,
  generateC,
  generateCpp,
  generateGo,
  generatePython,
  generateRust,
  generateTypeScript,
  lowerToIr,
} from "../src/pipeline";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (f: string): UfsmDocument => loadModel(readFileSync(join(repoRoot, f), "utf8")).doc;

describe("generateFiles", () => {
  it("gives what the backends give, with the options and the settings from targets", () => {
    const doc = load("examples/dimmer.ufsm");
    doc.options = { maxMicrosteps: 7 };
    doc.targets = {
      c: { prefix: "dim_" },
      python: { className: "Dim" },
      rust: { module: "dim" },
      go: { package: "dim" },
      cpp: { namespace: "dim" },
    };
    const ir = lowerToIr(flatten(doc));
    const c = generateC(ir, { prefix: "dim_", maxMicrosteps: 7 });
    assert.deepEqual(generateFiles(doc, "c").files, [
      { name: c.headerName, text: c.header },
      { name: c.sourceName, text: c.source },
    ]);
    const py = generatePython(ir, { className: "Dim", maxMicrosteps: 7 });
    assert.deepEqual(generateFiles(doc, "python", {}, ir).files, [{ name: py.fileName, text: py.source }]);
    const ts = generateTypeScript(ir, { maxMicrosteps: 7 });
    assert.deepEqual(generateFiles(doc, "ts").files, [{ name: ts.fileName, text: ts.source }]);
    const rs = generateRust(ir, { module: "dim", maxMicrosteps: 7 });
    assert.deepEqual(generateFiles(doc, "rust").files, [{ name: "dim.rs", text: rs.source }]);
    const go = generateGo(ir, { package: "dim", maxMicrosteps: 7 });
    assert.deepEqual(generateFiles(doc, "go").files, [{ name: "dim.go", text: go.source }]);
    const cpp = generateCpp(ir, { namespace: "dim", maxMicrosteps: 7 });
    assert.deepEqual(generateFiles(doc, "cpp").files, [{ name: "dim.hpp", text: cpp.source }]);
  });

  it("resolves options, then targets (never behaviour options there), then overrides", () => {
    const doc = load("tests/models/test_chained_signals.ufsm");
    const ir = lowerToIr(flatten(doc));
    const text = (o: { signalQueue?: number; maxMicrosteps?: number }): string => generateTypeScript(ir, o).source;
    doc.options = { signalQueue: 5, maxMicrosteps: 9 };
    doc.targets = { ts: { signalQueue: 3 } };
    const fromModel = generateFiles(doc, "ts", {}, ir);
    assert.equal(
      fromModel.files[0]!.text,
      text({ signalQueue: 5, maxMicrosteps: 9 }),
      "the model's options, not the target's",
    );
    assert.deepEqual(fromModel.problems, [
      "targets.ts.signalQueue: changes behaviour, so it is set in options for every target (ignored)",
    ]);
    assert.equal(
      generateFiles(doc, "ts", { signalQueue: 2 }, ir).files[0]!.text,
      text({ signalQueue: 2, maxMicrosteps: 9 }),
      "a flag overrides the model",
    );
    assert.notEqual(text({ signalQueue: 5 }), text({}), "the queue size shows in the code");
  });

  it("applies overrides only where they belong and reports ignored options", () => {
    const doc = load("examples/dimmer.ufsm");
    doc.targets = { c: { bogus: 1 } };
    const c = generateFiles(doc, "c", { prefix: "x_", className: "Ignored", signalQueue: 3 });
    assert.equal(c.files[0]!.name, "x.h");
    assert.deepEqual(c.problems, ["targets.c.bogus: unknown option (ignored)"]);
    const ts = generateFiles(doc, "ts", { prefix: "ignored_", className: "Lamp", maxMicrosteps: 0 });
    assert.match(ts.files[0]!.text, /export class Lamp \{/);
    assert.deepEqual(ts.problems, []);
    const rs = generateFiles(doc, "rust", { prefix: "ignored_", className: "Lamp", signalQueue: 3 });
    assert.match(rs.files[0]!.text, /^pub struct Lamp<H> \{$/m);
    const go = generateFiles(doc, "go", { prefix: "ignored_", className: "Lamp", signalQueue: 3 });
    assert.match(go.files[0]!.text, /^type Lamp struct \{$/m);
    const cpp = generateFiles(doc, "cpp", { prefix: "ignored_", className: "Lamp", signalQueue: 3 });
    assert.match(cpp.files[0]!.text, /^class Lamp \{$/m);
  });

  it("refuses a model with errors", () => {
    const doc = load("examples/dimmer.ufsm");
    doc.machine.transitions.push({ id: doc.machine.transitions[0]!.id, from: "nowhere", to: "nowhere" });
    assert.throws(
      () => modelIr(doc),
      (e: unknown) => e instanceof CodegenError && /the model has \d+ errors?/.test(e.message),
    );
    assert.throws(() => generateFiles(doc, "python"), CodegenError);
  });
});
