// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_MIN_H,
  HEADER_H,
  actionBlock,
  checkV1,
  indexV1,
  parseV1,
  regionBoxes,
  resetActionsHeight,
  serializeV1,
  setActionsHeight,
  vertexBox,
  type ActionBlock,
  type State,
  type UfsmDocument,
} from "../src/index";

/**
 * P (100,100, 300 wide) with six entry actions, four exit actions, three timers and two internal transitions, and two
 * regions: r1 (h 200) with A at y 300 (absolute 400), r2 (fill) with B. `w` and `actionsHeight` vary per test.
 */
function testDoc(w = 300, actionsHeight?: number): UfsmDocument {
  const names = ["initMotor", "ledOn", "startLog", "armWatchdog", "openValve", "clearFault", "stopMotor", "ledOff", "stopLog", "closeValve", "aInt", "poll", "count"];
  return parseV1(
    JSON.stringify({
      format: "ufsm",
      version: 1,
      name: "block",
      declarations: {
        events: [
          { id: "ev1", name: "eTimeout" },
          { id: "ev2", name: "eTick" },
          { id: "ev3", name: "eIdle" },
          { id: "ev4", name: "eInt" },
        ],
        signals: [],
        actions: names.map((name, i) => ({ id: `act${i + 1}`, name })),
        guards: [{ id: "grd1", name: "gReady" }],
      },
      machine: {
        root: {
          id: "r0",
          states: [
            {
              id: "s1",
              kind: "state",
              name: "P",
              entry: [1, 2, 3, 4, 5, 6].map((i) => ({ call: `act${i}` })),
              exit: [7, 8, 9, 10].map((i) => ({ call: `act${i}` })),
              timers: [
                { id: "tm1", name: "travel", after: 2, unit: "s", event: "ev1" },
                { id: "tm2", name: "poll", every: 100, unit: "ms", event: "ev2" },
                { id: "tm3", name: "idle", after: 5, unit: "min", event: "ev3" },
              ],
              internal: [
                { id: "t1", on: "ev4", do: [{ call: "act11" }] },
                { id: "t2", on: "ev2", guard: [{ call: "grd1" }], do: [{ call: "act12" }, { call: "act13" }] },
              ],
              regions: [
                { id: "r1", states: [{ id: "s2", kind: "state", name: "A" }] },
                { id: "r2", states: [{ id: "s3", kind: "state", name: "B" }] },
              ],
            },
            { id: "s4", kind: "state", name: "Plain" },
          ],
        },
        transitions: [],
      },
      diagram: {
        paper: "A2",
        states: {
          s1: { x: 100, y: 100, w, h: 600, ...(actionsHeight === undefined ? {} : { actionsHeight }) },
          s2: { x: 20, y: 300, w: 100, h: 60 },
          s3: { x: 20, y: 500, w: 100, h: 60 },
          s4: { x: 600, y: 100, w: 100, h: 60 },
        },
        regions: { r1: { h: 200 } },
        transitions: {},
      },
    }),
  );
}

const P = (doc: UfsmDocument): State => doc.machine.root.states[0] as State;
const block = (doc: UfsmDocument): ActionBlock => actionBlock(indexV1(doc), P(doc));
const texts = (b: ActionBlock): string[] => b.rows.map((r) => r.segments.map((g) => `${g.icon ?? "-"}:${g.text}`).join(" | "));

