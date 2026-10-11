// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel } from "@ufsm/core";
import { keymapMarkdown } from "../src/fsm/keymap";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fsm");

describe("editor key map", () => {
  const text = keymapMarkdown(loadModel(readFileSync(join(dir, "editor.ufsm"), "utf8")).doc);

  it("matches the committed KEYMAP.md (regenerate with `npm run gen:editor-fsm`)", () => {
    assert.equal(readFileSync(join(dir, "KEYMAP.md"), "utf8").replace(/\r\n/g, "\n"), text);
  });

  it("lists every key action of the model, so a key can be followed to its command", () => {
    for (const action of ["save", "deleteSelection", "goUp", "simStart", "dragBegin"]) assert.ok(text.includes("`" + action + "()`"), action);
    assert.match(text, /^## Keys$/m);
    assert.ok(text.includes("| Zoom | f |  | `fit()` | Tools |"));
  });
});
