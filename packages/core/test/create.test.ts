// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IdAllocator,
  NEW_BAND,
  addRegion,
  addTransition,
  addVertex,
  cannotAdd,
  cannotConnect,
  checkV1,
  copyFragment,
  deleteElements,
  documentIds,
  draggedVertexBox,
  edgeGeometry,
  indexV1,
  insertBendPoint,
  isOffPage,
  loadModel,
  newVertexBox,
  parseV1,
  pasteFragment,
  regionAt,
  regionBoxes,
  removeBendPoint,
  serializeV1,
  sheetOfVertex,
  toFreeRoute,
  toSRoute,
  uniqueStateName,
  vertexBox,
  type Box,
  type FreeEdgeLayout,
  type State,
  type Point,
  type UfsmDocument,
} from "../src/index";
import { randomModel, rng } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 *   Initial ─► P (100,100 400x300)  ── t5 ──►  C (700,100 120x80)
 *              ├ r1 (h 130): A (abs 120,150 100x60), D (abs 300,150 80x60); t6 A→D free (inside r1)
 *              └ r2 (fill):  B (abs 300,290 100x60)
 *   t2 A→B free (via in root coordinates), t3 B→C S auto, t4 A→C S with jog x 600
 */
function testDoc(): UfsmDocument {
  return parseV1(
    JSON.stringify({
      format: "ufsm",
      version: 1,
      name: "create",
      declarations: {
        events: [{ id: "ev1", name: "e1" }],
        signals: [{ id: "sig1", name: "s1" }],
        actions: [{ id: "act1", name: "a1" }],
        guards: [{ id: "grd1", name: "g1" }],
      },
      machine: {
        root: {
          id: "r0",
          states: [
            { id: "s1", kind: "initial" },
            {
              id: "s2",
              kind: "state",
              name: "P",
              regions: [
                { id: "r1", states: [{ id: "s3", kind: "state", name: "A" }, { id: "s6", kind: "state", name: "D" }] },
                { id: "r2", states: [{ id: "s4", kind: "state", name: "B" }] },
              ],
            },
            { id: "s5", kind: "state", name: "C", entry: [{ call: "act1" }], internal: [{ id: "t7", on: "ev1", guard: [{ in: "s3" }] }] },
          ],
        },
        transitions: [
          { id: "t1", from: "s1", to: "s2" },
          { id: "t2", from: "s3", to: "s4", on: "ev1", guard: [{ call: "grd1" }], do: [{ emit: "sig1" }] },
          { id: "t3", from: "s4", to: "s5", on: "ev1", guard: [{ in: "s3" }, { call: "grd1" }] },
          { id: "t4", from: "s3", to: "s5", on: "ev1" },
          { id: "t5", from: "s2", to: "s5", on: "ev1", guard: [{ in: "s6", not: true }] },
          { id: "t6", from: "s3", to: "s6", on: "sig1", guard: [{ in: "s4" }] },
        ],
      },
      diagram: {
        paper: "A4",
        states: {
          s1: { x: 40, y: 40, w: 20, h: 20 },
          s2: { x: 100, y: 100, w: 400, h: 300 },
          s3: { x: 20, y: 50, w: 100, h: 60 },
          s4: { x: 200, y: 190, w: 100, h: 60 },
          s5: { x: 700, y: 100, w: 120, h: 80 },
          s6: { x: 200, y: 50, w: 80, h: 60 },
        },
        regions: { r1: { h: 130 } },
        transitions: {
          t1: { from: { side: "right", offset: 10 }, to: { side: "left", offset: 20 } },
          t2: { from: { side: "bottom", offset: 50 }, to: { side: "left", offset: 30 }, via: [[170, 320]], label: { x: 180, y: 260, w: 100 } },
          t3: { route: "s" },
          t4: { route: "s", jog: { x: 600 } },
          t5: {
            from: { side: "right", offset: 50 },
            to: { side: "left", offset: 30 },
            via: [[600, 150], [600, 130]],
            label: { x: 520, y: 100, w: 150 },
          },
          t6: { from: { side: "right", offset: 30 }, to: { side: "left", offset: 30 }, via: [[150, 80]] },
        },
      },
    }),
  );
}

