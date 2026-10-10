// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodegenError,
  cOptionsFromTargets,
  flatten,
  formatFailure,
  generateC,
  loadModel,
  lowerToIr,
  parseTrace,
  runTrace,
  type UfsmDocument,
  traceOptions,
} from "../src/index";
import { DIFF_QUEUE, assertMatchesInterpreter, expressionModel, joinAgreementModel, randomScript, replayResults, type BackendDiff } from "./harness";
import { findCompiler, removeTempDir, runC, strictFlags, type CUnit } from "./c-harness";
import { randomModel } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
const modelFiles = ["examples", "tests/models"].flatMap((d) =>
  existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
);
// The C tests skip without a working compiler; UFSM_REQUIRE_CC=1 (CI) turns that into a failure.
const { cc, problem } = findCompiler();
if (!cc && process.env["UFSM_REQUIRE_CC"]) throw new Error(`UFSM_REQUIRE_CC is set but ${problem}`);
const skip = cc ? false : (problem ?? "no C compiler");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));
const load = (path: string): UfsmDocument => loadModel(readFileSync(path, "utf8")).doc;

type Diff = BackendDiff;
const MAX_STEPS = 300;

async function compareAll(diffs: Diff[]): Promise<void> {
  const units: CUnit[] = diffs.map((d) => ({
    ir: ir(d.doc),
    options: { maxMicrosteps: MAX_STEPS, signalQueue: d.signalQueue ?? DIFF_QUEUE },
    script: d.script,
    autoReset: true,
  }));
  assertMatchesInterpreter(diffs, await runC(cc!, units), MAX_STEPS, "C");
}

describe("C backend: conformance traces", { skip }, () => {
  const files = existsSync(traceDir) ? readdirSync(traceDir).filter((x) => x.endsWith(".json")).sort() : [];
  it(`${files.length} traces`, async () => {
    const traces = files.map((f) => {
      const path = join(traceDir, f);
      const trace = parseTrace(readFileSync(path, "utf8"));
      return { f, trace, doc: load(resolve(dirname(path), trace.model)) };
    });
    const results = await runC(
      cc!,
      traces.map(({ trace, doc }) => ({ ir: ir(doc), options: traceOptions(doc, trace), script: trace.steps, autoReset: false })),
    );
    const failures = traces.flatMap(({ f, trace, doc }, k) => runTrace(doc, trace, {}, replayResults(results[k]!, "C driver")).map((x) => `${f}: ${formatFailure(trace, x)}`));
    assert.equal(failures.length, 0, failures.join("\n"));
  });
});

describe("C backend matches the interpreter", { skip }, () => {
  it("on joins whose sources agree or disagree", async () => {
    await compareAll([false, true].map((agree) => ({ label: `joins ${agree}`, doc: joinAgreementModel(agree), script: [{ reset: true }, { send: "e1" }, { send: "e1" }] })));
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
  // UFSM_C_RANDOM=<n> runs more random models (default 300), e.g. as a longer fuzz run before a release.
  const count = Number(process.env["UFSM_C_RANDOM"] ?? 300);
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
});

describe("C backend: generated files", () => {
  it("compile without warnings as freestanding C99", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-c-"));
    try {
      const sources = modelFiles.map((f) => {
        const doc = load(f);
        const name = f.replace(/^.*[\\/]/, "").replace(/\.ufsm$/, "");
        const out = generateC(ir(doc), { file: name, prefix: `${name}_` });
        writeFileSync(join(dir, out.headerName), out.header);
        writeFileSync(join(dir, out.sourceName), out.source);
        return out.sourceName;
      });
      for (const s of sources) execFileSync(cc!, [...strictFlags(cc!), "-ffreestanding", "-c", s, "-o", s.replace(/\.c$/, ".o")], { cwd: dir, stdio: "pipe" });
    } finally {
      removeTempDir(dir);
    }
  });

  it("include only stdint.h and stdbool.h", () => {
    for (const f of modelFiles) {
      const out = generateC(ir(load(f)));
      const includes = `${out.header}${out.source}`.match(/#include\s+\S+/g) ?? [];
      for (const inc of includes) assert.match(inc, /<stdint\.h>|<stdbool\.h>|"[^"]+\.h"/, `${f}: ${inc}`);
    }
  });

  it("prefix every public name and default the prefix to the model name", () => {
    const doc = load(join(repoRoot, "examples/dimmer.ufsm"));
    const out = generateC(ir(doc));
    assert.equal(out.headerName, "dimmer.h");
    assert.equal(out.sourceName, "dimmer.c");
    assert.match(out.header, /^struct dimmer_machine \{$/m);
    assert.match(out.header, /^int dimmer_process\(struct dimmer_machine \*m, enum dimmer_event event\);$/m);
    assert.match(out.header, /^ {4}DIMMER_eButton = 0,$/m);
    assert.match(out.header, /^void dimmer_lamp_off\(void \*user\);$/m);
    const custom = generateC(ir(doc), { prefix: "dim_", file: "lamp" });
    assert.equal(custom.headerName, "lamp.h");
    assert.match(custom.header, /^int dim_init\(struct dim_machine \*m, void \*user\);$/m);
    assert.match(custom.header, /#ifndef UFSM_LAMP_H/);
    assert.match(custom.source, /#include "lamp.h"/);
  });

  it("generate only what the model uses", () => {
    const plain = generateC(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm")))).header;
    assert.doesNotMatch(plain, /queue\[|queue_len|hist\[|terminated;/);
    const signals = generateC(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), { signalQueue: 5 }).header;
    assert.match(signals, /uint8_t queue\[5\];/);
    const noCheck = generateC(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { maxMicrosteps: 0 });
    assert.doesNotMatch(noCheck.header + noCheck.source, /steps;|->steps/);
  });

  it("keep the queue bound exact: the last free slot can be used (B3)", () => {
    const src = generateC(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), { signalQueue: 3 }).source;
    assert.match(src, /if \(m->queue_len == 3u\) \{\n\s+return TEST_CHAINED_SIGNALS_ERR_QUEUE_FULL;/);
  });

  it("are the same for the same input", () => {
    const doc = load(join(repoRoot, "tests/models/canvas.ufsm"));
    assert.deepEqual(generateC(ir(doc)), generateC(ir(doc)));
  });

  it("reject names that clash in C", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.declarations.actions[0]!.name = "init";
    assert.throws(() => generateC(ir(doc)), (e: unknown) => e instanceof CodegenError && /action 'init' becomes 'test_guard1_init'/.test(e.message));
    doc.declarations.actions[0]!.name = "while";
    assert.throws(() => generateC(ir(doc), { prefix: "" }), /C keyword/);
    assert.throws(() => generateC(ir(doc), { prefix: "9x" }), /not a C identifier/);
  });

  it("read targets.c: its own settings, never behaviour options", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.targets = { c: { prefix: "g1_", signalQueue: 8, colour: "red", file: 3 } };
    const { options, problems } = cOptionsFromTargets(doc);
    assert.deepEqual(options, { prefix: "g1_" }, "behaviour options are not read from targets");
    assert.deepEqual(problems, [
      "targets.c.signalQueue: changes behaviour, so it is set in options for every target (ignored)",
      "targets.c.colour: unknown option (ignored)",
      "targets.c.file: expected a string",
    ]);
  });
});
