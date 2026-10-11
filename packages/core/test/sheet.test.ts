// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  PAPER_SIZES,
  checkV1,
  indexV1,
  loadModel,
  migrateV0,
  parseV1,
  serializeV1,
  v0,
  type Paper,
  type UfsmDocument,
} from "../src";
import { newDocument } from "../src/edit";
import {
  FRAME_BORDER,
  FRAME_MARGIN,
  TITLE_BLOCK_H,
  TITLE_BLOCK_W,
  ZONES,
  isSheet,
  locate,
  locationText,
  sheetFit,
  sheetFrame,
  sheetInfo,
  sheets,
  titleBlockCells,
  zoneOf,
  LABEL_FIRST_LINE,
  LABEL_TOP,
  layoutTransitionLabel,
  transitionLabelItems,
} from "../src/diagram";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PAPERS = Object.keys(PAPER_SIZES) as Paper[];
const MM = 2 * (72 / 25.4); // canvas units per millimetre (2 units per pt)

function load(rel: string): UfsmDocument {
  return loadModel(readFileSync(join(repoRoot, rel), "utf8")).doc;
}

/**
 *   r0: Initial (40,40) ─► A (100,100 300x200) ─t2─► B (600,100 200x100)
 *       A has r1 (off-page): C (40,40) ─► D (300,40), and r2 (inline, fills): E (20,20 within the band)
 */
function testDoc(paper: Paper = "A4"): UfsmDocument {
  return parseV1(
    JSON.stringify({
      format: "ufsm",
      version: 1,
      name: "frame",
      doc: "Checks the drawing frame.\nSecond line.",
      declarations: { events: [{ id: "ev1", name: "e1" }], signals: [], actions: [], guards: [] },
      machine: {
        root: {
          id: "r0",
          states: [
            { id: "s1", kind: "initial" },
            {
              id: "s2",
              kind: "state",
              name: "A",
              regions: [
                {
                  id: "r1",
                  name: "Inner",
                  states: [
                    { id: "s4", kind: "state", name: "C" },
                    { id: "s5", kind: "state", name: "D" },
                  ],
                },
                { id: "r2", states: [{ id: "s6", kind: "state", name: "E" }] },
              ],
            },
            { id: "s3", kind: "state", name: "B" },
          ],
        },
        transitions: [
          { id: "t1", from: "s1", to: "s2" },
          { id: "t2", from: "s2", to: "s3", on: "ev1" },
          { id: "t3", from: "s4", to: "s5", on: "ev1" },
        ],
      },
      diagram: {
        paper,
        states: {
          s1: { x: 40, y: 40, w: 20, h: 20 },
          s2: { x: 100, y: 100, w: 300, h: 200 },
          s3: { x: 600, y: 100, w: 200, h: 100 },
          s4: { x: 40, y: 40, w: 100, h: 60 },
          s5: { x: 300, y: 40, w: 100, h: 60 },
          s6: { x: 20, y: 20, w: 80, h: 40 },
        },
        regions: { r1: { h: 60, offPage: true } },
        transitions: { t1: { route: "s" }, t2: { route: "s" }, t3: { route: "s" } },
      },
    }),
  );
}