const clone = (doc: UfsmDocument): UfsmDocument => structuredClone(doc);
const box = (doc: UfsmDocument, id: string): Box => vertexBox(indexV1(doc), id);
const free = (doc: UfsmDocument, id: string): FreeEdgeLayout => doc.diagram!.transitions[id] as FreeEdgeLayout;
/** Errors that a structure edit must never cause. */
const BROKEN = new Set(["duplicate-id", "dangling-ref", "wrong-ref", "stale-layout", "missing-layout", "duplicate-name", "bad-name"]);
const broken = (doc: UfsmDocument): string[] =>
  checkV1(doc)
    .filter((d) => BROKEN.has(d.code))
    .map((d) => `${d.code}: ${d.message}`);
const roundTrips = (doc: UfsmDocument): void => {
  const text = serializeV1(doc);
  assert.equal(serializeV1(parseV1(text)), text);
};

describe("ids", () => {
  it("allocate the next number after the highest in use, per prefix", () => {
    const doc = testDoc();
    const ids = new IdAllocator(doc);
    assert.equal(ids.take("s"), "s7");
    assert.equal(ids.take("s"), "s8");
    assert.equal(ids.take("r"), "r3");
    assert.equal(ids.take("t"), "t8", "internal transitions share the t space (t7)");
    assert.equal(ids.take("ev"), "ev2");
    assert.equal(ids.take("sig"), "sig2", "sig is not s");
    assert.equal(ids.take("x"), "x1");
    assert.ok(documentIds(doc).has("t7"));
    // the highest number, not the last one seen: ids need not be in order, and may have gaps
    const gaps = testDoc();
    gaps.machine.root.states.reverse();
    gaps.machine.root.states[0]!.id = "s50"; // C, now first; its layout does not matter here
    const ids2 = new IdAllocator(gaps);
    assert.equal(ids2.take("s"), "s51");
  });
});

