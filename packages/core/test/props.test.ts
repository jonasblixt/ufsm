// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkV1, indexV1, internalTransitionLabel, loadModel, parseV1, serializeV1, transitionLabel, timerLabel, type State, type UfsmDocument } from "../src";
import {
  addDecl,
  addInternal,
  cannotOffPage,
  declNameProblem,
  declUses,
  deleteDecl,
  deleteElements,
  renameDecl,
  renameRegion,
  renameVertex,
  setBarOrientation,
  setDocText,
  setGuard,
  setMachineDoc,
  setMachineName,
  setOffPage,
  setPaper,
  setTitleField,
  setStateActions,
  setModelOption,
  setTargetOption,
  setTransitionActions,
  setTrigger,
  addTimer,
  setTimer,
  timerNameProblem,
  timerDurationProblem,
  copyFragment,
  pasteFragment,
} from "../src/edit";
import { edgeGeometry, sheetFit } from "../src/diagram";
import { randomModel, rng } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 *   Initial ─► P (100,100 400x300)  ── t5 ──►  C (700,100 120x80, entry a1, internal t7 on e1 [<A>])
 *              ├ r1 (h 130): A (abs 120,150), D (abs 300,150); t6 A→D free (inside r1)
 *              └ r2 (fill):  B (abs 300,290)
 *   t2 A→B, t3 B→C S, t4 A→C S; fork F (abs 900,300 10x100)
 */
function testDoc(): UfsmDocument {
  return parseV1(
    JSON.stringify({
      format: "ufsm",
      version: 1,
      name: "props",
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
            { id: "s7", kind: "fork" },
          ],
        },
        transitions: [
          { id: "t1", from: "s1", to: "s2" },
          { id: "t2", from: "s3", to: "s4", on: "ev1", guard: [{ call: "grd1" }], do: [{ emit: "sig1" }, { call: "act1" }] },
          { id: "t3", from: "s4", to: "s5", on: "ev1", guard: [{ in: "s3" }, { call: "grd1", not: true }] },
          { id: "t4", from: "s3", to: "s5", on: "ev1" },
          { id: "t5", from: "s2", to: "s5", on: "ev1" },
          { id: "t6", from: "s3", to: "s6", on: "sig1" },
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
          s7: { x: 900, y: 300, w: 10, h: 100 },
        },
        regions: { r1: { h: 130 } },
        transitions: {
          t1: { from: { side: "right", offset: 10 }, to: { side: "left", offset: 20 } },
          t2: { route: "s" },
          t3: { route: "s" },
          t4: { route: "s", jog: { x: 600 } },
          t5: { from: { side: "right", offset: 50 }, to: { side: "left", offset: 30 }, via: [[600, 150], [600, 130]], label: { x: 520, y: 100, w: 150 } },
          t6: { from: { side: "right", offset: 30 }, to: { side: "left", offset: 30 }, via: [[150, 80]], label: { x: 130, y: 40, w: 100 } },
        },
      },
    }),
  );
}

const clone = (doc: UfsmDocument): UfsmDocument => structuredClone(doc);
const BROKEN = new Set(["duplicate-id", "dangling-ref", "wrong-ref", "stale-layout", "missing-layout", "duplicate-name", "bad-name"]);
const broken = (doc: UfsmDocument): string[] =>
  checkV1(doc)
    .filter((d) => BROKEN.has(d.code))
    .map((d) => `${d.code}: ${d.message}`);
const roundTrips = (doc: UfsmDocument): void => {
  const text = serializeV1(doc);
  assert.equal(serializeV1(parseV1(text)), text);
};
const T = (doc: UfsmDocument, id: string) => doc.machine.transitions.find((t) => t.id === id)!;
const S = (doc: UfsmDocument, id: string) => indexV1(doc).vertices.get(id)!.vertex as State;