describe("sheet frame", () => {
  it("the paper is the A size at 2 units per pt; the drawing area starts at the sheet origin, the margin all round", () => {
    for (const p of PAPERS) {
      const f = sheetFrame(p);
      assert.deepEqual(f.sheet, { x: -FRAME_MARGIN, y: -FRAME_MARGIN, ...PAPER_SIZES[p] });
      assert.deepEqual(f.area, {
        x: 0,
        y: 0,
        w: PAPER_SIZES[p].w - 2 * FRAME_MARGIN,
        h: PAPER_SIZES[p].h - 2 * FRAME_MARGIN,
      });
      assert.equal(f.border.x, FRAME_BORDER - FRAME_MARGIN);
      assert.equal(f.border.x + f.border.w, f.sheet.x + f.sheet.w - FRAME_BORDER);
      assert.ok(FRAME_BORDER / MM >= 5, `${p}: the border line is printable (≥ 5 mm from the edge)`);
      assert.ok(FRAME_MARGIN - FRAME_BORDER >= 15, `${p}: room for the zone labels`);
    }
  });

  it("zones: ISO 5457 counts, about 50 mm each, numbers along the long edge", () => {
    for (const p of PAPERS) {
      const f = sheetFrame(p);
      assert.equal(f.xs.length, ZONES[p].cols + 1);
      assert.equal(f.ys.length, ZONES[p].rows + 1);
      assert.equal(f.xs[0], 0);
      assert.equal(f.xs.at(-1), f.area.w);
      assert.equal(f.ys.at(-1), f.area.h);
      assert.ok(ZONES[p].cols > ZONES[p].rows, "landscape: more columns than rows");
      for (const size of [f.area.w / ZONES[p].cols, f.area.h / ZONES[p].rows]) {
        assert.ok(size / MM > 42 && size / MM < 58, `${p}: zone of ${(size / MM).toFixed(1)} mm`);
      }
    }
  });

  it("zone references: letter then number, I and O skipped, undefined outside the area", () => {
    const f = sheetFrame("A4");
    assert.equal(zoneOf(f, { x: 0, y: 0 }), "A1");
    assert.equal(zoneOf(f, { x: f.area.w, y: f.area.h }), "D6", "the far corner belongs to the last zone");
    assert.equal(zoneOf(f, { x: f.xs[2]! + 1, y: f.ys[1]! + 1 }), "B3");
    assert.equal(zoneOf(f, { x: -1, y: 10 }), undefined);
    assert.equal(zoneOf(f, { x: 10, y: f.area.h + 1 }), undefined);
    const a1 = sheetFrame("A1");
    const letters = a1.ys
      .slice(0, -1)
      .map((y) => zoneOf(a1, { x: 1, y: y + 1 })!.slice(0, 1))
      .join("");
    assert.equal(letters, "ABCDEFGHJKLM");
    assert.equal(zoneOf(a1, { x: a1.area.w, y: 1 }), "A16");
  });

  it("the title block sits in the bottom-right corner of the drawing area", () => {
    for (const p of PAPERS) {
      const { titleBlock: tb, area } = sheetFrame(p);
      assert.deepEqual(tb, {
        x: area.w - TITLE_BLOCK_W,
        y: area.h - TITLE_BLOCK_H,
        w: TITLE_BLOCK_W,
        h: TITLE_BLOCK_H,
      });
    }
  });
});

describe("sheets of a document", () => {
  it("numbered in document order, root first; paths as in KiCad", () => {
    const index = indexV1(testDoc());
    const all = sheets(index);
    assert.deepEqual(
      all.map((s) => [s.number, s.region.id, s.name, s.path]),
      [
        [1, "r0", "frame", "/"],
        [2, "r1", "A · Inner", "/A · Inner"],
      ],
    );
    assert.equal(
      sheetInfo(index, index.regions.get("r2")!.region).number,
      1,
      "an inline region is drawn on its parent's sheet",
    );
    assert.equal(sheets(index), all, "cached per index");
  });

  it("every sheet of the repository models once, a parent's path before its children's", () => {
    for (const rel of ["tests/models/canvas.ufsm", "apps/editor/src/fsm/editor.ufsm"]) {
      const index = indexV1(load(rel));
      const all = sheets(index);
      const offPage = [...index.regions.values()].filter((r) => isSheet(index, r.region));
      assert.equal(all.length, offPage.length, rel);
      assert.deepEqual(
        all.map((s) => s.number),
        all.map((_, i) => i + 1),
      );
      for (const s of all.slice(1)) {
        assert.equal(sheetInfo(index, s.region), s, "a sheet is drawn on itself");
        const owner = index.regions.get(s.region.id)!.owner!;
        const up = sheetInfo(index, index.vertices.get(owner.id)!.region);
        assert.ok(up.number < s.number, `${rel}: ${s.path} after ${up.path}`);
        assert.ok(s.path.startsWith(up.path === "/" ? "/" : `${up.path}/`), `${rel}: ${s.path} below ${up.path}`);
      }
    }
  });

  it("locate: sheet and zone of a vertex and of a transition", () => {
    const index = indexV1(testDoc());
    assert.equal(locationText(locate(index, "s2")!), "sheet 1, A1");
    assert.equal(locationText(locate(index, "s3")!), "sheet 1, A3");
    assert.equal(locationText(locate(index, "s5")!), "sheet 2, A2");
    assert.equal(locate(index, "t3")!.sheet.number, 2);
    assert.equal(locate(index, "nope"), undefined);
  });
});

