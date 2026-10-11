// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatFailure, loadModel, parseTrace, runTrace, type MachineFactory, type UfsmDocument } from "../src";
import { flatten } from "../src/pipeline";
import { FlatRunner } from "../src/verify/flat-run";
import { checkJoinAgreement, compareWithInterpreter } from "./harness";
import { randomModel } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
const modelFiles = ["examples", "tests/models"].flatMap((d) =>
  existsSync(join(repoRoot, d))
    ? readdirSync(join(repoRoot, d))
        .filter((f) => f.endsWith(".ufsm"))
        .map((f) => join(repoRoot, d, f))
    : [],
);

const flatFactory: MachineFactory = (doc, host, options) => new FlatRunner(flatten(doc), host, options);

describe("flat model: conformance traces", () => {
  for (const f of existsSync(traceDir)
    ? readdirSync(traceDir)
        .filter((x) => x.endsWith(".json"))
        .sort()
    : []) {
    it(f, () => {
      const path = join(traceDir, f);
      const trace = parseTrace(readFileSync(path, "utf8"));
      const doc = loadModel(readFileSync(resolve(dirname(path), trace.model), "utf8")).doc;
      const failures = runTrace(doc, trace, {}, flatFactory);
      assert.equal(failures.length, 0, failures.map((x) => formatFailure(trace, x)).join("\n"));
    });
  }
});

describe("joins", () => {
  it("fire only when every source has the join as its first enabled transition", () => checkJoinAgreement(flatFactory));
});

const compare = (doc: UfsmDocument, seed: number, steps: number, options: { signalQueue?: number } = {}): void =>
  compareWithInterpreter(flatFactory, doc, seed, steps, options);

describe("flat model matches the interpreter", () => {
  for (const f of modelFiles) {
    it(`on random events: ${f.slice(repoRoot.length + 1)}`, () => {
      const doc = loadModel(readFileSync(f, "utf8")).doc;
      for (let seed = 1; seed <= 20; seed++) compare(doc, seed, 60);
    });
  }

  it("on 1500 random models", () => {
    for (let seed = 1; seed <= 1500; seed++) compare(randomModel(seed, { transitions: 16 }), seed * 31, 40);
  });

  it("on random models with a small signal queue", () => {
    for (let seed = 1; seed <= 300; seed++)
      compare(randomModel(seed, { signals: 2, transitions: 18 }), seed, 30, { signalQueue: 2 });
  });
});
