// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IdAllocator,
  UfsmFormatError,
  checkV1,
  documentIds,
  generateFiles,
  indexV1,
  loadModel,
  parseV1,
  serializeV1,
  type UfsmDocument,
} from "../src";
import {
  addArrow,
  addFrame,
  addNote,
  copyFragment,
  deleteElements,
  moveSelection,
  moveVertices,
  pasteFragment,
  resizeAnnotation,
  resizeVertex,
  setArrowEnd,
  setNoteText,
  setOffPage,
} from "../src/edit";
import {
  annotationBox,
  annotationsOn,
  arrowPoints,
  edgeGeometry,
  fractionAlong,
  locate,
  noteDisplayText,
  noteRefs,
  pointAlong,
  sheetFit,
  vertexBox,
  wrapNoteText,
} from "../src/diagram";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 *   Initial ─► P (100,100 400x300) ── t2 (straight) ──► C (700,100 120x80)
 *              └ r1 (fill): A (abs 120,150 100x60), B (abs 300,150 100x60)
 */
function testDoc(diagram: Record<string, unknown> = {}): UfsmDocument {
  return parseV1(
    JSON.stringify({
      format: "ufsm",
      version: 1,
      name: "notes",
      declarations: { events: [{ id: "ev1", name: "eGo" }], signals: [], actions: [], guards: [] },
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
                {
                  id: "r1",
                  states: [
                    { id: "s3", kind: "state", name: "A" },
                    { id: "s4", kind: "state", name: "B" },
                  ],
                },
              ],
            },
            { id: "s5", kind: "state", name: "C" },
          ],
        },
        transitions: [
          { id: "t1", from: "s1", to: "s2" },
          { id: "t2", from: "s2", to: "s5", on: "ev1" },
        ],
      },
      diagram: {
        paper: "A4",
        states: {
          s1: { x: 40, y: 40, w: 20, h: 20 },
          s2: { x: 100, y: 100, w: 400, h: 300 },
          s3: { x: 20, y: 50, w: 100, h: 60 },
          s4: { x: 200, y: 50, w: 100, h: 60 },
          s5: { x: 700, y: 100, w: 120, h: 80 },
        },
        regions: {},
        transitions: {
          t1: { from: { side: "right", offset: 10 }, to: { side: "left", offset: 20 } },
          t2: { from: { side: "right", offset: 50 }, to: { side: "left", offset: 50 } },
        },
        ...diagram,
      },
    }),
  );
}

const index = (doc: UfsmDocument) => indexV1(doc);
const codes = (doc: UfsmDocument): string[] => checkV1(doc).map((d) => `${d.severity}:${d.code}`);