describe("declarations", () => {
  it("check names: identifiers, unique across all four kinds", () => {
    const index = indexV1(testDoc());
    assert.match(declNameProblem(index, "")!, /name is needed/);
    assert.match(declNameProblem(index, "2go")!, /not an identifier/);
    assert.match(declNameProblem(index, "a b")!, /not an identifier/);
    assert.match(declNameProblem(index, "g1")!, /already declared as a guard/);
    assert.equal(declNameProblem(index, "g1", "grd1"), undefined, "renaming to its own name");
    assert.equal(declNameProblem(index, "_ok2"), undefined);
  });

  it("add and rename; every use follows the rename", () => {
    const doc = testDoc();
    assert.equal(addDecl(doc, "event", "e2"), "ev2");
    assert.equal(addDecl(doc, "signal", "s2"), "sig2");
    assert.deepEqual(doc.declarations.events.at(-1), { id: "ev2", name: "e2" });
    const machine = clone(doc).machine;
    renameDecl(doc, "ev1", "eGo");
    renameDecl(doc, "grd1", "ready");
    renameDecl(doc, "sig1", "sDone");
    assert.deepEqual(doc.machine, machine, "uses are by id: the machine section does not change");
    const index = indexV1(doc);
    assert.equal(transitionLabel(index, T(doc, "t2")), "eGo [ready()] / ^sDone, a1()");
    assert.equal(transitionLabel(index, T(doc, "t3")), "eGo [<A>, !ready()]");
    assert.equal(internalTransitionLabel(index, S(doc, "s5").internal![0]!), "eGo [<A>]");
  });

  it("list where a declaration is used", () => {
    const index = indexV1(testDoc());
    assert.deepEqual(declUses(index, "ev1").sort(), ["t2", "t3", "t4", "t5", "t7"]);
    assert.deepEqual(declUses(index, "sig1").sort(), ["t2", "t6"]);
    assert.deepEqual(declUses(index, "act1").sort(), ["s5", "t2"]);
    assert.deepEqual(declUses(index, "grd1").sort(), ["t2", "t3"]);
  });

  it("delete with its uses: calls, emits, guard terms, triggers; internal transitions on it go", () => {
    const doc = testDoc();
    deleteDecl(doc, "act1");
    assert.equal(S(doc, "s5").entry, undefined, "an empty entry list is removed");
    assert.deepEqual(T(doc, "t2").do, [{ emit: "sig1" }]);
    deleteDecl(doc, "sig1");
    assert.equal(T(doc, "t2").do, undefined);
    assert.equal(T(doc, "t6").on, undefined, "the transition stays, without trigger");
    deleteDecl(doc, "grd1");
    assert.equal(T(doc, "t2").guard, undefined);
    assert.deepEqual(T(doc, "t3").guard, [{ in: "s3" }]);
    deleteDecl(doc, "ev1");
    assert.equal(S(doc, "s5").internal, undefined, "an internal transition needs its trigger");
    assert.ok(doc.machine.transitions.every((t) => t.on === undefined));
    assert.deepEqual(doc.declarations, { events: [], signals: [], actions: [], guards: [] });
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });

  it("documentation text on declarations, states, transitions and internal transitions", () => {
    const doc = testDoc();
    for (const id of ["ev1", "s2", "t2", "t7"]) setDocText(doc, id, `about ${id}`);
    const index = indexV1(doc);
    assert.equal(index.decls.get("ev1")!.decl.doc, "about ev1");
    assert.equal(S(doc, "s2").doc, "about s2");
    assert.equal(T(doc, "t2").doc, "about t2");
    assert.equal(index.internals.get("t7")!.transition.doc, "about t7");
    setDocText(doc, "s2", "");
    assert.equal(S(doc, "s2").doc, undefined);
    roundTrips(doc);
  });

  it("machine name, description, options and code generator settings", () => {
    const doc = testDoc();
    setMachineName(doc, "lamp");
    setMachineDoc(doc, "A lamp.");
    setTargetOption(doc, "c", "prefix", "lamp_");
    setTargetOption(doc, "c", "file", "lamp");
    setModelOption(doc, "signalQueue", 4);
    assert.deepEqual([doc.name, doc.doc, doc.targets, doc.options], ["lamp", "A lamp.", { c: { prefix: "lamp_", file: "lamp" } }, { signalQueue: 4 }]);
    roundTrips(doc);
    setTargetOption(doc, "c", "prefix", undefined);
    setTargetOption(doc, "c", "file", undefined);
    setModelOption(doc, "signalQueue", undefined);
    setModelOption(doc, "maxMicrosteps", undefined);
    setMachineDoc(doc, "");
    assert.equal(doc.targets, undefined, "empty targets are removed");
    assert.equal(doc.options, undefined, "an empty options section is removed");
    assert.equal(doc.doc, undefined);
    roundTrips(doc);
  });

  it("paper size: every sheet changes, nothing moves; what no longer fits is listed", () => {
    const doc = testDoc();
    const layout = JSON.stringify(doc.diagram!.states);
    setPaper(doc, "A2");
    assert.equal(doc.diagram!.paper, "A2");
    assert.equal(JSON.stringify(doc.diagram!.states), layout, "nothing moves");
    assert.deepEqual(sheetFit(indexV1(doc)), []);
    doc.diagram!.states["s2"]!.x = 1500; // its contents go with it
    assert.deepEqual(sheetFit(indexV1(doc)), [], "fits on A2");
    setPaper(doc, "A4");
    const index = indexV1(doc);
    const fit = sheetFit(index);
    assert.equal(fit[0]?.id, "s2");
    assert.ok(fit.every((p) => !index.vertices.has(p.id) || index.vertices.get(p.id)!.region.id === "r0"), "a composite's contents are not listed again");
    roundTrips(doc);
    delete doc.diagram;
    setPaper(doc, "A3");
    assert.deepEqual(doc.diagram, { paper: "A3", states: {}, regions: {}, transitions: {} }, "a diagram section is created");
  });

  it("title block fields: trimmed, removed when empty, the block with the last one", () => {
    const doc = testDoc();
    setTitleField(doc, "revision", "  B ");
    setTitleField(doc, "author", "Jonas");
    assert.deepEqual(doc.diagram!.titleBlock, { revision: "B", author: "Jonas" });
    roundTrips(doc);
    setTitleField(doc, "revision", " ");
    assert.deepEqual(doc.diagram!.titleBlock, { author: "Jonas" });
    setTitleField(doc, "date", "");
    assert.deepEqual(doc.diagram!.titleBlock, { author: "Jonas" }, "clearing an absent field changes nothing");
    setTitleField(doc, "author", "");
    assert.equal(doc.diagram!.titleBlock, undefined);
    roundTrips(doc);
  });
});

