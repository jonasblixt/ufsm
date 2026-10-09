// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDecl,
  addInternal,
  addRegion,
  addTransition,
  addVertex,
  copyFragment,
  deleteDecl,
  deleteElements,
  indexV1,
  insertBendPoint,
  loadModel,
  moveVertices,
  pasteFragment,
  renameDecl,
  renameVertex,
  resizeVertex,
  serializeV1,
  setGuard,
  setStateActions,
  setTargetOption,
  setTrigger,
  type UfsmDocument,
} from "@ufsm/core";
import { History } from "../src/history";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (): UfsmDocument => loadModel(readFileSync(join(repoRoot, "examples/dimmer.ufsm"), "utf8")).doc;
const firstState = (doc: UfsmDocument): string => doc.machine.root.states.find((v) => v.kind === "state")!.id;

describe("editor undo history", () => {
  it("records an edit as one step and undoes and redoes it exactly", () => {
    const doc = load();
    const text = serializeV1(doc);
    const h = new History(doc);
    const id = firstState(doc);
    assert.equal(h.edit((d) => void moveVertices(d, [id], 40, 20, id)), true);
    const edited = serializeV1(h.current);
    assert.notEqual(edited, text);
    assert.equal(serializeV1(doc), text, "the loaded document is never mutated");
    const v1 = h.version;
    assert.notEqual(v1, 0);
    assert.ok(h.undo());
    assert.equal(serializeV1(h.current), text);
    assert.equal(h.version, 0, "back at the loaded version");
    assert.ok(!h.undo(), "nothing more to undo");
    assert.ok(h.redo());
    assert.equal(serializeV1(h.current), edited);
    assert.equal(h.version, v1, "redo returns to the same version");
    assert.ok(!h.redo());
  });

  it("records nothing for an edit that changes nothing", () => {
    const h = new History(load());
    const before = h.current;
    assert.equal(h.edit(() => undefined), false);
    assert.equal(h.current, before);
    assert.ok(!h.canUndo);
  });

  it("previews an interactive edit from its start and records only the result", () => {
    const doc = load();
    const id = firstState(doc);
    const h = new History(doc);
    h.begin();
    h.preview((d) => void moveVertices(d, [id], 100, 0, id));
    h.preview((d) => void moveVertices(d, [id], 30, 0, id));
    assert.equal(h.current.diagram!.states[id]!.x, doc.diagram!.states[id]!.x + 30, "not 130: every preview starts over");
    assert.ok(!h.canUndo, "no undo while dragging");
    assert.ok(h.commit());
    assert.ok(h.undo());
    assert.equal(serializeV1(h.current), serializeV1(doc), "one step undoes the whole drag");
  });

  it("cancels an interactive edit without a trace, and a drag back to the start records nothing", () => {
    const doc = load();
    const id = firstState(doc);
    const h = new History(doc);
    h.begin();
    h.preview((d) => void resizeVertex(d, id, { right: 2000 }));
    h.cancel();
    assert.equal(h.current, doc);
    h.begin();
    h.preview((d) => void moveVertices(d, [id], 50, 0, id));
    h.preview((d) => void moveVertices(d, [id], 0, 0, id));
    assert.equal(h.commit(), false);
    assert.equal(h.current, doc);
    assert.ok(!h.canUndo);
  });

  it("drops the redo steps when a new edit is made", () => {
    const doc = load();
    const id = firstState(doc);
    const h = new History(doc);
    h.edit((d) => void moveVertices(d, [id], 50, 0, id));
    h.undo();
    assert.ok(h.canRedo);
    h.edit((d) => void moveVertices(d, [id], 0, 50, id));
    assert.ok(!h.canRedo);
    assert.notEqual(h.version, 0);
  });

  it("runs the structure edits on Immer drafts: each one a step that undoes and redoes exactly", () => {
    for (const f of ["examples/dimmer.ufsm", "examples/test_model1.ufsm", "tests/models/canvas.ufsm"]) {
      const doc = loadModel(readFileSync(join(repoRoot, f), "utf8")).doc;
      const h = new History(doc);
      const texts = [serializeV1(doc)];
      const index = indexV1(doc);
      const states = [...index.vertices.values()].filter((i) => i.vertex.kind === "state").map((i) => i.vertex.id);
      const a = states[0]!, b = states[states.length - 1]!;
      const step = (recipe: (d: UfsmDocument) => void): void => {
        assert.ok(h.edit((d) => recipe(d as UfsmDocument)), f);
        texts.push(serializeV1(h.current));
      };
      step((d) => void addVertex(d, d.machine.root.id, "state", { x: 3000, y: 100, w: 160, h: 80 }));
      step((d) => void addRegion(d, a));
      let t = "";
      step((d) => void (t = addTransition(d, a, b)));
      step((d) => void insertBendPoint(d, t, { x: 0, y: 0 }));
      const frag = copyFragment(indexV1(h.current), [a, b])!;
      step((d) => void pasteFragment(d, frag, d.machine.root.id, { x: 3000, y: 400 }, { keepOuterStateRefs: true }));
      step((d) => void deleteElements(d, [a]));
      assert.equal(serializeV1(doc), texts[0], `${f}: the loaded document is never mutated`);
      for (let i = texts.length - 1; i > 0; i--) {
        assert.ok(h.undo());
        assert.equal(serializeV1(h.current), texts[i - 1], `${f}: undo to step ${i - 1}`);
      }
      for (let i = 1; i < texts.length; i++) {
        assert.ok(h.redo());
        assert.equal(serializeV1(h.current), texts[i], `${f}: redo to step ${i}`);
      }
    }
  });

  it("runs the property edits on Immer drafts with exact undo/redo", () => {
    const doc = loadModel(readFileSync(join(repoRoot, "tests/models/test_model1.ufsm"), "utf8")).doc;
    const h = new History(doc);
    const texts = [serializeV1(doc)];
    const step = (recipe: (d: UfsmDocument) => void): void => {
      assert.ok(h.edit((d) => recipe(d as UfsmDocument)));
      texts.push(serializeV1(h.current));
    };
    const s = firstState(doc);
    const t = doc.machine.transitions.find((x) => x.on)!.id;
    let act = "";
    step((d) => void (act = addDecl(d, "action", "fresh_action")));
    step((d) => setStateActions(d, s, "entry", [{ call: act }]));
    step((d) => renameVertex(d, s, "Renamed"));
    step((d) => setTrigger(d, t, { auto: true }));
    step((d) => setGuard(d, t, [{ in: s, not: true }]));
    step((d) => void addInternal(d, s, doc.declarations.events[0]!.id));
    step((d) => renameDecl(d, act, "renamed_action"));
    step((d) => setTargetOption(d, "c", "prefix", "m_"));
    step((d) => deleteDecl(d, doc.declarations.events[0]!.id));
    for (let i = texts.length - 1; i > 0; i--) {
      assert.ok(h.undo());
      assert.equal(serializeV1(h.current), texts[i - 1], `undo to step ${i - 1}`);
    }
    for (let i = 1; i < texts.length; i++) {
      assert.ok(h.redo());
      assert.equal(serializeV1(h.current), texts[i], `redo to step ${i}`);
    }
  });
});
