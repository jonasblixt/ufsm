# uFSM — project context

uFSM is a tool for drawing hierarchical state machines (UML statecharts) and
generating code from them. Owner: Jonas Blixt (jonas@blxt.se). Repository:
github.com/jonasblixt/ufsm.

The project is being rewritten from C/GTK + Python to TypeScript + Tauri on
the `ts-rewrite` branch.

**The documentation for people is the source; this file only adds what is specific to working here.** Read before
changing code:

- `docs/architecture.md`: the parts, the layers of `@ufsm/core` and their import rules (checked by
  `packages/core/test/boundaries.test.ts`), the entry points, the pipeline model -> check -> structure -> flat tables ->
  IR -> printers, the seven engines and who checks whom, the conventions (validity gate, queries take a `DocIndex`,
  caching contract, backends make no semantic decisions, stored vs derived), the editor's data flow.
- `docs/glossary.md`: the words (slot, offer, domain, jog, sheet, hidden marker, the four meanings of "trace", ...).
- `docs/contributing.md`: the rules for every change and recipes (add a design rule, an editor command, a generator
  option, a backend).
- `docs/format-v1.md` and `docs/semantics.md` are normative; `docs/backend-*.md` describe each generator.

Read these only when needed:

- `.claude/rework-decisions.md`: every design decision with its reason (a summary of the ones that shape the code is at
  its top). Read the rows for an area before revisiting a choice there.
- `.claude/rework-log.md`: analysis of the old code and the dated progress log. Search it for the history of a feature.
- `.claude/rules/editor.md` and `.claude/rules/backends.md`: the editor's file map, `window.ufsm` and the browser check;
  the requirements on generated code and their tests. They load automatically when files under `apps/editor/` or the
  backends/IR/tests are read; read them yourself before running editor or backend checks without having opened such a
  file.

The plan (old-generator bugs, strategy, task list, known issues) is imported below.

@./rework-tauri-ts.md

## Goals and constraints

- Desktop only: Windows, macOS, Linux. No phones or tablets.
- Code generation for several languages: C, C++, C#, Python,
  TypeScript/JavaScript, Rust and Go.
- Generated C must stay small and static (embedded targets, no malloc).
- Jonas works on Windows (`C:\Users\jonas\work\ufsm`); CI covers all three OSes.

## Repository layout

```
packages/core/          @ufsm/core: everything that is not UI (folders and rules: docs/architecture.md)
  schema/               ufsm-v1.schema.json (generated: `npm run gen:schema`; a test checks it)
  test/                 node:test suites (tsx); harness.ts (scripts, differential runs), random-model.ts,
                        backend-contract.ts (what every backend's tests share), {c,cpp,csharp,py,ts,rust,go}-harness.ts,
                        gate.test.ts (the validity gate), boundaries.test.ts (import rules)
packages/cli/           @ufsm/cli: `ufsm` command (info, check, list, migrate, fmt, run, trace, flatten, ir, generate, schema)
apps/editor/            @ufsm/editor: Vite + TypeScript frontend after VS Code (file map in .claude/rules/editor.md)
apps/editor/src-tauri/  Rust shell: window, dialog and fs plugins (fs reaches only dialog-picked paths), settings.json, icons
docs/                   architecture, glossary, contributing; format-v1, semantics (normative); backend-{c,cpp,csharp,python,ts,rust,go}
examples/, tests/models/  models in v1 format (tests/models has canvas.ufsm, the old editor's own logic)
tests/traces/           conformance traces (JSON): steps + expected action calls, by name
old/                    v0.5.x C/GTK editor, Python generator, C tests (reference only)
```

## Commands (run from the repo root)

