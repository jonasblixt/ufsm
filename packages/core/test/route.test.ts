// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  UfsmFormatError,
  attachPoint,
  autoSides,
  edgeGeometry,
  followPolyline,
  indexV1,
  labelAnchor,
  loadModel,
  parseV1,
  routeInfo,
  sRoute,
  serializeV1,
  vertexBox,
  type Box,
  type Pt,
  type Side,
  type UfsmDocument,
} from "../src/index";
import { rng } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SIDES: Side[] = ["left", "right", "top", "bottom"];
const normal = (s: Side): Pt => (s === "left" ? { x: -1, y: 0 } : s === "right" ? { x: 1, y: 0 } : s === "top" ? { x: 0, y: -1 } : { x: 0, y: 1 });
const dir = (a: Pt, b: Pt): Pt => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });

/** The properties every S route must have; returns a description of the first violation. */
function violation(points: Pt[], p: Pt, sp: Side, q: Pt, sq: Side): string | undefined {
  if (points.length < 2) return "fewer than 2 points";
  const first = points[0]!, last = points[points.length - 1]!;
  if (Math.hypot(first.x - p.x, first.y - p.y) > 1e-9) return "does not start at p";
  if (Math.hypot(last.x - q.x, last.y - q.y) > 1e-9) return "does not end at q";
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (a.x !== b.x && a.y !== b.y) return `segment ${i} is diagonal`;
    if (a.x === b.x && a.y === b.y) return `segment ${i} has no length`;
    if (i >= 2) {
      const d0 = dir(points[i - 2]!, a), d1 = dir(a, b);
      if (d0.x === -d1.x && d0.y === -d1.y) return `segment ${i} folds back`;
    }
  }
  const out = dir(points[0]!, points[1]!), n = normal(sp);
  if (out.x !== n.x || out.y !== n.y) return `leaves ${sp} side in direction ${JSON.stringify(out)}`;
  const inn = dir(points[points.length - 2]!, last), m = normal(sq);
  if (inn.x !== -m.x || inn.y !== -m.y) return `enters ${sq} side in direction ${JSON.stringify(inn)}`;
  return undefined;
}

function sidePoint(b: Box, s: Side, f: number): Pt {
  switch (s) {
    case "left": return { x: b.x, y: b.y + f * b.h };
    case "right": return { x: b.x + b.w, y: b.y + f * b.h };
    case "top": return { x: b.x + f * b.w, y: b.y };
    case "bottom": return { x: b.x + f * b.w, y: b.y + b.h };
  }
}

