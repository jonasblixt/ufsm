// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Interpreter,
  InterpreterError,
  formatFailure,
  formatTrace,
  indexV1,
  loadModel,
  parseTrace,
  runTrace,
  type TraceEntry,
  type UfsmDocument,
} from "../src/index";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
const traceFiles = existsSync(traceDir) ? readdirSync(traceDir).filter((f) => f.endsWith(".json")).sort() : [];

describe("conformance traces (reference interpreter)", () => {
  it("exist for every old C test", () => assert.ok(traceFiles.length >= 14, `found ${traceFiles.length}`));
  for (const f of traceFiles) {
    it(f, () => {
      const path = join(traceDir, f);
      const trace = parseTrace(readFileSync(path, "utf8"));
      const doc = loadModel(readFileSync(resolve(dirname(path), trace.model), "utf8")).doc;
      const failures = runTrace(doc, trace);
      assert.equal(failures.length, 0, failures.map((x) => formatFailure(trace, x)).join("\n"));
    });
  }
});

/** Tiny builder for inline models: states "A", "P{C,D}", transitions "A -e1-> B". */
function machine(spec: { root: string[]; transitions: string[]; signals?: string[]; history?: Record<string, "shallow-history" | "deep-history"> }): UfsmDocument {
  let n = 0;
  const events = new Map<string, string>();
  const actions = new Map<string, string>();
  const ids = new Map<string, string>();
  const decl = (map: Map<string, string>, prefix: string, name: string): string => {
    if (!map.has(name)) map.set(name, `${prefix}${map.size + 1}`);
    return map.get(name)!;
  };
  const signals = new Set(spec.signals ?? []);
  const regionOf = (items: string[], name: string): UfsmDocument["machine"]["root"] => {
    const states: UfsmDocument["machine"]["root"]["states"] = [];
    for (const item of items) {
      const m = /^([A-Za-z0-9_]+)(?:\{(.*)\})?$/.exec(item)!;
      const sname = m[1]!;
      const id = `s${++n}`;
      ids.set(sname, id);
      if (sname.startsWith("final")) {
        states.push({ id, kind: "final", name: sname });
        continue;
      }
      const st: UfsmDocument["machine"]["root"]["states"][number] = {
        id,
        kind: "state",
        name: sname,
        entry: [{ call: decl(actions, "act", `e${sname}`) }],
        exit: [{ call: decl(actions, "act", `x${sname}`) }],
      };
      if (m[2]) {
        // regions separated by '|', states by ','
        st.regions = m[2].split("|").map((r, i) => regionOf(splitTop(r), `${sname}r${i}`));
      }
      states.push(st);
    }
    return { id: `r_${name}`, states };
  };
  const splitTop = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const root = regionOf(spec.root, "root");
  // initial pseudo-state in every region, targeting its first state
  const transitions: UfsmDocument["machine"]["transitions"] = [];
  const addInitials = (r: UfsmDocument["machine"]["root"]): void => {
    const first = r.states[0]!;
    const kind = spec.history?.[r.id] ?? "initial";
    const pid = `p${++n}`;
    r.states.push({ id: pid, kind });
    transitions.push({ id: `ti${n}`, from: pid, to: first.id });
    for (const v of r.states) if (v.kind === "state") v.regions?.forEach(addInitials);
  };
  addInitials(root);
  for (const t of spec.transitions) {
    const m = /^(\w+) -(\w+)?(?:\[(!?\w+)\])?(?:\/([\w^,]+))?-> (\w+)$/.exec(t);
    if (!m) throw new Error(`bad transition spec '${t}'`);
    const [, from, trig, , act, to] = m;
    const tr: UfsmDocument["machine"]["transitions"][number] = { id: `t${transitions.length + 1}`, from: ids.get(from!)!, to: ids.get(to!)! };
    if (trig === "auto") tr.auto = true;
    else if (trig === "completion") tr.completion = true;
    else if (trig) tr.on = signals.has(trig) ? decl(events, "sig_", trig) : decl(events, "ev", trig);
    if (act) tr.do = act.split(",").map((a) => (a.startsWith("^") ? { emit: decl(events, "sig_", a.slice(1)) } : { call: decl(actions, "act", a) }));
    transitions.push(tr);
  }
  const evDecls = [...events].filter(([k]) => !signals.has(k)).map(([name, id]) => ({ id, name }));
  const sigDecls = [...events].filter(([k]) => signals.has(k)).map(([name, id]) => ({ id, name }));
  return {
    format: "ufsm",
    version: 1,
    name: "inline",
    declarations: { events: evDecls, signals: sigDecls, actions: [...actions].map(([name, id]) => ({ id, name })), guards: [] },
    machine: { root, transitions },
  };
}