describe("action block layout", () => {
  it("wraps entry and exit lists to the state's width, packs timers, one internal transition per line", () => {
    // 300 wide: (300 - 30 - 10) / 7 = 37 characters per line
    const b = block(testDoc());
    assert.deepEqual(texts(b), [
      "entry:initMotor(), ledOn(), startLog(),",
      "-:armWatchdog(), openValve(),",
      "-:clearFault()",
      "exit:stopMotor(), ledOff(), stopLog(),",
      "-:closeValve()",
      "after:2 s → eTimeout | every:100 ms → eTick",
      "after:5 min → eIdle",
      "internal:eInt / aInt()",
      "internal:eTick [gReady()] / poll(), count()",
    ]);
    assert.deepEqual(b.rows.map((r) => r.continued), [false, true, true, false, true, false, false, false, false]);
    assert.deepEqual(b.counts, { entry: 6, exit: 4, after: 2, every: 1, internal: 2 });
    assert.equal(b.auto, 10 + 20 * 9);
    assert.equal(b.height, b.auto);
    assert.equal(b.visible, 9);
    assert.ok(!b.limited && !b.summary && !b.cut && b.hiddenMarker === undefined);
    assert.deepEqual(b.hidden, { entry: 0, exit: 0, after: 0, every: 0, internal: 0 });
    // icons at the margin, continuation lines under the first action, the second timer after the first and a gap
    assert.deepEqual(b.rows[0]!.segments.map((g) => g.x), [10]);
    assert.deepEqual(b.rows[1]!.segments.map((g) => g.x), [30]);
    assert.deepEqual(b.rows[5]!.segments.map((g) => g.x), [10, 10 + 20 + 14 * 7 + 16]);
  });
  it("uses fewer lines in a wider state and more in a narrower one; a word that is too long keeps its line", () => {
    const wide = block(testDoc(800));
    assert.equal(wide.rows.length, 5, "entry, exit, timers and two internal transitions");
    assert.equal(texts(wide)[2], "after:2 s → eTimeout | every:100 ms → eTick | after:5 min → eIdle");
    const narrow = block(testDoc(100));
    assert.equal(narrow.rows.filter((r) => r.segments[0]!.icon === "entry" || r.continued).length >= 6, true);
    assert.equal(texts(narrow)[0], "entry:initMotor(),", "one action per line: 8 characters fit, the word is longer");
    assert.equal(narrow.auto, 10 + 20 * narrow.rows.length);
  });
  it("is empty for a state without actions, timers and internal transitions, whatever height is stored", () => {
    const doc = testDoc();
    doc.diagram!.states["s4"]!.actionsHeight = 50;
    const b = actionBlock(indexV1(doc), doc.machine.root.states[1] as State);
    assert.equal(b.auto, 0);
    assert.equal(b.height, 0);
    assert.equal(b.hiddenMarker, undefined);
  });
});

describe("action block with a stored height", () => {
  it("shows whole lines, counts what is hidden per kind and marks a list that is cut", () => {
    const b = block(testDoc(300, 90)); // four lines
    assert.equal(b.height, 90);
    assert.equal(b.visible, 4);
    assert.ok(b.limited && !b.summary);
    assert.ok(b.cut, "the exit list goes on in the first hidden line");
    assert.deepEqual(b.hidden, { entry: 0, exit: 1, after: 2, every: 1, internal: 2 });
    assert.ok(b.hiddenMarker);
    assert.deepEqual(b.hiddenMarker.parts.map((p) => `${p.icon}:${p.text}`), ["exit:1", "after:2", "every:1", "internal:2"]);
    assert.equal(b.hiddenMarker.x + b.hiddenMarker.w, 300 - 10, "right-aligned inside the margin");
    assert.equal(b.hiddenMarker.y + b.hiddenMarker.h / 2, HEADER_H + 90, "centred on the block's bottom line");
    const five = block(testDoc(300, 110));
    assert.ok(!five.cut, "the timers start a new line");
    assert.deepEqual(five.hidden, { entry: 0, exit: 0, after: 2, every: 1, internal: 2 });
  });
  it("rounds a height between lines down and never goes below one line", () => {
    assert.equal(block(testDoc(300, 85)).visible, 3);
    const tiny = block(testDoc(300, 5));
    assert.equal(tiny.height, ACTION_MIN_H);
    assert.ok(tiny.summary);
  });
  it("shows only the counts at one line", () => {
    const b = block(testDoc(300, ACTION_MIN_H));
    assert.ok(b.summary && b.limited);
    assert.equal(b.visible, 0);
    assert.equal(b.hiddenMarker, undefined);
    assert.deepEqual(b.summaryRow.map((g) => `${g.icon}:${g.text}`), ["entry:6", "exit:4", "after:2", "every:1", "internal:2"]);
    assert.deepEqual(b.hidden, b.counts);
  });
  it("has no effect when it is at least as tall as the lines", () => {
    const b = block(testDoc(300, 400));
    assert.equal(b.height, b.auto);
    assert.ok(!b.limited && b.hiddenMarker === undefined);
  });
  it("falls back to one total in a state too narrow for a count per kind", () => {
    const b = block(testDoc(100, 50));
    assert.ok(b.hiddenMarker);
    assert.equal(b.hiddenMarker.parts.length, 1);
    assert.match(b.hiddenMarker.parts[0]!.text, /^\+\d+$/);
    assert.equal(b.hiddenMarker.parts[0]!.icon, undefined);
    const hidden = Object.values(b.hidden).reduce((a, n) => a + n, 0);
    assert.equal(b.hiddenMarker.parts[0]!.text, `+${hidden}`);
  });
  it("moves the region bands with it", () => {
    const top = (doc: UfsmDocument): number => regionBoxes(indexV1(doc), P(doc))[0]!.box.y;
    assert.equal(top(testDoc()), 100 + HEADER_H + 190);
    assert.equal(top(testDoc(300, 90)), 100 + HEADER_H + 90);
  });
  it("is written after orientation, read back and accepted by the schema", () => {
    const text = serializeV1(testDoc(300, 90));
    assert.match(text, /"s1": \{ "x": 100, "y": 100, "w": 300, "h": 600, "actionsHeight": 90 \}/);
    assert.equal(serializeV1(parseV1(text)), text);
    assert.throws(() => parseV1(text.replace('"actionsHeight": 90', '"actionsHeight": "tall"')), /actionsHeight/);
  });
});