describe("S routes (geometry)", () => {
  it("are orthogonal, start and end on their sides, leave outward and enter inward, for every side pair", () => {
    const r = rng(42);
    let n = 0;
    for (let k = 0; k < 400; k++) {
      const a: Box = { x: Math.round(r() * 800), y: Math.round(r() * 600), w: 40 + Math.round(r() * 200), h: 30 + Math.round(r() * 150) };
      const b: Box = { x: Math.round(r() * 800), y: Math.round(r() * 600), w: 40 + Math.round(r() * 200), h: 30 + Math.round(r() * 150) };
      for (const sp of SIDES) for (const sq of SIDES) {
        const p = sidePoint(a, sp, 0.1 + 0.8 * r()), q = sidePoint(b, sq, 0.1 + 0.8 * r());
        for (const stagger of [0, -14, 14]) {
          const route = sRoute(p, sp, q, sq, undefined, stagger);
          const bad = violation(route.points, p, sp, q, sq);
          assert.equal(bad, undefined, `${bad}: ${JSON.stringify({ p, sp, q, sq, stagger, points: route.points })}`);
          n++;
        }
      }
    }
    assert.ok(n > 10000);
  });

  it("give the expected shapes: straight, S, L, U and detour", () => {
    const shape = (p: Pt, sp: Side, q: Pt, sq: Side) => sRoute(p, sp, q, sq).points.length;
    assert.equal(shape({ x: 0, y: 50 }, "right", { x: 200, y: 50 }, "left"), 2, "aligned facing sides: straight");
    assert.equal(shape({ x: 0, y: 50 }, "right", { x: 200, y: 90 }, "left"), 4, "facing sides: S");
    assert.equal(shape({ x: 0, y: 50 }, "right", { x: 200, y: 120 }, "top"), 3, "perpendicular, ahead and outside: L");
    assert.equal(shape({ x: 0, y: 50 }, "right", { x: 0, y: 150 }, "right"), 4, "same side: U");
    assert.equal(shape({ x: 200, y: 50 }, "right", { x: 0, y: 90 }, "left"), 6, "sides facing away: detour");
    const s = sRoute({ x: 0, y: 50 }, "right", { x: 200, y: 90 }, "left");
    assert.deepEqual(s.jog, { axis: "x", value: 100 }, "the S's jog is centred by default");
  });

  it("use a stored jog on the axis it was set for and ignore it on the other", () => {
    const p = { x: 0, y: 50 }, q = { x: 200, y: 90 };
    const set = sRoute(p, "right", q, "left", { x: 60 });
    assert.deepEqual(set.points.map((pt) => pt.x), [0, 60, 60, 200]);
    const wrongAxis = sRoute(p, "right", q, "left", { y: 300 });
    assert.deepEqual(wrongAxis.points.map((pt) => pt.x), [0, 100, 100, 200]);
    const detour = sRoute({ x: 200, y: 50 }, "right", { x: 0, y: 90 }, "left", { y: 300 });
    assert.equal(detour.jog?.axis, "y");
    assert.ok(detour.points.some((pt) => pt.y === 300), "a detour's crossing segment follows a y jog");
  });

  it("pick sides from where the boxes are", () => {
    const a: Box = { x: 0, y: 0, w: 100, h: 60 };
    assert.deepEqual(autoSides(a, { x: 300, y: 20, w: 100, h: 60 }), ["right", "left"]);
    assert.deepEqual(autoSides(a, { x: -300, y: 20, w: 100, h: 60 }), ["left", "right"]);
    assert.deepEqual(autoSides(a, { x: 10, y: 300, w: 100, h: 60 }), ["bottom", "top"]);
    assert.deepEqual(autoSides(a, { x: 10, y: -300, w: 100, h: 60 }), ["top", "bottom"]);
    assert.deepEqual(autoSides(a, { x: 10, y: 10, w: 40, h: 20 }), ["right", "right"], "nested: a U on the right");
  });

  it("hang labels above their first long horizontal segment", () => {
    const pts = sRoute({ x: 0, y: 50 }, "right", { x: 200, y: 90 }, "left").points;
    assert.deepEqual(labelAnchor(pts).anchor, { x: 0, y: 50 });
    const vertical = sRoute({ x: 50, y: 0 }, "bottom", { x: 50, y: 200 }, "top").points;
    assert.deepEqual(labelAnchor(vertical), { anchor: { x: 50, y: 100 }, horizontal: false, length: 0 });
  });

  it("let free routes follow their ends", () => {
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    assert.deepEqual(followPolyline(pts, { x: 10, y: 5 }, { x: 10, y: 5 }), pts.map((p) => ({ x: p.x + 10, y: p.y + 5 })), "same move: translation");
    const moved = followPolyline(pts, { x: 0, y: 0 }, { x: 0, y: 40 });
    assert.deepEqual(moved[0], { x: 0, y: 0 });
    assert.deepEqual(moved[2], { x: 100, y: 140 });
    assert.deepEqual(moved[1], { x: 100, y: 20 }, "the bend half way along moves half as much");
  });
});

