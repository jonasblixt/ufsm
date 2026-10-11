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
  cppName,
  cppNamespace,
  cppOptionsFromTargets,
  flatten,
  generateCpp,
  lowerToIr,
  type IrModule,
} from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { compileCxx, cxxStrictFlags, findCxx, runCpp } from "./cpp-harness";
import { randomModel } from "./random-model";
import { describeBackend, keywordModel, load, modelFiles, repoRoot } from "./backend-contract";

// The C++ tests skip without a C++ compiler; UFSM_REQUIRE_CXX=1 (CI) turns that into a failure.
const { cxx, problem } = findCxx();
if (process.env["UFSM_REQUIRE_CXX"] && !cxx) throw new Error(`UFSM_REQUIRE_CXX is set but ${problem}`);
const skip = cxx ? false : (problem ?? "no C++ compiler");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));
const baseName = (f: string): string => f.replace(/^.*[\\/]/, "").replace(/\.ufsm$/, "");

/** A handler with every method the machine calls, doing nothing. */
function stubHandler(ir: IrModule, ns: string): string {
  const m = [
    ...ir.actions.map((a) => `    void ${cppName(a.name)}() {}`),
    ...ir.guards.map((g) => `    bool ${cppName(g.name)}() { return false; }`),
    ...(ir.timers.length
      ? [`    void timer_start(${ns}::Timer, std::uint32_t, bool) {}`, `    void timer_stop(${ns}::Timer) {}`]
      : []),
    ...(ir.trace ? [`    void trace(${ns}::TraceKind, std::uint16_t) {}`] : []),
  ];
  return `struct stub_${ns} {\n${m.join("\n")}\n};\n`;
}

/**
 * Every repo model, the keyword model and some random models as headers, each also with debugInfo and trace, all
 * included in one translation unit that instantiates every machine (every member function) with a stub handler.
 */
function writeRepoUnit(dir: string): void {
  const docs: [string, UfsmDocument][] = modelFiles.map((f) => [
    `${cppNamespace(baseName(f))}${f.includes("examples") ? "_example" : ""}`,
    load(f),
  ]);
  docs.push(["keywords", keywordModel()]);
  for (let seed = 1; seed <= 40; seed++)
    docs.push([`random${seed}`, randomModel(seed, { transitions: 24, signals: seed % 3 })]);
  const tu: string[] = ["#include <cstdint>"];
  for (const [ns, doc] of docs) {
    for (const [name, lowered, debugInfo] of [
      [ns, ir(doc), false],
      [`${ns}_debug`, lowerToIr(flatten(doc), { trace: true }), true],
    ] as const) {
      const out = generateCpp(lowered, { namespace: name, className: "Machine", debugInfo });
      writeFileSync(join(dir, out.fileName), out.source);
      tu.push(
        `#include "${out.fileName}"`,
        stubHandler(lowered, name),
        `template class ${name}::Machine<stub_${name}>;`,
      );
    }
  }
  writeFileSync(join(dir, "all.cpp"), `${tu.join("\n")}\n`);
}

function docExample(): string {
  const doc = readFileSync(join(repoRoot, "docs/backend-cpp.md"), "utf8");
  const example = /## Example\n\n```cpp\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(example, "docs/backend-cpp.md has an Example section with a cpp block");
  return example;
}

describeBackend({
  name: "C++",
  target: "cpp",
  randomEnv: "UFSM_CPP_RANDOM",
  skip,
  run: (units) => runCpp(cxx!, units),
  timerApi: /enum class Timer\b/,
});

