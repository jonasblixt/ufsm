// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  UfsmFormatError,
  checkV1,
  edgeGeometry,
  indexV1,
  loadModel,
  migrateV0,
  newDocument,
  generateFiles,
  CODE_TARGETS,
  addVertex,
  parseV1,
  serializeV1,
  v0,
  vertexBox,
  actionBlockHeight,
  type UfsmDocument,
} from "../src/index";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const schema = JSON.parse(readFileSync(join(repoRoot, "packages/core/schema/ufsm-v1.schema.json"), "utf8"));
const load = (f: string): UfsmDocument => loadModel(readFileSync(join(repoRoot, f), "utf8")).doc;

function ufsmFiles(dir: string, exclude: string[] = []): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ufsm") && !exclude.some((ex) => f.startsWith(ex)))
    .map((f) => join(dir, f))
    .sort();
}

/** v1 models committed to the repo. */
const v1Files = [...ufsmFiles(join(repoRoot, "examples")), ...ufsmFiles(join(repoRoot, "tests/models")), ...ufsmFiles(join(repoRoot, "apps/editor/src/fsm"))];
/** Legacy v0 models (old/compose/tests holds pre-0.4 drafts that are not JSON). */
const v0Files = ufsmFiles(join(repoRoot, "old"), [join("compose", "tests") + sep]);

const rel = (p: string): string => relative(repoRoot, p);