/** Two states side by side with transitions between them, as S routes. */
function sDoc(): UfsmDocument {
  return parseV1(
    JSON.stringify({
      format: "ufsm",
      version: 1,
      name: "s",
      declarations: { events: [{ id: "ev1", name: "e1" }, { id: "ev2", name: "e2" }], signals: [], actions: [], guards: [] },
      machine: {
        root: { id: "r0", states: [{ id: "s1", kind: "initial" }, { id: "s2", kind: "state", name: "A" }, { id: "s3", kind: "state", name: "B" }, { id: "s4", kind: "state", name: "C" }] },
        transitions: [
          { id: "t1", from: "s1", to: "s2" },
          { id: "t2", from: "s2", to: "s3", on: "ev1" },
          { id: "t3", from: "s2", to: "s3", on: "ev2" },
          { id: "t4", from: "s2", to: "s4", on: "ev1" },
          { id: "t5", from: "s3", to: "s2", on: "ev2" },
        ],
      },
      diagram: {
        paper: "A4",
        states: {
          s1: { x: 40, y: 140, w: 20, h: 20 },
          s2: { x: 100, y: 100, w: 160, h: 120 },
          s3: { x: 500, y: 60, w: 160, h: 120 },
          s4: { x: 500, y: 400, w: 160, h: 120 },
        },
        regions: {},
        transitions: {
          t1: { route: "s" },
          t2: { route: "s" },
          t3: { route: "s", jog: { x: 300 }, label: { x: 4, y: -40, w: 200 } },
          t4: { route: "s", from: { side: "bottom", offset: 80 } },
          t5: { route: "s" },
        },
      },
    }),
  );
}