describe("C++ backend: generated files", () => {
  for (const std of ["c++11", "c++20"])
    it(
      `compile without warnings as ${std} with -fno-exceptions -fno-rtti (every member instantiated)`,
      { skip },
      async () => {
        const dir = mkdtempSync(join(tmpdir(), "ufsm-cpp-"));
        try {
          writeRepoUnit(dir);
          await compileCxx(
            cxx!,
            dir,
            ["all.cpp"],
            [`-std=${std}`, ...cxxStrictFlags(cxx!), "-fno-exceptions", "-fno-rtti"],
          );
        } finally {
          removeTempDir(dir);
        }
      },
    );

  it("run the dimmer example from docs/backend-cpp.md", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-cpp-"));
    try {
      writeFileSync(join(dir, "dimmer.hpp"), generateCpp(ir(load(join(repoRoot, "examples/dimmer.ufsm")))).source);
      writeFileSync(join(dir, "main.cpp"), docExample());
      const exe = join(dir, process.platform === "win32" ? "example.exe" : "example");
      execFileSync(cxx!, ["-std=c++14", ...cxxStrictFlags(cxx!), "main.cpp", "-o", exe], { cwd: dir, stdio: "pipe" });
      assert.equal(execFileSync(exe, [], { encoding: "utf8" }).trim(), "lamp at 30%");
    } finally {
      removeTempDir(dir);
    }
  });

  it("reject a handler that misses an action, and a value that is not an Event", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-cpp-"));
    try {
      writeFileSync(join(dir, "dimmer.hpp"), generateCpp(ir(load(join(repoRoot, "examples/dimmer.ufsm")))).source);
      // One mistake per file: g++ stops at the conversion error before it instantiates the template.
      const compile = (event: string): string => {
        writeFileSync(
          join(dir, "main.cpp"),
          '#include "dimmer.hpp"\nstruct Lamp { void lamp_off() {} };\n' +
            `int main() { Lamp l; dimmer::Dimmer<Lamp> m(l); m.reset(); m.process(${event}); return 0; }\n`,
        );
        const r = spawnSync(cxx!, ["-std=c++14", "-c", "main.cpp"], { cwd: dir, encoding: "utf8" });
        assert.notEqual(r.status, 0, event);
        return r.stderr;
      };
      assert.match(compile("dimmer::Event::eButton"), /lamp_(10|30|50|100)_percent/);
      assert.match(
        compile("5"),
        /cannot convert|cannot initialize|no viable conversion|no matching|invalid conversion/,
      );
    } finally {
      removeTempDir(dir);
    }
  });

  it("keep names as declared, keywords with a trailing underscore", () => {
    assert.equal(cppName("not"), "not_");
    assert.equal(cppName("eButton"), "eButton");
    assert.equal(cppNamespace("New model"), "new_model");
    const out = generateCpp(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
    assert.equal(out.fileName, "dimmer.hpp");
    assert.match(out.source, /^#include <cstdint>$/m);
    assert.equal(out.source.match(/^#include/gm)!.length, 1, "includes only <cstdint>");
    assert.doesNotMatch(
      out.source,
      /\bvirtual\b|\bnew\b|\bthrow\b|\btry\b|malloc/,
      "static: no virtuals, heap or exceptions",
    );
    assert.match(out.source, /^namespace dimmer \{$/m);
    assert.match(out.source, /^template <typename Handler>\nclass Dimmer \{$/m);
    assert.match(out.source, /^enum class Event : std::uint16_t \{\n {4}eButton = 0,$/m);
    assert.match(out.source, /^ {4}Status process\(Event event\)$/m);
    assert.match(out.source, /h_\.lamp_off\(\);/);
    const terms = generateCpp(ir(load(join(repoRoot, "tests/models/test_guard_terms.ufsm")))).source;
    assert.match(terms, /^ {4}not_ = \d+,$/m, "an event named like a keyword gets an underscore");
    const custom = generateCpp(ir(load(join(repoRoot, "examples/dimmer.ufsm"))), {
      className: "Lamp",
      namespace: "lights",
      file: "lamp_fsm",
    });
    assert.equal(custom.fileName, "lamp_fsm.hpp");
    assert.match(custom.source, /^namespace lights \{$/m);
    assert.match(custom.source, /^class Lamp \{$/m);
    assert.match(custom.source, /^#ifndef UFSM_LAMP_FSM_HPP$/m);
  });

  it("generate only what the model uses", () => {
    const plain = generateCpp(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm")))).source;
    assert.doesNotMatch(plain, /queue_len_|hist_ |terminated_|settle_/);
    const signals = generateCpp(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), {
      signalQueue: 5,
    }).source;
    assert.match(signals, /^ {4}std::uint8_t queue_\[5\] = \{\};/m);
    assert.match(
      signals,
      /if \(queue_len_ == 5u\) \{\n\s+return rc_queue_overflow;/,
      "the last free slot can be used (B3)",
    );
    const noCheck = generateCpp(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { maxMicrosteps: 0 }).source;
    assert.doesNotMatch(noCheck, /steps_|rc_livelock/);
  });

  it("emit the timer API only for a model with timers", () => {
    const none = generateCpp(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { debugInfo: true }).source;
    assert.doesNotMatch(none, /timer/i);
    const src = generateCpp(ir(load(join(repoRoot, "tests/models/test_timers.ufsm"))), { debugInfo: true }).source;
    assert.match(src, /^constexpr std::uint16_t timer_count = 4u;$/m);
    assert.match(src, /^inline Event timer_event\(Timer timer\)$/m);
    assert.match(src, /^inline const char \*timer_name\(Timer value\)$/m);
    assert.match(src, /h_\.timer_start\(Timer::long_, 3600000u, false\);/, "a timer named like a keyword");
  });

  it("reject names that cannot be used in C++", () => {
    const timers = load(join(repoRoot, "tests/models/test_timers.ufsm"));
    timers.declarations.actions[0]!.name = "timer_start";
    assert.throws(() => generateCpp(ir(timers)), /action 'timer_start' becomes 'timer_start', like a timer function/);
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.declarations.actions[0]!.name = "delete";
    doc.declarations.actions[1]!.name = "delete_";
    assert.throws(
      () => generateCpp(ir(doc)),
      (e: unknown) =>
        e instanceof CodegenError && /action 'delete_' becomes 'delete_', like action 'delete'/.test(e.message),
    );
    const macro = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    macro.declarations.events[0]!.name = "INT8_MAX";
    assert.throws(() => generateCpp(ir(macro)), /macro of <cstdint>/);
    const ok = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    for (const name of ["Event", "Status", "class", "9x"])
      assert.throws(() => generateCpp(ir(ok), { className: name }), /C\+\+ class name/, name);
    assert.throws(() => generateCpp(ir(ok), { namespace: "std" }), /not a usable identifier/);
    assert.throws(() => generateCpp(ir(ok), { file: "a/b" }), /not a plain file name/);
  });

  it("read targets.cpp: its own settings, never behaviour options", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.targets = { cpp: { className: "G", namespace: "guards", signalQueue: 8, colour: "red", file: 3 } };
    const { options, problems } = cppOptionsFromTargets(doc);
    assert.deepEqual(options, { className: "G", namespace: "guards" }, "behaviour options are not read from targets");
    assert.deepEqual(problems, [
      "targets.cpp.signalQueue: changes behaviour, so it is set in options for every target (ignored)",
      "targets.cpp.colour: unknown option (ignored)",
      "targets.cpp.file: expected a string",
    ]);
    const files = generateFiles(doc, "cpp", { className: "Other" });
    assert.equal(files.files[0]!.name, "guards.hpp");
    assert.match(files.files[0]!.text, /^class Other \{$/m);
  });
});
