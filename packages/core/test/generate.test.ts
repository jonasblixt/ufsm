// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodegenError,
  flatten,
  generateC,
  generateFiles,
  generatePython,
  generateRust,
  generateTypeScript,
  loadModel,
  lowerToIr,
  modelIr,
  type UfsmDocument,
} from "../src/index";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (f: string): UfsmDocument => loadModel(readFileSync(join(repoRoot, f), "utf8")).doc;

describe("generateFiles", () => {
  it("gives what the backends give, with the options from targets", () => {
    const doc = load("examples/dimmer.ufsm");
    doc.targets = { c: { prefix: "dim_" }, python: { className: "Dim" }, ts: { maxMicrosteps: 7 }, rust: { module: "dim" } };
    const ir = lowerToIr(flatten(doc));
    const c = generateC(ir, { prefix: "dim_" });
    assert.deepEqual(generateFiles(doc, "c").files, [{ name: c.headerName, text: c.header }, { name: c.sourceName, text: c.source }]);
    const py = generatePython(ir, { className: "Dim" });
    assert.deepEqual(generateFiles(doc, "python", {}, ir).files, [{ name: py.fileName, text: py.source }]);
    const ts = generateTypeScript(ir, { maxMicrosteps: 7 });
    assert.deepEqual(generateFiles(doc, "ts").files, [{ name: ts.fileName, text: ts.source }]);
    const rs = generateRust(ir, { module: "dim" });
    assert.deepEqual(generateFiles(doc, "rust").files, [{ name: "dim.rs", text: rs.source }]);
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
  });

  it("refuses a model with errors", () => {
    const doc = load("examples/dimmer.ufsm");
    doc.machine.transitions.push({ id: doc.machine.transitions[0]!.id, from: "nowhere", to: "nowhere" });
    assert.throws(() => modelIr(doc), (e: unknown) => e instanceof CodegenError && /the model has \d+ errors?/.test(e.message));
    assert.throws(() => generateFiles(doc, "python"), CodegenError);
  });
});
