// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The design rule check is the one validity gate: a model checkV1 reports no errors on gets through every later stage
 * (structure, flat tables, IR, every backend, the interpreter), and a model it rejects fails there with the stage's own
 * error class (CodegenError, MachineError), never with an internal one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CODE_TARGETS, CodegenError, Interpreter, MachineError, checkV1, generateFiles, indexV1, type State, type UfsmDocument } from "../src/index";
import { randomModel, rng } from "./random-model";

function baseDoc(): UfsmDocument {
  return {
    format: "ufsm",
    version: 1,
    name: "m",
    declarations: { events: [{ id: "ev1", name: "e1" }], signals: [], actions: [], guards: [] },
    machine: {
      root: {
        id: "r0",
        states: [
          { id: "s1", kind: "initial" },
          { id: "s2", kind: "state", name: "A" },
          { id: "s3", kind: "state", name: "B" },
        ],
      },
      transitions: [
        { id: "t1", from: "s1", to: "s2" },
        { id: "t2", from: "s2", to: "s3", on: "ev1" },
      ],
    },
  };
}

/** Every stage after the check, as the CLI and the editor run them. Throws what the first failing stage throws. */
function runAllStages(doc: UfsmDocument): void {
  for (const target of CODE_TARGETS) generateFiles(doc, target);
  new Interpreter(doc);
}

/** The model has the error `code` on `id`, and every later stage refuses it with its own error class. */
function rejected(doc: UfsmDocument, code: string, id: string): void {
  const found = checkV1(doc).filter((d) => d.severity === "error").map((d) => `${d.code} ${d.id}`);
  assert.ok(found.includes(`${code} ${id}`), `expected ${code} on ${id}, got ${JSON.stringify(found)}`);
  for (const target of CODE_TARGETS) assert.throws(() => generateFiles(doc, target), CodegenError);
  assert.throws(() => new Interpreter(doc), (e) => e instanceof MachineError && e.code === "invalid-model");
}

describe("the design rule check as the validity gate", () => {
  it("a fork without outgoing transitions", () => {
    const doc = baseDoc();
    doc.machine.root.states.push({ id: "f1", kind: "fork" });
    doc.machine.transitions.push({ id: "t3", from: "s3", to: "f1", on: "ev1" });
    rejected(doc, "fork-no-outgoing", "f1");
  });

  it("forks in a cycle", () => {
    const doc = baseDoc();
    doc.machine.root.states.push({ id: "f1", kind: "fork" }, { id: "f2", kind: "fork" });
    doc.machine.transitions.push(
      { id: "t3", from: "s3", to: "f1", on: "ev1" },
      { id: "t4", from: "f1", to: "f2" },
      { id: "t5", from: "f2", to: "f1" },
    );
    rejected(doc, "fork-cycle", "f1");
    rejected(doc, "fork-cycle", "f2");
  });

  it("a transition into a join from something other than a state", () => {
    const doc = baseDoc();
    doc.machine.root.states.push({ id: "j1", kind: "join" });
    doc.machine.transitions[0]!.to = "j1";
    doc.machine.transitions.push({ id: "t3", from: "j1", to: "s2" });
    rejected(doc, "join-incoming", "t1");
  });

  it("an initial transition that leaves its region", () => {
    const doc = baseDoc();
    const a = doc.machine.root.states[1] as State;
    a.regions = [{ id: "r1", states: [{ id: "s4", kind: "initial" }, { id: "s5", kind: "state", name: "C" }] }];
    doc.machine.transitions.push({ id: "t3", from: "s4", to: "s3" }, { id: "t4", from: "s5", to: "s3", on: "ev1" });
    rejected(doc, "initial-target", "t3");
  });

  it("an initial transition to itself", () => {
    const doc = baseDoc();
    doc.machine.transitions[0]!.to = "s1";
    rejected(doc, "initial-target", "t1");
  });

  it("an initial transition to a terminate", () => {
    const doc = baseDoc();
    doc.machine.root.states.push({ id: "x1", kind: "terminate" });
    doc.machine.transitions[0]!.to = "x1";
    rejected(doc, "initial-target", "t1");
  });

  it("random models with random defects: rejected by the check, or accepted by every stage", () => {
    const kinds = ["fork", "join", "initial", "terminate", "shallow-history", "deep-history", "final"] as const;
    const runs = Number(process.env["UFSM_GATE_RANDOM"] ?? 600);
    let accepted = 0;
    for (let seed = 1; seed <= runs; seed++) {
      const doc = randomModel(seed, { joins: true });
      const r = rng(seed * 7919);
      const int = (n: number): number => Math.floor(r() * n);
      const index = indexV1(doc);
      const vertices = [...index.vertices.keys()];
      const regions = [...index.regions.values()].map((x) => x.region);
      const ts = doc.machine.transitions;
      let n = 0;
      // one to three defects: drop a transition, move one of its ends, or add a pseudo-state with random connections
      for (let m = 1 + int(3); m > 0; m--) {
        const k = int(5);
        if (k === 0 && ts.length) ts.splice(int(ts.length), 1);
        else if (k === 1 && ts.length) ts[int(ts.length)]!.to = vertices[int(vertices.length)]!;
        else if (k === 2 && ts.length) ts[int(ts.length)]!.from = vertices[int(vertices.length)]!;
        else {
          const id = `zz${++n}`;
          regions[int(regions.length)]!.states.push({ id, kind: kinds[int(kinds.length)]! });
          if (doc.diagram) doc.diagram.states[id] = { x: 0, y: 0, w: 10, h: 10 };
          if (r() < 0.5) ts.push({ id: `zz${++n}`, from: vertices[int(vertices.length)]!, to: id });
          if (r() < 0.6) ts.push({ id: `zz${++n}`, from: id, to: vertices[int(vertices.length)]! });
        }
      }
      if (checkV1(doc).some((d) => d.severity === "error")) continue;
      accepted++;
      assert.doesNotThrow(() => runAllStages(doc), `seed ${seed}`);
    }
    assert.ok(accepted > runs / 10, `only ${accepted} of ${runs} mutated models passed the check`);
  });
});