describe("structure edits: adding", () => {
  it("find the innermost inline region under a point", () => {
    const index = indexV1(testDoc());
    const root = index.doc.machine.root;
    assert.equal(regionAt(index, root, { x: 150, y: 200 }).id, "r1");
    assert.equal(regionAt(index, root, { x: 320, y: 300 }).id, "r2");
    assert.equal(regionAt(index, root, { x: 600, y: 50 }).id, "r0");
    assert.equal(regionAt(index, root, { x: 200, y: 110 }).id, "r0", "a header is not inside a region");
    const off = testDoc();
    off.diagram!.regions["r1"] = { h: 130, offPage: true };
    const oi = indexV1(off);
    assert.equal(regionAt(oi, oi.doc.machine.root, { x: 150, y: 200 }).id, "r0", "off-page contents are on their own sheet");
    assert.equal(regionAt(oi, oi.regions.get("r1")!.region, { x: 30, y: 40 }).id, "r1");
  });

  it("box a clicked or dragged vertex on the grid", () => {
    assert.deepEqual(newVertexBox("state", { x: 303, y: 207 }), { x: 220, y: 170, w: 160, h: 80 });
    assert.deepEqual(newVertexBox("initial", { x: 303, y: 207 }), { x: 290, y: 200, w: 20, h: 20 });
    assert.deepEqual(newVertexBox("fork", { x: 303, y: 207 }, true), { x: 250, y: 200, w: 100, h: 10 });
    assert.deepEqual(draggedVertexBox("state", { x: 303, y: 207 }, { x: 101, y: 98 }), { x: 100, y: 100, w: 200, h: 110 });
    assert.deepEqual(draggedVertexBox("state", { x: 100, y: 100 }, { x: 104, y: 103 }), { x: 100, y: 100, w: 40, h: 40 }, "at least 40 square");
    assert.deepEqual(draggedVertexBox("join", { x: 100, y: 100 }, { x: 140, y: 300 }), { x: 100, y: 100, w: 10, h: 200 });
    assert.deepEqual(draggedVertexBox("final", { x: 100, y: 100 }, { x: 300, y: 300 }), { x: 290, y: 290, w: 20, h: 20 }, "placed at the release");
  });

  it("add a state relative to its region, named StateN, kept inside the band", () => {
    const doc = testDoc();
    const machine = clone(doc).machine;
    const id = addVertex(doc, "r2", "state", { x: 150, y: 300, w: 120, h: 60 });
    assert.equal(id, "s7");
    const s = indexV1(doc).vertices.get(id)!;
    assert.equal(s.region.id, "r2");
    assert.deepEqual(s.vertex, { id: "s7", kind: "state", name: "State1" });
    assert.deepEqual(doc.diagram!.states[id], { x: 50, y: 200, w: 120, h: 60 }, "relative to P's corner");
    assert.deepEqual(machine.root.states.length, doc.machine.root.states.length);
    // too tall for r1 (130): shrunk and moved into the band
    const tall = addVertex(doc, "r1", "state", { x: 150, y: 100, w: 100, h: 300 });
    assert.deepEqual(box(doc, tall), { x: 150, y: 130, w: 100, h: 130 });
    assert.equal(uniqueStateName(indexV1(doc)), "State3");
    // the sheet: non-negative
    const neg = addVertex(doc, "r0", "final", { x: -50, y: -50, w: 99, h: 99 });
    assert.deepEqual(doc.diagram!.states[neg], { x: 0, y: 0, w: 20, h: 20 }, "round pseudo states are 20 square");
    const bar = addVertex(doc, "r0", "fork", { x: 600, y: 600, w: 123, h: 10 }, { horizontal: true });
    assert.deepEqual(doc.diagram!.states[bar], { x: 600, y: 600, w: 120, h: 10, orientation: "horizontal" });
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });

  it("refuse a second initial or history state in a region", () => {
    const index = indexV1(testDoc());
    assert.match(cannotAdd(index, "r0", "initial")!, /already has an initial state/);
    assert.match(cannotAdd(index, "r0", "deep-history")!, /already has an initial state/);
    assert.equal(cannotAdd(index, "r1", "shallow-history"), undefined);
    assert.equal(cannotAdd(index, "r0", "final"), undefined);
    assert.equal(cannotAdd(index, "r0", "state"), undefined);
  });

  it("add a region at the bottom: the state grows, the previous last region keeps its height", () => {
    const doc = testDoc();
    const r = addRegion(doc, "s2")!;
    assert.equal(r, "r3");
    const index = indexV1(doc);
    const p = index.vertices.get("s2")!.vertex as State;
    assert.deepEqual(p.regions!.map((x) => x.id), ["r1", "r2", "r3"]);
    assert.equal(doc.diagram!.states["s2"]!.h, 300 + NEW_BAND);
    assert.deepEqual(doc.diagram!.regions["r2"], { h: 140 }, "r2 was filling 260..400");
    assert.equal(doc.diagram!.regions["r3"], undefined, "the new last region fills");
    assert.deepEqual(regionBoxes(index, p).map((b) => b.box.h), [130, 140, NEW_BAND]);
    // a simple state gets at least NEW_BAND below its header
    const c = addRegion(doc, "s5")!;
    assert.equal(doc.diagram!.states["s5"]!.h, 30 + 60 + NEW_BAND, "header, entry + internal lines, band");
    assert.deepEqual(indexV1(doc).regions.get(c)!.owner!.id, "s5");
    assert.equal(addRegion(doc, "s1"), undefined, "not a state");
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });

  it("check transition ends", () => {
    const doc = testDoc();
    const final = addVertex(doc, "r0", "final", { x: 900, y: 500, w: 20, h: 20 });
    const index = indexV1(doc);
    assert.match(cannotConnect(index, final)!, /final state has no outgoing/);
    assert.match(cannotConnect(index, "s1")!, /initial state has exactly one/);
    assert.equal(cannotConnect(index, "s3", "s4"), undefined);
    assert.equal(cannotConnect(index, "s3", final), undefined);
    assert.match(cannotConnect(index, "s5", "s1")!, /initial state cannot be the target/, "UML: no transitions into an initial state");
    const history = addVertex(doc, "r1", "shallow-history", { x: 140, y: 270, w: 20, h: 20 });
    assert.equal(cannotConnect(indexV1(doc), "s5", history), undefined, "history states are valid targets");
  });

  it("add a transition: S with automatic ends, or free through bend points", () => {
    const doc = testDoc();
    const s = addTransition(doc, "s4", "s6");
    assert.deepEqual(doc.machine.transitions.find((t) => t.id === s), { id: "t8", from: "s4", to: "s6" });
    assert.deepEqual(doc.diagram!.transitions[s], { route: "s" });
    const f = addTransition(doc, "s3", "s6", { via: [{ x: 172, y: 248 }, { x: 330, y: 251 }] });
    assert.deepEqual(free(doc, f), {
      from: { side: "bottom", offset: 50 },
      to: { side: "bottom", offset: 30 },
      via: [[70, 150], [230, 150]],
    }, "via relative to r1's origin (P's corner), ends nearest the first and last bend point");
    assert.deepEqual(edgeGeometry(indexV1(doc), f)!.points, [{ x: 170, y: 210 }, { x: 170, y: 250 }, { x: 330, y: 250 }, { x: 330, y: 210 }]);
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });

  it("add a straight transition: one line along the line between the centres, ends on the grid", () => {
    const doc = testDoc();
    const pts = (id: string): Point[] => edgeGeometry(indexV1(doc), id)!.points;
    const level = addTransition(doc, "s3", "s6", { route: "straight" });
    assert.deepEqual(free(doc, level), { from: { side: "right", offset: 30 }, to: { side: "left", offset: 30 } }, "level boxes: horizontal");
    assert.deepEqual(pts(level), [{ x: 220, y: 180 }, { x: 300, y: 180 }]);
    const diagonal = addTransition(doc, "s3", "s4", { route: "straight" });
    assert.deepEqual(pts(diagonal), [{ x: 210, y: 210 }, { x: 310, y: 290 }], "leaves A's bottom and enters B's top where the centre line does, snapped");
    const nested = addTransition(doc, "s2", "s3", { route: "straight" });
    assert.deepEqual(pts(nested), [{ x: 100, y: 180 }, { x: 220, y: 200 }], "a composite attaches at its side nearest to the inner centre");
    const loop = addTransition(doc, "s5", "s5", { route: "straight" });
    assert.deepEqual(free(doc, loop), {
      from: { side: "right", offset: 20 },
      to: { side: "top", offset: 100 },
      via: [[850, 120], [850, 70], [800, 70]],
    }, "a self-transition: a free loop around the top-right corner");
    for (const id of [level, diagonal, nested, loop]) assert.ok(pts(id).every((p) => p.x % 10 === 0 && p.y % 10 === 0), id);
    const bent = addTransition(doc, "s3", "s6", { route: "straight", via: [{ x: 172, y: 248 }] });
    assert.deepEqual(free(doc, bent)?.via, [[70, 150]], "bend points as before");
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });
});

