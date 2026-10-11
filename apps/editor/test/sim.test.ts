// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { produce } from "immer";
import { MachineError, formatFailure, formatTrace, loadModel, parseTrace, runTrace, type UfsmDocument } from "@ufsm/core";
import { moveVertices, renameDecl } from "@ufsm/core/edit";
import { Simulation, relativePath } from "../src/sim";
import { CODE_VIEWS, generatedCode, highlight } from "../src/code";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (f: string): UfsmDocument => loadModel(readFileSync(join(repoRoot, f), "utf8")).doc;
const models = [
  ...readdirSync(join(repoRoot, "examples")).filter((f) => f.endsWith(".ufsm")).map((f) => `examples/${f}`),
  ...readdirSync(join(repoRoot, "tests/models")).filter((f) => f.endsWith(".ufsm")).map((f) => `tests/models/${f}`),
  "apps/editor/src/fsm/editor.ufsm",
];

/** Small deterministic random numbers (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("simulation", () => {
  it("logs a step per reset and event, with calls, active states and taken transitions", () => {
    const doc = load("tests/models/test_fork_join.ufsm");
    const sim = new Simulation(doc, new Map());
    const r = sim.reset();
    assert.equal(r.event, undefined);
    assert.deepEqual(r.calls, ["eStart"]);
    assert.deepEqual(r.lines.map((l) => l.kind), ["enter", "call"]);
    assert.deepEqual(r.record, { reset: true, expect: ["eStart"], active: ["Start"] });
    assert.equal(sim.send("eEvent2").fired, 0);
    assert.equal(sim.fired.size, 0);
    assert.equal(sim.wouldTake("eBegin").length, 3, "fork: the trigger and both legs");
    const s = sim.send("eBegin");
    assert.equal(s.fired, 1);
    assert.deepEqual(s.calls, ["xStart", "eB", "eB1", "eB2"]);
    assert.equal(sim.fired.size, 3);
    assert.deepEqual(s.record.active, ["B1", "B2"], "innermost states only");
    assert.deepEqual(sim.activeIds().length, 3);
    assert.equal(sim.version, 3);
    sim.send("eEvent");
    assert.equal(sim.fired.size, 1, "only the last step's transitions");
  });

  it("records guard values when they change, from the next step on", () => {
    const doc = load("tests/models/test_guard_terms.ufsm");
    const guards = new Map<string, boolean>([["g", true]]);
    const sim = new Simulation(doc, guards);
    sim.reset();
    sim.send("all");
    guards.set("g", false);
    guards.set("h", false);
    sim.send("all");
    guards.set("h", true);
    sim.send("truthy");
    assert.deepEqual(
      sim.steps.map((s) => s.guards),
      [{ g: true }, undefined, { g: false }, { h: true }],
      "a guard set to false that was false is not recorded",
    );
  });

  it("records errors instead of expectations, and the queue size the trace needs", () => {
    const doc = load("tests/models/test_signals.ufsm");
    const sim = new Simulation(doc, new Map(), { signalQueue: 2 });
    sim.reset();
    sim.send("go");
    sim.send("two");
    const s = sim.send("burst");
    assert.equal(s.error?.code, "queue-overflow");
    assert.deepEqual(s.record, { send: "burst", error: "queue-overflow" });
    const t = sim.trace("../models/test_signals.ufsm");
    assert.deepEqual(t.options, { signalQueue: 2 });
    assert.deepEqual(runTrace(doc, parseTrace(formatTrace(t))), []);
    const plain = new Simulation(doc, new Map());
    plain.reset();
    assert.equal(plain.trace("m").options, undefined, "defaults are not written");
    assert.equal(plain.trace("m", { active: false }).steps[0]!.active, undefined);
  });

  it("runs with the model's options; a trace records only the ones the session overrides", () => {
    const doc = load("tests/models/test_options.ufsm");
    const sim = new Simulation(doc, new Map());
    assert.deepEqual(sim.options, { signalQueue: 1, maxMicrosteps: 2 });
    sim.reset();
    assert.equal(sim.send("e1").error?.code, "queue-overflow", "the model's queue of 1");
    assert.equal(sim.trace("m").options, undefined, "the model's own options are not written");
    assert.deepEqual(runTrace(doc, sim.trace("m")), []);
    const same = new Simulation(doc, new Map(), { signalQueue: 1 });
    assert.equal(same.trace("m").options, undefined, "an override equal to the model's value is not written");
    const wider = new Simulation(doc, new Map(), { signalQueue: 2 });
    wider.reset();
    assert.equal(wider.send("e1").error, undefined);
    const t = wider.trace("m");
    assert.deepEqual(t.options, { signalQueue: 2 });
    assert.deepEqual(runTrace(doc, t), []);
    assert.ok(!wider.staleFor(doc));
    assert.ok(wider.staleFor({ ...doc, options: { signalQueue: 3 } }), "changing the model's options makes the run out of date");
  });

  it("records no active states for a step that failed (the machine is undefined after an error)", () => {
    const doc = load("tests/models/test_eventless.ufsm");
    const guards = new Map<string, boolean>();
    const sim = new Simulation(doc, guards, { maxMicrosteps: 20 });
    // the conformance trace's steps up to its livelock
    const steps = parseTrace(readFileSync(join(repoRoot, "tests/traces/test_eventless.json"), "utf8")).steps;
    for (const st of steps.slice(0, steps.findIndex((x) => x.error === "livelock"))) {
      for (const [k, v] of Object.entries(st.guards ?? {})) guards.set(k, v);
      if (st.reset) sim.reset();
      else if (st.send) sim.send(st.send);
    }
    const s = sim.send("spin");
    assert.equal(s.error?.code, "livelock");
    assert.deepEqual(s.record, { send: "spin", error: "livelock" });
    assert.ok(sim.activeIds().length > 0, "states are still active");
    const t = sim.trace("m");
    assert.deepEqual(t.options, { maxMicrosteps: 20 });
    assert.deepEqual(runTrace(doc, t), []);
  });

  it("keeps the running timers on a virtual clock: fire sends the event, a one-shot stops, a periodic goes on", () => {
    const doc = load("tests/models/test_timers.ufsm");
    const sim = new Simulation(doc, new Map());
    sim.reset();
    assert.deepEqual(sim.timers(), [], "reset stops every timer");
    assert.deepEqual(sim.steps[0]!.calls.slice(0, 2), ["stop:travel", "stop:poll"]);
    sim.send("eGo");
    assert.deepEqual(sim.timers().map((t) => [t.name, t.event, t.periodic]), [["travel", "eTimeout", false], ["poll", "eTick", true], ["blink", "eBlink", true]]);
    assert.ok(sim.steps[1]!.lines.some((l) => l.kind === "timer" && l.start && l.name === "travel" && l.ms === 2000));
    const poll = sim.timers()[1]!.id;
    const step = sim.fire(poll)!;
    assert.equal(step.event, "eTick");
    assert.equal(step.timer, "poll");
    assert.deepEqual(step.record.send, "eTick", "a trace records the event, like any other");
    assert.deepEqual(sim.timers().map((t) => t.name), ["travel", "poll", "long"], "poll keeps running; blink stopped with C1");
    sim.fire(sim.timers()[0]!.id);
    assert.deepEqual(sim.timers(), [], "travel expired and P was left");
    assert.equal(sim.fire(poll), undefined, "not running");
    const trace = sim.trace("../models/test_timers.ufsm");
    assert.deepEqual(runTrace(doc, parseTrace(formatTrace(trace))), [], "the recorded trace replays");
  });

  it("refuses a model with errors", () => {
    const doc = load("examples/dimmer.ufsm");
    doc.machine.transitions.push({ id: "tx", from: "nowhere", to: "nowhere" });
    assert.throws(() => new Simulation(doc, new Map()), (e: unknown) => e instanceof MachineError && e.code === "invalid-model");
  });

  it("goes out of date when the machine or the declarations change, not the layout", () => {
    const doc = load("examples/dimmer.ufsm");
    const sim = new Simulation(doc, new Map());
    const id = doc.machine.root.states.find((v) => v.kind === "state")!.id;
    const moved = produce(doc, (d) => void moveVertices(d as UfsmDocument, [id], 10, 0));
    assert.notEqual(moved.diagram, doc.diagram);
    assert.equal(sim.staleFor(moved), false);
    const renamed = produce(doc, (d) => void renameDecl(d as UfsmDocument, d.declarations.events[0]!.id, "renamed"));
    assert.equal(sim.staleFor(renamed), true);
  });

  it("records traces that replay without failures on every repository model", () => {
    let sessions = 0;
    for (const f of models) {
      const doc = load(f);
      const next = rng(f.length * 7919);
      const guards = new Map<string, boolean>();
      let sim: Simulation;
      try {
        sim = new Simulation(doc, guards);
      } catch (e) {
        assert.ok(e instanceof MachineError && e.code === "invalid-model", f);
        continue;
      }
      const events = doc.declarations.events.map((e) => e.name);
      sim.reset();
      for (let i = 0; i < 60 && events.length; i++) {
        if (next() < 0.2) for (const g of doc.declarations.guards) guards.set(g.name, next() < 0.5);
        if (next() < 0.03) sim.reset();
        else sim.send(events[Math.floor(next() * events.length)]!);
      }
      const trace = parseTrace(formatTrace(sim.trace(f)));
      const failures = runTrace(doc, trace);
      assert.equal(failures.length, 0, `${f}: ${failures.map((x) => formatFailure(trace, x)).join("\n")}`);
      sessions++;
    }
    assert.ok(sessions >= 25, `only ${sessions} models could be simulated`);
  });
});

describe("relativePath", () => {
  it("relates a model to a trace file on POSIX and Windows paths", () => {
    assert.equal(relativePath("/w/ufsm/tests/traces/t.json", "/w/ufsm/tests/models/m.ufsm"), "../models/m.ufsm");
    assert.equal(relativePath("/w/m/t.json", "/w/m/m.ufsm"), "m.ufsm");
    assert.equal(relativePath("/w/m/t.json", "/w/m/sub/m.ufsm"), "sub/m.ufsm");
    assert.equal(relativePath("C:\\Users\\jonas\\work\\traces\\t.json", "c:\\Users\\Jonas\\work\\m.ufsm"), "../m.ufsm");
    assert.equal(relativePath("C:\\a\\t.json", "D:\\b\\m.ufsm"), "D:/b/m.ufsm");
    assert.equal(relativePath("/a/t.json", "/m.ufsm"), "../m.ufsm");
    assert.equal(relativePath("/w/x/t.json", "/w/x"), "../x", "a file named like a folder of the trace's path");
  });
});

describe("code preview", () => {
  it("regenerates only when something the generators read changed", () => {
    const doc = load("examples/dimmer.ufsm");
    const a = generatedCode(doc, "c");
    assert.ok("files" in a && a.files.length === 2);
    assert.equal(generatedCode(doc, "c"), a);
    const id = doc.machine.root.states.find((v) => v.kind === "state")!.id;
    const moved = produce(doc, (d) => void moveVertices(d as UfsmDocument, [id], 10, 0));
    assert.equal(generatedCode(moved, "c"), a, "layout edits keep the cached code");
    const named = produce(doc, (d) => void (d.name = "lamp"));
    const c = generatedCode(named, "c");
    assert.ok("files" in c && c.files[0]!.name === "lamp.h");
    const renamed = produce(named, (d) => void renameDecl(d as UfsmDocument, d.declarations.events[0]!.id, "eRenamed"));
    const b = generatedCode(renamed, "c");
    assert.notEqual(b, c);
    assert.ok("files" in b && b.files[0]!.text.includes("eRenamed"));
  });

  it("reports model errors and generator errors as text", () => {
    const doc = load("examples/dimmer.ufsm");
    doc.machine.transitions.push({ id: "tx", from: "nowhere", to: "nowhere" });
    const r = generatedCode(doc, "python");
    assert.ok("error" in r && /the model has \d+ error/.test(r.error));
    const clash = load("examples/dimmer.ufsm");
    clash.targets = { ts: { className: "class" } };
    assert.ok("error" in generatedCode(clash, "ts"));
  });

  it("highlights without changing the text, for every repository model and language", () => {
    const strip = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    let files = 0;
    for (const f of models) {
      const doc = load(f);
      for (const v of CODE_VIEWS) {
        const r = generatedCode(doc, v.target);
        if ("error" in r) continue;
        const text = r.files[v.file]!.text;
        const html = highlight(text, v.target);
        assert.equal(strip(html), text, `${f} ${v.id}`);
        assert.ok(!/<(?!\/?span)/.test(html.replace(/<span class="c-[a-z]+">/g, "")), `${f} ${v.id}: only spans`);
        files++;
      }
    }
    assert.ok(files > 120);
    assert.equal(
      highlight('#include <x.h>\nint a = 0x1Fu; /* <b> */ s = "a\\"b";', "c"),
      '<span class="c-pre">#include &lt;x.h&gt;</span>\n<span class="c-kw">int</span> a = <span class="c-num">0x1Fu</span>; <span class="c-com">/* &lt;b&gt; */</span> s = <span class="c-str">"a\\"b"</span>;',
    );
    assert.equal(
      highlight("#[derive(Debug)]\nfn f(x: &'static str) -> u8 { 'a' as u8 } // x", "rust"),
      '<span class="c-pre">#[derive(Debug)]</span>\n<span class="c-kw">fn</span> f(x: &amp;\'<span class="c-kw">static</span> <span class="c-kw">str</span>) -&gt; <span class="c-kw">u8</span> { <span class="c-str">\'a\'</span> <span class="c-kw">as</span> <span class="c-kw">u8</span> } <span class="c-com">// x</span>',
    );
    assert.equal(highlight("def f(self) -> None:  # x\n    return 'y'", "python"), '<span class="c-kw">def</span> f(<span class="c-kw">self</span>) -&gt; <span class="c-kw">None</span>:  <span class="c-com"># x</span>\n    <span class="c-kw">return</span> <span class="c-str">\'y\'</span>');
  });
});
