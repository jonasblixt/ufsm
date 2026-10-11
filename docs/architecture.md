# uFSM architecture

How the code is put together, for someone about to change it: the parts, the layers and the rules between them, the
engines that run a machine and how they check each other, and the conventions everything relies on. The normative
documents stay where they are: [format-v1.md](format-v1.md) (the file format) and [semantics.md](semantics.md) (what a
machine does). Words used here are in the [glossary](glossary.md); recipes for common changes are in
[contributing.md](contributing.md).

## The parts

```
                 apps/editor (Tauri + Vite)                    packages/cli
           canvas, panels, simulator, code preview          ufsm check, run, generate, ...
                          │                                          │
                          └──────────────── @ufsm/core ──────────────┘

  .ufsm ──► format/ read, write, migrate v0 ──► check/ the design rule check (the validity gate)
                   │                                   │ no errors
                   ▼                                   ▼
            model/  DocIndex, labels           semantics/ structure ──► flat tables ──► ir/ lower, simplify, analyze
            diagram/ geometry, routes,                 │                                         │
                     action block, labels, sheets      ▼                                         ▼
            edit/   what the editor's edits do   interp/ reference interpreter ◄── compared ── backends/ C, Python,
                                                  (simulator, test oracle)           with          TypeScript, Rust, Go, C++
```

One TypeScript core (`packages/core`) holds everything that is not UI. The editor and the CLI are thin users of it, and
the tests run the same code. Core is platform neutral: no Node or DOM APIs, so it runs unchanged in a browser, in the
Tauri webview, in Node and in tests.

## Layers of @ufsm/core

Each folder may import the folders listed for it, and nothing above. `packages/core/test/boundaries.test.ts` checks
every import against this table.

| Folder | What it is | May import |
|---|---|---|
| `format/` | The file format: model types, TypeBox schema (drives the reader and the JSON Schema), reader, canonical writer, options, id allocation, v0 conversion | nothing (the v0 converter also uses `v0/`, `model/` and `diagram/`, to pick a paper the drawing fits) |
| `v0/` | The legacy v0 reader | `format/` |
| `model/` | Queries over a document: the `DocIndex` every query takes, the text of labels | `format/` |
| `diagram/` | Layout derived from the document, read-only: absolute geometry, S routes, the action block, transition labels, sheets and the drawing frame | `format/`, `model/` |
| `edit/` | Edits: layout (what drags do), create/delete, clipboard, properties. Each mutates the document it is given | `format/`, `model/`, `diagram/` |
| `check/` | The design rule check: `semantic.ts` (every error, and warnings about behaviour), `diagram.ts` (layout warnings), `checkV1` = both | `format/`, `model/` (`diagram.ts` also `diagram/`) |
| `semantics/` | The machine as the semantics see it: document order, compound transitions (`structure.ts`), the flat tables (`flatten.ts`) | `format/`, `model/` |
| `runtime/` | The contract every executable form of a machine shares: host, options, errors, busy | `format/` |
| `interp/` | The reference interpreter and conformance traces | `format/`, `model/`, `check/`, `semantics/`, `runtime/` |
| `ir/` | The IR every backend prints, the lowering from the flat tables, the simplifier, the analysis printers need | `format/`, `semantics/` |
| `backends/` | One printer per language, `common.ts` (what they share) and `generate.ts` (the one entry point). A printer never imports another | `format/`, `model/`, `check/`, `semantics/`, `ir/`, `runtime/` |
| `verify/` | Test oracles: the flat-table runner and the IR runner (no entry point exports them) | `format/`, `semantics/`, `ir/`, `runtime/` |

### Entry points

| Import | For | Holds |
|---|---|---|
| `@ufsm/core` | everyone | format, model queries, the check, the runtime contract, the interpreter and traces, `generateFiles` |
| `@ufsm/core/diagram` | the editor, the CLI's locations | `diagram/` |
| `@ufsm/core/edit` | the editor, tests | `edit/` |
| `@ufsm/core/pipeline` | the CLI's `flatten`/`ir`, tests, new backends | `semantics/`, `ir/` (not the simplifier), the four printers |

The editor and the CLI use only these (checked too). Tests import the oracles and the simplifier by path.

## From a model to generated code

1. **Read**: `loadModel` parses v1 (or converts v0 in memory).
2. **Check**: `checkV1`. This is the one validity gate: a model without errors gets through every later stage. A
   construct the later stages cannot handle is a design rule error here; the throws further down are assertions
   (`packages/core/test/gate.test.ts` checks this with mutated random models).
3. **Structure** (`semantics/structure.ts`): positions in document order, compound transitions (forks and joins
   resolved), region initializers.
4. **Flatten** (`semantics/flatten.ts`): static tables, the way generated code runs the machine: a slot per region,
   offers per trigger, conflict masks (`blocks`), entry programs.
5. **Lower** (`ir/lower.ts`): straight-line code over the tables: an if/else chain per offer, one helper per region
   that needs one. Every decision is made here, including which functions exist at all; `ir/simplify.ts` folds what
   enclosing conditions already decided.
6. **Print** (`backends/*.ts`): each printer starts from `prepare()` (options with defaults, the facts `ir/analyze.ts`
   finds: queue, terminate, step counter, functions that can fail) and only prints. **Backends make no semantic
   decisions**; anything a printer would need to decide belongs in the lowering, so every language gets it.