function run(doc: UfsmDocument, events: string[], opts: { signalQueue?: number } = {}): string[] {
  const calls: string[] = [];
  const m = new Interpreter(doc, { call: (n) => void calls.push(n) }, opts);
  m.reset();
  calls.length = 0;
  for (const e of events) m.process(e);
  return calls;
}

describe("interpreter", () => {
  it("requires reset() before process()", () => {
    const m = new Interpreter(machine({ root: ["A", "B"], transitions: ["A -e1-> B"] }));
    assert.throws(() => m.process("e1"), (e: unknown) => e instanceof InterpreterError && e.code === "not-started");
  });

  it("rejects unknown events and models with errors", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -e1-> B"] });
    const m = new Interpreter(doc);
    m.reset();
    assert.throws(() => m.process("nope"), (e: unknown) => e instanceof InterpreterError && e.code === "unknown-event");
    doc.machine.transitions.push({ id: "tx", from: "s1", to: "missing", on: "ev1" });
    assert.throws(() => new Interpreter(doc), (e: unknown) => e instanceof InterpreterError && e.code === "invalid-model");
  });

  it("accepts event ids as well as names", () => {
    assert.deepEqual(run(machine({ root: ["A", "B"], transitions: ["A -e1-> B"] }), ["ev1"]), ["xA", "eB"]);
  });

  it("treats a self-transition as external (exit and re-enter)", () => {
    assert.deepEqual(run(machine({ root: ["A"], transitions: ["A -e1-> A"] }), ["e1"]), ["xA", "eA"]);
  });

  it("exits a composite on a transition from it to its own substate", () => {
    const doc = machine({ root: ["P{C,D}"], transitions: ["P -e1-> D"] });
    assert.deepEqual(run(doc, ["e1"]), ["xC", "xP", "eP", "eD"]);
  });

  it("runs exit actions, then transition actions, then entry actions", () => {
    assert.deepEqual(run(machine({ root: ["A", "B"], transitions: ["A -e1/go-> B"] }), ["e1"]), ["xA", "go", "eB"]);
  });

  it("detects auto-transition livelocks", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -auto-> B", "B -auto-> A"] });
    const m = new Interpreter(doc, {}, { maxMicrosteps: 50 });
    assert.throws(() => m.reset(), (e: unknown) => e instanceof InterpreterError && e.code === "livelock");
  });

  it("bounds the signal queue when asked to", () => {
    const doc = machine({ root: ["A", "B"], signals: ["s"], transitions: ["A -e1/^s,^s,^s-> B"] });
    assert.deepEqual(run(doc, ["e1"], { signalQueue: 3 }), ["xA", "eB"]);
    assert.throws(() => run(doc, ["e1"], { signalQueue: 2 }), (e: unknown) => e instanceof InterpreterError && e.code === "queue-overflow");
  });

  it("drains the signal queue in every process() call (B2)", () => {
    const doc = machine({ root: ["A", "B"], signals: ["s"], transitions: ["A -e1/^s-> B", "B -s-> A"] });
    assert.deepEqual(run(doc, ["e1", "e1", "e1"]), ["xA", "eB", "xB", "eA", "xA", "eB", "xB", "eA", "xA", "eB", "xB", "eA"]);
  });

  it("stays busy after a call that did not finish, until reset()", () => {
    const doc = machine({ root: ["A", "B"], signals: ["s"], transitions: ["A -e1/^s,^s-> B", "B -e1-> A"] });
    const isBusy = (e: unknown): boolean => e instanceof InterpreterError && e.code === "busy";
    const id = (name: string): string => doc.machine.root.states.find((v) => v.name === name)!.id;
    const m = new Interpreter(doc, {}, { signalQueue: 1 });
    m.reset();
    assert.throws(() => m.process("e1"), (e: unknown) => e instanceof InterpreterError && e.code === "queue-overflow");
    assert.throws(() => m.process("e1"), isBusy);
    assert.throws(() => m.process("e9"), /unknown event/, "unknown-event is checked first");
    m.reset();
    assert.ok(m.isActive(id("A")));
    // an exception from the host passes through unchanged and latches the same way
    const boom = new Error("boom");
    let raise = true;
    const h = new Interpreter(doc, {
      call: (name) => {
        if (raise && name === "xA") throw boom;
      },
    });
    h.reset();
    assert.throws(() => h.process("e1"), (e: unknown) => e === boom);
    raise = false;
    assert.throws(() => h.process("e1"), isBusy);
    h.reset();
    h.process("e1");
    assert.ok(h.isActive(id("B")));
  });

  it("refuses process() from inside an action without changing anything; the outer call goes on", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -e1/go-> B", "B -e1-> A"] });
    const calls: string[] = [];
    let nested: unknown;
    const m: Interpreter = new Interpreter(doc, {
      call: (name) => {
        calls.push(name);
        if (name !== "go") return;
        try {
          m.process("e1");
        } catch (e) {
          nested = e;
        }
      },
    });
    m.reset();
    m.process("e1");
    assert.ok(nested instanceof InterpreterError && nested.code === "busy");
    assert.deepEqual(calls, ["eA", "xA", "go", "eB"]);
    m.process("e1");
    assert.ok(m.isActive(doc.machine.root.states.find((v) => v.name === "A")!.id), "a refused nested call does not latch");
  });

  it("restores shallow history one level deep", () => {
    const doc = machine({
      root: ["Off", "On{X{X1,X2},Y}"],
      history: { r_Onr0: "shallow-history" },
      transitions: ["Off -go-> On", "On -stop-> Off", "X -next-> Y", "X1 -sub-> X2", "Y -back-> X"],
    });
    // Leave from X2: shallow history restores X, which then starts at X1 again.
    assert.deepEqual(run(doc, ["go", "sub", "stop", "go"]), ["xOff", "eOn", "eX", "eX1", "xX1", "eX2", "xX2", "xX", "xOn", "eOff", "xOff", "eOn", "eX", "eX1"]);
  });

  it("restores deep history all the way down", () => {
    const doc = machine({
      root: ["Off", "On{X{X1,X2},Y}"],
      history: { r_Onr0: "deep-history" },
      transitions: ["Off -go-> On", "On -stop-> Off", "X1 -sub-> X2"],
    });
    assert.deepEqual(run(doc, ["go", "sub", "stop", "go"]), ["xOff", "eOn", "eX", "eX1", "xX1", "eX2", "xX2", "xX", "xOn", "eOff", "xOff", "eOn", "eX", "eX2"]);
  });

  it("forgets history when the region was left resting in its final state", () => {
    const doc = machine({
      root: ["Off", "On{X,Y}"],
      history: { r_Onr0: "shallow-history" },
      transitions: ["Off -go-> On", "On -stop-> Off", "X -next-> Y"],
    });
    // Y -> final, then leave and come back: default entry (X), not Y.
    const fin = { id: "fin", kind: "final" as const };
    const on = doc.machine.root.states.find((v) => v.name === "On");
    assert.ok(on?.kind === "state");
    on.regions![0]!.states.push(fin);
    doc.declarations.events.push({ id: "evf", name: "done" });
    const y = on.regions![0]!.states.find((v) => v.name === "Y")!;
    doc.machine.transitions.push({ id: "tf", from: y.id, to: "fin", on: "evf" });
    assert.deepEqual(run(doc, ["go", "next", "stop", "go"]).slice(-3), ["xOff", "eOn", "eY"], "history restores Y");
    assert.deepEqual(run(doc, ["go", "next", "stop", "go", "done", "stop", "go"]).slice(-3), ["xOff", "eOn", "eX"], "final clears the record");
  });

  it("enters nothing on the way to a terminate pseudo-state", () => {
    const doc = machine({ root: ["A", "P{B}"], transitions: [] });
    const p = doc.machine.root.states.find((v) => v.name === "P");
    assert.ok(p?.kind === "state");
    p.regions![0]!.states.push({ id: "term", kind: "terminate" });
    doc.declarations.events.push({ id: "evq", name: "quit" });
    doc.machine.transitions.push({ id: "tq", from: "s1", to: "term", on: "evq" });
    assert.deepEqual(run(doc, ["quit"]), ["xA"]);
  });

  it("stops for good in a terminate pseudo-state, without exit actions", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -e1-> B"] });
    doc.machine.root.states.push({ id: "term", kind: "terminate" });
    doc.machine.transitions.push({ id: "tq", from: "s2", to: "term", on: "ev1" });
    const log: TraceEntry[] = [];
    const calls: string[] = [];
    const m = new Interpreter(doc, { call: (n) => void calls.push(n) }, { onTrace: (e) => void log.push(e) });
    m.reset();
    m.process("e1");
    m.process("e1");
    assert.ok(m.terminated);
    assert.deepEqual(m.activeIds(), []);
    assert.deepEqual(calls, ["eA", "xA", "eB", "xB"]);
    assert.equal(m.process("e1"), 0);
    assert.ok(log.some((e) => e.type === "terminate"));
  });

  it("joins into a state with regions and enters them by default (B8)", () => {
    const doc = machine({ root: ["P{A,A2|B,B2}", "T{U|V}"], transitions: ["A -e1-> A2", "B -e2-> B2"] });
    doc.machine.root.states.push({ id: "j1", kind: "join" });
    const id = (name: string): string => {
      let found = "";
      const walk = (states: UfsmDocument["machine"]["root"]["states"]): void => {
        for (const v of states) {
          if (v.name === name) found = v.id;
          if (v.kind === "state") v.regions?.forEach((r) => walk(r.states));
        }
      };
      walk(doc.machine.root.states);
      return found;
    };
    doc.declarations.events.push({ id: "evj", name: "go" });
    doc.machine.transitions.push(
      { id: "tj1", from: id("A2"), to: "j1" },
      { id: "tj2", from: id("B2"), to: "j1" },
      { id: "tj3", from: "j1", to: id("T"), on: "evj" },
    );
    assert.deepEqual(run(doc, ["go"]), [], "join waits for A2 and B2");
    assert.deepEqual(run(doc, ["e1", "e2", "go"]), ["xA", "eA2", "xB", "eB2", "xB2", "xA2", "xP", "eT", "eU", "eV"]);
  });

  it("fires completion transitions out of simple states right away", () => {
    const doc = machine({ root: ["A", "B", "C"], transitions: ["A -e1-> B", "B -completion-> C"] });
    assert.deepEqual(run(doc, ["e1"]), ["xA", "eB", "xB", "eC"]);
  });
});