describe("structure edits: bend points and route styles", () => {
  it("make an S route free with the same shape, and back", () => {
    const doc = testDoc();
    const before = edgeGeometry(indexV1(doc), "t4")!;
    toFreeRoute(doc, "t4");
    const e = free(doc, "t4");
    assert.equal(e.route, undefined);
    assert.ok(e.from && e.to && e.via && e.label);
    assert.deepEqual(edgeGeometry(indexV1(doc), "t4"), before);
    toSRoute(doc, "t4");
    assert.deepEqual(doc.diagram!.transitions["t4"], { route: "s" });
  });

  it("insert a bend point on the nearest segment and remove it again", () => {
    const doc = testDoc();
    // t5: P right (500,150) -> (600,150) -> (600,130) -> C left (700,130)
    assert.equal(insertBendPoint(doc, "t5", { x: 652, y: 128 }), 2);
    assert.deepEqual(free(doc, "t5").via, [[600, 150], [600, 130], [650, 130]]);
    removeBendPoint(doc, "t5", 0);
    assert.deepEqual(free(doc, "t5").via, [[600, 130], [650, 130]]);
    // an S route becomes free first
    const n = edgeGeometry(indexV1(doc), "t3")!.points.length;
    insertBendPoint(doc, "t3", { x: 420, y: 320 });
    assert.equal(free(doc, "t3").via!.length, n - 2 + 1);
    removeBendPoint(doc, "t6", 0);
    assert.equal(free(doc, "t6").via, undefined, "the last bend point removes `via`");
    roundTrips(doc);
  });
});

