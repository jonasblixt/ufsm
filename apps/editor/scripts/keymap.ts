// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** Write apps/editor/src/fsm/KEYMAP.md from editor.ufsm (run by `npm run gen:editor-fsm`). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel } from "@ufsm/core";
import { keymapMarkdown } from "../src/fsm/keymap";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fsm");
writeFileSync(join(dir, "KEYMAP.md"), keymapMarkdown(loadModel(readFileSync(join(dir, "editor.ufsm"), "utf8")).doc));