describe("interpreter for simulators", () => {
  const load = (f: string): UfsmDocument => loadModel(readFileSync(join(repoRoot, "tests/models", f), "utf8")).doc;

  it("tells which transitions an event would take, without taking them", () => {
    const doc = load("test_fork_join.ufsm");
    const index = indexV1(doc);
    const vname = (id: string): string => {
      const v = index.vertices.get(id)!.vertex;
      return v.name ?? v.kind;
    };
    const name = (id: string): string => `${vname(index.transitions.get(id)!.from)}->${vname(index.transitions.get(id)!.to)}`;
    const m = new Interpreter(doc);
    assert.deepEqual(m.wouldTake("eBegin"), [], "nothing before reset()");
    m.reset();
    assert.deepEqual(m.wouldTake("eBegin").map((t) => t.parts.map((p) => name(p.id))), [["Start->fork", "fork->B1", "fork->B2"]]);
    assert.deepEqual(m.wouldTake("eEvent2"), []);
    assert.deepEqual(m.wouldTake("nonsense"), [], "unknown events take nothing");
    assert.deepEqual(m.activeIds().length, 1, "asking changed nothing");
    m.process("eBegin");
    m.process("eEvent");
    assert.deepEqual(m.wouldTake("eEvent2").map((t) => t.parts.map((p) => name(p.id)).sort()), [["B11->join", "B2->join", "join->End"]]);
  });

  it("asks the guards as process() would", () => {
    const doc = load("test_guard_terms.ufsm");
    const guards = new Map<string, boolean>();
    const m = new Interpreter(doc, { guard: (g) => guards.get(g) ?? false });
    m.reset();
    assert.equal(m.wouldTake("truthy").length, 0);
    guards.set("g", true);
    assert.equal(m.wouldTake("truthy").length, 1);
  });

  it("reports every model transition of a fork or join and marks internal transitions", () => {
    const log: TraceEntry[] = [];
    const m = new Interpreter(load("test_fork_join.ufsm"), {}, { onTrace: (e) => void log.push(e) });
    m.reset();
    m.process("eBegin");
    const taken = log.filter((e) => e.type === "transition");
    assert.equal(taken.length, 1);
    assert.equal(taken[0]!.type === "transition" && taken[0]!.parts.length, 3);
    const ilog: TraceEntry[] = [];
    const im = new Interpreter(load("test_internal.ufsm"), {}, { onTrace: (e) => void ilog.push(e) });
    im.reset();
    im.process("eUp");
    const it = ilog.find((e) => e.type === "transition");
    assert.ok(it?.type === "transition" && it.internal && it.parts.length === 1 && it.parts[0] === it.id);
  });
});