describe("structure edits: deleting", () => {
  it("delete a composite state with its contents, its transitions and the guard terms on them", () => {
    const doc = testDoc();
    const gone = deleteElements(doc, ["s2"]);
    assert.deepEqual([...gone].sort(), ["r1", "r2", "s2", "s3", "s4", "s6", "t1", "t2", "t3", "t4", "t5", "t6"]);
    assert.deepEqual(doc.machine.root.states.map((v) => v.id), ["s1", "s5"]);
    assert.deepEqual(doc.machine.transitions, []);
    assert.deepEqual(Object.keys(doc.diagram!.states).sort(), ["s1", "s5"]);
    assert.deepEqual(doc.diagram!.regions, {});
    assert.deepEqual(doc.diagram!.transitions, {});
    assert.deepEqual((doc.machine.root.states[1] as State).internal, [{ id: "t7", on: "ev1" }], "in A dropped, empty guard removed");
    assert.equal(doc.declarations.events.length, 1, "declarations stay");
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });

  it("delete a nested state: only the transitions touching it and the terms naming it", () => {
    const doc = testDoc();
    deleteElements(doc, ["s3"]);
    assert.deepEqual(doc.machine.transitions.map((t) => t.id), ["t1", "t3", "t5"]);
    assert.deepEqual(doc.machine.transitions.find((t) => t.id === "t3")!.guard, [{ call: "grd1" }]);
    assert.deepEqual(doc.machine.transitions.find((t) => t.id === "t5")!.guard, [{ in: "s6", not: true }]);
    assert.deepEqual(broken(doc), []);
  });

  it("delete transitions, internal ones too", () => {
    const doc = testDoc();
    deleteElements(doc, ["t3", "t7"]);
    assert.deepEqual(doc.machine.transitions.map((t) => t.id), ["t1", "t2", "t4", "t5", "t6"]);
    assert.equal(doc.diagram!.transitions["t3"], undefined);
    assert.equal((doc.machine.root.states[2] as State).internal, undefined);
    assert.deepEqual(deleteElements(doc, ["r0", "nope"]), new Set(), "the root region stays");
  });

  it("delete a region: the ones below move up with their contents, the state keeps its size", () => {
    const doc = testDoc();
    const b = box(doc, "s4");
    const t3 = edgeGeometry(indexV1(doc), "t3")!;
    deleteElements(doc, ["r1"]);
    const p = doc.machine.root.states[1] as State;
    assert.deepEqual(p.regions!.map((r) => r.id), ["r2"]);
    assert.deepEqual(box(doc, "s4"), { ...b, y: b.y - 130 });
    assert.deepEqual(doc.diagram!.states["s2"], { x: 100, y: 100, w: 400, h: 300 });
    assert.equal(doc.diagram!.regions["r1"], undefined);
    assert.deepEqual(doc.machine.transitions.map((t) => t.id), ["t1", "t3", "t5"], "t2, t4, t6 touched A or D");
    assert.notDeepEqual(edgeGeometry(indexV1(doc), "t3"), t3, "B moved, its S route follows");
    assert.deepEqual(broken(doc), []);

    const last = testDoc();
    deleteElements(last, ["r2"]);
    assert.deepEqual((last.machine.root.states[1] as State).regions!.map((r) => r.id), ["r1"]);
    assert.equal(last.diagram!.regions["r1"], undefined, "the new last region fills the state");
    const only = testDoc();
    deleteElements(only, ["r1", "r2"]);
    assert.equal((only.machine.root.states[1] as State).regions, undefined, "a simple state again");
    roundTrips(only);
  });
});