describe("notes, frames and arrows: format", () => {
  it("round-trip in canonical form, maps in natural id order, defaults left out", () => {
    const doc = testDoc({
      notes: {
        n10: { region: "r0", x: 600, y: 300, w: 200, h: 60, text: "Later" },
        n2: { region: "r1", x: 20, y: 150, w: 160, h: 60, text: "See {s3}\nand {ev1}", todo: true },
      },
      frames: { g1: { region: "r1", x: 10, y: 40, w: 380, h: 90, caption: "Pair" } },
      arrows: {
        a1: { region: "r0", from: { ref: "n10", x: 0, y: 30 }, to: { ref: "t2", at: 0.5 }, head: "end" },
        a2: { region: "r0", from: { x: 600, y: 500 }, to: { ref: "s5", x: 60, y: 80 }, head: "both", dashed: true },
      },
    });
    const text = serializeV1(doc);
    assert.deepEqual(parseV1(text), parseV1(serializeV1(parseV1(text))));
    assert.equal(serializeV1(parseV1(text)), text);
    const dia = JSON.parse(text).diagram;
    assert.deepEqual(Object.keys(dia), ["paper", "states", "regions", "transitions", "frames", "notes", "arrows"]);
    assert.deepEqual(Object.keys(dia.notes), ["n2", "n10"]);
    assert.equal(dia.arrows.a1.head, undefined, "end is the default");
    assert.equal(dia.arrows.a2.head, "both");
    assert.deepEqual(dia.arrows.a1, { region: "r0", from: { ref: "n10", x: 0, y: 30 }, to: { ref: "t2", at: 0.5 } });
  });

  it("the reader rejects malformed ones", () => {
    const bad = (diagram: Record<string, unknown>, path: RegExp): void => {
      const text = serializeV1(testDoc()).replace(
        '"regions": {}',
        `"regions": {}, ${JSON.stringify(diagram).slice(1, -1)}`,
      );
      assert.throws(
        () => parseV1(text),
        (e: unknown) => e instanceof UfsmFormatError && path.test(e.path),
      );
    };
    bad({ notes: { n1: { region: "r0", x: 0, y: 0, w: 100, h: 40 } } }, /notes\.n1\.text/);
    bad({ frames: { g1: { region: "r0", x: 0, y: 0, w: 100, h: 40, colour: "red" } } }, /frames\.g1\.colour/);
    bad({ arrows: { a1: { region: "r0", from: { ref: "t2", at: 2 }, to: { x: 0, y: 0 } } } }, /arrows\.a1\.from/);
    bad(
      { arrows: { a1: { region: "r0", from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, head: "start" } } },
      /arrows\.a1\.head/,
    );
  });

  it("change nothing the generators see: generated code is byte-identical", () => {
    const plain = loadModel(readFileSync(join(repoRoot, "examples", "dimmer.ufsm"), "utf8")).doc;
    const noted = structuredClone(plain);
    const root = noted.machine.root.id;
    addNote(noted, root, { x: 40, y: 600, w: 200, h: 60 }, "Long press: held > 800 ms", { todo: true });
    addFrame(noted, root, { x: 20, y: 500, w: 400, h: 200 }, "Group");
    const s = noted.machine.root.states.find((v) => v.kind === "state")!;
    addArrow(
      noted,
      root,
      { target: undefined, p: { x: 40, y: 600 } },
      { target: s.id, p: vertexBox(indexV1(noted), s.id) },
    );
    for (const target of ["c", "python", "ts", "rust", "go", "cpp", "csharp"] as const)
      assert.deepEqual(generateFiles(noted, target).files, generateFiles(plain, target).files, target);
  });

  it("their ids are document ids, so new ids never clash with them", () => {
    const doc = testDoc({ notes: { n1: { region: "r0", x: 0, y: 0, w: 100, h: 40, text: "" } } });
    assert.ok(documentIds(doc).has("n1"));
    assert.equal(new IdAllocator(doc).take("n"), "n2");
  });
});

describe("notes, frames and arrows: design rules", () => {
  it("TODO notes are listed as info; a clean document has no other findings", () => {
    const doc = testDoc({
      notes: { n1: { region: "r0", x: 600, y: 300, w: 200, h: 60, text: "Fade out?\nmore", todo: true } },
    });
    const found = checkV1(doc).filter((d) => d.id === "n1");
    assert.deepEqual(found, [{ severity: "info", code: "todo", message: "TODO: Fade out?", id: "n1" }]);
  });

  it("unknown regions, references and attachments, ids taken twice, arrows across sheets", () => {
    const doc = testDoc({
      notes: {
        n1: { region: "r9", x: 0, y: 0, w: 100, h: 40, text: "" },
        n2: { region: "r0", x: 600, y: 300, w: 100, h: 40, text: "see {s3} and {s99}" },
        s3: { region: "r0", x: 600, y: 400, w: 100, h: 40, text: "" },
      },
      arrows: {
        a1: { region: "r0", from: { ref: "s77", x: 0, y: 0 }, to: { ref: "t9", at: 0.5 }, head: "none" },
      },
    });
    const c = codes(doc);
    for (const code of ["annotation-region", "note-ref", "annotation-id", "arrow-ref"])
      assert.ok(c.includes(`warning:${code}`), code);
    assert.equal(c.filter((x) => x === "warning:arrow-ref").length, 2);
    assert.ok(!c.some((x) => x.startsWith("error:")));

    const off = testDoc({
      regions: { r1: { offPage: true } },
      arrows: { a1: { region: "r0", from: { x: 600, y: 300 }, to: { ref: "s3", x: 0, y: 0 } } },
    });
    assert.ok(codes(off).includes("warning:arrow-sheet"));
  });

  it("notes, frames and arrows take part in the sheet fit check and are located", () => {
    const doc = testDoc({
      notes: { n1: { region: "r0", x: 1500, y: 0, w: 200, h: 60, text: "off the edge" } },
      frames: { g1: { region: "r0", x: 1100, y: 950, w: 100, h: 60 } },
      arrows: { a1: { region: "r0", from: { x: 600, y: 300 }, to: { x: 600, y: -40 } } },
    });
    const fit = sheetFit(index(doc)).map((p) => `${p.id}:${p.problem}`);
    assert.deepEqual(fit.sort(), ["a1:outside", "g1:title-block", "n1:outside"]);
    assert.ok(checkV1(doc).some((d) => d.code === "outside-frame" && /note 'off the edge'/.test(d.message)));
    assert.equal(locate(index(doc), "g1")?.sheet.number, 1);
  });
});

