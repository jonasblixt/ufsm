# Rework: analysis and progress log

Part of the rewrite plan (`.claude/rework-tauri-ts.md`, which is imported into every session; this file is not).
Sections 1 and 3 record the analysis of the old code and format; section 6 is the dated progress log. Append a
line to the end of section 6 whenever work lands; search it for the history of a feature.

---

## 1. Starting point (analysis of v0.5.x, 2026-10-08)

The old code lives in `old/` and is kept for reference.

| Part | Tech | Size | Notes |
|------|------|------|-------|
| `old/compose` | C99, GTK 3, Cairo, json-c, libuuid | ~14k lines | Editor. `controller.c` 4.8k lines, hand-written undo 1.6k lines (one undo type per operation). Its own interaction logic is a uFSM model: `compose/src/canvas.ufsm` (166 states, 200 transitions, 36 events). |
| `old/generator` | Python 3 | ~1.5k lines | `parser.py` → `flattener.py` (static flattening into state-vector rules) → `c_generator.py`. `optimizer.py` unfinished. |
| `old/tests` | 14 `.ufsm` + C test drivers | | Expected action traces live in C (`UFSM_TEST(machine, event, "eA", "eB", …)`), so they can't be reused for other languages. |

### What was good (keep)
- **Static flattening** (`flattener.py`): transitions are pre-computed into
  rules over `csv[]`/`wsv[]` state vectors, so the generated C needs no tree
  walking or heap. Great for embedded and portable to any language.
- Dogfooding: the editor's own logic is a uFSM model, which makes a strong
  real-world test model (now `tests/models/canvas.ufsm`).
- Plain JSON, stable ids, declarations listed once and referenced by id.

### What limited further work
- Semantics, code printing and file format were tangled: `c_generator.py`
  makes semantic decisions while printing (e.g. auto-transition detection in
  the entry emitter), so every new language would duplicate them.
- Editor: model structs carry UI state (`selected`, `tx/ty`, nav nodes);
  massive controller; per-operation undo code.
- Portability: `sys/queue.h`, `uuid/uuid.h`, `getopt`, GTK 3 → Windows and
  macOS very hard.
- Tests are C-only.

## 3. Findings on the v0 file format (2026-10-08)

Measured over the 21 valid legacy models (864 KB):
- 65% whitespace, 13% UUIDs; layout is 25% of the non-whitespace content.
- **Region order is reversed**: the GTK editor loads and saves regions via a
  stack, so on-screen order is the reverse of file order (stable across
  save/load). Region order also defines the generated region index.
- Region start is not stored; derived from entry/exit line count
  (30 header + 20 + 20·n) plus previous region heights. `height: -1` = fill
  (unused in practice).
- Absolute coordinates for nested states; off-page region contents use their
  own sheet coordinates in the same fields.
- Mixed numeric enums (`trigger-kind`, guard `kind`, ref `kind`,
  `orientation`, `paper-size`) and string enums; mixed key styles; `trigger`
  means event or signal depending on `trigger-kind`; guard `action-id` points
  into the guards list; `version` never bumped; no schema.
- 101/244 state names are not identifiers, 27 reused across regions,
  "Multi select" twice in one region of canvas.ufsm.
- UUID on every reference instance (editor bookkeeping).
- `old/compose/tests/*.ufsm` are pre-0.4 drafts, not valid JSON.

## 6. Progress log

- **2026-10-08** Analysis of old code and format; bugs B1–B11 verified.
- **2026-10-08** Moved old code to `old/`; scaffolded workspace (core, cli,
  editor), Tauri shell (dialog plugin, read/write commands, icons), CI
  workflow, README. Jonas got `npm run dev` working on Windows after
  installing VS Build Tools (installed: Tauri 2.12.1, Vite 7.3.7, TS 6.0.3).
- **2026-10-08** Editor: read-only canvas (port of render.c), pan/zoom/fit,
  model tree, breadcrumb, off-page navigation, selection.
- **2026-10-08** Fixed region order bug (states in multi-region composites
  were unselectable and labels misplaced) via `regionsTopDown`; hit testing
  made independent of region boxes.
- **2026-10-08** v1 format: spec (`docs/format-v1.md`), JSON Schema, types,
  strict reader, canonical writer, index, geometry, labels, design rule check,
  v0→v1 migrator, version-agnostic loader. Editor and CLI switched to v1
  (Save/Save As, problems panel). 21 legacy models converted (3.5× smaller).
  88 tests: lossless geometry for every legacy model, schema validity,
  canonical form, converter/committed-file equality.
- **2026-10-09** Added `.claude/CLAUDE.md` and this file.
- **2026-10-09** Phase S, first part: `docs/semantics.md`; `core/src/semantics/structure.ts` (document order, compound
  transitions for fork/join, region initializers); reference interpreter `core/src/interp/interpreter.ts` (priority and
  conflicts, signals, auto/completion, shallow+deep history, fork/join, terminate, livelock and queue-overflow errors);
  trace format + runner (`interp/trace.ts`); 16 traces in `tests/traces/` (14 from the old C tests, 2 new for priority)
  with regression models `tests/models/test_priority*.ufsm`; CLI `ufsm run` (simulate) and `ufsm trace`; DRC
  `join-trigger` and `shadowed`. 126 tests. Old expectations changed in 6 steps (exit/entry order, B12), each
  documented in its trace. Smoke run: 200×60 random events on every model, no errors except canvas.ufsm's
  self-looping `auto` (t110) livelocking under a constant guard, as expected. Found B12.
- **2026-10-09** Editor input: no webview context menu on the canvas; pan with right or middle drag; left drag draws a
  selection rectangle (to the right: enclosed, orange; to the left: touching, blue, never the composite it starts in),
  Shift adds, Shift-click toggles, Esc cancels. Selection is now a set of vertex and transition ids; selected
  transitions are highlighted. `window.ufsm.selectedIds()` added. Checked in headless Chromium (16 checks).
- **2026-10-09** Sidebar: the "Tree" button is now "Sidebar" (T) and toggles a panel with the tool palette
  (`apps/editor/src/palette.ts`) above the model tree, which scrolls on its own. Palette: Select | State, Region,
  Transition / Initial, Final, Shallow history, Deep history, Fork, Join, Terminate; only Select works, the rest are
  disabled until editing lands. Canvas cursor is now the default arrow (left drag no longer pans).
- **2026-10-09** S7: `semantics/flatten.ts` (static tables) and `semantics/flat-run.ts` (runs them with integer
  arrays). Selection reworded as post-order offers + conflict masks (interpreter changed to match; 0 differences to
  the SCXML-style selection on 3000 random join-free machines). Fixed in the interpreter: terminate entered the
  terminate vertex's ancestors; history kept a stale record after the region rested in its final state. New DRC
  errors `fork-targets`/`join-sources`. `test/random-model.ts` generates valid random machines (nesting, orthogonal
  regions, history, finals, forks, shared joins, terminate, guards, signals, auto/completion). Flat runner matches
  the interpreter on all 16 traces, all repo models and 1800 random models; all 8 deliberate mutations of the
  runner are caught. CLI `ufsm flatten [--json]`. 171 tests.
- **2026-10-09** S8: IR types with the runtime loop documented in `ir/ir.ts`; `ir/lower.ts` (flat tables -> IR, helper
  per region for exit/record/default entry/deep restore, one step function per event/signal plus eventless,
  simplifier); `ir/eval.ts` runs IR; `ir/print.ts` + CLI `ufsm ir [--json]`. Shared differential harness
  `test/harness.ts` (used by flat and IR tests). IR matches the interpreter on all traces, all repo models and 1800
  random models; all 10 deliberate mutations of the lowering are caught. canvas.ufsm: 2882 lines of pseudo-code.
  216 tests.
- **2026-10-09** B-C: C backend `core/src/backends/c.ts` (IR printer: header + source, options from `targets.c`, name
  clash check) and CLI `ufsm generate c [-o dir] [--prefix] [--signal-queue] [--max-microsteps]`; docs/backend-c.md.
  Tests (`test/backend-c.test.ts`, `test/c-harness.ts`): many generated machines linked into one driver per run,
  scripts fed on stdin; all 16 traces, a model covering every expression form, every repo model, 300 random models
  and 100 with a 2-slot queue match the interpreter exactly (calls, states, errors); repo models compile
  warning-free as freestanding C99 with gcc and clang (and as C++11). Mutation check: 9 of 10 deliberate printer
  bugs caught; the 10th (terminate not clearing the queue) is unobservable, `reset` clears the queue anyway.
  `test/harness.ts` split into `randomScript` + `runScript`; random models now sometimes get two final states in a
  region. IR: exit/record merged per domain. canvas.ufsm -> 3.7k lines of C, 13 KB x86-64 at -Os; dimmer: 16-byte
  machine, 615 bytes of code. 233 tests.