describe("structure edits: copy and paste", () => {
  it("copy a composite state with what is inside it, positions relative to the fragment", () => {
    const doc = testDoc();
    const frag = copyFragment(indexV1(doc), ["s2", "s3", "t5"])!;
    assert.deepEqual(frag.vertices.map((v) => v.id), ["s2"], "A comes with P");
    assert.deepEqual(frag.transitions.map((t) => t.id), ["t2", "t6"], "both ends copied; t5's target is not");
    assert.deepEqual(frag.diagram.states["s2"], { x: 0, y: 0, w: 400, h: 300 });
    assert.deepEqual(frag.diagram.states["s3"], { x: 20, y: 50, w: 100, h: 60 });
    assert.deepEqual(frag.outer, ["t2"], "A→B's common region is the root");
    assert.deepEqual((frag.diagram.transitions["t2"] as FreeEdgeLayout).via, [[70, 220]]);
    assert.deepEqual((frag.diagram.transitions["t6"] as FreeEdgeLayout).via, [[150, 80]], "inside r1: unchanged");
    assert.deepEqual(frag.declarations.map((d) => d.decl.name).sort(), ["e1", "g1", "s1"]);
    assert.equal(frag.w, 400);
    assert.equal(copyFragment(indexV1(doc), ["t2"]), undefined, "transitions alone are not copied");
  });

  it("paste into the same machine: fresh ids, same declarations, same shapes moved", () => {
    const doc = testDoc();
    const index0 = indexV1(doc);
    const frag = copyFragment(index0, ["s2"])!;
    const pasted = pasteFragment(doc, frag, "r0", { x: 603, y: 498 }, { keepOuterStateRefs: true });
    assert.deepEqual(pasted, ["s7", "t8", "t9"]);
    const index = indexV1(doc);
    assert.deepEqual(index.vertices.get("s7")!.vertex.kind, "state");
    assert.deepEqual(doc.declarations, testDoc().declarations, "matched by name");
    assert.deepEqual(box(doc, "s7"), { x: 600, y: 500, w: 400, h: 300 });
    const map: Record<string, string> = { t2: "t8", t6: "t9" };
    for (const [from, to] of Object.entries(map)) {
      const a = edgeGeometry(index0, from)!, b = edgeGeometry(index, to)!;
      assert.deepEqual(b.points, a.points.map((p) => ({ x: p.x + 500, y: p.y + 400 })), `${from} -> ${to}`);
      assert.deepEqual(b.label, a.label && { ...a.label, x: a.label.x + 500, y: a.label.y + 400 });
    }
    const t9 = index.transitions.get("t9")!;
    assert.equal(t9.on, "sig1");
    assert.deepEqual(t9.guard, [{ in: index.transitions.get("t8")!.to }], "in B -> in the copy of B");
    assert.deepEqual(broken(doc), []);
    const again = pasteFragment(doc, frag, "r0", { x: 1100, y: 500 });
    assert.deepEqual(again, ["s11", "t10", "t11"], "a second paste gets other ids");
    roundTrips(doc);
  });

  it("paste into another machine: declarations added (renamed on a clash), outside state terms dropped", () => {
    const src = testDoc();
    const frag = copyFragment(indexV1(src), ["s3", "s4"])!;
    assert.deepEqual(frag.transitions.map((t) => t.id), ["t2"]);
    const dst = parseV1(
      JSON.stringify({
        format: "ufsm",
        version: 1,
        name: "other",
        declarations: { events: [{ id: "ev1", name: "g1" }], signals: [], actions: [], guards: [] },
        machine: { root: { id: "r0", states: [] }, transitions: [] },
      }),
    );
    const ids = pasteFragment(dst, frag, "r0", { x: 0, y: 0 }, { keepOuterStateRefs: true });
    assert.deepEqual(dst.declarations.events, [{ id: "ev1", name: "g1" }, { id: "ev2", name: "e1" }]);
    assert.deepEqual(dst.declarations.guards, [{ id: "grd1", name: "g1_2" }], "g1 is an event there");
    assert.deepEqual(dst.declarations.signals, [{ id: "sig1", name: "s1" }]);
    const t = dst.machine.transitions[0]!;
    assert.deepEqual([t.on, t.guard, t.do], ["ev2", [{ call: "grd1" }], [{ emit: "sig1" }]]);
    assert.deepEqual(ids.length, 3);
    assert.deepEqual(broken(dst), []);
    // a term on a state that was not copied: dropped when the state is missing or not wanted
    const fragT6 = copyFragment(indexV1(src), ["s3", "s6"])!;
    const same = testDoc();
    pasteFragment(same, fragT6, "r0", { x: 700, y: 600 });
    assert.equal(same.machine.transitions.at(-1)!.guard, undefined, "in B dropped without keepOuterStateRefs");
    const kept = testDoc();
    pasteFragment(kept, fragT6, "r0", { x: 700, y: 600 }, { keepOuterStateRefs: true });
    assert.deepEqual(kept.machine.transitions.at(-1)!.guard, [{ in: "s4" }]);
  });

  it("paste inside a region band, moved in when it would stick out", () => {
    const doc = testDoc();
    const frag = copyFragment(indexV1(doc), ["s4"])!;
    const [id] = pasteFragment(doc, frag, "r1", { x: 450, y: 250 });
    assert.deepEqual(box(doc, id!), { x: 400, y: 200, w: 100, h: 60 }, "r1 is 100..500 x 130..260");
    assert.equal(indexV1(doc).vertices.get(id!)!.region.id, "r1");
  });
});