describe("notes, frames and arrows: geometry", () => {
  it("a note in a state's region is relative to the state and moves with it", () => {
    const doc = testDoc({ notes: { n1: { region: "r1", x: 20, y: 150, w: 160, h: 60, text: "" } } });
    assert.deepEqual(annotationBox(index(doc), "n1"), { x: 120, y: 250, w: 160, h: 60 });
    moveVertices(doc, ["s2"], 30, 20);
    assert.deepEqual(annotationBox(index(doc), "n1"), { x: 150, y: 270, w: 160, h: 60 });
    assert.deepEqual(doc.diagram!.notes!.n1, { region: "r1", x: 20, y: 150, w: 160, h: 60, text: "" });
  });

  it("arrow ends: free, on a box (kept inside it), along a transition's route", () => {
    const doc = testDoc({
      arrows: { a1: { region: "r1", from: { x: 10, y: 10 }, to: { ref: "s5", x: 500, y: 40 } } },
    });
    // free: relative to r1's origin (P's corner); on C: clamped to its right side
    assert.deepEqual(arrowPoints(index(doc), "a1"), { from: { x: 110, y: 110 }, to: { x: 820, y: 140 } });
    doc.diagram!.arrows!.a1!.to = { ref: "t2", at: 0.5 };
    const pts = edgeGeometry(index(doc), "t2")!.points;
    assert.deepEqual(arrowPoints(index(doc), "a1")!.to, pointAlong(pts, 0.5));
    assert.deepEqual(pointAlong(pts, 0.5), { x: 600, y: 150 });
    assert.equal(fractionAlong(pts, { x: 650, y: 100 }), 0.75);
  });

  it("annotationsOn lists what a sheet shows", () => {
    const doc = testDoc({
      regions: { r1: { offPage: true } },
      notes: {
        n1: { region: "r1", x: 0, y: 0, w: 100, h: 40, text: "" },
        n2: { region: "r0", x: 0, y: 0, w: 100, h: 40, text: "" },
      },
    });
    const ix = index(doc);
    assert.deepEqual(annotationsOn(ix, ix.regions.get("r1")!.region).notes, ["n1"]);
    assert.deepEqual(annotationsOn(ix, doc.machine.root).notes, ["n2"]);
  });

  it("note text: {id} shows the element's current name, unknown ones stay; wrapping", () => {
    const ix = index(testDoc());
    assert.equal(noteDisplayText(ix, "{s3} on {ev1}, not {s99} or {}"), "A on eGo, not {s99} or {}");
    assert.deepEqual(
      noteRefs("a {s3} b {x.y}").map((r) => r.id),
      ["s3", "x.y"],
    );
    // 7 units per character, room = w - 2*10 - 7 = 63: nine characters
    assert.deepEqual(wrapNoteText("one two three four", 90), ["one two", "three", "four"]);
    assert.deepEqual(wrapNoteText("abcdefghijklmnop", 90), ["abcdefghi", "jklmnop"]);
    assert.deepEqual(wrapNoteText("a\n\nb", 100), ["a", "", "b"]);
  });
});