describe("timers", () => {
  it("add, change and check names and durations", () => {
    const doc = testDoc();
    const a = addTimer(doc, "s5", "ev1")!;
    const b = addTimer(doc, "s3", "ev1", { name: "poll" })!;
    assert.deepEqual([a, b], ["tm1", "tm2"]);
    assert.equal(addTimer(doc, "s1", "ev1"), undefined, "pseudo-states have no timers");
    assert.deepEqual(S(doc, "s5").timers, [{ id: "tm1", name: "timer1", after: 1, unit: "s", event: "ev1" }]);
    setTimer(doc, b, { kind: "every", count: 500, unit: "ms" });
    assert.deepEqual(S(doc, "s3").timers, [{ id: "tm2", name: "poll", every: 500, unit: "ms", event: "ev1" }], "after became every");
    setTimer(doc, b, { kind: "after" });
    assert.equal(timerLabel(indexV1(doc), S(doc, "s3").timers![0]!), "t/poll(500 ms, e1)", "the count is kept");
    const index = indexV1(doc);
    assert.match(timerNameProblem(index, "poll", a)!, /timer of 'A'/);
    assert.equal(timerNameProblem(index, "poll", b), undefined, "its own name");
    assert.match(timerNameProblem(index, "9x")!, /not an identifier/);
    assert.equal(timerDurationProblem(1193, "h"), undefined);
    assert.match(timerDurationProblem(1194, "h")!, /At most 1193 h/);
    assert.match(timerDurationProblem(0, "s")!, /whole number/);
    assert.match(timerDurationProblem(1.5, "s")!, /whole number/);
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });

  it("go with their event, their state, or one by one; doc text; uses", () => {
    const doc = testDoc();
    const a = addTimer(doc, "s5", "ev1")!;
    addTimer(doc, "s3", "ev1");
    assert.deepEqual(declUses(indexV1(doc), "ev1").filter((id) => id.startsWith("tm")), ["tm2", "tm1"]);
    setDocText(doc, a, "how long the door may take");
    assert.equal(S(doc, "s5").timers![0]!.doc, "how long the door may take");
    assert.deepEqual([...deleteElements(doc, [a])], [a]);
    assert.equal(S(doc, "s5").timers, undefined, "an empty list goes");
    deleteDecl(doc, "ev1");
    assert.equal(S(doc, "s3").timers, undefined, "a timer needs its event");
    const again = testDoc();
    addTimer(again, "s3", "ev1");
    deleteElements(again, ["s2"]);
    assert.equal(indexV1(again).timers.size, 0, "deleted with the state that owns it");
    assert.deepEqual(broken(again), []);
  });

  it("are copied with their state: fresh ids, their event, a name of their own", () => {
    const doc = testDoc();
    addTimer(doc, "s3", "ev1", { name: "poll" });
    const frag = copyFragment(indexV1(doc), ["s3"])!;
    assert.deepEqual(frag.declarations.map((d) => d.decl.name), ["e1"], "the timer's event comes along");
    const ids = pasteFragment(doc, frag, "r0", { x: 600, y: 500 });
    const copy = S(doc, ids[0]!);
    assert.deepEqual(copy.timers, [{ id: "tm2", name: "poll_2", after: 1, unit: "s", event: "ev1" }]);
    assert.deepEqual(checkV1(doc).filter((d) => d.code.startsWith("timer-")), [], "no duplicate timer names");
    const other = testDoc();
    other.declarations.events = [];
    deleteElements(other, ["t2", "t3", "t4", "t5", "t7"]);
    pasteFragment(other, frag, "r0", { x: 600, y: 500 });
    const added = other.declarations.events.find((e) => e.name === "e1")!;
    assert.equal([...indexV1(other).timers.values()][0]!.timer.event, added.id, "the event is declared in the target");
  });
});