describe("structure edits on every repository model and random models", () => {
  const files = ["examples", "tests/models", "apps/editor/src/fsm"].flatMap((d) =>
    existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
  );
  const models = (): { name: string; doc: UfsmDocument }[] => [
    ...files.map((f) => ({ name: f, doc: loadModel(readFileSync(f, "utf8")).doc })),
    ...Array.from({ length: 40 }, (_, i) => ({ name: `random ${i}`, doc: laidOut(randomModel(1000 + i)) })),
  ];
  /** Random models have no diagram: give every vertex the default box geometry.ts assumes. */
  const laidOut = (doc: UfsmDocument): UfsmDocument => {
    const states: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of indexV1(doc).vertices.keys()) states[id] = { x: 0, y: 0, w: 100, h: 60 };
    doc.diagram = { paper: "A4", states, regions: {}, transitions: {} };
    return doc;
  };

  it("delete random selections without leaving dangling references or layouts", () => {
    const r = rng(11);
    let n = 0;
    for (const { name, doc: original } of models()) {
      const index = indexV1(original);
      const all = [...index.vertices.keys(), ...index.transitions.keys(), ...index.internals.keys(), ...[...index.regions.keys()].filter((id) => id !== "r0")];
      for (let k = 0; k < 8; k++) {
        const doc = clone(original);
        const pick = all.filter(() => r() < 0.15);
        deleteElements(doc, pick);
        assert.deepEqual(broken(doc), [], `${name}: deleting ${pick.join(" ")}`);
        const left = indexV1(doc);
        for (const id of pick) assert.ok(!left.vertices.has(id) && !left.transitions.has(id) && !left.regions.has(id) && !left.internals.has(id), `${name}: ${id} still there`);
        roundTrips(doc);
        n++;
      }
    }
    assert.ok(n > 200);
  });

  it("copy and paste random selections: valid, and the copies are the originals moved", () => {
    const r = rng(12);
    let n = 0;
    for (const { name, doc: original } of models()) {
      const index0 = indexV1(original);
      const page = index0.doc.machine.root;
      // the editor selects on one sheet at a time; take the root sheet (not inside an off-page region at any depth)
      const vs = [...index0.vertices.keys()].filter((id) => sheetOfVertex(index0, id) === page);
      for (let k = 0; k < 4; k++) {
        const doc = clone(original);
        const pick = vs.filter(() => r() < 0.2);
        const frag = copyFragment(index0, pick);
        if (!frag) continue;
        // far to the right of everything on the root sheet, so nothing is clamped
        const at = { x: 6000 + Math.round(r() * 30) * 10, y: Math.round(r() * 50) * 10 };
        const ids = pasteFragment(doc, frag, page.id, at, { keepOuterStateRefs: true });
        assert.deepEqual(broken(doc), [], `${name}: pasting ${pick.join(" ")}`);
        const index = indexV1(doc);
        const first = frag.vertices[0]!.id;
        const b0 = vertexBox(index0, first), b1 = vertexBox(index, ids[0]!);
        const dx = b1.x - b0.x, dy = b1.y - b0.y;
        // vertices and free routes are the originals moved by (dx, dy); S routes may spread their ends differently
        const pairs = new Map<string, string>();
        const walkPair = (a: string, b: string): void => {
          pairs.set(a, b);
          const va = index0.vertices.get(a)!.vertex, vb = index.vertices.get(b)!.vertex;
          if (va.kind === "state" && vb.kind === "state") va.regions?.forEach((ra, i) => ra.states.forEach((c, j) => walkPair(c.id, vb.regions![i]!.states[j]!.id)));
        };
        frag.vertices.forEach((v, i) => walkPair(v.id, ids[i]!));
        for (const [a, b] of pairs) {
          if (isOffPage(index0, index0.vertices.get(a)!.region.id)) continue;
          const x = vertexBox(index0, a), y = vertexBox(index, b);
          assert.deepEqual(y, { ...x, x: x.x + dx, y: x.y + dy }, `${name}: ${a} -> ${b}`);
        }
        frag.transitions.forEach((t, i) => {
          const tid = ids[frag.vertices.length + i]!;
          assert.equal(index.transitions.get(tid)!.from, pairs.get(t.from));
          assert.equal(index.transitions.get(tid)!.to, pairs.get(t.to));
          if (index0.doc.diagram?.transitions[t.id]?.route === "s") return;
          if (isOffPage(index0, index0.vertices.get(t.from)!.region.id)) return;
          const g0 = edgeGeometry(index0, t.id), g1 = edgeGeometry(index, tid);
          if (!g0 || !g1) return;
          const near = (p: { x: number; y: number }, q: { x: number; y: number }): boolean => Math.abs(p.x + dx - q.x) < 1e-6 && Math.abs(p.y + dy - q.y) < 1e-6;
          assert.ok(g0.points.every((p, j) => near(p, g1.points[j]!)), `${name}: ${t.id} -> ${tid}`);
          if (g0.label) assert.ok(near(g0.label, g1.label!), `${name}: label of ${t.id}`);
        });
        roundTrips(doc);
        n++;
      }
    }
    assert.ok(n > 80);
  });

  it("add vertices, regions and transitions anywhere and stay valid", () => {
    const r = rng(13);
    for (const { name, doc } of models().slice(0, 30)) {
      for (let k = 0; k < 10; k++) {
        const index = indexV1(doc);
        const regions = [...index.regions.keys()];
        const states = [...index.vertices.values()].filter((i) => i.vertex.kind === "state").map((i) => i.vertex.id);
        const vertices = [...index.vertices.keys()];
        const pick = r();
        if (pick < 0.4) {
          const kinds = ["state", "final", "terminate", "fork", "join", "initial", "shallow-history"] as const;
          const kind = kinds[Math.floor(r() * kinds.length)]!;
          const region = regions[Math.floor(r() * regions.length)]!;
          if (cannotAdd(index, region, kind)) continue;
          addVertex(doc, region, kind, { x: r() * 2000, y: r() * 1000, w: r() * 300, h: r() * 300 }, { horizontal: r() < 0.5 });
        } else if (pick < 0.6 && states.length) addRegion(doc, states[Math.floor(r() * states.length)]!);
        else {
          const a = vertices[Math.floor(r() * vertices.length)]!, b = vertices[Math.floor(r() * vertices.length)]!;
          if (cannotConnect(index, a, b)) continue;
          const p = r();
          addTransition(doc, a, b, p < 0.35 ? {} : p < 0.7 ? { route: "straight" } : { via: [{ x: r() * 1000, y: r() * 1000 }] });
        }
        assert.deepEqual(broken(doc), [], name);
      }
      roundTrips(doc);
    }
  });
});
