// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexV1, loadModel, parseV1, type LoadedModel } from "@ufsm/core";
import { deleteElements, moveVertices } from "@ufsm/core/edit";
import { edgeGeometry, estimateLabelWidth, transitionLabelBox, vertexBox } from "@ufsm/core/diagram";
import { gripAt } from "../src/handles";
import { arrowTargetAt, boxSelect, hitAnnotation, hitTest, hitTransition, sheetBounds } from "../src/hit";
import { Workspace, type Change } from "../src/workspace";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (rel: string): LoadedModel => loadModel(readFileSync(join(repoRoot, rel), "utf8"));

/** A workspace with the dimmer example open and shown, recording every change. */
function dimmer(): { ws: Workspace; changes: Change[][] } {
  const ws = new Workspace();
  const changes: Change[][] = [];
  ws.onChange((c) => changes.push([...c]));
  ws.activate(ws.open(load("examples/dimmer.ufsm"), "dimmer.ufsm", undefined));
  changes.length = 0;
  return { ws, changes };
}

const stateNamed = (ws: Workspace, name: string): string =>
  [...ws.active!.index.vertices.values()].find((v) => v.vertex.kind === "state" && v.vertex.name === name)!.vertex.id;

describe("editor workspace", () => {
  it("opens machines as tabs and shows one at a time", () => {
    const ws = new Workspace();
    const seen: Change[][] = [];
    ws.onChange((c) => seen.push([...c]));
    const a = ws.open(load("examples/dimmer.ufsm"), "dimmer.ufsm", undefined);
    const b = ws.open(load("examples/led.ufsm"), "led.ufsm", undefined);
    assert.equal(ws.active, undefined, "opening does not show");
    ws.activate(a);
    assert.equal(ws.active, a);
    assert.deepEqual(seen, [["active"]]);
    ws.cycle(1);
    assert.equal(ws.active, b);
    ws.cycle(1);
    assert.equal(ws.active, a, "cycling wraps around");
    assert.notEqual(a.key, b.key);
    assert.equal(ws.byKey(b.key), b);
  });

  it("closing the shown machine shows its neighbour", () => {
    const ws = new Workspace();
    const a = ws.open(load("examples/dimmer.ufsm"), "dimmer.ufsm", undefined);
    const b = ws.open(load("examples/led.ufsm"), "led.ufsm", undefined);
    ws.activate(b);
    ws.close(b);
    assert.equal(ws.active, a);
    ws.close(a);
    assert.equal(ws.active, undefined);
    assert.equal(ws.sessions.length, 0);
  });

  it("an edit is one undo step, makes the machine dirty and says the document changed", () => {
    const { ws, changes } = dimmer();
    const d = ws.active!;
    const id = stateNamed(ws, "Off");
    assert.equal(d.dirty, false);
    ws.edit((x) => void moveVertices(x, [id], 40, 0, id));
    assert.equal(d.dirty, true);
    assert.deepEqual(changes, [["document"]]);
    ws.undo();
    assert.equal(d.dirty, false, "undone back to the saved version");
    ws.edit(() => undefined);
    assert.equal(changes.length, 2, "an edit that changes nothing announces nothing");
  });

  it("drops deleted elements from the selection and rechecks the design rules", () => {
    const { ws } = dimmer();
    const d = ws.active!;
    const id = stateNamed(ws, "On");
    ws.select([id]);
    assert.equal(ws.single()?.id, id);
    const before = d.diagnostics;
    ws.edit((x) => void deleteElements(x, [id]));
    assert.equal(d.selection.size, 0);
    assert.equal(d.index.vertices.has(id), false);
    assert.notEqual(d.diagnostics, before, "the check ran again");
  });

  it("an interactive edit previews from its start and commits as one step", () => {
    const { ws } = dimmer();
    const d = ws.active!;
    const id = stateNamed(ws, "Off");
    const x0 = vertexBox(d.index, id).x;
    d.begin();
    d.preview((x) => void moveVertices(x, [id], 20, 0, id));
    d.preview((x) => void moveVertices(x, [id], 40, 0, id));
    assert.equal(vertexBox(d.index, id).x, x0 + 40, "each preview starts from the document as it was");
    d.commit();
    assert.equal(d.history.canUndo, true);
    d.undo();
    assert.equal(vertexBox(d.index, id).x, x0, "one undo step");
    d.begin();
    d.preview((x) => void moveVertices(x, [id], 40, 0, id));
    d.cancel();
    assert.equal(vertexBox(d.index, id).x, x0, "a cancelled edit leaves nothing");
  });

  it("keeps a status message until the next press", () => {
    const { ws, changes } = dimmer();
    ws.say("hello");
    assert.equal(ws.note, "hello");
    ws.clearNote();
    ws.clearNote();
    assert.equal(ws.note, undefined);
    assert.deepEqual(changes, [["chrome"], ["chrome"]]);
  });

  it("has no simulation to show until one runs", () => {
    const { ws } = dimmer();
    assert.equal(ws.active!.simHighlight(), undefined);
    assert.equal(ws.active!.wouldMap().size, 0);
  });
});