describe("state, region and transition properties", () => {
  it("rename states, name pseudo states and regions", () => {
    const doc = testDoc();
    renameVertex(doc, "s2", "Parent state");
    renameVertex(doc, "s7", "split");
    renameRegion(doc, "r1", "Upper");
    assert.equal(S(doc, "s2").name, "Parent state");
    assert.equal(indexV1(doc).vertices.get("s7")!.vertex.name, "split");
    assert.equal(indexV1(doc).regions.get("r1")!.region.name, "Upper");
    renameVertex(doc, "s7", "");
    renameRegion(doc, "r1", "");
    assert.equal(indexV1(doc).vertices.get("s7")!.vertex.name, undefined);
    assert.equal(indexV1(doc).regions.get("r1")!.region.name, undefined);
    roundTrips(doc);
  });

  it("entry, exit and transition actions, guards; empty lists are removed", () => {
    const doc = testDoc();
    setStateActions(doc, "s2", "entry", [{ call: "act1" }, { emit: "sig1" }]);
    setStateActions(doc, "s2", "exit", [{ call: "act1" }]);
    assert.deepEqual([S(doc, "s2").entry, S(doc, "s2").exit], [[{ call: "act1" }, { emit: "sig1" }], [{ call: "act1" }]]);
    setStateActions(doc, "s2", "exit", []);
    assert.equal(S(doc, "s2").exit, undefined);
    setTransitionActions(doc, "t3", [{ call: "act1" }]);
    setTransitionActions(doc, "t7", [{ emit: "sig1" }]);
    setGuard(doc, "t2", [{ call: "grd1", not: true }, { in: "s6", not: true }]);
    setGuard(doc, "t7", []);
    assert.deepEqual(T(doc, "t3").do, [{ call: "act1" }]);
    assert.deepEqual(indexV1(doc).internals.get("t7")!.transition, { id: "t7", on: "ev1", do: [{ emit: "sig1" }] });
    assert.deepEqual(T(doc, "t2").guard, [{ call: "grd1", not: true }, { in: "s6", not: true }]);
    assert.deepEqual(broken(doc), []);
    roundTrips(doc);
  });

  it("triggers: an event or signal, auto, completion or none; internal transitions take only events and signals", () => {
    const doc = testDoc();
    setTrigger(doc, "t2", { auto: true });
    assert.deepEqual([T(doc, "t2").on, T(doc, "t2").auto], [undefined, true]);
    setTrigger(doc, "t2", { completion: true });
    assert.deepEqual([T(doc, "t2").auto, T(doc, "t2").completion], [undefined, true]);
    setTrigger(doc, "t2", { on: "sig1" });
    assert.deepEqual([T(doc, "t2").on, T(doc, "t2").completion], ["sig1", undefined]);
    setTrigger(doc, "t2", undefined);
    assert.deepEqual(Object.keys(T(doc, "t2")).sort(), ["do", "from", "guard", "id", "to"]);
    setTrigger(doc, "t7", { on: "sig1" });
    setTrigger(doc, "t7", { auto: true });
    assert.deepEqual(indexV1(doc).internals.get("t7")!.transition, { id: "t7", on: "sig1", guard: [{ in: "s3" }] }, "no auto on an internal transition");
    roundTrips(doc);
  });

  it("add an internal transition", () => {
    const doc = testDoc();
    assert.equal(addInternal(doc, "s2", "ev1"), "t8");
    assert.deepEqual(S(doc, "s2").internal, [{ id: "t8", on: "ev1" }]);
    assert.equal(addInternal(doc, "s1", "ev1"), undefined, "not a state");
    deleteElements(doc, ["t8"]);
    assert.equal(S(doc, "s2").internal, undefined);
  });

  it("turn a fork/join bar around its centre", () => {
    const doc = testDoc();
    setBarOrientation(doc, "s7", true);
    assert.deepEqual(doc.diagram!.states["s7"], { x: 855, y: 345, w: 100, h: 10, orientation: "horizontal" });
    setBarOrientation(doc, "s7", false);
    assert.deepEqual(doc.diagram!.states["s7"], { x: 900, y: 300, w: 10, h: 100 });
    roundTrips(doc);
  });

  it("put a self-contained region on a page of its own and back", () => {
    const doc = testDoc();
    assert.match(cannotOffPage(indexV1(doc), "r1")!, /2 transitions cross the region's border/, "t2 and t4 leave r1");
    assert.match(cannotOffPage(indexV1(doc), "r0")!, /root/);
    deleteElements(doc, ["t2", "t4"]);
    const index0 = indexV1(doc);
    assert.equal(cannotOffPage(index0, "r1"), undefined);
    const before = clone(doc);
    const g0 = edgeGeometry(index0, "t6")!;
    setOffPage(doc, "r1", true);
    assert.deepEqual(doc.diagram!.regions["r1"], { h: 130, offPage: true });
    assert.deepEqual(doc.diagram!.states["s3"], { x: 20, y: 20, w: 100, h: 60 }, "same place relative to the band (130 abs)");
    const g1 = edgeGeometry(indexV1(doc), "t6")!;
    const moved = (p: { x: number; y: number }) => ({ x: p.x - 100, y: p.y - 130 });
    assert.deepEqual(g1.points, g0.points.map(moved), "the band's corner (100,130) became the sheet's origin");
    assert.deepEqual({ x: g1.label!.x, y: g1.label!.y }, moved(g0.label!));
    assert.deepEqual(broken(doc), []);
    setOffPage(doc, "r1", false);
    assert.deepEqual(doc, before, "and back: exactly as before");
    // a transition into the region crosses its border as well
    doc.machine.transitions.push({ id: "t9", from: "s5", to: "s6" });
    doc.diagram!.transitions["t9"] = { route: "s" };
    assert.match(cannotOffPage(indexV1(doc), "r1")!, /1 transition crosses/);
  });
});

describe("property edits on every repository model and random models", () => {
  const files = ["examples", "tests/models", "apps/editor/src/fsm"].flatMap((d) =>
    existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
  );
  const models = (): { name: string; doc: UfsmDocument }[] => [
    ...files.map((f) => ({ name: f, doc: loadModel(readFileSync(f, "utf8")).doc })),
    ...Array.from({ length: 40 }, (_, i) => ({ name: `random ${i}`, doc: randomModel(2000 + i) })),
  ];

  it("delete and rename random declarations: no dangling references, valid names, round trips", () => {
    const r = rng(21);
    let n = 0;
    for (const { name, doc: original } of models()) {
      const errors = new Set(checkV1(original).filter((d) => d.severity === "error").map((d) => d.code));
      const decls = [...indexV1(original).decls.keys()];
      for (let k = 0; k < 6; k++) {
        const doc = clone(original);
        const pick = decls.filter(() => r() < 0.3);
        for (const id of pick) {
          if (r() < 0.5) deleteDecl(doc, id);
          else {
            const fresh = `renamed_${n++}`;
            assert.equal(declNameProblem(indexV1(doc), fresh, id), undefined);
            renameDecl(doc, id, fresh);
          }
        }
        const after = checkV1(doc).filter((d) => d.severity === "error" && !errors.has(d.code));
        assert.deepEqual(after.map((d) => `${d.code}: ${d.message}`), [], `${name}: ${pick.join(" ")}`);
        const index = indexV1(doc);
        for (const id of pick) if (index.decls.has(id)) assert.ok(declUses(index, id).length >= 0);
        roundTrips(doc);
      }
    }
    assert.ok(n > 50);
  });

  it("every region that may go off-page goes there and back unchanged", () => {
    let n = 0;
    for (const { name, doc: original } of models().slice(0, files.length)) {
      const index = indexV1(original);
      for (const [id, info] of index.regions) {
        if (!info.owner || cannotOffPage(index, id)) continue;
        const off = index.doc.diagram?.regions[id]?.offPage === true;
        const doc = clone(original);
        setOffPage(doc, id, !off);
        assert.deepEqual(broken(doc).filter((m) => !broken(original).includes(m)), [], `${name}: ${id}`);
        setOffPage(doc, id, off);
        assert.deepEqual(doc, original, `${name}: ${id} round trip`);
        n++;
      }
    }
    assert.ok(n > 20, String(n));
  });
});