| Command | Purpose |
|---------|---------|
| `npm install` | Install all workspaces |
| `npm run dev` | Tauri window + Vite dev server (first run compiles Rust) |
| `npm run dev:web` | Frontend only in a browser at http://localhost:1420 |
| `npm run build` | Release build and installers |
| `npm test` | All unit tests (core and editor) |
| `npm run typecheck` | `tsc` in every workspace |
| `npm run format` / `format:check` | Prettier (printWidth 120) on the hand-written TS/JS; CI checks it |
| `npm run ufsm -- <cmd> <file>` | CLI; paths are relative to where you run npm |
| `npm run ufsm -- run <model> e1 e2 -g guard` | Simulate a model on the interpreter, printing every step (`-g name[=true\|false]`; guards start false; `--signal-queue`/`--max-microsteps` override the model's options) |
| `npm run ufsm -- trace tests/traces/*.json` | Replay conformance traces on the interpreter |
| `npm run ufsm -- flatten <model> [--json]` | Show the flat tables (regions/slots, transitions, offers) |
| `npm run ufsm -- ir <model> [--json]` | Show the IR as pseudo-code (what backends emit) |
| `npm run ufsm -- generate <c\|cpp\|csharp\|python\|ts\|rust\|go> <model> -o <dir>` | Generate code (`--prefix` for C, `--class-name` for the others, `--signal-queue`, `--max-microsteps`, `--debug-info`, `--trace`) |
| `npm run gen:editor-fsm` | Regenerate the editor model's `editor-fsm.ts` and `KEYMAP.md` after editing `editor.ufsm` |
| `npm run gen:schema` | Regenerate `packages/core/schema/ufsm-v1.schema.json` from `src/format/schema.ts` |

Toolchain: Node 24 LTS (>= 22.18), Rust stable (MSVC on Windows, needs VS
Build Tools "Desktop development with C++"), TypeScript 6, Vite 7, Tauri 2.

## Conventions an agent must not miss

The full list is in docs/architecture.md and docs/contributing.md; these are the ones that are easy to get wrong.

- Licence: GPL-3.0-or-later (`LICENSE`) with an output exception for generated code (`LICENSE-EXCEPTION`). Every source
  file starts with `SPDX-License-Identifier: GPL-3.0-or-later` and `Copyright (C) <year> Jonas Blixt <jonas@blxt.se>`;
  generated code says it may be used under any terms (`OUTPUT_NOTICE` in backends/common.ts) and never carries a GPL
  header (`test/license.test.ts`). old/ stays BSD-3.
- TypeScript: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`, extensionless
  relative imports, double quotes; Prettier formats. Tests: `node:test` + `node:assert/strict` through `tsx --test`, no
  Vitest/Jest; tests that need `old/` skip themselves when it is absent.
- Semantics: trace expectations are derived from `docs/semantics.md` by hand, never copied from the interpreter's
  output; a new rule gets a small model with one concept and a trace that would fail if the rule were broken.
- Generated code: the per-language requirements (flags, type checkers, tool env vars, `UFSM_*_RANDOM`) are in
  `.claude/rules/backends.md`. On Jonas's machine C needs `CC="C:/Program Files/LLVM/bin/clang.exe"`.
- Model files: always written by `serializeV1` (`npm run ufsm -- fmt <file>`), never by hand. The committed files in
  `examples/` and `tests/models/` must equal the converter output for the matching `old/` file (a test enforces this;
  files fixed by hand are listed in its `fixedByHand`), so extend their traces rather than the models. New test models
  have no `old/` counterpart. Never write the v0 format; do not modify `old/`.

## v1 file format at a glance (spec: docs/format-v1.md)

- Sections: `declarations` (events, signals, actions, guards), `machine` (root region, transitions), `diagram` (layout
  keyed by id), `options` (behaviour and API options shared by every generator, the interpreter and the simulator;
  `format/options.ts`), `targets` (per-generator settings).
- References are by id; ids are unique per document (`ev1`, `sig1`, `act1`, `grd1`, `r0`, `s1`, `t1`). A state's
  `regions` are top-down (v0 stores them bottom-up: `v0.regionsTopDown()`).
- Coordinates are relative (to the owning state, or the sheet origin for the root and off-page regions; `via`/`label`
  to the innermost region containing both ends): use `diagram/geometry.ts` for absolute positions, never re-derive.
- Transitions: free routes store a polyline, S routes (`"route": "s"`) only what was pinned; new transitions use S. An
  initial state is never a target in the editor. Triggers: `on` | `auto: true` | `completion: true`.
- A state's `internal` list (static reactions, drawn in the action block) and `timers` list (`after|every`, `unit`,
  `event`; the application runs the clock). The action block is derived from the state's width
  (`diagram/action-block.ts`); `actionsHeight` makes it smaller and a marker counts the hidden lines.
- Guards: ANDed terms (`{call}`, `{call, not}`, `{in}`, `{in, not}`), guard functions take no arguments and return a
  boolean. Actions: `{call}` | `{emit}`.

## Working agreements

- After finishing a task from the rework plan: tick it in section 7 of
  `.claude/rework-tauri-ts.md`, append a dated line to the progress log in
  `.claude/rework-log.md`, add new decisions to `.claude/rework-decisions.md`,
  and record newly found bugs or caveats in `.claude/rework-tauri-ts.md`
  (sections 2 and 8).
- Ask before committing or pushing; Jonas commits himself unless he asks.
- Commit messages: short but clear. A subject line under ~60 characters saying what changed, with an area prefix as in
  the history (`editor: …`, `core: …`, `ci: …`, `gen/c: …`). Add a body only when the reason isn't obvious, and keep it
  to a few lines. Leave out file lists, test counts and the progress-log detail; those belong in `.claude/rework-log.md`.
- Keep CI green on all three OSes; add tests with every behaviour change.