describe("title block", () => {
  it("cells tile the block exactly", () => {
    for (const p of PAPERS) {
      const index = indexV1(testDoc(p));
      const cells = titleBlockCells(index, index.doc.machine.root);
      const tb = sheetFrame(p).titleBlock;
      let area = 0;
      for (const c of cells) {
        area += c.box.w * c.box.h;
        assert.ok(
          c.box.x >= tb.x && c.box.y >= tb.y && c.box.x + c.box.w <= tb.x + tb.w && c.box.y + c.box.h <= tb.y + tb.h,
          `${c.key} inside`,
        );
        for (const o of cells) {
          if (o === c) continue;
          const overlap =
            c.box.x < o.box.x + o.box.w &&
            o.box.x < c.box.x + c.box.w &&
            c.box.y < o.box.y + o.box.h &&
            o.box.y < c.box.y + c.box.h;
          assert.ok(!overlap, `${c.key} and ${o.key} do not overlap`);
        }
      }
      assert.equal(area, tb.w * tb.h);
    }
  });

  it("filled from the model, the file name and the free fields", () => {
    const doc = testDoc("A3");
    doc.diagram!.titleBlock = {
      revision: "C",
      date: "2026-10-10",
      author: "Jonas",
      company: "blxt",
      document: "UF-001",
    };
    const index = indexV1(doc);
    const val = (region: string, fileName?: string): Record<string, string> =>
      Object.fromEntries(
        titleBlockCells(index, index.regions.get(region)!.region, fileName === undefined ? {} : { fileName }).map(
          (c) => [c.key, c.value],
        ),
      );
    assert.deepEqual(val("r0", "frame.ufsm"), {
      title: "frame",
      revision: "C",
      description: "Checks the drawing frame.",
      path: "/",
      sheet: "1 / 2",
      file: "frame.ufsm",
      date: "2026-10-10",
      size: "A3",
      author: "Jonas",
      company: "blxt",
      document: "UF-001",
    });
    assert.equal(val("r1").sheet, "2 / 2");
    assert.equal(val("r1").path, "/A · Inner");
    assert.equal(val("r1").file, "", "no file name yet");
    const free = titleBlockCells(index, doc.machine.root)
      .filter((c) => c.free)
      .map((c) => c.free);
    assert.deepEqual(free, ["revision", "date", "author", "company", "document"]);
  });

  it("format: written after the paper in canonical order, read back; unknown fields are rejected", () => {
    const doc = testDoc();
    doc.diagram!.titleBlock = { document: "X-1", revision: "A" };
    const text = serializeV1(doc);
    assert.match(text, /"paper": "A4",\n    "titleBlock": \{ "revision": "A", "document": "X-1" \},\n    "states"/);
    assert.equal(serializeV1(parseV1(text)), text);
    const schema = JSON.parse(readFileSync(join(repoRoot, "packages/core/schema/ufsm-v1.schema.json"), "utf8"));
    const validate = new Ajv({ allErrors: true, strict: false } as ConstructorParameters<typeof Ajv>[0]).compile(
      schema,
    );
    assert.ok(validate(JSON.parse(text)), JSON.stringify(validate.errors));
    assert.ok(
      !validate(JSON.parse(text.replace('"revision": "A"', '"rev": "A"'))),
      "the schema rejects unknown fields too",
    );
    doc.diagram!.titleBlock = { revision: "" };
    assert.doesNotMatch(serializeV1(doc), /titleBlock/, "empty fields and blocks are not written");
    assert.throws(() => parseV1(text.replace('"revision": "A"', '"rev": "A"')), /rev/);
    assert.throws(() => parseV1(text.replace('"revision": "A"', '"revision": 1')), /revision/);
  });
});

