// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The editor's interaction logic is a uFSM model (dogfooding). Its generated
 * TypeScript is committed; this keeps it equal to what the generator makes of
 * the model. Its behaviour is pinned by tests/traces/editor.json, which every
 * backend replays.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkV1, flatten, generateTypeScript, loadModel, lowerToIr, tsOptionsFromTargets } from "../src/index";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dir = join(repoRoot, "apps/editor/src/fsm");

describe("editor interaction model", { skip: !existsSync(dir) && "apps/editor not present" }, () => {
  const { doc } = loadModel(readFileSync(join(dir, "editor.ufsm"), "utf8"));

  it("passes the design rule check without warnings", () => {
    assert.deepEqual(checkV1(doc).map((d) => `${d.severity}: ${d.message}`), []);
  });

  it("matches the committed generated code (regenerate with `npm run gen:editor-fsm`)", () => {
    const { options, problems } = tsOptionsFromTargets(doc);
    assert.deepEqual(problems, []);
    const out = generateTypeScript(lowerToIr(flatten(doc)), options);
    assert.equal(out.fileName, "editor-fsm.ts");
    assert.equal(readFileSync(join(dir, out.fileName), "utf8").replace(/\r\n/g, "\n"), out.source);
  });

  it("has a conformance trace", () => {
    assert.ok(existsSync(join(repoRoot, "tests/traces/editor.json")));
  });
});
