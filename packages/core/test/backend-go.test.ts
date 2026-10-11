// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodegenError, generateFiles, type UfsmDocument } from "../src";
import { flatten, generateGo, goName, goOptionsFromTargets, goPackageName, lowerToIr } from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { findGo, goEnv, goRun, runGo, writeGoModule } from "./go-harness";
import { randomModel } from "./random-model";
import { describeBackend, keywordModel, load, modelFiles, repoRoot } from "./backend-contract";

// The Go tests skip without go; UFSM_REQUIRE_GO=1 (CI) turns that into a failure.
const tools = findGo();
if (process.env["UFSM_REQUIRE_GO"] && (!tools.go || !tools.gofmt))
  throw new Error(`UFSM_REQUIRE_GO is set but ${tools.problem ?? "gofmt was not found (set GOFMT)"}`);
const skip = tools.go ? false : (tools.problem ?? "no go");
const skipFmt = skip || (tools.gofmt ? false : "gofmt not found");
const ir = (doc: UfsmDocument) => lowerToIr(flatten(doc));
const baseName = (f: string): string => f.replace(/^.*[\\/]/, "").replace(/\.ufsm$/, "");

/** Every repo model, the keyword model and some random models as packages of one module, each also with debugInfo and trace. */
function writeRepoModule(dir: string): string[] {
  const docs: [string, UfsmDocument][] = modelFiles.map((f) => [
    `${goPackageName(baseName(f))}${f.includes("examples") ? "_example" : ""}`,
    load(f),
  ]);
  docs.push(["keywords", keywordModel()]);
  for (let seed = 1; seed <= 40; seed++)
    docs.push([`random${seed}`, randomModel(seed, { transitions: 24, signals: seed % 3 })]);
  const packages = docs.flatMap(([pkg, doc]) => {
    const plain = generateGo(ir(doc), { package: pkg });
    const debug = generateGo(lowerToIr(flatten(doc), { trace: true }), { package: `${pkg}_debug`, debugInfo: true });
    return [
      { pkg, files: [{ name: plain.fileName, text: plain.source }] },
      { pkg: `${pkg}_debug`, files: [{ name: debug.fileName, text: debug.source }] },
    ];
  });
  writeGoModule(dir, packages);
  return packages.map((p) => `${p.pkg}/${p.files[0]!.name}`);
}

function docExample(): string {
  const doc = readFileSync(join(repoRoot, "docs/backend-go.md"), "utf8");
  const example = /## Example\n\n```go\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(example, "docs/backend-go.md has an Example section with a go block");
  return example;
}

describeBackend({
  name: "Go",
  target: "go",
  randomEnv: "UFSM_GO_RANDOM",
  skip,
  run: (units) => runGo(tools, units),
  timerApi: /TimerStart\(timer Timer, ms uint32, periodic bool\)/,
});