describe("fit on the sheet", () => {
  const codes = (doc: UfsmDocument): string[] =>
    checkV1(doc)
      .filter((d) => d.code === "outside-frame" || d.code === "title-block")
      .map((d) => `${d.code} ${d.id}: ${d.message} (${locationText(locate(indexV1(doc), d.id!)!)})`);

  it("a drawing inside the frame and clear of the title block has no findings; neither has a new machine", () => {
    assert.deepEqual(sheetFit(indexV1(testDoc())), []);
    assert.deepEqual(codes(newDocument("x")), []);
  });

  it("outside the frame: only the outermost element is reported, with its sheet", () => {
    const doc = testDoc();
    const area = sheetFrame("A4").area;
    doc.diagram!.states["s2"]!.x = area.w - 100; // A sticks out right; its inline contents and t1/t2 go with it
    assert.deepEqual(codes(doc), ["outside-frame s2: state 'A' lies outside the frame (sheet 1)"]);
    doc.diagram!.states["s5"]!.y = -10; // above the frame of A's off-page sheet
    assert.deepEqual(codes(doc).slice(1), ["outside-frame s5: state 'D' lies outside the frame (sheet 2, A2)"]);
  });

  it("over the title block: vertices and the routes that cross it", () => {
    const doc = testDoc();
    const tb = sheetFrame("A4").titleBlock;
    doc.diagram!.states["s3"] = { x: tb.x + 10, y: tb.y - 50, w: 100, h: 60 };
    assert.deepEqual(codes(doc), ["title-block s3: state 'B' overlaps the title block (sheet 1, D4)"]);
    // B just above the block, A left of it and lower: t2's S route runs inside the block
    doc.diagram!.states["s3"] = { x: tb.x + 300, y: tb.y - 120, w: 100, h: 100 };
    doc.diagram!.states["s2"] = { x: tb.x - 400, y: tb.y - 80, w: 300, h: 200 };
    assert.deepEqual(
      sheetFit(indexV1(doc)).map((p) => [p.id, p.problem]),
      [["t2", "title-block"]],
    );
    doc.diagram!.states["s2"]!.x = tb.x - 200;
    assert.deepEqual(
      sheetFit(indexV1(doc)).map((p) => [p.id, p.problem]),
      [["s2", "title-block"]],
      "A overlaps; t2 starts at A, so it is not listed again",
    );
    doc.diagram!.states["s2"] = { x: tb.x - 400, y: tb.y - 200, w: 300, h: 160 };
    doc.diagram!.transitions["t2"] = {
      from: { side: "bottom", offset: 150 },
      to: { side: "bottom", offset: 50 },
      via: [
        [tb.x - 250, tb.y + 60],
        [tb.x + 350, tb.y + 60],
      ],
    };
    assert.deepEqual(
      sheetFit(indexV1(doc)).map((p) => [p.id, p.problem]),
      [["t2", "title-block"]],
    );
    doc.diagram!.transitions["t2"] = {
      from: { side: "bottom", offset: 150 },
      to: { side: "bottom", offset: 50 },
      via: [
        [tb.x - 250, tb.h + tb.y + 60],
        [tb.x + 350, tb.y + tb.h + 60],
      ],
    };
    assert.deepEqual(
      sheetFit(indexV1(doc)).map((p) => [p.id, p.problem]),
      [["t2", "outside"]],
    );
  });

  it("every repository model fits its sheets", () => {
    const rels = [
      ...["examples", "tests/models"].flatMap((d) =>
        readdirSync(join(repoRoot, d))
          .filter((f) => f.endsWith(".ufsm"))
          .map((f) => `${d}/${f}`),
      ),
      "apps/editor/src/fsm/editor.ufsm",
      "apps/editor/test/browser/edit.ufsm",
    ];
    assert.ok(rels.length >= 40, `${rels.length} models`);
    // The label of t6 runs past the right edge of the frame in the converted v0 file, which must stay as converted.
    const known: Record<string, string[]> = {
      "tests/models/test_external_transitions.ufsm": [
        "outside-frame t6: transition P -> P lies outside the frame (sheet 1, A6)",
      ],
    };
    for (const rel of rels) assert.deepEqual(codes(load(rel)), known[rel] ?? [], rel);
  });

  it("the v0 converter takes the smallest paper (no smaller than v0's) on which the drawing fits", () => {
    const path = join(repoRoot, "old/tests/test_fork_join.ufsm");
    if (!existsSync(path)) return; // old/ is optional
    const v0doc = v0.parseV0(readFileSync(path, "utf8"));
    assert.equal(v0doc["paper-size"] ?? 1, 1, "drawn on A4 in v0");
    const { doc, notes } = migrateV0(v0doc);
    assert.equal(doc.diagram!.paper, "A3");
    assert.deepEqual(sheetFit(indexV1(doc)), []);
    assert.deepEqual(
      notes.filter((n) => n.code === "paper").map((n) => n.message),
      ["paper A4 is now A3, so the drawing fits inside the frame and clear of the title block"],
    );
    const small = migrateV0(v0.parseV0(readFileSync(join(repoRoot, "old/tests/test_guard1.ufsm"), "utf8")));
    assert.equal(small.doc.diagram!.paper, "A4", "a drawing that fits keeps its paper");
    assert.ok(!small.notes.some((n) => n.code === "paper"));
    const big = v0.parseV0(readFileSync(join(repoRoot, "old/tests/test_guard1.ufsm"), "utf8"));
    big["paper-size"] = 3;
    assert.equal(migrateV0(big).doc.diagram!.paper, "A2", "never a smaller paper than v0's");
  });

  it("only the outermost element is listed, on every repository model squeezed onto A4", () => {
    for (const rel of [
      "tests/models/canvas.ufsm",
      "tests/models/test_nested_states.ufsm",
      "tests/models/test_nested_states2.ufsm",
      "apps/editor/src/fsm/editor.ufsm",
    ]) {
      const doc = load(rel);
      doc.diagram!.paper = "A4";
      const index = indexV1(doc);
      const fit = sheetFit(index);
      assert.ok(fit.length > 0, rel);
      const listed = new Set(fit.map((p) => p.id));
      // owners up to the sheet the vertex is drawn on (an off-page region starts a sheet of its own)
      const owners = (id: string): string[] => {
        const out: string[] = [];
        for (let r = index.vertices.get(id)!.region; !isSheet(index, r);) {
          const o = index.regions.get(r.id)!.owner!;
          out.push(o.id);
          r = index.vertices.get(o.id)!.region;
        }
        return out;
      };
      for (const p of fit) {
        const t = index.transitions.get(p.id);
        const covering = t ? [t.from, t.to, ...owners(t.from), ...owners(t.to)] : owners(p.id);
        assert.ok(!covering.some((a) => listed.has(a)), `${rel}: ${p.id} is inside or attached to a listed element`);
      }
    }
  });
});