`generateFiles(doc, target, overrides)` runs 2–6 and resolves the options: the model's `options`, then the API options
of `targets.<name>`, then the overrides.

## Seven engines, and who checks whom

The semantics run in seven places. Only the interpreter is the reference; the others exist to be checked against it,
each at one stage, so a failure points at the stage that is wrong.

| Engine | Where | Runs | Checked by |
|---|---|---|---|
| Interpreter | `interp/interpreter.ts` | the model, directly, written to read like semantics.md | the conformance traces (`tests/traces/*.json`), whose expectations are derived from semantics.md by hand |
| Flat runner | `verify/flat-run.ts` | the flat tables | traces + random models against the interpreter (`flat.test.ts`) |
| IR runner | `verify/ir-run.ts` | the IR | traces + random models against the interpreter (`ir.test.ts`) |
| C, C++, Python, TypeScript, Rust, Go | generated code | the printed IR | `test/backend-contract.ts` for each: traces, differential runs against the interpreter on every repo model and random models, plus compilers, type checkers and linters on the output |

The editor's simulator runs the interpreter (`apps/editor/src/sim.ts`); nothing ships the flat runner or the IR runner.

## Conventions everything relies on

- **semantics.md is the definition.** A behaviour change updates semantics.md, the interpreter and a trace together;
  trace expectations are derived from the document, never copied from the interpreter's output.
- **Queries take a `DocIndex`, mutations take a document.** `indexV1(doc)` builds the index; queries in `model/` and
  `diagram/` read it, functions in `edit/` change a document (in the editor an Immer draft) and build the index they
  need themselves.
- **Never mutate a document an index was built from.** Derived layout is cached in `WeakMap`s keyed by the index
  (action blocks, geometry, sheets, label boxes, search rows); the caches are right because every change produces a new
  document and a new index. The editor rebuilds the index after every edit, undo and redo (`DocSession.refresh`).
- **Stored vs derived.** The file stores what the user decided (positions, sizes, pinned ends, jogs, a resized action
  block); everything else is derived in `diagram/` and never stored.
- **Generated code** is deterministic, warning-free under strict settings in every language, and carries the output
  notice instead of the GPL header. Refactoring a printer keeps its output byte-identical.
- **Model files** are always written by `serializeV1` (canonical form; `ufsm fmt`). The editor writes only v1.

## The editor

```
 DOM events ──► fsm/input.ts ──► editor model (fsm/editor.ufsm, generated editor-fsm.ts)
                                        │ actions and guards
                                        ▼
                    canvas/keys.ts, pointer.ts, tools.ts ──► commands.ts, edit-commands.ts, navigation.ts, ...
                                        │                        │
                                        │       core edit on a draft (edit/), one undo step
                                        ▼                        ▼
                             Workspace / DocSession (the one store) ──► ws.changed(kind)
                                                                          │
                                         shell.ts (title bar, tabs, explorer, panel, status) ◄─┤
                                         canvas/view.ts (draws the sheet on the next frame)  ◄─┘
```

- **One store.** `workspace.ts` holds the open machines (`DocSession`s, `session.ts`), the active one, the clipboard and
  the status message; neither has DOM code, so editor logic runs in `node:test`. A session holds its document and undo
  history (`history.ts`, Immer patches), the derived index and findings, what is shown (sheet, selection, pan/zoom) and
  its simulator state.
- **Changes are announced, not drawn.** A part that changes something calls `ws.changed(kind)` (`document`,
  `selection`, `view`, `sim`, `chrome`, `shell`, `active`) or a workspace method that does; `shell.update` redraws what
  that kind touches, at once, and the canvas draws on the next frame.
- **One command table.** `commands.ts` defines every command once; the menus, the command palette and the key actions
  use it. A command run by a key has the name of that action in the editor model.
- **Its own state machine.** Keys and pointer gestures go through a uFSM model of the editor itself: modes like "`a`
  pressed, waiting for the second key", a drag that only starts past a threshold, a tool that is armed until it has
  placed one vertex. A statechart says this more clearly than flags in event handlers, it has a conformance trace like
  any model, every backend generates code for it, and the editor is its own first user. The cost is one indirection:
  `fsm/KEYMAP.md` (generated) lists what every key does, by state, with the action names to search for.
- The window is laid out after VS Code; colors come from DTCG design-token themes (`themes/`); host access (files,
  dialogs, window, settings) goes through `platform.ts` only, so the frontend also runs in a plain browser.
- `.claude/rules/editor.md` has the file map and the browser check (`apps/editor/test/browser/check.mjs`).

## Where to go next

| To change | Read first |
|---|---|
| What a model means | [semantics.md](semantics.md), `interp/interpreter.ts`, a trace in `tests/traces/` |
| The file format | [format-v1.md](format-v1.md), `format/model.ts`, `format/schema.ts` |
| A design rule | `check/semantic.ts` or `check/diagram.ts`, [contributing.md](contributing.md#add-a-design-rule) |
| Generated code | the backend's doc (`docs/backend-*.md`), `ir/ir.ts`, `backends/common.ts`, the printer |
| How something is drawn or dragged | `diagram/` for the geometry, `edit/layout.ts` for the drag, `apps/editor/src/render.ts` |
| A key, a menu entry | `fsm/KEYMAP.md`, `commands.ts`, [contributing.md](contributing.md#add-an-editor-command) |
| Why something is the way it is | `.claude/rework-decisions.md` (a summary of the decisions that shape the code is at its top) |