describe("Go backend: generated files", () => {
  it(
    "build and pass go vet (repo models, the keyword model, random models, with and without debugInfo)",
    { skip },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "ufsm-go-"));
      try {
        writeRepoModule(dir);
        await goRun(tools.go!, dir, ["vet", "./..."]);
      } finally {
        removeTempDir(dir);
      }
    },
  );

  it("are formatted as gofmt formats them", { skip: skipFmt }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-go-"));
    try {
      const files = writeRepoModule(dir);
      const r = spawnSync(tools.gofmt!, ["-l", "-d", ...files], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "", `gofmt would change the generated code:\n${r.stdout.slice(0, 4000)}`);
    } finally {
      removeTempDir(dir);
    }
  });

  it("run the dimmer example from docs/backend-go.md", { skip }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-go-"));
    try {
      const out = generateGo(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
      writeGoModule(dir, [{ pkg: "dimmer", files: [{ name: out.fileName, text: out.source }] }]);
      writeFileSync(join(dir, "main.go"), docExample().replace('"example.com/lamp/dimmer"', '"ufsmtest/dimmer"'));
      const exe = process.platform === "win32" ? "example.exe" : "example";
      await goRun(tools.go!, dir, ["build", "-o", exe, "."]);
      assert.equal(execFileSync(join(dir, exe), [], { encoding: "utf8" }).trim(), "lamp at 30%");
    } finally {
      removeTempDir(dir);
    }
  });

  it("reject a handler that misses an action, and a value that is not an Event", { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-go-"));
    try {
      const out = generateGo(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
      writeGoModule(dir, [{ pkg: "dimmer", files: [{ name: out.fileName, text: out.source }] }]);
      writeFileSync(
        join(dir, "main.go"),
        'package main\n\nimport "ufsmtest/dimmer"\n\ntype lamp struct{}\n\nfunc (lamp) Lamp_off() {}\n\n' +
          "func main() {\n\tm := dimmer.New(lamp{})\n\tvar e int = 5\n\t_ = m.Process(e)\n}\n",
      );
      const r = spawnSync(tools.go!, ["build", "."], { cwd: dir, encoding: "utf8", env: goEnv() });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /missing method Lamp_(10|100|30|50)_percent/);
      assert.match(r.stderr, /cannot use e \(variable of type int\) as dimmer\.Event value/);
    } finally {
      removeTempDir(dir);
    }
  });

  it("name declarations as exported Go names, the package after the model", () => {
    assert.equal(goName("lamp_10_percent"), "Lamp_10_percent");
    assert.equal(goName("eButton"), "EButton");
    assert.equal(goName("eKey_F_down"), "EKey_F_down", "case further on is kept (canvas.ufsm has eKey_f_down too)");
    assert.equal(goName("_1x"), "X_1x");
    assert.equal(goPackageName("New model"), "new_model");
    const out = generateGo(ir(load(join(repoRoot, "examples/dimmer.ufsm"))));
    assert.equal(out.fileName, "dimmer.go");
    assert.match(out.source, /^\/\/ Code generated by uFSM .* DO NOT EDIT\.$/m, "the marker Go tools look for");
    assert.match(out.source, /^package dimmer$/m);
    assert.doesNotMatch(out.source, /^import/m, "imports nothing");
    assert.match(out.source, /^\tEventEButton Event = iota$/m);
    assert.match(out.source, /^type Handler interface \{\n\t\/\/ Lamp_off is action lamp_off\.\n\tLamp_off\(\)$/m);
    assert.match(out.source, /^func \(m \*Machine\) Process\(event Event\) error \{$/m);
    const custom = generateGo(ir(load(join(repoRoot, "examples/dimmer.ufsm"))), {
      className: "Lamp",
      package: "lampfsm",
      file: "lamp_fsm",
    });
    assert.equal(custom.fileName, "lamp_fsm.go");
    assert.match(custom.source, /^package lampfsm$/m);
    assert.match(custom.source, /^func New\(handler Handler\) \*Lamp \{$/m);
  });

  it("generate only what the model uses", () => {
    const plain = generateGo(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm")))).source;
    assert.doesNotMatch(plain, /m\.queue|m\.hist|terminated|settle/);
    const signals = generateGo(ir(load(join(repoRoot, "tests/models/test_chained_signals.ufsm"))), {
      signalQueue: 5,
    }).source;
    assert.match(signals, /^\tqueue +\[5\]uint8$/m);
    assert.match(signals, /if m\.queueLen == 5 \{\n\t\treturn ErrQueueOverflow/, "the last free slot can be used (B3)");
    const noCheck = generateGo(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { maxMicrosteps: 0 }).source;
    assert.doesNotMatch(noCheck, /m\.steps|ErrLivelock\n/);
  });

  it("emit the timer API only for a model with timers", () => {
    const none = generateGo(ir(load(join(repoRoot, "tests/models/test_guard1.ufsm"))), { debugInfo: true }).source;
    assert.doesNotMatch(none, /timer/i);
    const src = generateGo(ir(load(join(repoRoot, "tests/models/test_timers.ufsm"))), { debugInfo: true }).source;
    assert.match(src, /^type Timer int$/m);
    assert.match(src, /^func \(t Timer\) Event\(\) Event \{$/m);
    assert.match(src, /^func \(t Timer\) String\(\) string \{$/m);
    assert.match(src, /^\tTimerStop\(timer Timer\)$/m);
    assert.match(src, /m\.h\.TimerStart\(TimerLong, 3600000, false\)/);
  });

  it("reject names that cannot be used in Go", () => {
    const timers = load(join(repoRoot, "tests/models/test_timers.ufsm"));
    timers.declarations.actions[0]!.name = "TimerStart";
    assert.throws(() => generateGo(ir(timers)), /action 'TimerStart' becomes 'TimerStart', like a timer method/);
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.declarations.actions[0]!.name = "lamp";
    doc.declarations.actions[1]!.name = "Lamp";
    assert.throws(
      () => generateGo(ir(doc)),
      (e: unknown) => e instanceof CodegenError && /action 'Lamp' becomes 'Lamp', like action 'lamp'/.test(e.message),
    );
    const ok = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    for (const name of ["Event", "Handler", "New", "machine", "9x"])
      assert.throws(() => generateGo(ir(ok), { className: name }), /Go type name|the type name/, name);
    assert.throws(() => generateGo(ir(ok), { package: "type" }), /not a usable identifier/);
    assert.throws(() => generateGo(ir(ok), { file: "x_test" }), /not a plain file name/);
  });

  it("read targets.go, its own settings, never behaviour options", () => {
    const doc = load(join(repoRoot, "tests/models/test_guard1.ufsm"));
    doc.targets = { go: { className: "G", package: "guards", signalQueue: 8, colour: "red", file: 3 } };
    const { options, problems } = goOptionsFromTargets(doc);
    assert.deepEqual(options, { className: "G", package: "guards" }, "behaviour options are not read from targets");
    assert.deepEqual(problems, [
      "targets.go.signalQueue: changes behaviour, so it is set in options for every target (ignored)",
      "targets.go.colour: unknown option (ignored)",
      "targets.go.file: expected a string",
    ]);
    const files = generateFiles(doc, "go", { className: "Other" });
    assert.equal(files.files[0]!.name, "guards.go");
    assert.match(files.files[0]!.text, /^type Other struct \{$/m);
  });
});
