# uFSM — project context

uFSM is a tool for drawing hierarchical state machines (UML statecharts, in
the spirit of IAR visualSTATE) and generating code from them. Owner: Jonas
Blixt (jonas@blxt.se). Repository: github.com/jonasblixt/ufsm.

The project is being rewritten from C/GTK + Python to TypeScript + Tauri on
the `ts-rewrite` branch. **Read `.claude/rework-tauri-ts.md` before working
on the rewrite**: it holds the original analysis, bugs found, strategy,
decisions, progress log and task list. Keep it up to date (see "Working
agreements" below).

@./rework-tauri-ts.md

## Goals and constraints

- Desktop only: Windows, macOS, Linux. No phones or tablets.
- Code generation for several languages: C, Python, TypeScript/JavaScript and
  Rust today; later possibly C#, Go.
- Generated C must stay small and static (embedded targets, no malloc).
- Jonas works on Windows (`C:\Users\jonas\work\ufsm`); CI covers all three OSes.

## Repository layout

```
packages/core/          @ufsm/core: model, v0 reader, v1 format, checks, semantics, interpreter, IR, backends
  src/v1/               current file format (model, parse, serialize, doc-index, geometry, route, labels, check, migrate,
                        load) and edit.ts (layout edits the editor's drags make: move, resize, region split, ends, jog,
                        bend points, labels, S/free conversion; diagram-only, snapped, children kept inside, free routes
                        follow); structure edits: ids.ts (id allocation), create.ts (add vertex/region/transition with
                        validity checks, delete with cascade), clipboard.ts (copy/paste fragments); props.ts (property
                        edits: names, actions, triggers, guards, internal transitions, regions, declarations, targets,
                        title block fields); sheet.ts (sheets as drawings: frame and zones, sheet numbers and paths,
                        `locate` -> "sheet 2, B4", title block cells, `sheetFit` for the design rule check)
  src/v0/               legacy reader, exported as the `v0` namespace
  src/semantics/        structure.ts (document order, compound transitions, initializers), flatten.ts (static tables),
                        flat-run.ts (runs the tables like generated code; must match the interpreter)
  src/interp/           reference interpreter (simulator + test oracle; wouldTake for the simulator) and traces
                        (parse, run, formatTrace)
  src/ir/               IR every backend prints (ir.ts documents the runtime loop), lowering, evaluator, printer
  src/backends/         code generators = IR printers: c.ts (C99 header + source), python.ts (one typed module),
                        ts.ts (one typed, erasable-syntax TypeScript module), rust.ts (one no_std Rust module, no heap,
                        rustfmt/clippy-clean); generate.ts (generateFiles: model + targets options -> files, the one entry
                        point for the CLI and the editor's code preview)
  schema/               ufsm-v1.schema.json (JSON Schema draft-07)
  test/                 node:test suites (run with tsx); harness.ts (scripts, differential runs), random-model.ts,
                        c-harness.ts (links many generated C machines into one driver, needs a C compiler),
                        py-harness.ts (runs many generated Python modules in one process, needs Python 3.8+),
                        ts-harness.ts (imports generated TypeScript into the test process),
                        rust-harness.ts (all machines as modules of one crate + one driver binary, needs rustc)
packages/cli/           @ufsm/cli: `ufsm` command (info, check, list, migrate, fmt, run, trace, flatten, ir, generate)
apps/editor/            @ufsm/editor: Vite + TypeScript frontend. Window laid out after VS Code: title bar (titlebar.tsx: menus,
                        search field (quickpick.tsx; search.ts ranks, no DOM, tested), window buttons; frameless window except macOS), explorer (palette.ts above explorer.ts,
                        one section per open machine holding its tree.ts), tab strip (tabs.tsx; every open machine is a Doc in
                        main.ts with its own history, view, page and selection), canvas, right panel (panel.tsx: Properties
                        edits the selection, Project edits declarations and file-level settings, Problems lists the design
                        rule check live, Simulator (simpanel.tsx), Code (codepanel.tsx); widgets.tsx has the shared
                        Section/Field), Settings (settingspanel.tsx: color theme, UI zoom), status bar; sash.ts resizes the side panels;
                        scrollbars.ts shows scrollbars only while scrolling
  src/fsm/              editor.ufsm (the editor's interaction model: regions Keys {Tools, Zoom, Jump, Add, Edit}, Pointer, Tool), editor-fsm.ts (generated and committed:
                        `npm run gen:editor-fsm`), input.ts (DOM events -> machine events); panels: Preact, edits: Immer
  src/history.ts        undo/redo: Immer patches; interactive edits preview from their start, commit one step
  src/handles.ts        grips: selection handles, labels, movable vertices; what a drag at a point would do
  src/preview.ts        tool previews drawn over the page (ghost of a vertex to place, transition being drawn)
  src/sim.ts            the simulator: interpreter on a snapshot of the document, step log, canvas highlight, every step
                        recorded as a conformance trace; out of date once machine or declarations change (no DOM, tested)
  src/code.ts           code preview: generated files cached per machine/declarations/name/targets, syntax highlighter
  src/untitled.ts       File › New names: untitled, untitled2, ...; the first save names the machine after its file (no DOM, tested)
  src/tokens.ts         Design Tokens 2025.10 (DTCG): resolver sets/modifiers/inputs, deep merge, aliases, sRGB/HSL colors (no DOM, tested)
  src/theme.ts          bundled themes, resolveTheme(setting, systemDark) -> CSS custom properties + canvas colors `C` (no DOM)
  src/themes/           ui.tokens.json (the editor's token names: ui.* -> --css vars, syntax.*, canvas.*, as aliases to
                        palette roles) and one folder per theme, `<name>/<name>.resolver.json` + `<name>.tokens.json` (the
                        upstream palette, absolute colors only) + role files: gruvbox/ (appearance dark|light × contrast
                        hard|medium|soft, colors/gruvbox.vim), everforest/ (same modifiers, autoload/everforest.vim),
                        solarized/ (appearance only, the README's table), catppuccin/ (appearance: light = Latte; flavor
                        frappe|macchiato|mocha = the dark flavor, palette.json). Register a new theme in theme.ts
                        (THEME_FILES imports, THEMES)
  src/settings.ts       settings.json: parse (never fails; unknown keys kept), canonical text, UI zoom steps (no DOM, tested);
                        settingspanel.tsx is the Settings tab. UI zoom = CSS `zoom: var(--ui-zoom)` on the parts around
                        the canvas (title bar, explorer, tabs, breadcrumbs, panel, status bar), never on the canvas
  test/                 node:test suites (history, sim + code, theme + settings, search); browser/check.mjs: optional Playwright check of the real editor
apps/editor/src-tauri/  Rust shell: window, dialog plugin, read/write file commands, read/write settings.json (app config dir), icons
docs/format-v1.md       file format specification (normative)
docs/semantics.md       execution semantics (normative; every backend must match)
docs/backend-c.md       C generator: options (`targets.c`), generated API, testing
docs/backend-python.md  Python generator: options (`targets.python`), generated API, testing
docs/backend-ts.md      TypeScript generator: options (`targets.ts`), generated API, testing
docs/backend-rust.md    Rust generator: options (`targets.rust`), generated API, testing
examples/               example models in v1 format
tests/models/           test models in v1 format (incl. canvas.ufsm, the old editor's own logic)
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
| `npm run ufsm -- <cmd> <file>` | CLI; paths are relative to where you run npm |
| `npm run ufsm -- run <model> e1 e2 -g guard` | Simulate a model on the interpreter, printing every step (`-g name[=true\|false]`; guards start false) |
| `npm run ufsm -- trace tests/traces/*.json` | Replay conformance traces on the interpreter |
| `npm run ufsm -- flatten <model> [--json]` | Show the flat tables (regions/slots, transitions, offers) |
| `npm run ufsm -- ir <model> [--json]` | Show the IR as pseudo-code (what backends emit) |
| `npm run ufsm -- generate c <model> -o <dir>` | Generate `<name>.h`/`<name>.c` (`--prefix`, `--signal-queue`, `--max-microsteps`) |
| `npm run ufsm -- generate python <model> -o <dir>` | Generate `<name>.py` (`--class-name`, `--signal-queue`, `--max-microsteps`) |
| `npm run ufsm -- generate ts <model> -o <dir>` | Generate `<name>.ts` (`--class-name`, `--signal-queue`, `--max-microsteps`) |
| `npm run ufsm -- generate rust <model> -o <dir>` | Generate `<name>.rs` (`--class-name` names the struct, `--signal-queue`, `--max-microsteps`) |

Toolchain: Node 24 LTS (>= 22.18), Rust stable (MSVC on Windows, needs VS
Build Tools "Desktop development with C++"), TypeScript 6, Vite 7, Tauri 2.

## Conventions

- Licence: GPL-3.0-or-later (`LICENSE`) with an output exception for generated
  code (`LICENSE-EXCEPTION`). Every source file (.ts, .rs, .css, .html, .yml,
  Cargo.toml) starts with `SPDX-License-Identifier: GPL-3.0-or-later` and
  `Copyright (C) <year> Jonas Blixt <jonas@blxt.se>` in that file type's comment
  syntax; generated code instead says it may be used under any terms
  (`OUTPUT_NOTICE` in backends/c.ts) and must never carry a GPL header.
  `test/license.test.ts` enforces both. old/ stays BSD-3 (`old/LICENSE`).
- **`@ufsm/core` is platform neutral**: no Node or DOM APIs in `src/`. It runs
  unchanged in the editor, the CLI and tests. Node APIs only in `test/` and
  `packages/cli`.
- Workspace packages are consumed as TypeScript source (`exports` points at
  `src/index.ts`); no build step between packages.
- TypeScript: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `moduleResolution: bundler`, extensionless relative imports. 2-space
  indent, LF line endings, double quotes.
- Tests: `node:test` + `node:assert/strict`, run through `tsx --test`. No
  Vitest/Jest. Tests that need `old/` skip themselves when it is absent.
- Semantics: `docs/semantics.md` is the definition; the interpreter
  implements it. A behaviour change updates the doc, the interpreter and a
  trace in `tests/traces/` together. Backends are tested by replaying the
  same traces against generated code, and by differential runs against the
  interpreter on random models (`test/random-model.ts`, `test/harness.ts`).
  Trace expectations are derived from `docs/semantics.md` by hand, never
  copied from the interpreter's output; a new rule gets a small model with
  one concept and a trace that would fail if the rule were broken.
  Pipeline: model -> structure -> flat tables -> IR -> backend printer.
- Backends make no semantic decisions: anything a printer would need to
  decide belongs in the lowering (`ir/lower.ts`), so every language gets it.
  Generated code must be deterministic (no dates) and warning-free; the C
  tests compile with `-std=c99 -Wall -Wextra -Wpedantic -Wconversion
  -Wsign-conversion -Wshadow -Werror` and skip when no C compiler is found
  (`$CC`, else `cc`/`gcc`/`clang`). `UFSM_C_RANDOM=<n>` runs more random models.
  Generated Python is fully typed: it must pass `pyright --strict` for
  Python 3.8 and import only `enum`/`typing`. Its tests skip without Python
  3.8+ (`$PYTHON`, else `python3`/`python`/`py -3`); the type check skips
  without pyright (`$PYRIGHT`, else `pyright` on PATH; `npm install -g
  pyright`). `UFSM_PY_RANDOM=<n>` runs more random models. CI sets
  `UFSM_REQUIRE_CC`, `UFSM_REQUIRE_PYTHON`, `UFSM_REQUIRE_PYRIGHT` and
  `UFSM_REQUIRE_RUST` so missing tools fail instead of skipping. Generated TypeScript imports
  nothing, uses only erasable syntax (it runs under Node's type stripping)
  and must type-check under strict settings plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnused*` and `erasableSyntaxOnly` with
  only the ES2020 lib; its tests import it in-process (`UFSM_TS_RANDOM=<n>`).
  Generated Rust uses only `core` (no heap, no `unsafe`, no inner attributes,
  so `include!` works), builds warning-free with `-D warnings -W missing_docs`
  in a `#![no_std]` crate on editions 2021 and 2024, passes clippy's default
  and pedantic lints and must equal `rustfmt` output (the printer breaks long
  conditions as rustfmt does). Its tests skip without rustc (`$RUSTC`, else
  `rustc`); clippy (`$CLIPPY_DRIVER`) and rustfmt (`$RUSTFMT`) checks skip
  without those; CI sets `UFSM_REQUIRE_RUST` (all three).
  `UFSM_RUST_RANDOM=<n>` runs more random models.
- Editor: canvas in vanilla TS + Canvas 2D, panels and dialogs in Preact.
  Drawing rules mirror `old/compose/src/render.c`. Every edit is a core
  function (`v1/edit.ts`, `v1/create.ts`, `v1/clipboard.ts`, `v1/props.ts`) run on an Immer draft by
  `history.ts`; the document is the only state, everything else (index,
  handles, geometry) is rebuilt from it.
  Avoid APIs newer than Safari 15 (macOS 12 WKWebView), e.g. use the manual
  `roundedRect` helper instead of `ctx.roundRect`.
- Host access goes through `apps/editor/src/platform.ts` only, so the
  frontend also works in a plain browser (`dev:web`).
- Colors: never write a color literal in the editor's CSS or TS. Add a token to `src/themes/ui.tokens.json` (an
  alias to a palette role) and use `var(--name)` (ui.*), `var(--syntax-*)` or `C.<name>`/`canvasAlpha()` (canvas.*);
  `test/theme.test.ts` rejects literals in style.css outside the `:root` fallback (which must equal gruvbox dark
  medium). Theme files follow the DTCG 2025.10 format, color and resolver modules. A bundled theme's palette file holds
  the upstream colors exactly (a test compares them with values copied from upstream); ufsm's own choices (which palette
  color plays which role, extra shades) live in the role files and are checked per variant in theme.test.ts.
- Model files: always written by `serializeV1` (canonical form). Never hand
  format a `.ufsm`; run `npm run ufsm -- fmt <file>`. The committed files in
  `examples/` and `tests/models/` must equal the converter output for the
  matching `old/` file (a test enforces this; files fixed by hand are listed in its `fixedByHand`), so extend their traces rather
  than the models. New test models have no `old/` counterpart.
- Never write the v0 format. The editor and CLI read v0 and write v1.
- Do not modify `old/`; it is reference material for behaviour and tests.

## v1 file format essentials (full spec: docs/format-v1.md)

- Sections: `declarations` (events, signals, actions, guards), `machine`
  (root region, transitions), `diagram` (layout keyed by id), `targets`.
- All references are by id; ids unique per document; generated ids are
  `ev1`, `sig1`, `act1`, `grd1`, `r0`, `s1`, `t1`.
- Coordinates are relative: state x/y to the owning state's top-left (or the
  sheet origin for the root region and off-page regions: the top-left corner of the drawing area inside the frame,
  50 units in from the paper edge; `core/src/v1/sheet.ts`); transition `via`/`label`
  to the innermost region containing both endpoints. Use
  `core/src/v1/geometry.ts` for absolute positions, never re-derive.
- Transition layouts: `route` absent/`"free"` = stored polyline (`from`, `via`, `to`;
  what v0 converts to); `"route": "s"` = derived orthogonal route (`core/src/v1/route.ts`)
  with optional pinned `from`/`to`, `jog` `{x}` or `{y}` (region-relative) and `label`
  relative to the route's label anchor. Nothing derived is stored; derived defaults keep to the 10-unit grid.
  New transitions use S (the straight tool makes free ones). An initial state is never a target in the editor.
- A state's `regions` are top-down. (v0 files store them bottom-up; use
  `v0.regionsTopDown()` when reading v0.)
- Triggers: `on` (event/signal id) | `auto: true` | `completion: true`.
- A state's `internal` list holds internal transitions (visualSTATE: static reactions):
  `{id, on, guard?, do?}`, no target, never leave the state; drawn as text in the
  action block after entry/exit. Prefer them to self-transitions unless exit/re-entry is wanted.
  Guards: list of terms ANDed (`{call}`, `{call, not}`, `{in}`, `{in, not}`);
  guard functions take no arguments and return a boolean (no compare terms;
  v0 compares are converted to derived guards). Actions: `{call}` | `{emit}`.

## Verifying UI changes

The editor exposes `window.ufsm` for automation: `load(text, name)`, `newModel()`,
`worldToScreen(x, y)`, `selectedName()`, `selectedIds()`, `select(ids)`, `serialize()`,
`box(id)`, `route(id)`, `handles()` (with screen positions), `undo()`, `redo()`,
`canUndo()`, `canRedo()`, `isDirty()`, `tabs()`, `activateTab(i)`, `closeTab(i, force)`, `view()`,
`tool()`, `pickTool(id)`, `status()`, `panelTab()`, `openSearch(text)`, `search(text)` (the rows the search lists: label, kind, detail, machine, checked), `theme()` (id, inputs, appearance), `zoom()` (UI zoom %), `settings()` (settings.json text), simulator: `simStart()`, `simStop()`, `simSend(event)`,
`simGuard(name, true|false)`, `sim()` (steps, active, fired, last calls, hovered event and its transitions, trace text),
`simError()` (all act on the active tab; `load` opens a new one). `apps/editor/test/browser/check.mjs` bundles
`apps/editor/src/main.ts` with esbuild (stubbing `@tauri-apps/*`), serves it and drives
it with Playwright (338 checks; the page emulates a dark OS, mostly on `test/browser/edit.ufsm`: select, drag, resize,
separators, transition handles, labels, undo/redo, pan/zoom, then menus, search field,
panel keys, Properties/Project, sash, several machines in tabs, File › New, adding/deleting (tools,
transitions, regions, bend points, Delete, copy/cut/paste) and properties (e/a keys, pickers,
guards, internal transitions, declarations, options, Problems tab), then the simulator (F5, events, guards, canvas
highlight read back as pixels, log, saved traces, out of date, a model with errors), the code preview on repository
models (C, Python, TypeScript, Rust) and the Settings tab (all six gruvbox variants and Everforest/Solarized/Catppuccin dark and light read back as pixels,
Catppuccin's flavor, following the OS, kept across a reload; UI zoom with the canvas unchanged), then the search
(Ctrl+P/Ctrl+Shift+P/F1, other machines, focus order, commands, settings preview, Project settings, prefixes),
the sheet frame and title block (frame, zones, off-page marker, fields, double-click, fit findings with sheet and zone);
with a second argument
it writes screenshots there); it needs esbuild and
playwright (`UFSM_NODE_TOOLS=/opt/npm-tools` in the cloud workspace). Run it after
renderer, hit-test or interaction changes.

## Working agreements

- After finishing a task from the rework plan, update
  `.claude/rework-tauri-ts.md`: tick the task, add a dated line to the
  progress log, record new decisions and newly found bugs.
- Ask before committing or pushing; Jonas commits himself unless he asks.
- Keep CI green on all three OSes; add tests with every behaviour change.