- **2026-10-09** C tests on Windows with LLVM clang: temp-dir cleanup retries (a just-exited driver.exe stays locked
  briefly) and never fails a test; driver built with `-D_CRT_SECURE_NO_WARNINGS`. Newer clang flagged
  `cfg[8] == 1u && cfg[8] != 1u` (a guard with `in S` and `not in S`) and dead `false && ...` (completion of a region
  without final states): the IR simplifier now merges all slot conditions on one region within a conjunction and
  folds contradictions to false (dropping the if). The C tests add `-Wtautological-overlap-compare
  -Wunreachable-code` when the compiler is clang.
- **2026-10-09** Conformance coverage. Census of `tests/models` + traces found deep history, terminate, root final,
  external self/parent/child transitions, compare guards, guarded autos, emits from entry/exit, error paths and
  most fork/join shapes untested by any trace (the old 16 traces fired 5/13 transitions of test_model1; canvas and
  test_final_state_completion had none). Added 13 models with traces (`test_action_order`, `_completion`,
  `_eventless`, `_external_transitions`, `_fork_join3`, `_guard_terms`, `_history`, `_in_guards`, `_init_fork`,
  `_join_agreement`, `_root_final`, `_signals` (+ `test_signals_queue.json`, queue of 2), `_terminate`), a first trace
  for test_final_state_completion and longer traces for test_model1 (now 13/13 transitions), test_nested_composits,
  test_nested_finals and test_state_conditions: 31 traces. Trace format: `inactive`, `options.maxMicrosteps`. Random
  models now get empty/multiple entry and exit lists, emits in entry/exit, forks and joins over three regions and to
  nested targets, and initial transitions into forks (all 1500 seeds valid). Every expectation checked by hand
  against semantics.md. Planted-bug check on the interpreter: the old traces caught 5 of 16 bugs (deep history as
  shallow, history kept after a final, reset keeping history, terminate entering ancestors, LIFO signals, `<=` as
  `<`, negative guard values false, v0.5 exit order, initializer actions too early, no settle after an unhandled
  event, B12, joins ignoring disagreeing sources, reversed transition actions, B3, terminate keeping the
  configuration, skipped deep entry actions), the new ones all 16. Interpreter, flat tables, IR and C (gcc) pass
  all 31 traces. 319 tests.
- **2026-10-09** B-PY: Python backend `core/src/backends/python.ts` (IR printer, `targets.python`, keyword mapping) and
  CLI `ufsm generate python [-o dir] [--class-name C] [--signal-queue n] [--max-microsteps n]`; docs/backend-python.md.
  Tests (`test/backend-python.test.ts`, `test/py-harness.ts`: all units as modules in one Python process, scripts on
  stdin, same protocol as the C driver): all 31 traces, joins, the expression model, every repo model, 300 random
  models and 100 with a 2-slot queue match the interpreter exactly; a hand-built IR checks operator precedence over
  every guard combination (no repo or random model prints an `or` inside an `and`); every generated module parses
  with the Python 3.8 grammar and imports nothing; the doc's example runs. Trace replay and the interpreter
  comparison moved from backend-c.test.ts to `test/harness.ts` (`replayResults`, `assertMatchesInterpreter`).
  Planted printer bugs: 15 of 16 caught; the 16th (process() not returning early once terminated) cannot change
  behaviour, terminate clears every region. CI's test job now sets `UFSM_REQUIRE_CC`/`UFSM_REQUIRE_PYTHON`.
  canvas.ufsm -> 2.5k lines of Python. 334 tests.
- **2026-10-09** Typed Python (Jonas): IntEnum events, a Protocol for the handler, annotations everywhere, bound-method
  dispatch tables; `pyright --strict` (Python 3.8 rules) passes on every generated module and on the typed doc example,
  and rejects a caller with an incomplete handler or a plain int event (new test; pyright via `$PYRIGHT`/PATH, CI installs
  pyright@1.1.414 and sets `UFSM_REQUIRE_PYRIGHT`). pyright found `if cfg[2] == 2: if cfg[2] != 1` in test_in_guards: the IR
  simplifier now decides slot tests implied by enclosing conditions (changes the IR of 808 of 1540 test models; all engines
  still match the interpreter). Its invalidation (set/invoke) changes no current model, so `simplify` got direct unit tests;
  planted bugs in it: 5 of 5 caught. Python printer mutants rerun: 15 of 16 caught (P13 unobservable), after adding
  multi-slot tests to the hand-built IR test. pip cannot reach PyPI from either workspace, so mypy is not checked; pyright
  was already installed in the cloud workspace, where the whole suite ran with gcc, Python 3.13 and pyright (285 tests,
  old/ absent). Jonas's machine: 335 tests, the pyright one skipped.
- **2026-10-09** Plan review: housekeeping items ticked (ci.yml, lockfile and first commit were already in 518e6bd);
  added committing today's work and ignoring `build/`; B-FZ reworded to what is left.
- **2026-10-09** B-TS: TypeScript backend `core/src/backends/ts.ts` and CLI `ufsm generate ts` (alias `typescript`; `--class-name`
  shared with Python); docs/backend-ts.md. Tests (`test/backend-ts.test.ts`, `test/ts-harness.ts`: generated modules are
  imported into the test process and wrapped as TraceMachines, so they plug into runTrace/compareWithInterpreter like
  the interpreter): all 31 traces, joins, the expression model, every repo model, 300 random models, 100 with a 2-slot
  queue and the hand-built expression IR (with numeric and boolean guards) match the interpreter; every module
  type-checks with the TypeScript compiler API under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes +
  noUnused* + noImplicitReturns + erasableSyntaxOnly with only the ES2020 lib; the doc example type-checks and runs
  under plain Node; a caller with an incomplete handler or an out-of-range event is rejected. Planted printer bugs: 16
  of 17 caught (the 17th, loose `==`, behaves the same for numbers and booleans) after adding boolean guards to the
  hand-built test. Editor decisions recorded: dogfooding with the TS backend, S routes with an absolute jog, libavoid
  for a later auto mode; licence question opened.
- **2026-10-09** Relicensed to GPL-3.0-or-later with the output exception: LICENSE (FSF text), LICENSE-EXCEPTION, old/LICENSE
  (the BSD text, for v0.5), package.json/Cargo.toml/lockfile licence fields, SPDX + copyright header in all 56 source files,
  `OUTPUT_NOTICE` line in generated C/Python/TypeScript, README section, `test/license.test.ts`.
- **2026-10-09** E1: the editor's input now goes through its own uFSM model `apps/editor/src/fsm/editor.ufsm` (Editor with
  regions Keys {Tools, Zoom, Jump} and Pointer {Idle, Pressed, Lasso, PanPressed, Panning}; 20 events, 27 actions, 4 guards,
  one in-state guard: Esc clears the selection only when no rubber band is drawn). Generated with `ufsm generate ts` into
  the committed `editor-fsm.ts` (`npm run gen:editor-fsm`; `test/editor-model.test.ts` keeps it fresh); `fsm/input.ts`
  maps DOM events to machine events and keeps pointer/modifier data in an `InputState` the handler reads (uFSM events
  carry no data); `main.ts` implements the handler. Old key map: `n` sidebar (was `t`), `z f` fit / `z n` 100% (was `f`),
  `j a` up / `j r` root, plain `o`/`s`/`S`, Ctrl+A; Enter/Backspace/double-click kept as extras. `tests/traces/editor.json`
  (55 steps, hand-checked) runs on the interpreter, flat tables, IR, C, Python and TypeScript. Headless Chromium: 29
  checks of the real editor (select, Shift-toggle, rubber band and its Esc cancel, right/middle pan, wheel, two-key
  commands, sidebar, Ctrl+A, Enter, double-click, off-page navigation), no page errors. 364 tests.
- **2026-10-09** Internal transitions through the whole pipeline: format (model, strict reader, canonical writer, schema,
  doc index `internals`, DRC: ids, references, trigger kind, shadowing; format-v1.md), semantics.md section, structure
  (candidates after the outgoing ones, domain = own region, empty targets), interpreter, flat tables, IR (no exit/record),
  so every backend has them; labels, renderer (action block), CLI `info`/`list`; random models get them (own RNG stream,
  so the rest of each model is unchanged). `tests/models/test_internal.ufsm` + trace (13 steps, hand-checked); planted
  interpreter bugs (internal as external self-transition, tried before outgoing, never conflicting, actions or guards
  dropped): 5 of 5 caught. The editor model's 12 self-loops became internal transitions (Tools 8, Idle 2, Lasso 1,
  Panning 1; same behaviour: those states have no entry/exit actions, so editor.json is unchanged) and its diagram was
  relaid out (states sized to their text, forward transitions side by side, returns in separate lanes below). 374 tests;
  29 headless editor checks pass.
- **2026-10-09** E2 transition routing: `core/src/v1/route.ts` (S/L/U/detour shapes with 24-unit stubs, polyline
  simplification, automatic sides, label anchor and default label, `followPolyline` for free routes), `SEdgeLayout` in
  the model, strict reader, canonical writer, schema (if/then/else on `route`), geometry (`resolveSEnds` with side
  spreading, parallel stagger and self-loop corners, `routeInfo` for the coming handles); format-v1.md "Transition
  routes". Property test over every side pair and random boxes/jogs/staggers (orthogonal, ends on their sides,
  outward/inward stubs) plus every repository model converted to S; the property test found two bugs in the stagger
  (jog pushed behind the start, U stagger past the stub), fixed. Screenshots of test_model1, test_priority_orthogonal and
  dhcpclient converted to S look right; dense diagrams can still overlap labels (they are movable in E3). 385 tests
  (1 skipped: no C compiler/pyright in the VM), typecheck clean, 29 headless editor checks pass.
