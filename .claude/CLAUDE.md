# uFSM — project context

uFSM is a tool for drawing hierarchical state machines (UML statecharts, in
the spirit of IAR visualSTATE) and generating code from them. Owner: Jonas
Blixt (jonas@blxt.se). Repository: github.com/jonasblixt/ufsm.

The project is being rewritten from C/GTK + Python to TypeScript + Tauri on
the `ts-rewrite` branch. The plan (old-generator bugs, strategy, task list,
known issues) is imported below. Read these only when needed:

- `.claude/rework-decisions.md`: every design decision with its reason. Read
  the rows for an area before revisiting a choice there.
- `.claude/rework-log.md`: analysis of the old code and the dated progress
  log. Search it for the history of a feature.
- `.claude/rules/editor.md` and `.claude/rules/backends.md`: editor and
  code-generator conventions. They load automatically when files under
  `apps/editor/` or the backends/IR/tests are read; read them yourself before
  running editor or backend checks without having opened such a file.

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
  src/v1/               current file format (model, schema (TypeBox: the reader's definition, the JSON Schema is
                        generated from it, model.ts is checked against it at compile time), parse, serialize, doc-index,
                        geometry, action-block (layout of a state's entry/exit/timer/internal lines: wrapping, height, hidden lines), route, labels, check, migrate, load, options (the `options` section: defaults, behaviour vs
                        API options, what `targets.<name>` may override)) and edit.ts (layout edits the editor's drags make: move, resize, region split, ends, jog,
                        bend points, labels, S/free conversion, the action block's height; diagram-only, snapped, children kept inside, free routes
                        follow); structure edits: ids.ts (id allocation), create.ts (add vertex/region/transition with
                        validity checks, delete with cascade), clipboard.ts (copy/paste fragments); props.ts (property
                        edits: names, actions, triggers, guards, internal transitions, regions, declarations, targets,
                        title block fields); sheet.ts (sheets as drawings: frame and zones, sheet numbers and paths,
                        `locate` -> "sheet 2, B4", title block cells, `sheetFit` for the design rule check)
  src/v0/               legacy reader, exported as the `v0` namespace
  src/semantics/        structure.ts (document order, compound transitions, initializers), flatten.ts (static tables),
                        flat-run.ts (runs the tables like generated code; must match the interpreter)
  src/runtime/          contract.ts: what every executable form shares (MachineHost, RunOptions, MachineError, busy,
                        RunningMachine); the interpreter, runners and backends import it, never the interpreter
  src/interp/           reference interpreter (simulator + test oracle; wouldTake for the simulator) and traces
                        (parse, run, formatTrace)
  src/ir/               IR every backend prints (ir.ts documents the runtime loop and trace hooks), lowering (drops what the
                        runtime loop cannot reach), analyze.ts (what a printer needs to know: queue, terminate, step counter,
                        fallible functions), evaluator, printer, ids.ts (state enum names, the numbering's fingerprint)
  src/backends/         code generators = IR printers: common.ts (CodegenError, OUTPUT_NOTICE, identifier/pascalCase,
                        CommonOptions, resolveOptions, readTargetOptions, prepare, the line writer; backends never import
                        each other), c.ts (C99 header + source), python.ts (one typed module),
                        ts.ts (one typed, erasable-syntax TypeScript module), rust.ts (one no_std Rust module, no heap,
                        rustfmt/clippy-clean); generate.ts (generateFiles: model + targets options -> files, the one entry
                        point for the CLI and the editor's code preview)
  schema/               ufsm-v1.schema.json (JSON Schema draft-07, generated: `npm run gen:schema`; a test checks it)
  test/                 node:test suites (run with tsx); harness.ts (scripts, differential runs), random-model.ts,
                        c-harness.ts (links many generated C machines into one driver, needs a C compiler),
                        py-harness.ts (runs many generated Python modules in one process, needs Python 3.8+),
                        ts-harness.ts (imports generated TypeScript into the test process),
                        rust-harness.ts (all machines as modules of one crate + one driver binary, needs rustc)
packages/cli/           @ufsm/cli: `ufsm` command (info, check, list, migrate, fmt, run, trace, flatten, ir, generate, schema)
apps/editor/            @ufsm/editor: Vite + TypeScript frontend laid out after VS Code (canvas, explorer, tabs,
                        panels, simulator, code preview, themes, settings); file map in .claude/rules/editor.md
apps/editor/src-tauri/  Rust shell: window, dialog and fs plugins (fs reaches only dialog-picked paths), read/write settings.json
                        (app config dir), icons
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
| `npm run ufsm -- run <model> e1 e2 -g guard` | Simulate a model on the interpreter, printing every step (`-g name[=true\|false]`; guards start false; `--signal-queue`/`--max-microsteps` override the model's options) |
| `npm run ufsm -- trace tests/traces/*.json` | Replay conformance traces on the interpreter |
| `npm run ufsm -- flatten <model> [--json]` | Show the flat tables (regions/slots, transitions, offers) |
| `npm run ufsm -- ir <model> [--json]` | Show the IR as pseudo-code (what backends emit) |
| `npm run ufsm -- generate c <model> -o <dir>` | Generate `<name>.h`/`<name>.c` (`--prefix`, `--signal-queue`, `--max-microsteps`, `--debug-info`, `--trace`) |
| `npm run ufsm -- generate python <model> -o <dir>` | Generate `<name>.py` (`--class-name`, `--signal-queue`, `--max-microsteps`, `--debug-info`, `--trace`) |
| `npm run ufsm -- generate ts <model> -o <dir>` | Generate `<name>.ts` (`--class-name`, `--signal-queue`, `--max-microsteps`, `--debug-info`, `--trace`) |
| `npm run gen:schema` | Regenerate `packages/core/schema/ufsm-v1.schema.json` from `src/format/schema.ts` |
| `npm run ufsm -- generate rust <model> -o <dir>` | Generate `<name>.rs` (`--class-name` names the struct, `--signal-queue`, `--max-microsteps`, `--debug-info`, `--trace`) |

Toolchain: Node 24 LTS (>= 22.18), Rust stable (MSVC on Windows, needs VS
Build Tools "Desktop development with C++"), TypeScript 6, Vite 7, Tauri 2.

## Conventions

- Licence: GPL-3.0-or-later (`LICENSE`) with an output exception for generated
  code (`LICENSE-EXCEPTION`). Every source file (.ts, .rs, .css, .html, .yml,
  Cargo.toml) starts with `SPDX-License-Identifier: GPL-3.0-or-later` and
  `Copyright (C) <year> Jonas Blixt <jonas@blxt.se>` in that file type's comment
  syntax; generated code instead says it may be used under any terms
  (`OUTPUT_NOTICE` in backends/common.ts) and must never carry a GPL header.
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
  Generated code must be deterministic (no dates) and warning-free; the
  per-language requirements (compiler flags, type checkers, tool env vars,
  `UFSM_*_RANDOM`) are in `.claude/rules/backends.md`.
- Editor (`apps/editor/`): conventions for the canvas, edits, host access
  and colors, plus the `window.ufsm` automation API and the browser check,
  are in `.claude/rules/editor.md`.
- Model files: always written by `serializeV1` (canonical form). Never hand
  format a `.ufsm`; run `npm run ufsm -- fmt <file>`. The committed files in
  `examples/` and `tests/models/` must equal the converter output for the
  matching `old/` file (a test enforces this; files fixed by hand are listed in its `fixedByHand`), so extend their traces rather
  than the models. New test models have no `old/` counterpart.
- Never write the v0 format. The editor and CLI read v0 and write v1.
- Do not modify `old/`; it is reference material for behaviour and tests.

## v1 file format essentials (full spec: docs/format-v1.md)

- Sections: `declarations` (events, signals, actions, guards), `machine`
  (root region, transitions), `diagram` (layout keyed by id), `options`
  (shared by every generator, the interpreter and the simulator: `signalQueue`,
  `maxMicrosteps`; behaviour options are set only there, `core/src/format/options.ts`),
  `targets` (per-generator settings: prefix, className, ...).
- All references are by id; ids unique per document; generated ids are
  `ev1`, `sig1`, `act1`, `grd1`, `r0`, `s1`, `t1`.
- Coordinates are relative: state x/y to the owning state's top-left (or the
  sheet origin for the root region and off-page regions: the top-left corner of the drawing area inside the frame,
  50 units in from the paper edge; `core/src/diagram/sheet.ts`); transition `via`/`label`
  to the innermost region containing both endpoints. Use
  `core/src/diagram/geometry.ts` for absolute positions, never re-derive.
- Transition layouts: `route` absent/`"free"` = stored polyline (`from`, `via`, `to`;
  what v0 converts to); `"route": "s"` = derived orthogonal route (`core/src/diagram/route.ts`)
  with optional pinned `from`/`to`, `jog` `{x}` or `{y}` (region-relative) and `label`
  relative to the route's label anchor. Nothing derived is stored; derived defaults keep to the 10-unit grid.
  New transitions use S (the straight tool makes free ones). An initial state is never a target in the editor.
- A state's `regions` are top-down. (v0 files store them bottom-up; use
  `v0.regionsTopDown()` when reading v0.)
- Triggers: `on` (event/signal id) | `auto: true` | `completion: true`.
- A state's `internal` list holds internal transitions (visualSTATE: static reactions):
  `{id, on, guard?, do?}`, no target, never leave the state; drawn as text in the
  action block after entry/exit and timers. Prefer them to self-transitions unless exit/re-entry is wanted.
- A state's `timers` list: `{id, name, after|every, unit (ms|s|min|h), event}`; started after entry actions, stopped
  before exit actions, all stopped by reset()/terminate; the application runs the clock and sends `event` on expiry
  (semantics.md "Timers"). Generated code has a timer API only when the model has timers; traces list the calls as
  `start:<name>(<ms> ms)` / `start:<name>(every <ms> ms)` / `stop:<name>`.
- The action block is derived from the state's width (`core/src/diagram/action-block.ts`, format-v1.md "Action block"): an
  icon per kind, entry and exit lists wrapped, timers packed, 7-unit character cells, `10 + 20 × lines` tall. A state's
  optional `actionsHeight` in the diagram makes it smaller: the first lines show and a marker counts the rest.
- Guards: list of terms ANDed (`{call}`, `{call, not}`, `{in}`, `{in, not}`);
  guard functions take no arguments and return a boolean (no compare terms;
  v0 compares are converted to derived guards). Actions: `{call}` | `{emit}`.

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