describe("S routes in documents", () => {
  it("round-trip through the reader and the canonical writer, and the schema accepts them", () => {
    const text = serializeV1(sDoc());
    assert.equal(serializeV1(parseV1(text)), text);
    assert.match(text, /"t3": \{ "route": "s", "jog": \{ "x": 300 \}, "label": \{ "x": 4, "y": -40, "w": 200 \} \}/);
    assert.match(text, /"t4": \{ "route": "s", "from": \{ "side": "bottom", "offset": 80 \} \}/);
    const schema = JSON.parse(readFileSync(join(repoRoot, "packages/core/schema/ufsm-v1.schema.json"), "utf8"));
    const validate = new Ajv({ allErrors: true, strict: false } as ConstructorParameters<typeof Ajv>[0]).compile(schema);
    assert.ok(validate(JSON.parse(text)), JSON.stringify(validate.errors));
    const bad = JSON.parse(text);
    bad.diagram.transitions.t2.via = [[1, 2]];
    assert.ok(!validate(bad), "the schema rejects bend points on an S route");
    assert.throws(() => parseV1(JSON.stringify(bad)), (e: unknown) => e instanceof UfsmFormatError && /bend points belong to free routes/.test(e.message));
    const badJog = JSON.parse(text);
    badJog.diagram.transitions.t3.jog = { x: 1, y: 2 };
    assert.throws(() => parseV1(JSON.stringify(badJog)), /exactly one of x or y/);
    const freeJog = JSON.parse(text);
    freeJog.diagram.transitions.t2 = { from: { side: "right", offset: 10 }, to: { side: "left", offset: 10 }, jog: { x: 3 } };
    assert.throws(() => parseV1(JSON.stringify(freeJog)), /a jog belongs to S routes/);
    const explicitFree = JSON.parse(text);
    explicitFree.diagram.transitions.t2 = { route: "free", from: { side: "right", offset: 10 }, to: { side: "left", offset: 10 } };
    assert.doesNotMatch(serializeV1(parseV1(JSON.stringify(explicitFree))), /"route": "free"/, "free is the default and not written");
  });

  it("resolve automatic ends: facing sides, spread along the side without crossing, staggered parallel jogs", () => {
    const index = indexV1(sDoc());
    const t2 = routeInfo(index, "t2")!, t3 = routeInfo(index, "t3")!, t5 = routeInfo(index, "t5")!;
    assert.deepEqual([t2.from.side, t2.to.side], ["right", "left"]);
    assert.equal(t2.fromPinned || t2.toPinned, false);
    // A's right side holds the ends of t2, t3 and t5 (t4 leaves from the pinned bottom side): three distinct offsets
    const offsets = [t2.from.offset, t3.from.offset, t5.to.offset];
    assert.equal(new Set(offsets).size, 3, JSON.stringify(offsets));
    assert.deepEqual(routeInfo(index, "t4")!.from, { side: "bottom", offset: 80 });
    assert.ok(routeInfo(index, "t4")!.fromPinned);
    assert.equal(routeInfo(index, "t4")!.to.side, "top", "the free end faces the pinned one");
    assert.equal(t3.jog?.value, 300 + 0, "a stored jog is relative to the transition's region (the root sheet here)");
    assert.notEqual(t2.jog?.value, t5.jog?.value, "parallel routes get different default jogs");
    for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
      const t = index.transitions.get(id)!, info = routeInfo(index, id)!;
      const g = edgeGeometry(index, id)!;
      const p = attachPoint(index, t.from, info.from), q = attachPoint(index, t.to, info.to);
      assert.equal(violation(g.points, p, info.from.side, q, info.to.side), undefined, id);
      assert.ok(g.label, `${id} has a label position`);
    }
    const g3 = edgeGeometry(index, "t3")!;
    assert.deepEqual(g3.label, { x: routeInfo(index, "t3")!.labelAnchor.x + 4, y: routeInfo(index, "t3")!.labelAnchor.y - 40, w: 200 });
  });

  it("give parallel U routes distinct lanes (two and three of them; a centred stagger made the outer ones coincide)", () => {
    for (const n of [2, 3]) {
      const doc = sDoc();
      doc.machine.transitions = doc.machine.transitions.filter((t) => t.from !== "s2" || t.to !== "s3");
      for (let k = 0; k < n; k++) {
        doc.machine.transitions.push({ id: `u${k}`, from: "s2", to: "s3", on: "ev1" });
        // both ends pinned on the right side: a U around the right of both boxes
        doc.diagram!.transitions[`u${k}`] = { route: "s", from: { side: "right", offset: 20 + 30 * k }, to: { side: "right", offset: 20 + 30 * k } };
      }
      const index = indexV1(doc);
      const jogs = Array.from({ length: n }, (_, k) => routeInfo(index, `u${k}`)!.jog!.value);
      assert.equal(new Set(jogs).size, n, `${n} parallel U routes: ${JSON.stringify(jogs)}`);
    }
  });

  it("loop self-transitions around the top-right corner", () => {
    const doc = sDoc();
    doc.machine.transitions.push({ id: "t6", from: "s3", to: "s3", on: "ev1" });
    doc.diagram!.transitions["t6"] = { route: "s" };
    const index = indexV1(doc);
    const info = routeInfo(index, "t6")!;
    assert.deepEqual([info.from.side, info.to.side], ["right", "top"]);
    const b = vertexBox(index, "s3");
    const pts = edgeGeometry(index, "t6")!.points;
    assert.equal(pts.length, 5, JSON.stringify(pts));
    assert.ok(pts.every((p) => p.x >= b.x + b.w / 2 && p.y <= b.y + b.h / 2), "the loop stays at the top-right corner");
    assert.equal(violation(pts, attachPoint(index, "s3", info.from), "right", attachPoint(index, "s3", info.to), "top"), undefined);
  });

  it("follow their states: moving a state moves the route, nothing is stored", () => {
    const doc = sDoc();
    const before = edgeGeometry(indexV1(doc), "t2")!.points;
    doc.diagram!.states["s3"]!.y += 40;
    const after = edgeGeometry(indexV1(doc), "t2")!.points;
    assert.deepEqual(after[0], before[0], "the start stays on A");
    assert.equal(after[after.length - 1]!.y, before[before.length - 1]!.y + 40, "the end moves with B");
    doc.diagram!.states["s3"]!.x = 120;
    doc.diagram!.states["s3"]!.y = 500;
    assert.deepEqual([routeInfo(indexV1(doc), "t2")!.from.side, routeInfo(indexV1(doc), "t2")!.to.side], ["bottom", "top"], "B below A: the sides turn");
  });

  it("lie on the grid between grid-aligned states: ends, jogs, stubs and lanes (new transitions are aligned)", () => {
    const onGrid = (pts: Pt[]): boolean => pts.every((p) => p.x % 10 === 0 && p.y % 10 === 0);
    // the document's own routes: S, the staggered parallel pair, U and the self-loop
    const doc = sDoc();
    doc.machine.transitions.push({ id: "t6", from: "s3", to: "s3", on: "ev1" }, { id: "t7", from: "s4", to: "s4", on: "ev2" });
    doc.diagram!.transitions["t6"] = { route: "s" };
    doc.diagram!.transitions["t7"] = { route: "s" };
    doc.diagram!.states["s4"] = { x: 500, y: 400, w: 170, h: 70 }; // odd middles: 85 and 35
    let index = indexV1(doc);
    for (const id of ["t1", "t2", "t3", "t5", "t6", "t7"]) assert.ok(onGrid(edgeGeometry(index, id)!.points), `${id} ${JSON.stringify(edgeGeometry(index, id)!.points)}`);
    // random grid-aligned boxes far enough apart for the parallel jogs (14 apart) to find grid lines between the ends;
    // one to three parallel transitions each way
    const rand = rng(7);
    const r = { int: (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1)) };
    for (let n = 0; n < 300; n++) {
      const d = sDoc();
      const box = (): { x: number; y: number; w: number; h: number } => ({ x: 10 * r.int(0, 80), y: 10 * r.int(0, 80), w: 10 * r.int(8, 25), h: 10 * r.int(8, 25) }); // room for six ends on a side
      const a = box();
      let b = box();
      while (Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h)) < 100) b = box();
      d.diagram!.states["s2"] = a;
      d.diagram!.states["s3"] = b;
      d.machine.transitions = [];
      d.diagram!.transitions = {};
      const k = r.int(1, 3);
      for (let i = 0; i < k; i++) {
        d.machine.transitions.push({ id: `t${2 * i + 1}`, from: "s2", to: "s3", on: "ev1" }, { id: `t${2 * i + 2}`, from: "s3", to: "s2", on: "ev2" });
        d.diagram!.transitions[`t${2 * i + 1}`] = { route: "s" };
        d.diagram!.transitions[`t${2 * i + 2}`] = { route: "s" };
      }
      index = indexV1(d);
      for (const t of d.machine.transitions) {
        const pts = edgeGeometry(index, t.id)!.points;
        assert.ok(onGrid(pts), `${n} ${t.id} ${JSON.stringify([a, b])} ${JSON.stringify(pts)}`);
        const info = routeInfo(index, t.id)!;
        assert.equal(violation(pts, attachPoint(index, t.from, info.from), info.from.side, attachPoint(index, t.to, info.to), info.to.side), undefined);
      }
    }
  });

  it("route every transition of every repository model when converted to S", () => {
    const files = ["examples", "tests/models", "apps/editor/src/fsm"].flatMap((d) =>
      existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
    );
    let n = 0;
    for (const f of files) {
      const doc = loadModel(readFileSync(f, "utf8")).doc;
      for (const id of Object.keys(doc.diagram?.transitions ?? {})) doc.diagram!.transitions[id] = { route: "s" };
      const index = indexV1(doc);
      for (const t of doc.machine.transitions) {
        const info = routeInfo(index, t.id);
        assert.ok(info, `${f} ${t.id}`);
        const g = edgeGeometry(index, t.id)!;
        const p = attachPoint(index, t.from, info.from), q = attachPoint(index, t.to, info.to);
        const bad = violation(g.points, p, info.from.side, q, info.to.side);
        assert.equal(bad, undefined, `${f} ${t.id}: ${bad} ${JSON.stringify(g.points)}`);
        void vertexBox;
        n++;
      }
    }
    assert.ok(n > 500, `${n} transitions`);
  });
});
