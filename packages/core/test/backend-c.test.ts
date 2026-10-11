// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodegenError, type UfsmDocument } from "../src";
import { cOptionsFromTargets, flatten, generateC, lowerToIr } from "../src/pipeline";
import { findCompiler, removeTempDir, runC, strictFlags } from "./c-harness";
import { describeBackend, load, modelFiles, repoRoot } from "./backend-contract";

// The C tests skip without a working compiler; UFSM_REQUIRE_CC=1 (CI) turns that into a failure.
const { cc, problem } = findCompiler();
if (!cc && process.env["UFSM_REQUIRE_CC"]) throw new Error(`UFSM_REQUIRE_CC is set but ${problem}`);
const skip = cc ? false : (problem ?? "no C compiler");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));

describeBackend({ name: "C", target: "c", randomEnv: "UFSM_C_RANDOM", skip, run: (units) => runC(cc!, units), timerApi: /_timer_start\(void \*user/ });

describe("C backend: generated files", () => {
  it("compile without warnings as freestanding C99, also with debugInfo and trace", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-c-"));
    try {
      const sources = modelFiles.flatMap((f) => {
        const doc = load(f);
        const name = f.replace(/^.*[\\/]/, "").replace(/\.ufsm$/, "");
        return [false, true].map((debug) => {
          const file = debug ? `${name}_debug` : name;
          const out = generateC(lowerToIr(flatten(doc), { trace: debug }), { file, prefix: `${file}_`, debugInfo: debug });
          writeFileSync(join(dir, out.headerName), out.header);
          writeFileSync(join(dir, out.sourceName), out.source);
          return out.sourceName;
        });
      });
      for (const s of sources) execFileSync(cc!, [...strictFlags(cc!), "-ffreestanding", "-c", s, "-o", s.replace(/\.c$/, ".o")], { cwd: dir, stdio: "pipe" });
    } finally {
      removeTempDir(dir);
    }
  });

  it("include only stdint.h and stdbool.h, also with debugInfo and trace", () => {
    for (const f of modelFiles) {
      const out = generateC(lowerToIr(flatten(load(f)), { trace: true }), { debugInfo: true });
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

  it("emit the timer API only for a model with timers", () => {
    const none = generateC(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { debugInfo: true });
    assert.doesNotMatch(none.header + none.source, /timer/);
    const out = generateC(ir(load(join(repoRoot, "tests/models/test_timers.ufsm"))), { debugInfo: true });
    assert.match(out.header, /^ {4}TEST_TIMERS_TIMER_travel = 0, \/\* after 2000 ms -> eTimeout \*\/$/m);
    assert.match(out.header, /^#define TEST_TIMERS_TIMER_COUNT 4$/m);
    assert.match(out.header, /^void test_timers_timer_start\(void \*user, enum test_timers_timer timer, uint32_t ms, bool periodic\);$/m);
    assert.match(out.header, /^void test_timers_timer_stop\(void \*user, enum test_timers_timer timer\);$/m);
    assert.match(out.header, /^enum test_timers_event test_timers_timer_event\(enum test_timers_timer timer\);$/m);
    assert.match(out.header, /^const char \*test_timers_timer_name\(uint16_t timer\);$/m);
    assert.match(out.source, /test_timers_timer_start\(m->user, TEST_TIMERS_TIMER_poll, 100u, true\);/);
    assert.match(out.source, /test_timers_timer_start\(m->user, TEST_TIMERS_TIMER_long, 3600000u, false\);/);
  });

  it("reject timer names that clash in C", () => {
    const doc = load(join(repoRoot, "tests/models/test_timers.ufsm"));
    doc.declarations.actions[0]!.name = "timer_start";
    assert.throws(() => generateC(ir(doc)), /action 'timer_start' becomes 'test_timers_timer_start', which is the timer start function/);
    doc.declarations.actions[0]!.name = "eIdle";
    doc.declarations.events[0]!.name = "TIMER_poll";
    assert.throws(() => generateC(ir(doc)), /timer 'poll' becomes 'TEST_TIMERS_TIMER_poll', like event 'TIMER_poll'/);
  });

  it("keep the queue bound exact: the last free slot can be used (B3)", () => {
    const src = generateC(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), { signalQueue: 3 }).source;
    assert.match(src, /if \(m->queue_len == 3u\) \{\n\s+return TEST_CHAINED_SIGNALS_ERR_QUEUE_FULL;/);
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