describe("transition labels", () => {
  it("are laid out in core: items wrap at the label width, 20 units per line", () => {
    const doc = load("tests/models/test_external_transitions.ufsm");
    const index = indexV1(doc);
    const t = index.transitions.get("t6")!;
    assert.deepEqual(transitionLabelItems(index, t), ["selfP", " / aP()"]);
    const at = { x: 100, y: 200, w: 120 };
    const one = layoutTransitionLabel(index, t, at, (text) => text.length * 7);
    assert.deepEqual(
      one.items.map((i) => [i.x, i.y]),
      [
        [100, 200 + LABEL_FIRST_LINE],
        [145, 200 + LABEL_FIRST_LINE],
      ],
    );
    assert.deepEqual(one.box, { x: 100, y: 200 + LABEL_TOP, w: 94, h: 20 });
    const narrow = layoutTransitionLabel(index, t, { ...at, w: 60 }, (text) => text.length * 7);
    assert.deepEqual(
      narrow.items.map((i) => [i.x, i.y]),
      [
        [100, 240],
        [100, 260],
      ],
      "the second item wraps",
    );
    assert.equal(narrow.box.h, 40);
  });

  it("count in the sheet fit: a label past the frame is reported for its transition", () => {
    const doc = load("tests/models/test_external_transitions.ufsm");
    assert.deepEqual(
      sheetFit(indexV1(doc)).map((p) => `${p.id} ${p.problem}`),
      ["t6 outside"],
    );
  });
});