describe("resizing the action block", () => {
  const bands = (doc: UfsmDocument): number[] => regionBoxes(indexV1(doc), P(doc)).map((r) => r.box.y);
  it("stores whole lines and gives the difference to the first region band", () => {
    const doc = testDoc();
    const before = bands(doc);
    setActionsHeight(doc, "s1", 100 + HEADER_H + 94); // nearest whole line: 90
    assert.equal(doc.diagram!.states["s1"]!.actionsHeight, 90);
    assert.equal(doc.diagram!.regions["r1"]!.h, 300, "the first band grew by the 100 the block gave up");
    assert.deepEqual(bands(doc), [before[0]! - 100, before[1]!], "the separator below it stays");
    assert.equal(vertexBox(indexV1(doc), "s2").y, 400, "contents do not move");
  });
  it("never goes below one line", () => {
    const doc = testDoc();
    setActionsHeight(doc, "s1", 0);
    assert.equal(doc.diagram!.states["s1"]!.actionsHeight, ACTION_MIN_H);
    assert.ok(block(doc).summary);
  });
  it("is automatic again once every line shows", () => {
    const doc = testDoc(300, 90);
    doc.diagram!.regions["r1"]!.h = 300;
    setActionsHeight(doc, "s1", 2000);
    assert.equal(doc.diagram!.states["s1"]!.actionsHeight, undefined);
    assert.equal(doc.diagram!.regions["r1"]!.h, 200);
    assert.equal(serializeV1(doc), serializeV1(testDoc()));
  });
  it("stops at the contents of the first band and leaves it a minimum height", () => {
    const doc = testDoc(300, 30);
    doc.diagram!.regions["r1"]!.h = 360;
    doc.diagram!.states["s2"]!.y = 150; // A's top at 250: 120 below the header
    setActionsHeight(doc, "s1", 2000);
    assert.equal(doc.diagram!.states["s1"]!.actionsHeight, 110, "the last whole line above A");
    assert.equal(doc.diagram!.regions["r1"]!.h, 280);
    resetActionsHeight(doc, "s1");
    assert.equal(doc.diagram!.states["s1"]!.actionsHeight, 110, "double-click obeys the same limit");
  });
  it("resets to automatic, and does nothing for a state without a block", () => {
    const doc = testDoc(300, 50);
    doc.diagram!.regions["r1"]!.h = 340;
    resetActionsHeight(doc, "s1");
    assert.equal(serializeV1(doc), serializeV1(testDoc()));
    const plain = testDoc();
    setActionsHeight(plain, "s4", 500);
    resetActionsHeight(plain, "s4");
    assert.equal(serializeV1(plain), serializeV1(testDoc()));
  });
});

describe("design rules for the action block", () => {
  const codes = (doc: UfsmDocument): string[] => checkV1(doc).filter((d) => d.code.startsWith("actions-")).map((d) => `${d.code} ${d.id}: ${d.message}`);
  it("accept a block that fits, also with lines hidden by a stored height", () => {
    assert.deepEqual(codes(testDoc()), []);
    assert.deepEqual(codes(testDoc(300, 50)), []);
    assert.deepEqual(codes(testDoc(300, ACTION_MIN_H)), []);
  });
  it("warn when the state is too low or too narrow for what the block shows", () => {
    const low = testDoc();
    low.diagram!.states["s1"]!.h = 150;
    assert.deepEqual(codes(low).filter((c) => c.startsWith("actions-clipped")), ["actions-clipped s1: state 'P' is too small to show its actions, timers and internal transitions"]);
    const narrow = testDoc(100);
    assert.equal(codes(narrow).filter((c) => c.startsWith("actions-clipped")).length, 1, "initMotor(), is wider than the state");
    const hiddenInstead = testDoc(300, 50);
    hiddenInstead.diagram!.states["s1"]!.h = 150;
    assert.deepEqual(codes(hiddenInstead).filter((c) => c.startsWith("actions-clipped")), [], "two lines fit in 150");
  });
  it("warn when the block is drawn over the first region's contents", () => {
    const doc = testDoc();
    doc.diagram!.states["s2"]!.y = 150;
    assert.deepEqual(codes(doc), ["actions-overlap s1: the actions of state 'P' are drawn over 'A'"]);
    doc.diagram!.states["s1"]!.actionsHeight = 110;
    assert.deepEqual(codes(doc), []);
  });
});