describe("hit testing (no DOM)", () => {
  it("finds the innermost vertex under a point, and what a rubber band encloses or touches", () => {
    const { ws } = dimmer();
    const d = ws.active!;
    const id = stateNamed(ws, "Off");
    const b = vertexBox(d.index, id);
    assert.equal(hitTest(d.index, d.sheet, b.x + b.w / 2, b.y + 10).vertex?.id, id);
    assert.equal(hitTest(d.index, d.sheet, -1000, -1000).vertex, undefined);
    const around = { x0: b.x - 1, y0: b.y - 1, x1: b.x + b.w + 1, y1: b.y + b.h + 1 };
    assert.ok(boxSelect(d.index, d.sheet, around, "enclosed").includes(id));
    const corner = { x0: b.x - 5, y0: b.y - 5, x1: b.x + 5, y1: b.y + 5 };
    assert.ok(!boxSelect(d.index, d.sheet, corner, "enclosed").includes(id));
    assert.ok(boxSelect(d.index, d.sheet, corner, "touching").includes(id));
    const all = sheetBounds(d.index, d.sheet)!;
    assert.ok(all.x0 <= b.x && all.x1 >= b.x + b.w);
  });

  it("picks a transition by its label (measured by the caller) or its line", () => {
    const { ws } = dimmer();
    const d = ws.active!;
    const t = [...d.index.transitions.values()].find((x) => edgeGeometry(d.index, x.id)?.label)!;
    const box = transitionLabelBox(d.index, t, estimateLabelWidth)!;
    assert.deepEqual(hitTransition(d.index, d.sheet, box.x + 2, box.y + 2, 4, estimateLabelWidth), {
      id: t.id,
      label: true,
    });
    const [p, q] = edgeGeometry(d.index, t.id)!.points;
    const mid = { x: (p!.x + q!.x) / 2, y: (p!.y + q!.y) / 2 };
    assert.equal(hitTransition(d.index, d.sheet, mid.x, mid.y, 4, estimateLabelWidth)?.id !== undefined, true);
  });

  it("a frame in a state's region wins over that state, selected or not, but not over the states in its region", () => {
    // P (100,100 400x300) holds r1 with A (abs 120,250) and frame g1 (abs 150,300 150x80) without a caption
    const doc = parseV1(
      JSON.stringify({
        format: "ufsm",
        version: 1,
        name: "frames",
        declarations: { events: [], signals: [], actions: [], guards: [] },
        machine: {
          root: {
            id: "r0",
            states: [
              {
                id: "s1",
                kind: "state",
                name: "P",
                regions: [{ id: "r1", states: [{ id: "s2", kind: "state", name: "A" }] }],
              },
            ],
          },
          transitions: [],
        },
        diagram: {
          paper: "A4",
          states: { s1: { x: 100, y: 100, w: 400, h: 300 }, s2: { x: 20, y: 150, w: 100, h: 60 } },
          regions: {},
          transitions: {},
          frames: { g1: { region: "r1", x: 50, y: 200, w: 150, h: 80 } },
        },
      }),
    );
    const index = indexV1(doc);
    const sheet = doc.machine.root;
    const grip = (x: number, y: number, selected: string[]) =>
      gripAt(index, sheet, new Set(selected), [], x, y, 1, false)?.grip;
    const under = (x: number, y: number) => hitTest(index, sheet, x, y, 6).vertex;
    // its left edge, inside P's region
    assert.equal(under(150, 340)?.id, "s1");
    assert.equal(hitAnnotation(index, sheet, 150, 340, 6, "frames", undefined, under(150, 340)), "g1");
    assert.deepEqual(grip(150, 340, []), { kind: "move", id: "g1" });
    assert.deepEqual(grip(150, 340, ["s1"]), { kind: "move", id: "g1" });
    // its inside is P's (a press there moves the selected P), A over its corner is A's
    assert.deepEqual(grip(220, 340, ["s1"]), { kind: "move", id: "s1" });
    assert.equal(hitAnnotation(index, sheet, 150, 300, 6, "frames", undefined, under(150, 300)), undefined);
    assert.equal(under(150, 300)?.id, "s2");
    // an arrow pointed inside it attaches to the frame, not to P
    assert.equal(arrowTargetAt(index, sheet, 220, 340, 6), "g1");
  });
});