function minimalDoc(): UfsmDocument {
  return {
    format: "ufsm",
    version: 1,
    name: "m",
    declarations: { events: [{ id: "ev1", name: "e1" }], signals: [], actions: [{ id: "act1", name: "a1" }], guards: [] },
    machine: {
      root: {
        id: "r0",
        states: [
          { id: "s1", kind: "initial" },
          { id: "s2", kind: "state", name: "A", entry: [{ call: "act1" }] },
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

describe("v1 files in the repository", () => {
  it("exist", () => assert.ok(v1Files.length >= 20, `found ${v1Files.length}`));

  // strict: false keeps ajv 8 from logging style hints about the schema; typed loosely so older ajv typings accept it.
  const ajv = new Ajv({ allErrors: true, strict: false } as ConstructorParameters<typeof Ajv>[0]);
  const validate = ajv.compile(schema);

  for (const path of v1Files) {
    it(`${rel(path)} is canonical, schema-valid and passes the design rule check`, () => {
      const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
      const loaded = loadModel(text);
      assert.equal(loaded.sourceVersion, 1);
      assert.equal(serializeV1(loaded.doc), text, "file is not in canonical form; run `npm run ufsm -- fmt <file>`");
      assert.ok(validate(JSON.parse(text)), JSON.stringify(validate.errors, null, 2));
      assert.deepEqual(checkV1(loaded.doc).filter((d) => d.severity === "error"), []);
    });
  }
});

describe("a new document", () => {
  const ajv = new Ajv({ allErrors: true, strict: false } as ConstructorParameters<typeof Ajv>[0]);
  const validate = ajv.compile(schema);

  it("is canonical, schema-valid, clean and generates code for every target", () => {
    const doc = newDocument("blinker");
    assert.equal(doc.name, "blinker");
    const text = serializeV1(doc);
    assert.ok(validate(JSON.parse(text)), JSON.stringify(validate.errors, null, 2));
    const loaded = loadModel(text);
    assert.equal(loaded.sourceVersion, 1);
    assert.deepEqual(loaded.doc, doc);
    assert.equal(serializeV1(loaded.doc), text);
    assert.deepEqual(checkV1(doc), []);
    for (const target of CODE_TARGETS) assert.ok(generateFiles(doc, target).files.length > 0, target);
  });

  it("is a fresh object each time, with the root region's id the allocator expects", () => {
    const a = newDocument("a");
    const b = newDocument("a");
    assert.notEqual(a.machine.root, b.machine.root);
    assert.equal(a.machine.root.id, "r0");
    const s = addVertex(a, "r0", "state", { x: 200, y: 200, w: 160, h: 80 });
    assert.equal(s, "s1");
    assert.equal(b.machine.root.states.length, 0);
    assert.deepEqual(checkV1(a).map((d) => d.code), ["no-initial"]);
  });
});

describe("v0 -> v1 migration", { skip: v0Files.length === 0 && "old/ not present" }, () => {
  for (const path of v0Files) {
    it(`${rel(path)} converts without losing structure or geometry`, () => {
      const text = readFileSync(path, "utf8");
      const old = v0.indexV0(v0.parseV0(text));
      const { doc } = migrateV0(old.model);
      const index = indexV1(doc);

      // Same number of states, regions and transitions.
      assert.equal(index.vertices.size, old.states.size);
      assert.equal(index.regions.size, old.regions.size);
      assert.equal(index.transitions.size, old.transitions.length);

      // Every state lands on exactly the same absolute position as before.
      const v0ToV1 = new Map<string, string>();
      const order: string[] = [];
      const walk = (r: v0.V0Region): void => {
        for (const s of r.states) {
          order.push(s.id);
          v0.regionsTopDown(s).forEach(walk);
        }
      };
      walk(old.model.region);
      order.forEach((id, i) => v0ToV1.set(id, `s${i + 1}`));
      for (const [id, { state }] of old.states) {
        const b = vertexBox(index, v0ToV1.get(id)!);
        assert.deepEqual([b.x, b.y, b.w, b.h], [state.x, state.y, state.width, state.height], `state '${state.name}'`);
      }

      // Transition bend points and labels too.
      const v0Transitions: v0.V0Transition[] = [];
      const walkT = (r: v0.V0Region): void => {
        for (const s of r.states) {
          v0Transitions.push(...s.transitions);
          v0.regionsTopDown(s).forEach(walkT);
        }
      };
      walkT(old.model.region);
      v0Transitions.forEach((t, i) => {
        const g = edgeGeometry(index, `t${i + 1}`)!;
        const via = g.points.slice(1, -1).map((p) => [p.x, p.y]);
        assert.deepEqual(via, t.vertices.map((p) => [p.x, p.y]), `t${i + 1} bend points`);
        assert.deepEqual([g.label!.x, g.label!.y, g.label!.w], [t["text-block"].x, t["text-block"].y, t["text-block"].w]);
      });

      assert.deepEqual(checkV1(doc).filter((d) => d.severity === "error"), []);
    });
  }

  it("keeps the committed v1 conversions in sync with the converter", () => {
    // Fixed by hand after conversion: the draft's 'completion-event' trigger (no trigger-kind, B9) is now
    // `completion: true`, which is what it meant; the converter still turns it into an ordinary event.
    // dimmer.ufsm was edited in the editor: t8 now returns to s4 on an S route.
    const fixedByHand = new Set(["test_final_state_completion.ufsm", "dimmer.ufsm"]);
    const committed = new Map(v1Files.map((p) => [basename(p), p]));
    let compared = 0;
    for (const path of v0Files) {
      const target = committed.get(basename(path));
      if (!target || fixedByHand.has(basename(path))) continue;
      const { doc } = migrateV0(v0.parseV0(readFileSync(path, "utf8")));
      assert.equal(serializeV1(doc), readFileSync(target, "utf8").replace(/\r\n/g, "\n"), rel(target));
      compared++;
    }
    assert.ok(compared >= 19, `compared ${compared}`);
  });

  it("turns v0 compare terms into calls of new boolean guards", () => {
    const path = v0Files.find((p) => p.endsWith(join("compose", "src", "canvas.ufsm")));
    if (!path) return;
    const v0doc = v0.parseV0(readFileSync(path, "utf8"));
    const count = v0doc.guards.find((g) => g.name === "canvas_selection_count")!;
    const refs = (r: typeof v0doc.region): v0.V0GuardRef[] =>
      r.states.flatMap((s) => [...s.transitions.flatMap((t) => t.guards), ...s.region.flatMap(refs)]);
    const compares = refs(v0doc.region).filter((g) => g["action-id"] === count.id);
    assert.ok(compares.length >= 3);
    const { doc, notes } = migrateV0(v0doc);
    const names = doc.declarations.guards.map((g) => g.name);
    assert.ok(!names.includes("canvas_selection_count"), "a guard that was only compared goes");
    for (const n of ["canvas_selection_count_le_1", "canvas_selection_count_gt_1", "canvas_selection_count_ge_1"]) assert.ok(names.includes(n), n);
    assert.equal(notes.filter((n) => n.code === "derived").length, 3);
    assert.ok(notes.some((n) => n.code === "removed" && n.message.includes("'canvas_selection_count'")));
    assert.deepEqual(checkV1(doc).filter((d) => d.severity === "error"), []);
    // Negative and fractional values, a name already taken, and a guard that is also called plainly.
    compares[0]!.kind = v0.V0GuardKind.Gt;
    compares[0]!.value = -1;
    compares[1]!.value = 2.5;
    compares[2]!.kind = v0.V0GuardKind.True;
    v0doc.guards.push({ id: "taken", name: "canvas_selection_count_gt_m1" });
    const again = migrateV0(v0doc);
    const names2 = again.doc.declarations.guards.map((g) => g.name);
    assert.ok(names2.includes("canvas_selection_count"), "still called plainly, so kept");
    assert.ok(names2.includes("canvas_selection_count_gt_m1_2"), names2.join(" "));
    assert.ok(names2.some((n) => /^canvas_selection_count_[a-z]{2}_2p5$/.test(n)), names2.join(" "));
    assert.equal(new Set(names2).size, names2.length);
    assert.deepEqual(checkV1(again.doc).filter((d) => d.severity === "error"), []);
  });

  it("reports what it had to change", () => {
    const path = v0Files.find((p) => p.endsWith("test_final_state_completion.ufsm"));
    if (!path) return;
    const { doc, notes } = migrateV0(v0.parseV0(readFileSync(path, "utf8")));
    assert.ok(notes.some((n) => n.code === "renamed" && n.message.includes("completion_event")));
    assert.ok(doc.declarations.events.some((e) => e.name === "completion_event"));
  });

  it("stores regions top-down", () => {
    const path = v0Files.find((p) => p.endsWith("test_nested_composits.ufsm"));
    if (!path) return;
    const { doc } = migrateV0(v0.parseV0(readFileSync(path, "utf8")));
    const a = doc.machine.root.states.find((s) => s.name === "A");
    assert.ok(a && a.kind === "state");
    assert.deepEqual(a.regions?.map((r) => r.name), ["Ar1", "Ar2"]);
  });
});

describe("v1 reader", () => {
  it("round-trips a minimal document", () => {
    const text = serializeV1(minimalDoc());
    assert.deepEqual(parseV1(text), minimalDoc());
    assert.equal(serializeV1(parseV1(text)), text);
  });

  it("rejects unknown fields with their path", () => {
    const doc = JSON.parse(serializeV1(minimalDoc()));
    doc.machine.transitions[1].trigger = "ev1";
    assert.throws(
      () => parseV1(JSON.stringify(doc)),
      (e: unknown) => e instanceof UfsmFormatError && e.path === "machine.transitions[1].trigger",
    );
  });

  it("rejects two triggers on one transition", () => {
    const doc = JSON.parse(serializeV1(minimalDoc()));
    doc.machine.transitions[1].auto = true;
    assert.throws(() => parseV1(JSON.stringify(doc)), /at most one/);
  });

  it("rejects false flags (omit them instead)", () => {
    const doc = JSON.parse(serializeV1(minimalDoc()));
    doc.machine.transitions[1].auto = false;
    delete doc.machine.transitions[1].on;
    assert.throws(() => parseV1(JSON.stringify(doc)), /expected true/);
  });

  it("rejects other versions", () => {
    assert.throws(() => parseV1(JSON.stringify({ format: "ufsm", version: 2 })), /version/);
  });

  it("refuses files that are not models", () => {
    assert.throws(() => loadModel("{}"), /not a uFSM model/);
  });
});

describe("internal transitions in the format", () => {
  const withInternal = (): UfsmDocument => {
    const doc = minimalDoc();
    const a = doc.machine.root.states[1]!;
    if (a.kind === "state") a.internal = [{ id: "t9", on: "ev1", guard: [{ call: "act1", not: true }], do: [{ call: "act1" }], doc: "stays in A" }];
    return doc;
  };
  it("round-trip through the canonical writer, after entry/exit and before regions", () => {
    const text = serializeV1(withInternal());
    assert.ok(text.indexOf('"entry"') < text.indexOf('"internal"'));
    assert.match(text, /"id": "t9",\s+"on": "ev1",\s+"guard": \[\{ "call": "act1", "not": true \}\],\s+"do": \[\{ "call": "act1" \}\],\s+"doc": "stays in A"/);
    assert.deepEqual(parseV1(text), withInternal());
    assert.equal(serializeV1(parseV1(text)), text);
  });
  it("are read strictly", () => {
    const json = (): { machine: { root: { states: { internal?: Record<string, unknown>[] }[] } } } => JSON.parse(serializeV1(withInternal()));
    const noTrigger = json();
    delete noTrigger.machine.root.states[1]!.internal![0]!["on"];
    assert.throws(() => parseV1(JSON.stringify(noTrigger)), /on/);
    const extra = json();
    extra.machine.root.states[1]!.internal![0]!["to"] = "s3";
    assert.throws(() => parseV1(JSON.stringify(extra)), /to/);
  });
  it("make the action block taller and are indexed", () => {
    const doc = withInternal();
    const index = indexV1(doc);
    assert.equal(index.internals.get("t9")?.state.name, "A");
    const a = doc.machine.root.states[1]!;
    assert.ok(a.kind === "state");
    assert.equal(actionBlockHeight(a), 20 + 20 * 2, "one entry action and one internal transition");
  });
});

describe("v1 writer", () => {
  it("keeps lines within 100 columns where possible", () => {
    for (const path of v1Files) {
      const long = readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.length > 100 && !/^\s*("[^"]*": )?"[^"]*",?$/.test(l)); // a long string cannot wrap
      assert.deepEqual(long, [], rel(path));
    }
  });

  it("writes whole numbers without a decimal point", () => {
    const doc = minimalDoc();
    doc.diagram = { paper: "A4", states: { s2: { x: 10.0, y: 0.1 + 0.2, w: 100, h: 60 } }, regions: {}, transitions: {} };
    const text = serializeV1(doc);
    assert.match(text, /"x": 10,/);
    assert.match(text, /"y": 0.3,/);
  });
});

describe("design rule check", () => {
  const codes = (doc: UfsmDocument): string[] => checkV1(doc).map((d) => d.code);

  it("accepts a minimal valid document", () => {
    assert.deepEqual(checkV1(minimalDoc()).filter((d) => d.severity === "error"), []);
  });

  it("finds dangling and wrongly typed references", () => {
    const doc = minimalDoc();
    doc.machine.transitions[1]!.on = "act1";
    doc.machine.transitions.push({ id: "t3", from: "s3", to: "nope", on: "ev1" });
    const c = codes(doc);
    assert.ok(c.includes("wrong-ref"));
    assert.ok(c.includes("dangling-ref"));
  });

  it("finds duplicate ids and bad names", () => {
    const doc = minimalDoc();
    doc.declarations.signals.push({ id: "s2", name: "not valid" });
    const c = codes(doc);
    assert.ok(c.includes("duplicate-id"));
    assert.ok(c.includes("bad-name"));
  });

  it("checks options: a queue for emitted signals, behaviour options only in options", () => {
    const doc = load("tests/models/test_options.ufsm");
    assert.deepEqual(codes(doc), []);
    doc.options = { signalQueue: 0 };
    assert.deepEqual(codes(doc), ["signal-queue"], "the model emits signals");
    doc.declarations.signals = [];
    doc.machine.transitions = doc.machine.transitions.filter((t) => !t.do);
    assert.ok(!codes(doc).includes("signal-queue"), "a queue of 0 is fine when nothing is emitted");
    const ok = load("tests/models/test_options.ufsm");
    ok.targets = { c: { prefix: "o_", maxMicrosteps: 5 }, go: { signalQueue: 2 } };
    assert.deepEqual(
      checkV1(ok).map((d) => [d.severity, d.code, d.message]),
      [
        ["warning", "target-option", "targets.c.maxMicrosteps is ignored: it changes behaviour, so it is set in options for every target"],
        ["warning", "target-option", "targets.go.signalQueue is ignored: it changes behaviour, so it is set in options for every target"],
      ],
    );
  });

  it("checks internal transitions: ids, references, trigger kind, shadowing", () => {
    const doc = minimalDoc();
    const a = doc.machine.root.states[1]!;
    assert.ok(a.kind === "state");
    a.internal = [{ id: "t9", on: "ev1", do: [{ call: "act1" }] }];
    assert.deepEqual(checkV1(doc).filter((d) => d.severity === "error"), [], "a valid internal transition");
    assert.ok(codes(doc).includes("shadowed"), "after an unguarded outgoing transition with the same trigger");
    a.internal = [{ id: "t2", on: "act1", guard: [{ call: "nope" }] }];
    const c = codes(doc);
    assert.ok(c.includes("duplicate-id"), "ids are shared with transitions");
    assert.ok(c.includes("wrong-ref"), "an action is not a trigger");
    assert.ok(c.includes("dangling-ref"), "unknown guard");
  });

    it("finds initial states without exactly one transition", () => {
    const doc = minimalDoc();
    doc.machine.transitions.shift();
    assert.ok(codes(doc).includes("initial-transitions"));
  });

  it("warns about transitions that can never fire", () => {
    const doc = minimalDoc();
    delete doc.machine.transitions[1]!.on;
    assert.ok(codes(doc).includes("no-trigger"));
  });

  it("warns about transitions shadowed by an earlier unguarded one", () => {
    const doc = minimalDoc();
    doc.machine.transitions.push({ id: "t3", from: "s2", to: "s2", on: "ev1" });
    assert.deepEqual(checkV1(doc).filter((d) => d.code === "shadowed").map((d) => d.id), ["t3"]);
    doc.machine.transitions[1]!.guard = [{ in: "s3" }];
    assert.ok(!codes(doc).includes("shadowed"));
  });

  it("rejects forks into one region", () => {
    const doc = minimalDoc();
    doc.machine.root.states.push({ id: "f1", kind: "fork" });
    doc.machine.transitions.push({ id: "t3", from: "s3", to: "f1", on: "ev1" }, { id: "t4", from: "f1", to: "s2" }, { id: "t5", from: "f1", to: "s3" });
    assert.ok(codes(doc).includes("fork-targets"));
  });

  it("rejects triggers on transitions into a join", () => {
    const doc = minimalDoc();
    doc.machine.root.states.push({ id: "j1", kind: "join" });
    doc.machine.transitions.push({ id: "t3", from: "s3", to: "j1", on: "ev1" }, { id: "t4", from: "j1", to: "s2", on: "ev1" });
    assert.ok(checkV1(doc).some((d) => d.code === "join-trigger" && d.severity === "error"));
  });
});
