// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UfsmFormatError,
  checkV0References,
  indexV0,
  parseV0,
  regionsTopDown,
  summarizeV0,
  transitionLabel,
} from "../src/v0/index";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const oldDir = join(repoRoot, "old");

/** old/compose/tests holds pre-0.4 drafts that are not valid JSON; skip them. */
const EXCLUDED = [join("compose", "tests") + sep];

function findModels(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ufsm"))
    .filter((f) => !EXCLUDED.some((ex) => f.startsWith(ex)))
    .map((f) => join(dir, f))
    .sort();
}

function load(path: string) {
  return indexV0(parseV0(readFileSync(path, "utf8")));
}

describe("v0 loader", () => {
  const models = findModels(oldDir);

  it("finds the legacy models in old/", { skip: models.length === 0 && "old/ not present" }, () => {
    assert.ok(models.length >= 20, `expected at least 20 models, found ${models.length}`);
  });

  for (const path of models) {
    it(`loads ${relative(repoRoot, path)} with consistent references`, () => {
      const index = load(path);
      assert.deepEqual(checkV0References(index), []);
    });
  }

  it("reads the editor's own canvas model", { skip: !existsSync(join(oldDir, "compose/src/canvas.ufsm")) }, () => {
    const s = summarizeV0(load(join(oldDir, "compose/src/canvas.ufsm")));
    assert.equal(s.name, "canvas");
    assert.equal(s.states, 166);
    assert.equal(s.transitions, 200);
    assert.equal(s.triggers, 36);
  });

  it("orders regions top-down as the old editor displays them", { skip: models.length === 0 && "old/ not present" }, () => {
    // Invariant over every legacy model: in regionsTopDown() order, the
    // topmost normal state of each region never lies above the previous one's.
    let checked = 0;
    for (const path of models) {
      const index = load(path);
      for (const { state } of index.states.values()) {
        // Off-page regions live on their own sheets, so only inline ones are comparable.
        const tops = regionsTopDown(state)
          .filter((r) => !r.off_page)
          .map((r) => Math.min(...r.states.filter((s) => s.kind === "state").map((s) => s.y)))
          .filter(Number.isFinite);
        for (let i = 1; i < tops.length; i++) {
          assert.ok(tops[i - 1]! <= tops[i]!, `${relative(repoRoot, path)}: regions of '${state.name}' out of order`);
        }
        if (tops.length > 1) checked++;
      }
    }
    assert.ok(checked > 0, "expected some states with several regions");
  });

  it("puts Ar1 above Ar2 in test_nested_composits", { skip: !existsSync(join(oldDir, "tests/test_nested_composits.ufsm")) }, () => {
    const index = load(join(oldDir, "tests/test_nested_composits.ufsm"));
    const a = [...index.states.values()].find((x) => x.state.name === "A")!.state;
    assert.deepEqual(regionsTopDown(a).map((r) => r.name), ["Ar1", "Ar2"]);
  });

  it("formats transition labels like the old editor", { skip: !existsSync(join(oldDir, "examples/dimmer/dimmer.ufsm")) }, () => {
    const index = load(join(oldDir, "examples/dimmer/dimmer.ufsm"));
    const labels = index.transitions.map((t) => transitionLabel(index, t));
    assert.ok(labels.includes("eButton"));
    assert.ok(labels.includes("eOffButton"));
  });
});

describe("v0 format errors", () => {
  it("rejects non-JSON", () => {
    assert.throws(() => parseV0("{ nope"), UfsmFormatError);
  });

  it("rejects other file kinds", () => {
    assert.throws(() => parseV0(JSON.stringify({ kind: "Something", version: 0 })), /kind/);
  });

  it("reports the JSON path of a bad field", () => {
    const bad = {
      kind: "uFSM Model",
      version: 0,
      name: "m",
      triggers: [],
      actions: [],
      guards: [],
      region: {
        id: "r",
        name: "Root",
        off_page: false,
        height: 0,
        states: [{ id: "s", kind: "state", name: 42 }],
      },
    };
    assert.throws(
      () => parseV0(JSON.stringify(bad)),
      (e: unknown) => e instanceof UfsmFormatError && e.path === "region.states[0].name",
    );
  });
});