- **2026-10-09** New app icon (folded-transition bolt, see decisions): `icons/icon.svg` plus 32x32, 128x128,
  128x128@2x, icon.png (512), icon.ico (16/20/24/32/40/48/64/256, each rendered from the SVG at its size, PNG entries)
  and icon.icns (16–1024). Checked at 16/24/32/48 px on dark and light taskbar backgrounds.
- **2026-10-09** E3: moving, resizing and transition handles with undo/redo. Core `v1/edit.ts` (`moveVertices`,
  `resizeVertex`, `moveRegionSplit`, `setEdgeEnd`/`unpinEdgeEnd`, `setJog`/`resetJog`, `setBendPoint`, `setLabel`/
  `resetLabel`, `nearestEnd`, `topLevelVertices`, `regionBand`; see decisions) and `route.ts` `followOffset`;
  `test/edit.test.ts` (17 tests, incl. 40 random edits on every repository model: every vertex that was inside its band
  stays inside, the machine section never changes, the result round-trips through the canonical writer); 7 planted bugs
  in edit.ts, all caught after adding a test for the limit tolerance. Editor: `history.ts` (Immer patches,
  begin/preview/commit/cancel, version for dirty tracking; `apps/editor/test/history.test.ts`, 5 tests, so the editor
  workspace now has `npm test`), `handles.ts` (handles and grips), renderer (handles, dashed outline around selected
  labels, `hitTransition` for lines and labels, label boxes cached per document version), `main.ts` (drag actions,
  undo/redo, hover cursors, `window.ufsm` hooks `select`/`box`/`route`/`handles`/`undo`/`redo`/`canUndo`/`canRedo`/
  `isDirty`). editor.ufsm: state Dragging (internal eMotion / dragUpdate; returns on eLMBUp / dragFinish, Esc and
  eCancel / dragCancel), `Pressed -eMotion [beyondThreshold, pressedOnGrip] / dragBegin, dragUpdate-> Dragging` before
  the rubber band transition, Tools internals Ctrl+Z / Ctrl+R (`[ctrl, not in Dragging]`), Esc's clearSelection also
  guarded by `not in Dragging`, Idle internal eMotion / hover; new transitions laid out as S routes (returns as nested
  U routes on Idle's left). editor.json: 77 steps (22 new, step 10 now expects `undo`), hand-checked, on every backend.
  Found and fixed: parallel U routes coincided (lanes). Browser check committed as `apps/editor/test/browser/check.mjs`
  (41 checks, all pass, no page errors). Drag on canvas.ufsm costs ~16 ms per pointer move in headless Chromium.
  README key/mouse table brought up to date (it still listed `F` and `T`). 403 core + 5 editor tests in the cloud
  workspace (gcc, clang, Python 3, pyright present: nothing skipped), typecheck clean.
- **2026-10-09** Editor window, VS Code style (see decisions): `titlebar.tsx` (menus, search field, window buttons),
  `tabs.tsx`, `explorer.ts`, `panel.tsx` (Properties, Project), `sash.ts`; `main.ts` now keeps a list of open machines
  (`Doc` per tab: history, index, page, selection, view, tree, explorer section) and switches between them; File/Edit/View/
  Go/Help menus run the same commands as the keys; `platform.ts` gained `confirmDiscard`, window controls and a close
  guard (Tauri `onCloseRequested`, browser `beforeunload`). Tauri: `decorations: false`, `tauri.macos.conf.json`
  (Overlay), capabilities for start-dragging, minimize, toggle-maximize, close, destroy. editor.ufsm: events `eKey_p`,
  `eKey_tab`, actions `togglePanel`, `nextTab`, `prevTab` (Tools internals `p [!ctrl]`, `Tab [ctrl, shift, in Idle]`,
  `Tab [ctrl, in Idle]`); Tools moved up 60 so its three new lines fit above the returns; editor.json 88 steps (11 new,
  hand-checked). License test now covers `.tsx`. Browser check: 67 checks (26 new: menus, search field swallowing keys,
  Properties following the selection and its links, `p`/`n`, View › Project, sash, two tabs with separate selection,
  view and undo, Ctrl+Tab, explorer and tab clicks, dirty-close question cancel/discard, empty state). Then, on Jonas's request, the three areas became rounded cards floating on a
  darker window background, like current VS Code (CSS only: `--chrome`, `--card`, `--card-edge`, `--gap`, `--radius`).
  Scrollbars as in VS Code: thin, no arrow buttons, the thumb visible only while the area scrolls (`scrollbars.ts` sets
  `.scrolling` for 0.9 s after each scroll event, captured on the document) or under the pointer; the mouse wheel
  scrolls the tab strip sideways. Checked in Chromium with scrollbars enabled (idle / scrolling / 1.2 s later).
  Not yet run inside Tauri: frameless drag/resize, window buttons, the macOS overlay and the close question need a check on real windows.
- **2026-10-09** E4 create/delete: core `v1/ids.ts` (`IdAllocator`, `documentIds`), `v1/create.ts` (`regionAt`, `regionArea`,
  `newVertexBox`/`draggedVertexBox`, `cannotAdd`/`cannotConnect`, `addVertex`, `addRegion`, `addTransition`, `deleteElements`,
  `uniqueStateName`), `v1/clipboard.ts` (`copyFragment`, `pasteFragment`), `edit.ts` additions (`toFreeRoute`, `toSRoute`,
  `insertBendPoint`, `removeBendPoint`, exported `followTransitions`); see decisions. `test/create.test.ts` (21 tests, incl.
  random deletes, copy+paste with geometry checks and random additions on every repository model and 40 random models:
  never a dangling reference, duplicate id or stale/missing layout, always round-trips); 15 planted bugs in the new code,
  all caught (after adding an id-gap test). Editor: editor.ufsm grew a Tool region (Select, Armed {Place, Connect}), Keys
  state Add, Pointer states Sizing and Linking (21 states, 48 transitions + 54 internal, 33 events, 4 signals; laid out on
  A1, built with the new core functions); editor.json 167 steps (79 new, hand-checked; step 0 now expects `toolSelect`,
  the old `a` placeholder step became `a` + Esc), on every backend. `main.ts`: tool handling, previews (`preview.ts`: ghost,
  rubber band with bend points, green/red target), Delete, Ctrl+C/X/V, Add menu (every tool, Bend Point, Convert to S
  Route) and Edit › Cut/Copy/Paste/Delete, status-line notes that last until the next key or press, explorer trees
  rebuilt when the machine section changes (closes the known issue); palette: every tool live, highlight follows the
  model; Properties: Add region and × per region work. Found and fixed: the title bar registered its Esc/click-away
  listeners in `useEffect` (after paint), so an Esc right after opening a menu reached the canvas and cleared the
  selection; now `useLayoutEffect`. `apps/editor/test/history.test.ts`: structure edits through Immer with exact undo/redo
  on three models. Browser check: 101 checks (34 new). 424 core + 6 editor tests, nothing skipped, typecheck clean.
- **2026-10-09** E5 properties and declarations: core `v1/props.ts` (`declNameProblem`, `addDecl`, `renameDecl`, `declUses`,
  `deleteDecl`, `setDocText`, `setMachineName`/`setMachineDoc`, `setTargetOption`, `renameVertex`, `renameRegion`,
  `setStateActions`, `setTransitionActions`, `setGuard`, `setTrigger`, `addInternal`, `cannotOffPage`/`setOffPage`,
  `setBarOrientation`); `test/props.test.ts` (14 tests, incl. random deletes/renames of declarations and every region that
  may go off-page going there and back unchanged, on every repository model and 40 random models); 14 planted bugs, 13
  caught after two new assertions (internal transitions refuse `auto`; a transition into a region also blocks off-page);
  the 14th (an x shift when going off-page) was always 0, so the code was removed. Editor: `panel.tsx` rewritten (TextInput,
  Picker, EditList, ActionList, GuardList, TriggerField; Properties, Project, Problems), `main.ts` (panel ops: every change
  one `edit`, `use` declares-then-uses in one step; focus requests from keys; jump-to; canvas badges; Edit menu entries
  for rename/trigger/add entry/exit/guard/action), the problems popup replaced by the tab. editor.ufsm: Keys state Edit
  (`e n/t/r/O`, sDone like Add), Add internals `e/x/g/a`, Editor 400 wider and 80 taller (22 states, 51 transitions + 56
  internal); editor.json 195 steps (28 new, hand-checked), on every backend. Found and fixed while testing: TextInput
  committed the stale draft on the blur that follows Esc (so Esc did not revert) and could commit twice on Enter; mapped
  keys typed into the field they opened (see decisions). `history.test.ts`: property edits through Immer with exact
  undo/redo. Browser check: 139 checks (38 new). 438 core + 7 editor tests, nothing skipped, typecheck clean.

- **2026-10-09** E6 simulator and code preview (see decisions). Core: `Interpreter.wouldTake(event)` (the transitions an
  event would take now, without taking them), `parts`/`internal` on `transition` trace entries, `formatTrace` (reads back
  unchanged for all 33 trace files, 25 of them byte for byte), `backends/generate.ts` (`modelIr`, `generateFiles`; `ufsm
  generate` now uses it, output unchanged). Found and fixed: `ufsm run` crashed when an internal transition fired (it looked
  the id up among the machine's transitions). Editor: `sim.ts` (Simulation, relativePath), `code.ts` (cache, highlighter),
  `simpanel.tsx`, `codepanel.tsx`, `widgets.tsx` (Section/Field moved out of panel.tsx), render.ts highlight (SimHighlight),
  main.ts (per-machine simulation, guards, options, Run menu, File › Generate, status-bar badge, `window.ufsm` sim hooks),
  platform.ts (`saveTextFile`, `saveFilesToFolder`, `copyText`), titlebar menu labels may be functions. editor.ufsm: event
  `eKey_f5`, actions `simStart`/`simStop` (Tools internals `F5 [shift] / simStop`, `F5 / simStart`; Tools 40 taller, grown
  upwards so its bottom and transition ends stay put); editor.json 203 steps (8 new, hand-checked), on every backend. Tests:
  core +7 (wouldTake, parts, formatTrace, generateFiles); editor `test/sim.test.ts` (11: steps, guard recording, errors and
  options in traces, staleness, relative paths, code cache, highlighter on every repository model and language, and a
  random 60-step session on every repository model whose saved trace replays with `runTrace` without a failure); 15 planted
  bugs in sim.ts/code.ts, all caught after four tests were tightened. Browser check: 179 checks (40 new: F5, events,
  hover, guards, canvas pixels of the highlight, log, history, saved trace download, out of date and restart, Run menu, a
  model with errors, all four code views, options followed, Save…/Save both…). 400 core + 18 editor tests in the cloud
  workspace (old/ absent: 6 skipped), typecheck clean. Not yet tried in Tauri: saving a trace or code through the native
  dialogs, the folder picker, the clipboard.

- **2026-10-09** File › New (see decisions). Core: `newDocument` (create.ts) + 2 tests in v1.test.ts (canonical,
  schema-valid, round-trips, no findings, code for every target; fresh objects, first state is `s1`). Editor: `untitled.ts`
  (`untitledName`, `nameOnSave`) + `test/untitled.test.ts`; main.ts `newModel`, Doc `untitled`, File › New, `explorer-new`
  button, `window.ufsm.newModel`; `saveModelFile` takes a `make(path)` callback like `saveTextFile`, so the text is built
  once the path is known; empty-state hint mentions Ctrl+N; README key table. editor.ufsm: action `newModel` (act82), Tools
  internal t110 before the `n` toggle (now `[not ctrl]`), Tools 20 taller downwards, the return lanes under it moved down 20
  with their labels; editor-fsm.ts regenerated; editor.json 205 steps (2 new: Ctrl+n in Idle, Ctrl+n while dragging),
  hand-checked. Browser check: 187 checks (8 new: New in the empty explorer, Ctrl+N, File › New, untitled3 after two,
  placing a state, saving, a closed name reused). 402 core + 20 editor tests in the cloud workspace (old/ absent: 6
  skipped), typecheck clean. Not yet tried in Tauri: the first save through the native dialog renaming the machine.

- **2026-10-09** Color themes and global settings (see decisions). `apps/editor/src/tokens.ts` (DTCG 2025.10 resolver,
  deep merge, aliases with type resolution, sRGB/HSL colors with hex fallback, WCAG contrast), `theme.ts` (bundled themes,
  `resolveTheme`, `buildTheme`, the canvas colors `C` + `canvasAlpha`), `settings.ts` (settings.json), `settingspanel.tsx`
  (Settings tab), `themes/ui.tokens.json` + `themes/gruvbox/` (resolver, palette generated from Jonas's gruvbox-master.zip,
  dark/light roles, hard/medium/soft). Every color literal left the editor: render.ts (`C` now `background`, `paper`, `grid`,
  `stateFill`, `ink`, `selection`, `touching`, `ok`, `refuse`, `warning`, `badgeMark`, `active`, `would`; the warning badge
  and the empty canvas were hard-coded), main.ts (rubber band), style.css (scrollbars, menu shadow, close button, flash,
  syntax colors; `--orange-dim` was unused and went). platform.ts: `cachedSettings`, `readSettings`, `writeSettings`,
  `systemPrefersDark`, `onSystemAppearance`; Rust `read_settings`/`write_settings` (not compiled in the cloud workspace:
  no crates.io). `window.ufsm.theme()`/`settings()`. `test/theme.test.ts` (16 tests: palette equals gruvbox.vim, all six
  variants, dark medium equals the old colors, WCAG contrast in every variant, style.css fallbacks and no literals, OS
  following, fallbacks with problems, the DTCG engine's rules and errors, settings parsing); 18 planted bugs, all caught
  after adding a test for alias-vs-group types, which also showed that merging per file lost a group's `$type` (now
  deep-merged). Browser check: 208 checks (21 new: File/View › Settings, every variant read back as pixels of the panel,
  sheet and surround, color-scheme, saved text, System following an emulated OS change, explicit Dark ignoring it, kept
  across a reload, an invalid option reported, unknown keys kept); the page now emulates a dark OS. 402 core + 36 editor
  tests in the cloud workspace (old/ absent: 6 skipped), typecheck clean.

- **2026-10-09** Jonas's editor feedback (eight items, see decisions). Core: `GRID` in model.ts; route.ts default jogs,
  stubs and lanes on the grid (`onGrid`, `gridOut`, `firstOk`); geometry.ts automatic end offsets on the grid (exact for a
  U that would fold) and self-loops at 20 + 10k; create.ts `cannotConnect` refuses an initial target, `addTransition`
  `route: "straight"` (`straightEnds`, `exitPoint`, free self-loop); props.ts `setPaper`, `beyondPaper`; format-v1.md (grid
  defaults). Editor: render.ts (selection drawn as the vertex's color, `drawSelection` gone, texts clipped), handles.ts
  (resize grips hidden: side lines with `span`/`axis`, corners), palette.ts (S and straight tools, new S icon), preview.ts
  `drawLinkRoute`, main.ts (two link tools, `linkRoute` preview on a copy, `sRouteTowards`, S tool refuses bend points,
  hints, Add menu), input.ts (`l`), panel.tsx (Paper select + warning), style.css (`.paper-warn`), README key table.
  editor.ufsm: event `eKey_l` (ev38), action `toolStraight` (act83), Add internal t111 `l / toolStraight(), ^sConnect,
  ^sDone` (Add 20 taller), PanPressed t112 and Panning t113 `eWheel / zoomAtPointer()`; editor-fsm.ts regenerated;
  editor.json 211 steps (6 new, hand-checked: wheel in PanPressed and Panning, `a l`, Esc). Tests: route.test.ts (a state
  moved by 40 instead of 37 now that ends snap; new: routes between grid-aligned boxes lie on the grid, 300 random pairs
  with up to three parallel transitions each way), create.test.ts (initial target refused, history allowed; straight
  transitions: level, diagonal, nested, self-loop, with a bend point; random adds use straight too), props.test.ts
  (paper). Found while testing: snapping put both ends of a U level in editor.ufsm converted to S (t94 folded back), hence
  the exact fallback. Browser check: 232 checks (24 new: selection pixels with nothing around the state, resizing from a
  side away from its middle, the top side and a corner with their cursors, zoom while panning, the add keys, an initial
  target refused, the S tool refusing bend points, `a l`, the palette's two tools, a straight line on the grid, the S
  route on the grid, Paper select with undo, the paper warning, clipped texts read back as pixels). 450 core + 36 editor
  tests in the cloud workspace (old/ restored from git: nothing skipped), typecheck clean. Merged into Jonas's uncommitted
  editor.ufsm (Keys, Pointer and Tool regions off-page, states moved): only the diagram differed, so the same machine
  edits went on top (Add again 440 tall) and editor-fsm.ts is identical. With that layout one test fails, also without
  this work: create.test.ts "copy and paste random selections" (see known issues).
- **2026-10-09** Fixed that failure: the test's random selection only excluded vertices whose own region is off-page, so
  vertices nested inside off-page states slipped in and the selection spanned several sheets (impossible in the editor,
  which selects on one page). It now picks only vertices on the root sheet (`sheetOfVertex`). 450 core + 36 editor tests
  pass on Jonas's machine, nothing skipped; typecheck clean.
- **2026-10-09** Jonas fixed tests/models/test_final_state_completion.ufsm by hand: A -> B is now `completion: true` (the
  v0 draft's 'completion-event' trigger, which the converter keeps as an ordinary event). Its trace was rewritten by hand
  (8 steps: completion only once both regions are final, in either order); the converter-sync test skips this file
  (`fixedByHand` in v1.test.ts), so it is the one committed conversion that differs from the converter output. 450 core +
  36 editor tests pass, nothing skipped.

- **2026-10-09** B-RS Rust backend (see decisions): `core/src/backends/rust.ts` (IR printer, `targets.rust`, `rustName`,
  `rustModuleName`, rustfmt-style line breaking of `&&`/`||` chains, `if` heads and match arms), `generateFiles`/
  `CODE_TARGETS` (`"rust"`), CLI `ufsm generate rust [-o dir] [--class-name S] [--signal-queue n] [--max-microsteps n]`
  (`--class-name` now applies to python, ts and rust), docs/backend-rust.md (its Example is compiled and run by the
  tests), format-v1.md (targets of every generator), schema description, README, semantics.md. Editor: Rust view in the
  Code tab (highlighter: Rust keywords, attributes as `c-pre`, char literals without catching lifetimes), File › Generate
  Rust Code…, Project tab "Code generation: Rust" (Struct, Module, Signal queue, Max microsteps). Tests
  (`test/backend-rust.test.ts`, `test/rust-harness.ts`: all units as modules of one library crate built with `-D warnings`
  and clippy, plus one driver binary on the C harness's stdin protocol): 33 traces; differential runs on joins, a model
  whose names are Rust keywords (`type`, `self`, `match`, `into`, `Self`, `async`, `gen`), the expression model, every repo
  model, 300 random models (`UFSM_RUST_RANDOM`), 100 with a 2-slot queue, a hand-built IR of expression shapes (incl.
  `> 0.5`, `< 1e12`, `>= -2.5`, `== 0.5`) and a hand-built eventless step ending in `return false`; every repo model plus
  the keyword model in a `#![no_std]` + `forbid(unsafe_code)` crate (one through `include!`) on editions 2021 and 2024,
  clippy default + pedantic, `rustfmt --check` on those, 60 random models and a model with over-long conditions and
  or-patterns; a missing handler method and a number as event are compile errors; the docs example prints `lamp at 30%`.
  Also generate.test.ts and license.test.ts cover Rust; sim.test.ts highlights it; CI installs Rust (clippy, rustfmt) in
  the test job and sets `UFSM_REQUIRE_RUST`. Found while testing: `test_external_transitions` declares an event `self`
  (hence the underscore rule); in a binary crate rustc warned about unused public items (hence `allow(dead_code)` on
  those only). 16 planted bugs in rust.ts: 15 caught (one after adding the final-return test); the 16th (settle not
  clearing the queue after terminate) is unobservable, since `reset()` clears it and a terminated machine never reads
  it (kept for parity with C/TS). Browser check: 234 checks (2 new: the Rust view, its options followed). 469 core + 36
  editor tests in the cloud workspace (rustc/clippy/rustfmt 1.97, gcc, Python, pyright: nothing skipped), typecheck
  clean. Not yet run on Jonas's machine (Windows, MSVC rustc).

- **2026-10-09** Bool-only guards (see decisions). Core: `GuardTerm`/`FlatGuard` without the compare form, strict reader
  (`op`/`value` are unknown keys now), writer, schema, labels; IR `compare` removed (lower, eval, print, simplifier);
  interpreter, flat runner and IR evaluator ask `guard(): boolean` (default false); C/Python/TypeScript/Rust print plain
  calls and `!`/`not` (Rust no longer `!= 0`), signatures `bool`; trace guard values are booleans (`parseTrace` rejects
  numbers with a hint); `ufsm run -g name[=true|false]`. v0 converter: compare terms become derived guards (see
  decisions); `tests/models/canvas.ufsm` regenerated (grd16 `canvas_selection_count` replaced by grd18-20 `_le_1`,
  `_gt_1`, `_ge_1`; ids keep the gap). `test_guard_terms` rewritten for boolean guards (events truthy/not/all, guards g/h;
  trace 9 steps, hand-derived); every trace's guard values converted to true/false (0 -> false, else true). Tests: random
  models and scripts use boolean guards; the expression model and the hand-built IR shapes test `not` terms instead of
  compares; C/Python/Rust drivers take `g <i> 0|1` (the C driver's guard logs a bad user pointer as a call); new converter
  test (derived names, a value of -1 and 2.5, a taken name, a guard also called plainly keeps its declaration) and a
  trace-format test for numbers. Editor: the guard term select offers is true / is false only; the Simulator's guards are
  checkboxes; `Simulation`, `simGuard(name, boolean)`; editor-fsm.ts regenerated (handler guards `(): boolean`). Docs:
  format-v1.md, semantics.md, the four backend docs, CLAUDE.md. Planted bugs: 7 of 7 caught (`not` ignored in the
  interpreter, `!` dropped in C and Rust, compared guard never removed, derived guards keyed without the value, `not`
  dropped on `in` terms by the reader, numbers accepted in traces). 470 core + 36 editor tests and 235 browser checks in
  the cloud workspace (gcc, clang, Python, pyright, rustc/clippy/rustfmt: nothing skipped), typecheck clean. Saved traces
  from earlier simulator sessions with numeric guard values no longer load (change `1` to `true`, `0` to `false`).

- **2026-10-09** UI zoom (see decisions). `settings.ts` (`zoom`, `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEPS`, `zoomStep`), `main.ts`
  (`applyZoom` from the first paint, `setZoomSetting`, View menu items, handler actions, `window.ufsm.zoom()`),
  `settingspanel.tsx` (Zoom section), `style.css` (`--ui-zoom`, `zoom` on the UI parts, disabled segmented buttons),
  `sash.ts` (`scale` option), `fsm/input.ts` (`+`/`=`/`-`/`0`, allowed in text fields with Ctrl). editor.ufsm: events
  ev39–ev41, actions act84–act86, Tools internals t114–t116; Tools 60 taller downwards and the ten return routes under it
  (bend points and labels) moved down 60; editor-fsm.ts regenerated; editor.json 220 steps (9 new, hand-checked: Ctrl
  with +/-/0, the keys without Ctrl, not while a button is held). Tests: theme.test.ts +2 (zoom read/write/clamp,
  steps). Browser check: 261 checks (26 new: keys, the canvas's view scale and hit testing unchanged at 125%, selection
  pixels, View menu, the tab's buttons and limits, Ctrl+= in the search field, the sash at 125%, kept across a reload,
  out of range reported). 470 core + 38 editor tests in the cloud workspace (nothing skipped), typecheck clean.

- **2026-10-09** Everforest, Solarized and Catppuccin themes (see decisions). Upstream sources fetched with `git clone` in the cloud workspace (raw.githubusercontent.com and the GitHub API are blocked there; clone works): sainnhe/everforest 85a86eb (2026-06-08), altercation/solarized 62f656a, catppuccin/palette 07d02aa (v1.8.0), catppuccin/catppuccin (style guide). The token files were generated from those sources by a script (not committed; the tests hold the upstream values). `themes/everforest/` (resolver, palette, roles, dark, light, hard/medium/soft), `themes/solarized/` (resolver, palette, roles, dark, light), `themes/catppuccin/` (resolver, palette, roles, dark, latte, frappe/macchiato/mocha). theme.ts: the files registered, `THEMES` alphabetical, `FALLBACK_THEME` (gruvbox; was `THEMES[0]`), `modifierHasEffect` (cached). settingspanel.tsx: a modifier without effect is disabled with the reason as title; style.css: its chosen button stays visible, muted. Tests: theme.test.ts +7 (palettes equal upstream, the resolvers' modifiers, every variant's roles, code colors, layout rules for every variant of every theme, contrast floors at the weakest upstream pairs, options without effect); 5 planted bugs (always "has effect", an edge role, the Solarized ink override dropped, a code color, a palette hex), all caught. Browser check: 275 checks (14 new: Everforest/Solarized/Catppuccin dark and light read back as pixels of the panel, sheet and surround, each theme's own controls, Catppuccin's flavor disabled while light and enabled when dark, Frappé repainting and saved, kept across a reload, back to Gruvbox dropping the flavor). Screenshots of all six looked right. 45 editor tests, typecheck clean (core unchanged).

- **2026-10-10** Search (see decisions). `apps/editor/src/search.ts` (no DOM: `SearchItem`, `fuzzyMatch`, `substringMatch`, `matchItem`, `search`, `parseQuery`/`PREFIXES`, `elementItems` per machine, `menuCommands` from the menus, `helpItems`, `remember`), `quickpick.tsx` (the field and its list under it, wider while open; Up/Down, PageUp/PageDown, Tab, Enter, Esc gives the focus back; Ctrl+P/Ctrl+Shift+P/F1 inside switch mode or walk the list; matched letters marked, a symbol per kind, key caps, the file name of other machines' rows, a check on settings in use, "recently used" group) replaces the placeholder in `titlebar.tsx`; `main.ts`: `searchItems` (elements cached per index), `settingItems`, `projectItems` (`focusProjectField` puts the cursor in the Project tab's field), `onSearchPick`, theme preview (`applyTheme(preview)`), menu items Go › Search… / Go to Element in Machine… / in All Machines…, View › Command Palette…; panel.tsx exports `TARGETS`. editor.ufsm: events `eKey_P`, `eKey_f1`, actions `quickOpen`, `commandPalette`, internals of Tools (Ctrl+P, Ctrl+Shift+P, F1, pointer Idle); Tools grown 60 units to show its 26 internal transitions (the return paths below moved with it); input.ts maps P and F1 and lets Ctrl+P/Ctrl+Shift+P/F1 through in text fields like the zoom keys; trace editor.json +9 steps (step 84: Ctrl+P now opens the search). Tests: search.test.ts (22: matching, classes, detail/keywords as runs, elements of every repository model, focus ranking, prefixes, empty field, recency, menus, speed); 7 planted bugs (no focus priority, no word-start bonus, `@` over all machines, recency duplicates, no exact class, disabled commands listed, scattered detail matches), all caught. Browser check: 319 checks (44 new: Ctrl+P/Ctrl+Shift+P/F1, finding and showing a state of another machine, focus order in the list, commands with keys run, disabled commands hidden, mode switching, appearance and theme preview/restore/save, Project paper size as one undo step, a generator option focused, `@` and `#`, a declaration in its machine's Project tab, recent picks, `?`, mouse, menus, Ctrl+P from another field and focus given back). Fixed while testing: the caret placed one frame late swallowed the first typed letter; focusing the field from show() reopened it empty. 470 core + 67 editor tests (nothing skipped), typecheck clean.

- **2026-10-10** Sheet frame and title block (see decisions). Core: `v1/sheet.ts` (`sheetFrame`, `ZONES`, `zoneOf`,
  `zoneRowLabel`, `paperOf`, `sheets`/`sheetInfo`/`sheetName` (cached per index), `locate`/`locationText`,
  `titleBlockCells`, `sheetFit`/`sheetFitMessage`), model `TitleBlock`/`TITLE_BLOCK_FIELDS` and `Diagram.titleBlock`
  (reader, canonical writer after `paper`, schema), props `setTitleField` (replaces `beyondPaper`), check
  `outside-frame`/`title-block`, migrate picks a paper that fits (note `paper`); CLI: `check` adds "sheet n, Zone" to each
  finding, `info` prints the sheet count and paper. Models: 7 converted test models regenerated (paper only), test_internal
  and test_join_agreement (hand-made) moved to A3; now every repository model fits its sheets (test). Editor: render.ts
  `drawSheet` (paper, grid inside the drawing area only, border, frame, zone ticks and labels) and `drawTitleBlock`; the
  off-page marker names its sheet; panel.tsx Project tab › Title block (five fields, Date › Today), the fit warning counted
  from the findings, Problems rows end in " · sheet n, Zone"; main.ts passes the file name, status line shows where the
  selection is, double-click on the title block focuses Revision, `z f` on an empty page fits the sheet, search rows
  "Project: Title Block: …"; style.css `.title-field`, `.problem .loc`. docs/format-v1.md (frame, zones, title block, fit,
  converter), README. Tests: sheet.test.ts (16: frame geometry for every paper, ISO zone counts and sizes, zone names, I/O
  skipped, sheets and paths on canvas.ufsm and editor.ufsm, locate, title block cells tile the block, values from the
  model, format round trip + schema, fit findings for vertices/routes/title block, only the outermost element listed on
  four big models squeezed onto A4, every repository model fits, the converter's paper choice), props.test.ts (paper,
  title fields); 17 planted bugs in the new core code, all caught after two tests were added (nested contents of a listed
  state, never a smaller paper than v0's). Browser check: 338 checks (19 new: frame lines, border, zone numbers and
  letters with an empty band, title block drawn, off-page marker's sheet number, status line, double-click → Revision
  focused, a field written and drawn and undone in one step, Today, five search rows and picking one, the Project warning
  for outside/over the title block, Problems with sheet and zone, a bigger paper clearing them, `z f` on an empty page).
  487 core + 67 editor tests in the cloud workspace (nothing skipped), typecheck clean. A first attempt at this (in the
  cloud workspace earlier today) was lost before it reached the repository; this is a rebuild of it from what was left.
- **2026-10-10** CI: actions/checkout, actions/setup-node and actions/upload-artifact v4 -> v7 (all run on Node 24; v4 targeted Node 20, which GitHub now forces onto Node 24 with a deprecation warning). No breaking change applies: checkout v7 only blocks fork PRs under pull_request_target/workflow_run, setup-node keeps the explicit `cache: npm`, upload-artifact still zips by default (`archive: false` is opt-in).

- **2026-10-10** Mouse back button goes up one level (see decisions). editor.ufsm: ev44 `eMouseBack`, Tools internal t120
  (Tools 20 taller downwards for its 27th line, the ten return routes under it, bend points and labels, moved down 20);
  editor-fsm.ts regenerated; editor.json 231 steps (2 new, hand-checked: goes up in Idle, nothing while drawing a
  transition). input.ts: button 3 released anywhere in the window sends it; buttons 3/4 never navigate the webview's
  history. README key table. Browser check: 343 checks (5 new, the real button through CDP: up from an off-page sheet with
  the owner selected, the history entry kept, with the pointer over the explorer, nothing on the top sheet; disabling the
  preventDefault fails three of them). 435 core + 67 editor tests in the cloud workspace (old/ absent: 6 skipped),
  typecheck clean.
- **2026-10-10** Bugfix: right-clicking the explorer, menus, right panel, status bar or background opened the webview's
  context menu (only the canvas suppressed it). input.ts: one `contextmenu` listener on the window prevents it everywhere
  except text fields (input, textarea, contenteditable keep cut/copy/paste and spelling). Browser check: 345 checks (2 new:
  dispatched on canvas, explorer, sidebar, title bar, panel, status bar and body; a Project text field keeps it; with the
  old canvas-only listener the first fails). Run on Windows for the first time (Playwright + esbuild in the scratchpad via
  UFSM_NODE_TOOLS): 345 passed; editor typecheck clean.
- 2026-10-10: Transition ends at the clicks. `addTransition` takes `fromAt`/`toAt` (absolute points where the source and
  target were clicked) and attaches each end on the nearest side, snapped along it (`endAt` in edit.ts, shared with
  `setEdgeEnd`); S routes get both ends pinned, straight ones use them instead of the centre line or the first/last bend
  point; self-transitions ignore them. The editor passes the clicks; the previews start from the clicked source end.
  Core test + browser check (346 checks, all passing on Windows); editor typecheck clean.
- 2026-10-10: Free routes keep their bend points when one end moves. `followPolyline` no longer blends each bend point
  by its position along the path (which scaled the route off the grid); bend points move only when both ends move by
  the same amount (the route is translated), otherwise only the first or last segment changes. `followOffset` moves a
  label by the blend of its segment's two points (stays between bend points, follows the end on a first/last segment).
  route/edit unit tests updated + new label test; browser check: dragging C keeps t5's bend points (347 checks).
- 2026-10-10: The editor reads and writes files through `tauri-plugin-fs` (2.6.0, matching the Rust crate already in
  Cargo.lock via the dialog plugin) instead of the shell's own `read_text_file`/`write_text_file`, which accepted any
  path. No static fs scope: the dialog plugin adds each picked file, and a picked folder with its direct children, for
  the rest of the run; capabilities grant only `fs:allow-read-text-file`/`fs:allow-write-text-file`. Settings keep their
  two commands (fixed path, atomic write). Browser check stub gained the plugin's names (347 checks).
- 2026-10-10: Format v1 has one schema source: `core/src/v1/schema.ts` (TypeBox 1.3) replaces the hand-written
  structural reader (`parse.ts`: format/version pre-checks, `Value.Check`, then one error picked from `Value.Errors`:
  errors from union members the value is not meant to be (by `kind`/`route`/which keys) are dropped, messages follow
  ajv-errors' `errorMessage`); `ufsm schema [-o]` / `npm run gen:schema` writes `schema/ufsm-v1.schema.json`
  (schema.test checks it is fresh, pins 15 error messages, and that Ajv reading the published file agrees with the
  reader); compile-time check that each `model.ts` interface and its schema definition have the same fields and types.
  Error messages unchanged except absent fields ("missing"). Tests: core 485 + 1 skip, editor 67, browser check 347.
- 2026-10-10: Live tracing from an embedded target discussed and written up as a later feature in
  `docs/live-trace.md` (replay log of events + guard bits, keyframes, transports, timeline); not started.
- 2026-10-10: Busy latch for failed and nested calls (Jonas: exceptions out of actions). `docs/semantics.md` gains
  "Failed and nested calls"; interpreter, flat runner and IR evaluator get the `busy` error (`busyError`,
  `BUSY_MESSAGE`); Python/TS/C/Rust printers set the flag at the start of reset/process and clear it at the end (C:
  `ERR_BUSY = -4`, an event range check up front, so an unknown event after terminate is now `ERR_EVENT` as in the
  interpreter; Rust: `Error::Busy`). Trace keys `raise` and `reenter` (parser, runner, `formatTrace` order); the driver
  protocol gains `x raise|reenter <name>` and a fourth output column (shared `driverLines`/`parseDriverOutput` in
  `test/harness.ts`): C leaves with `longjmp`, Python raises, Rust panics under `catch_unwind` (re-entry cannot compile
  there, reported as refused), TS runs in-process. New trace `test_busy.json` (on test_guard1.ufsm; raise in an exit
  action, an entry action during reset and a guard; reenter from an entry action); busy steps added after the errors in
  `test_eventless` and `test_signals_queue`; planted-bug check: dropping the latch or never clearing it fails all three
  traces. Editor: `input.ts` resets its machine when an editor action throws, then rethrows; `editor-fsm.ts`
  regenerated. Backend docs updated. Tests on Windows: core 498 (C suites with `CC` = LLVM clang, which is installed but
  not on PATH), editor 67. Browser check not run.
- 2026-10-10: Jonas reviewed the busy latch semantics (accepted); the simulator keeps Stop/Start and Reset as the way out.
- 2026-10-10: Common `options` section (Jonas's decision): new `core/src/v1/options.ts` (defaults, behaviour vs API
  options, `targetSection`), schema/model/canonical writer (`options` after `diagram`, closed), design rules
  `signal-queue` (error: queue 0 while emitting) and `target-option` (warning: behaviour option under `targets`).
  Backends read only their own keys from `targets.*`; `generateFiles` resolves `options` -> targets -> overrides. The
  interpreter takes its defaults from the model (its queue is now bounded at 16 by default, like generated code); flat
  runner and IR runner default to 16 too; trace runner: model, then caller, then trace options (`traceOptions` for the
  backend runners). CLI `run` accepts `--signal-queue`/`--max-microsteps`. Editor: Project tab shows one Options section
  (per-language sections keep prefix/class/module/file), search rows "Project: Options: ...", code preview cache keyed on
  `options`; simulator runs with the model's options plus session overrides, a run is out of date when `options` change,
  saved traces record only overrides. New `tests/models/test_options.ufsm` (queue 1, 2 microsteps) with
  `test_options.json` (model's options apply) and `test_options_override.json` (a trace's override). Found and fixed:
  generated Rust with a queue of 1 failed clippy (`modulo_one`); now no `queue_head` and slot 0. Fixed a latent flaw in
  create.test's paste check (vertices nested inside an off-page region were compared across sheets; exposed because the
  new model shifted the random selections). Generated code for all 38 repo models in all four languages is byte-identical
  to HEAD. Tests on Windows: core 503 (501 pass, 1 skipped, 1 fail: `test_model1.ufsm` hand-edited in 25c441d, see
  section 8), C suites with `CC` = LLVM clang 14/14, editor 68. Docs: format-v1.md (Options section, design rules),
  semantics.md, the four backend docs. Browser check updated (Options section in the Project tab) but not run.
- 2026-10-10: `test_model1.ufsm` added to `fixedByHand` in v1.test.ts (tidied up in the editor in 25c441d); the converter
  sync test now compares 18 files (floor lowered from 19).
- 2026-10-11: State ids, `debugInfo` and `trace` (decisions log 2026-10-10, API approved by Jonas with one hook instead of
  five, CLI flags and the fingerprint in `ufsm info`). IR: `IrState.ident`/`label` (`ir/ids.ts`: names qualified with
  parent states only as far as needed, else the id appended), `IrModule.transitions` (numbered: `machine.transitions`
  order, then internal ones in state post-order; initial transitions not numbered), `fingerprint` (FNV-1a 32 over a JSON
  text of the numbering), `trace`; `lowerToIr(flat, { trace })` emits `{op: "trace"}` statements (enter after `set`, exit
  after the children's exits and before the exit actions, transition after the microstep's exits and before its own
  actions), the runtime loop reports event (after the terminated check) and signal (when popped). The interpreter's
  existing `onTrace` already reported exactly these points, so it is the reference unchanged. Options: `debugInfo` and
  `trace` in `API_OPTIONS` (`isApiOption`, `behaviourOptions()` for the interpreter, simulator and traces; trace files
  keep behaviour options only), schema regenerated, design rule warning for a non-boolean override in `targets`.
  `generateFiles` lowers again when the target's resolved `trace` differs from the IR passed in. Backends: always a state
  enum and the fingerprint (C `enum <p>state`/`<P>FINGERPRINT`, Python `<C>State`/`<C>.FINGERPRINT`, TS
  `<C>State`/`static FINGERPRINT`, Rust `State`/`FINGERPRINT`); debugInfo: C `*_name(uint16_t)` (NULL out of range) and
  `is_active`, Python/TS `EVENT_NAMES`/`SIGNAL_NAMES`/`STATE_NAMES` and `is_active`/`isActive`, Rust `name()` and
  `from_index()` on `Event`/`Signal`/`State` (matches, not arrays: rustfmt's array layout is not worth copying) and
  `is_active`; trace: one hook `trace(kind, id)` (C `<p>trace(void *user, enum <p>trace_kind, uint16_t)`, a method on
  the handler/trait elsewhere), a trace-kind enum, a public signal enum, the transition numbers as a comment; an action
  named `trace` clashes. CLI: `--debug-info`, `--trace`, `ufsm info` prints the fingerprint. Project tab: two switches
  with a short text in Options, a per-language select (As in Options / On / Off) and search entries. Tests: hooks.test.ts
  (hand-derived hook order on the interpreter and the IR, naming, fingerprint with FNV test vectors, option resolution,
  clashes); a differential pass per backend with both options (hook calls logged as pseudo-calls among the actions,
  `decodeHooks`/`interpreterHooks` in harness.ts; names checked in the hook, active states read through is_active;
  planted exit-hook-order bug caught); debug variants in pyright, tsc, freestanding C99 (+ clang++ by hand), rustc/clippy
  /rustfmt crate checks. Windows, `CC` = LLVM clang: core 526/526, editor 68/68, browser check 356/356. Docs:
  semantics.md "Numbering and trace hooks", format-v1.md Options, a Debugging section in each backend doc.
- 2026-10-11: Timers (Jonas's decisions of 2026-10-10, PoEtato): decisions recorded, "timers" dropped from the open
  questions, design written to `docs/timers.md` (format, design rules, semantics, traces, IR, per-language API, Zephyr
  example, editor, tests, six open points); no code yet, waiting for approval.
- 2026-10-11: Timers built (Jonas approved docs/timers.md as proposed; its text now lives in format-v1.md, semantics.md and
  the backend docs, the file is gone). Format: `timers` on states (`model.ts` `Timer`, TypeBox schema as one closed object with
  `not`/`anyOf` for exactly one of after/every: a union made the reader blame a bad `unit` on after/every), ids `tm<n>`,
  `index.timers`, `timerMs`, `timerLabel`; check rules `timer-name`, `timer-duration`, `timer-same-event` (event refs use
  the existing `dangling-ref`/`wrong-ref` instead of a separate `timer-event`). Semantics: `SemTimer` in the structure,
  `InterpreterHost.timerStart/timerStop`, trace entries `timer-start`/`timer-stop`, pseudo-calls `start:<name>(<ms> ms)` /
  `start:<name>(every <ms> ms)` / `stop:<name>` (`timerStartCall`/`timerStopCall`); flat tables and runner; IR `timers` +
  `timerStart`/`timerStop` statements, `start` begins with a stop of every timer, a terminating microstep stops them once.
  Backends: C enum + `<P>TIMER_COUNT` + `timer_event()` table + `timer_name()` (debugInfo); Python `<Class>Timer`,
  `<module>_timer_event()`, `TIMER_NAMES`; TS `<Class>Timer`, `<class>TimerEvent()`, `TIMER_NAMES`; Rust `Timer` with
  `COUNT`/`event()`/`index()` (+ `name()`/`from_index()`), durations digit-grouped for clippy, long calls broken as rustfmt
  does. Found and fixed: Rust `settle()` for a model with a terminate but no eventless transitions or signals was a `loop`
  that never loops (clippy never_loop) and needlessly fallible (unnecessary_wraps); test_timers was the first such model.
  Tests: `tests/models/test_timers.ufsm` + hand-derived `test_timers.json` (12 steps) replayed by the interpreter and all
  four backends; random models get timers from their own RNG (about 2/3 of them; one in twenty near the uint32 limit);
  drivers log `~start:`/`~stop:` tokens (`driverCall`) and check the expiry event and names; a planted "no stop" bug is
  caught by random runs in 39/60 models, 7/7 timer mutants of the interpreter fail the trace. Editor: action block lines,
  Properties › Timers (name, after/every, count, unit, event picker incl. new event, doc, delete), Edit › Add Timer,
  paste renames clashing timer names `_2`, search kind `timer`, simulator Timers section with Fire (`simFire`), problem
  badges/jump on the owning state. CLI: `run` prints start/stop, `info` counts timers, `list` lists them. Windows, `CC` =
  LLVM clang: core 547/547, editor 70/70, browser check 368/368, typecheck clean.
- 2026-10-11: **Action block rework (E-AB).** Core `v1/action-block.ts`: the block's layout from the state's width on a
  7-unit character cell (entry and exit lists wrapped with continuation lines under the first action, timers packed 16
  apart, one internal transition per line wrapped at spaces), height `10 + 20 × lines` (was `20 + 20 × items`), optional
  `diagram.states[id].actionsHeight` (schema, writer, spec): first whole lines shown, hidden items counted per kind, the
  marker's box (per-kind counts, `+N` when the state is too narrow), one-line summary of counts at the minimum.
  `actionBlockHeight(index, s)` now needs the index. Edits `setActionsHeight`/`resetActionsHeight` (whole lines, not
  stored once every line shows, the first region band takes the difference, stops above its contents). Design rules
  `actions-clipped` and `actions-overlap`; lines hidden by a stored height are not reported. Editor: `icons.ts` (Tabler
  login/logout/hourglass/repeat/bolt/chevrons as Path2D, MIT, credited in README), monospace font sized so a character
  is exactly one cell, marker drawn on the block's bottom line, grip `actions` (bar handle on a selected state, drag,
  double-click = automatic), a click on the marker = automatic and selects, `window.ufsm.actionBlock(id)` and
  `problems()`. The cell is 7 and not 8 so every block of canvas.ufsm and the examples still fits its state (8 clipped
  19 of them); three states of editor.ufsm grew by 10 (Tools, PanPressed, Place) for their wrapped internal
  transitions. Cloud workspace (gcc, Python, pyright, rustc): core 565/565 (18 new in `action-block.test.ts`), editor
  70/70, browser check 386/386 (18 new), typecheck clean. Not run on Windows yet.
- 2026-10-11: Properties › Timers rows read `travel(20 s, eTimeout)` without the `t/` prefix (new `timerText` in
  labels.ts; `timerLabel` keeps the prefix for the CLI and the search). Browser check 386/386 in the cloud workspace.
- 2026-10-11: **Review R1, one validity gate.** `ufsm check` passed models that `ufsm generate` then crashed on (a fork
  without outgoing transitions threw `SemanticsError` through the CLI). New design rules `fork-no-outgoing`, `fork-cycle`,
  `join-incoming` and `initial-target` (leaves its region, loops to itself, or reaches a terminate, which the flattener
  could not lower); the remaining throws in `structure.ts`/`flatten.ts` are assertions (`SemanticsError`), the duplicate
  join-trigger throw is gone. `test/gate.test.ts`: one model per rule (check error, `CodegenError` from every backend,
  `invalid-model` from the interpreter) and 600 mutated random models (rejected, or accepted by every stage). Generated
  code of every repo model and 150 random models byte-identical.
- 2026-10-11: **Review R3, runtime contract.** `core/src/runtime/contract.ts` holds what every executable form shares:
  `MachineHost`, `RunOptions`, `TraceEntry`, `MachineError`/`MachineErrorCode`, `busyError`, `BUSY_MESSAGE` and
  `RunningMachine` (was `TraceMachine` in `interp/trace.ts`). Renamed without aliases (`InterpreterHost`,
  `InterpreterOptions`, `InterpreterError`): nothing outside the repo uses them. No import of `interp/` is left in core
  outside `index.ts`. Tests and golden output unchanged.
- 2026-10-11: **Review R10, vocabulary.** Interpreter `TraceEntry`/`onTrace` -> `StepEvent`/`onStep` ("trace" now means a
  conformance trace or the generated hook); the editor says sheet, not page (`showSheet`, `renderSheet`, `sheetBounds`,
  `doc.sheet`, `parentSheet`, `sheetPath`, `sheetLabel`; the `pageOf*` aliases in nav.ts are gone; menu "Fit Sheet";
  "off-page region" stays, it is the format's term); the action block's `pill` is the hidden marker (`hiddenMarker`,
  `HiddenMarker`, `HIDDEN_MARKER_*`, `hiddenMarkerAt`, `window.ufsm.actionBlock(id).hiddenMarkerScreen`). Also fixed the
  browser check's timer row selector, broken since the `t/` prefix left Properties. Browser check 386/386 on Windows.
- 2026-10-11: **Review R4, shared backend layer.** The lowering drops functions the runtime loop cannot reach and the
  signal steps of a model that never emits (`ufsm ir` lists fewer functions; generated code unchanged): the reachability
  each printer computed is now a decision of the lowering. `ir/analyze.ts` (`walkStmts`, `someStmt`, `emitsSignals`,
  `analyzeIr`: queue, terminate, timers, `checkSteps`/`countSteps`, fallible functions) replaces four copies.
  `backends/common.ts`: `CodegenError`, `OUTPUT_NOTICE`, `identifier` (was `cIdentifier`), `pascalCase` (was
  `pythonClassName`), `CommonOptions` (the four `*Options` extend it), `resolveOptions` (generate.ts resolves the common
  options once), `readTargetOptions` (the four `*OptionsFromTargets` are one line each; `*_TARGET_KEYS`), `prepare` (trace
  and queue checks + analysis), `lines()`. Each printer is a context function plus named parts (`cContext`,
  `cExpressions`, `cStatements`, `cHeader`, `cSourceTop`, `cFunctions`, `cSettle`, `cEntryPoints`, `cDebugInfo`; `py*`,
  `ts*`, `rs*` likewise); backends no longer import each other. Generated code byte-identical: every repo model and 150
  random models x 4 targets x (default, debugInfo+trace, queue 0, queue 3 + 5 microsteps), before and after each step.
- 2026-10-11: **Review R6 + R5, core folders and entry points.** `v1/` is gone: `format/` (model, schema, parse,
  serialize, options, ids, migrate, load, errors), `model/` (doc-index, labels), `diagram/` (geometry, route,
  action-block, sheet; the one `segmentDistance`, the editor's copy is gone), `edit/` (layout = old edit.ts, now also
  setOffPage/cannotOffPage/setBarOrientation from props.ts; create, clipboard, props), `check/` (semantic.ts: every
  error; diagram.ts: layout warnings; index.ts: `checkV1` = both; the interpreter and `modelIr` use `checkSemantics`),
  `verify/` (flat-run, ir-run = old ir/eval.ts), `ir/simplify.ts` out of lower.ts. One commit per folder with
  `git mv`. Entry points in packages/core/package.json: `@ufsm/core`, `/diagram`, `/edit`, `/pipeline`; the editor's
  70-name import is three imports, the CLI takes `flatten`/`lowerToIr`/`printIr`/`hex32` from `/pipeline`, tests import
  oracles by path. The browser check resolves the subpaths from package.json (an esbuild plugin instead of an alias).
  Tests 566/566 + 70/70, browser check 386/386, golden output unchanged.
- 2026-10-11: **Review R12, one backend contract suite.** `test/backend-contract.ts`: `describeBackend(spec)` runs the
  conformance traces, the differential passes (joins, expression model, repo models plus the keyword model, random
  models, debugInfo + trace, small queue), the hand-built IR shapes and the tail-return module, and contract checks on
  generated files (deterministic, timer API only with timers, `targets.<name>` API options read and behaviour options /
  wrong types / unknown keys reported, CodegenError for queue 0 and model errors). The drift is gone: C now runs the IR
  shapes, every backend the keyword model and the tail return. `harness.recordScript` records in-process runs (TS) as the
  drivers do. Backend test files: 1,312 -> 794 lines. C skipped on this machine (no compiler); Python, TS, Rust pass.
- 2026-10-11: **Review R7, label layout in core.** `diagram/label-layout.ts`: `transitionLabelItems` (bracket and comma
  rules), `layoutTransitionLabel(index, t, at, measure)`, `transitionLabelBox`, constants `LABEL_FIRST_LINE` (40),
  `LABEL_TOP` (26), `LABEL_LINE_H`, `LABEL_GAP`, `LABEL_FONT_SIZE`, and `estimateLabelWidth` (7 per character) for callers
  without a canvas. The injected-measure variant: the editor draws exactly as before (its canvas measures), the `+ 40`
  in the layout edits and the `+ 30` in `locate` are the named constants. The sheet fit check now includes labels:
  one finding in the repo models (test_external_transitions t6, past the right edge; listed as known in sheet.test).
  Browser check 386/386, tests 581.
- 2026-10-11: **Review R8, main.ts split.** main.ts 2,306 -> 80 lines. `workspace.ts` (the one store, no DOM; typed
  changes `document`/`selection`/`view`/`sim`/`chrome`/`shell`/`active` replace the 69 manual refresh calls: the shell's
  `update` decides what to redraw, the canvas draws on the next frame), `session.ts` (DocSession: today's Doc fields plus
  edit/undo/redo/begin/preview/commit/cancel/refresh and the simulator queries; the global `view` alias is gone),
  `shell.ts`, `commands.ts` (one table: menus, command palette and key actions; ids are the editor model's action
  names), `canvas/{view,state,keys,pointer,tools}.ts`, `files.ts`, `navigation.ts`, `edit-commands.ts`,
  `settings-controller.ts`, `sim-controller.ts`, `search-items.ts`, `automation.ts`, `app.ts`. Hit testing moved from
  render.ts to `hit.ts` (no DOM; label widths from a measure). panel.tsx 1,312 lines -> `panel/` (index, types, fields,
  properties, project, problems). New `test/workspace.test.ts` (workspace, sessions, hit testing in node:test).
  `turnBar`/`toggleOffPage` became commands (in no menu). Browser check 386/386, editor tests 79.