describe("trace files", () => {
  it("are written back by formatTrace unchanged in content, one step per line when it fits", () => {
    for (const f of traceFiles) {
      const text = readFileSync(join(traceDir, f), "utf8");
      const trace = parseTrace(text);
      const out = formatTrace(trace);
      assert.deepEqual(parseTrace(out), trace, f);
      assert.equal(formatTrace(parseTrace(out)), out, `${f}: formatting is stable`);
      for (const line of out.split("\n")) if (/^ {4}\{ /.test(line)) assert.ok(line.replace(/,$/, "").length <= 120, `${f}: ${line}`);
    }
    const t = parseTrace(`{"model":"m.ufsm","options":{"signalQueue":2},"steps":[{"reset":true,"expect":["eA"]},{"guards":{"g":true,"h":false},"send":"e1","expect":[],"active":["A"]}]}`);
    assert.equal(
      formatTrace(t),
      `{\n  "model": "m.ufsm",\n  "options": { "signalQueue": 2 },\n  "steps": [\n    { "reset": true, "expect": ["eA"] },\n    { "guards": { "g": true, "h": false }, "send": "e1", "expect": [], "active": ["A"] }\n  ]\n}\n`,
    );
    const long = formatTrace({ model: "m", steps: [{ send: "e1", expect: Array.from({ length: 20 }, (_, i) => `action${i}`) }] });
    assert.match(long, /\n {4}\{\n {6}"send": "e1",\n {6}"expect": \["action0", /);
    assert.equal(formatTrace({ model: "m", steps: [] }), `{\n  "model": "m",\n  "steps": []\n}\n`);
    assert.throws(() => parseTrace(`{"model":"m","steps":[{"guards":{"g":1},"send":"e1","expect":[]}]}`), /true \| false/, "guard values are booleans");
  });

  it("reject unknown keys and steps without expectations", () => {
    assert.throws(() => parseTrace(`{"model":"m","steps":[{"send":"e1"}]}`), /needs `expect`/);
    assert.throws(() => parseTrace(`{"model":"m","steps":[{"send":"e1","expect":[],"bogus":1}]}`), /unknown key/);
    assert.throws(() => parseTrace(`{"model":"m","steps":[{"reset":true,"send":"e1","expect":[]}]}`), /not both/);
    assert.throws(() => parseTrace(`{"model":"m","steps":[{"reset":true,"reenter":"eA","expect":[]}]}`), /needs a send/);
    assert.throws(() => parseTrace(`{"model":"m","steps":[{"send":"e1","raise":"xA","error":"busy"}]}`), /no `error`/);
    assert.throws(() => parseTrace(`{"model":"m","steps":[{"guards":{"g":true},"raise":"g"}]}`), /needs a reset or send/);
  });

  it("raise exceptions from actions and call process() from inside an action (guards: test_busy.json)", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -e1/go-> B", "B -e1-> A"] });
    const steps = [
      `{"reset":true,"expect":["eA"]}`,
      `{"send":"e1","raise":"go","expect":["xA","go"]}`,
      `{"send":"e1","error":"busy"}`,
      `{"reset":true,"expect":["eA"]}`,
      `{"send":"e1","reenter":"go","expect":["xA","go","eB"],"active":["B"]}`,
      `{"send":"e1","expect":["xB","eA"]}`,
    ];
    const trace = parseTrace(`{"model":"m","steps":[${steps.join(",")}]}`);
    assert.deepEqual(runTrace(doc, trace), []);
    // raised where none was expected, expected but not raised, a nested call on the wrong action
    const wrong = parseTrace(`{"model":"m","steps":[{"reset":true,"raise":"zz","expect":["eA"]},{"send":"e1","reenter":"zz","expect":[]}]}`);
    const failures = runTrace(doc, wrong).map((f) => f.message);
    assert.match(failures[0]!, /'zz' was not called/);
    assert.match(failures[1]!, /'zz' was not called; expected the nested process\(\)/);
  });

  it("report differing traces", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -e1-> B"] });
    const trace = parseTrace(`{"model":"m","steps":[{"reset":true,"expect":["eA"]},{"send":"e1","expect":["xA","eX"],"active":["A"]}]}`);
    const failures = runTrace(doc, trace);
    assert.equal(failures.length, 2);
    assert.match(formatFailure(trace, failures[0]!), /expected: xA eX\n {4}actual: {3}xA eB/);
    assert.match(failures[1]!.message, /'A' is not active/);
  });

  it("check states that must not be active", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -e1-> B"] });
    const trace = parseTrace(`{"model":"m","steps":[{"reset":true,"expect":["eA"],"inactive":["B"]},{"send":"e1","expect":["xA","eB"],"inactive":["B"]}]}`);
    const failures = runTrace(doc, trace);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.step, 1);
    assert.match(failures[0]!.message, /'B' is active but should not be/);
  });

  it("take a signal queue size and a livelock limit", () => {
    const doc = machine({ root: ["A", "B"], transitions: ["A -auto-> B", "B -e1-> A"] });
    const trace = parseTrace(`{"model":"m","options":{"signalQueue":2,"maxMicrosteps":1},"steps":[{"reset":true,"expect":["eA","xA","eB"]},{"send":"e1","error":"livelock"}]}`);
    assert.deepEqual(trace.options, { signalQueue: 2, maxMicrosteps: 1 });
    assert.equal(runTrace(doc, trace).length, 0);
    for (const bad of [`{"queue":2}`, `{"maxMicrosteps":-1}`, `{"signalQueue":1.5}`]) {
      assert.throws(() => parseTrace(`{"model":"m","options":${bad},"steps":[]}`), /options/);
    }
  });

  it(`live in ${relative(repoRoot, traceDir)}`, () => assert.ok(existsSync(traceDir)));
});