describe("notes, frames and arrows: edits", () => {
  it("add: snapped, minimum size, relative to the region; arrows attach where they start and end", () => {
    const doc = testDoc();
    const n = addNote(doc, "r1", { x: 133, y: 288, w: 20, h: 10 }, "hi");
    assert.deepEqual(doc.diagram!.notes![n], { region: "r1", x: 30, y: 190, w: 60, h: 40, text: "hi" });
    const g = addFrame(doc, "r0", { x: 600, y: 300, w: 200, h: 100 }, "F");
    assert.equal(g, "g1");
    const a = addArrow(doc, "r0", { target: n, p: { x: 140, y: 300 } }, { target: "t2", p: { x: 650, y: 140 } });
    assert.deepEqual(doc.diagram!.arrows![a], {
      region: "r0",
      from: { ref: n, x: 10, y: 10 },
      to: { ref: "t2", at: 0.75 },
    });
    // both ends inside P's region: the arrow belongs to it
    const b = addArrow(
      doc,
      "r0",
      { target: undefined, p: { x: 300, y: 300 } },
      { target: "s3", p: { x: 130, y: 160 } },
    );
    assert.deepEqual(doc.diagram!.arrows![b], {
      region: "r1",
      from: { x: 200, y: 200 },
      to: { ref: "s3", x: 10, y: 10 },
    });
    setArrowEnd(doc, b, "from", undefined, { x: 900, y: 500 });
    assert.deepEqual(doc.diagram!.arrows![b]!.from, { x: 800, y: 400 });
  });

  it("moveSelection moves vertices and annotations together, snapped to the anchor", () => {
    const doc = testDoc({
      notes: {
        n1: { region: "r0", x: 600, y: 300, w: 100, h: 40, text: "" },
        n2: { region: "r1", x: 0, y: 200, w: 100, h: 40, text: "" },
      },
      arrows: { a1: { region: "r0", from: { x: 600, y: 400 }, to: { ref: "s5", x: 0, y: 0 } } },
    });
    const d = moveSelection(doc, ["s2", "n1", "n2", "a1"], 23, 18, "n1");
    assert.deepEqual(d, { x: 20, y: 20 });
    assert.deepEqual(vertexBox(index(doc), "s2"), { x: 120, y: 120, w: 400, h: 300 });
    assert.equal(doc.diagram!.notes!.n1!.x, 620);
    // n2 is inside P: it moved with P, not again
    assert.deepEqual([doc.diagram!.notes!.n2!.x, doc.diagram!.notes!.n2!.y], [0, 200]);
    // a free end moves, an attached one stays on its element
    assert.deepEqual(doc.diagram!.arrows!.a1, {
      region: "r0",
      from: { x: 620, y: 420 },
      to: { ref: "s5", x: 0, y: 0 },
    });
  });

  it("a note or frame dropped into a state's region belongs to it and moves with the state; dragged out it does not", () => {
    const doc = testDoc({
      notes: { n1: { region: "r0", x: 600, y: 300, w: 100, h: 40, text: "" } },
      frames: { g1: { region: "r0", x: 600, y: 400, w: 100, h: 60 } },
    });
    moveSelection(doc, ["n1", "g1"], -300, -50);
    assert.deepEqual(doc.diagram!.notes!.n1, { region: "r1", x: 200, y: 150, w: 100, h: 40, text: "" });
    assert.deepEqual(doc.diagram!.frames!.g1, { region: "r1", x: 200, y: 250, w: 100, h: 60 });
    moveVertices(doc, ["s2"], 30, 20);
    assert.deepEqual(annotationBox(index(doc), "n1"), { x: 330, y: 270, w: 100, h: 40 });
    assert.deepEqual(annotationBox(index(doc), "g1"), { x: 330, y: 370, w: 100, h: 60 });
    // the top-left corner decides: out of P's band, back on the sheet at the same place
    moveSelection(doc, ["n1"], 300, 0);
    assert.deepEqual(doc.diagram!.notes!.n1, { region: "r0", x: 630, y: 270, w: 100, h: 40, text: "" });
  });

  it("resize keeps the minimum size and arrow ends where they were", () => {
    const doc = testDoc({
      frames: { g1: { region: "r0", x: 600, y: 300, w: 200, h: 100 } },
      arrows: { a1: { region: "r0", from: { ref: "g1", x: 100, y: 50 }, to: { x: 0, y: 0 } } },
    });
    resizeAnnotation(doc, "g1", { left: 640, top: 395 });
    assert.deepEqual(annotationBox(index(doc), "g1"), { x: 640, y: 360, w: 160, h: 40 });
    assert.deepEqual(arrowPoints(index(doc), "a1")!.from, { x: 700, y: 360 });
    assert.deepEqual(doc.diagram!.arrows!.a1!.from, { ref: "g1", x: 60, y: 0 });
  });

  it("a note keeps its absolute place when its state's left/top edge moves, or its region goes off-page", () => {
    const doc = testDoc({
      notes: { n1: { region: "r1", x: 20, y: 150, w: 100, h: 40, text: "" } },
      arrows: { a1: { region: "r1", from: { x: 20, y: 150 }, to: { ref: "s2", x: 200, y: 0 } } },
    });
    resizeVertex(doc, "s2", { left: 90, top: 90 });
    assert.deepEqual(annotationBox(index(doc), "n1"), { x: 120, y: 250, w: 100, h: 40 });
    assert.deepEqual(arrowPoints(index(doc), "a1"), { from: { x: 120, y: 250 }, to: { x: 300, y: 100 } });
    setOffPage(doc, "r1", true);
    // inline: relative to P's corner; off-page: the band's offset (header) comes off y
    assert.deepEqual([doc.diagram!.notes!.n1!.x, doc.diagram!.notes!.n1!.y], [30, 130]);
  });

  it("delete: notes go with their region, arrow ends on deleted elements stay as free ends", () => {
    const doc = testDoc({
      notes: {
        n1: { region: "r1", x: 20, y: 150, w: 100, h: 40, text: "" },
        n2: { region: "r0", x: 600, y: 300, w: 100, h: 40, text: "" },
      },
      arrows: {
        a1: { region: "r0", from: { ref: "n2", x: 0, y: 0 }, to: { ref: "s3", x: 10, y: 10 } },
        a2: { region: "r0", from: { ref: "n2", x: 0, y: 0 }, to: { ref: "t2", at: 0.5 } },
      },
    });
    const gone = deleteElements(doc, ["s2", "n2"]);
    assert.ok(gone.has("n1") && gone.has("n2"));
    assert.equal(doc.diagram!.notes, undefined);
    assert.deepEqual(doc.diagram!.arrows!.a1, { region: "r0", from: { x: 600, y: 300 }, to: { x: 130, y: 160 } });
    // t2 went with P
    assert.deepEqual(doc.diagram!.arrows!.a2, { region: "r0", from: { x: 600, y: 300 }, to: { x: 600, y: 150 } });
    assert.deepEqual(deleteElements(doc, ["a1", "a2"]), new Set(["a1", "a2"]));
    assert.equal(doc.diagram!.arrows, undefined);
    assert.deepEqual(
      checkV1(doc).filter((d) => /arrow|note|annotation/.test(d.code)),
      [],
    );
  });

  it("copy and paste: annotations come along, ids and {id} references follow the copy", () => {
    const doc = testDoc({
      notes: {
        n1: { region: "r1", x: 20, y: 150, w: 100, h: 40, text: "about {s3} and {s5}" },
        n2: { region: "r0", x: 600, y: 300, w: 100, h: 40, text: "top" },
      },
      arrows: {
        a1: { region: "r1", from: { ref: "n1", x: 0, y: 0 }, to: { ref: "s3", x: 0, y: 0 } },
        a2: { region: "r0", from: { ref: "n2", x: 0, y: 0 }, to: { ref: "s2", x: 0, y: 0 } },
        a3: { region: "r0", from: { ref: "n2", x: 0, y: 0 }, to: { ref: "s5", x: 0, y: 0 } },
      },
    });
    const frag = copyFragment(index(doc), ["s2", "n2"])!;
    assert.deepEqual(Object.keys(frag.annotations!.notes).sort(), ["n1", "n2"]);
    assert.deepEqual(Object.keys(frag.annotations!.arrows).sort(), ["a1", "a2"], "a3 ends on C, which is not copied");
    const ids = pasteFragment(doc, frag, "r0", { x: 100, y: 500 });
    const notes = doc.diagram!.notes!;
    const n1 = ids.find((id) => notes[id]?.region !== "r0" && notes[id] !== undefined)!;
    const s = ids[0]!;
    const inner = doc.machine.root.states.find((v) => v.id === s)!;
    const a = inner.kind === "state" ? inner.regions![0]!.states[0]!.id : "";
    assert.equal(notes[n1]!.text, `about {${a}} and {s5}`);
    assert.equal(notes[n1]!.region, inner.kind === "state" ? inner.regions![0]!.id : "");
    const top = ids.find((id) => notes[id]?.region === "r0")!;
    assert.deepEqual(annotationBox(index(doc), top), { x: 600, y: 700, w: 100, h: 40 });
    assert.deepEqual(
      checkV1(doc).filter((d) => d.severity !== "info" && /arrow|note|annotation/.test(d.code)),
      [],
    );
    // only annotations: pasted on their own
    const only = copyFragment(index(doc), ["n2"])!;
    assert.equal(only.vertices.length, 0);
    assert.equal(pasteFragment(doc, only, "r0", { x: 0, y: 0 }).length, 1);
  });

  it("setNoteText stores the height the text needs, on the grid", () => {
    const doc = testDoc({ notes: { n1: { region: "r0", x: 0, y: 0, w: 100, h: 40, text: "" } } });
    setNoteText(doc, "n1", "a\nb\nc", 73);
    assert.deepEqual([doc.diagram!.notes!.n1!.text, doc.diagram!.notes!.n1!.h], ["a\nb\nc", 80]);
  });
});
