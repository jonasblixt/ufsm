# Rework: C/GTK + Python → TypeScript + Tauri

Living document for the rewrite on branch `ts-rewrite`. Sections 1–5 record
what was found and decided; section 6 is the progress log; section 7 is the
task list. Update 6 and 7 whenever work lands.

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

## 2. Bugs found in the old generator (verified 2026-10-08)

All 14 old C tests pass; these were found with extra models and by running
the generated code. Status refers to the new implementation.

| # | Bug | Evidence | Status |
|---|-----|----------|--------|
| B1 | **No transition priority/conflict resolution.** Parent and child handling the same event both fire; two transitions from one state on the same event both fire. All transitions are evaluated against `csv` and nothing marks a region as consumed. | Model P{C}, P –e1→ X, C –e1→ Y: sending e1 printed `xC xP eX xC xP eY`. | Fixed in the interpreter (S3); `tests/models/test_priority*.ufsm` + traces; flat tables, IR and C backend follow (differential tests). |
| B2 | **Signal queue never drained.** `sq_count` only reset in `_init()`; old signals replay on every later event. | `test_chained_signals`: after the first e1, every further e1 replays `xC eD xD eC`. | Fixed in the interpreter (S5); trace step + unit test; IR and C backend follow. |
| B3 | **Off-by-one queue overflow**: `if (sq_count > N)` should be `>=`; writes `sq[N]`. | `c_generator.py` `_emit_sq_push`. | Fixed in the C backend (ring buffer, full at exactly N); unit test + small-queue differential runs. |
| B4 | **`m->user` only set when `--sq_length > 0`**; actions get a garbage pointer otherwise. | `_gen_process_func`. | Fixed: `init` always stores it; the C test driver checks the pointer in every action and guard. |
| B5 | **Exit-action parser bug**: exit loop reads `entry_data`/`action_kind` from the entry loop → wrong ids, or `UnboundLocalError` when a state with exits but no entries comes first. | Reordered model crashed the generator. | Fixed by design: new v0 reader/migrator parses exits independently. |
| B6 | `_sc_expr_helper` concatenates csv and wsv conditions without `&&` → `(a)(b)` in C when a rule has both (completion events + orthogonal finals). | Code reading. | Fixed by design: conditions are IR expressions printed with precedence; `expressionModel` in `test/harness.ts` covers an or inside an and. |
| B7 | Deep history and terminate are drawable and parsed but silently ignored by the flattener. | `grep DeepHistory flattener.py` → nothing. | Fixed in the interpreter (S6), flattener (S7), IR and C backend. |
| B8 | `_build_join` passes a single `State` where a list is expected (`explicit_target_states`); only works when the join target has no regions. | Code reading. | Fixed in the interpreter (S4, unit test), flattener (S7), IR and C backend. |
| B9 | Transitions with a trigger but no `trigger-kind` (19 in the legacy models, 13 in dhcpclient) are treated as trigger-less by the Python parser. | Model census. | Fixed: migrator resolves them by id and reports each. |
| B10 | Generated C: events are bare `#define`s without prefix (name clashes); 152 `-Wunused-parameter` warnings. | gcc -Wall -Wextra on generated tests. | Fixed: prefixed enums and functions, clash check; generated files compile with gcc/clang `-Wall -Wextra -Wpedantic -Wconversion -Werror` (also as C++). |
| B11 | Names never validated: trigger `completion-event` yields invalid C; action `canvas_focus_selection` declared twice. | Model census. | Fixed: v1 check rejects; migrator renames/merges with notes. |
| B12 | **Completion ignores regions without a final state**: `find_orth_finals` only looks for finals directly in sibling regions, so a composite completes while a region without its own final state is still busy. | `test_nested_finals`: e1 alone left A (`xA11 xA121 xA12 xA eEnd`). | Fixed in the interpreter: every region must rest in a final state; trace documents the old result. |

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

## 4. Strategy (proposed 2026-10-08, accepted)

```
 .ufsm (v1)  ──►  core: parse/migrate → check (DRC) → flatten → IR
                       │                                  │
                       ├─ reference interpreter ◄─────────┤  (simulator + test oracle)
                       │                                  ▼
                       │        backends = IR printers: C │ Python │ TS/JS │ (Rust, C#, Go…)
                       ▼
                 editor (canvas, undo, DRC panel, live code preview, simulator)
```

1. **One TypeScript core** shared by editor, CLI and tests. Platform neutral.
2. **Semantics decided once** in a lowering from the flat model to a small
   imperative **IR** (`if cond`, `call action`, `guard compare`, `push signal`,
   `set region state`, `mark auto`), so each backend is a ~200–300 line
   printer.
3. **Correct priority cheaply**: order transitions innermost-first, compute a
   static `conflict_mask[t]` from exit scopes, and track a per-step `fired`
   bitmask: fire only if `(fired & conflict_mask[t]) == 0`. Reference
   semantics: W3C SCXML algorithm (optimal enabled transition set).
4. **Reference interpreter** in core, used by the editor's simulator and as a
   test oracle.
5. **Language-neutral conformance tests**: traces as data
   (`send: event` → `expect: [actions…]`), replayed by a small runner per
   backend; plus **differential fuzzing** (random event sequences, compare
   action traces of interpreter vs generated C/Python/TS).
6. **Backend binding styles**: C — prefixed enums, static dispatch,
   `void *user`, no unused-parameter warnings; Python — generated base class
   or delegate; TS/JS — `interface Actions` + class, ESM with `.d.ts`.
7. **Editor**: Tauri shell (small installers, native webview), TS frontend,
   Canvas 2D ported from `render.c`; undo via immutable document + patches;
   simulation by running the interpreter / generated JS.
8. CLI distributed later as a single binary (`bun build --compile` or
   `deno compile`), optional thin pip wrapper.

## 5. Decisions log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-08 | TypeScript core + Tauri 2 shell (alternatives considered: PySide6/Qt, C++/Qt, Rust egui/iced/Slint, Electron) | One language for core, CLI, editor; run generated JS for simulation; Canvas2D ≈ Cairo; small installers |
| 2026-10-08 | npm workspaces, packages consumed as TS source; `node:test` + `tsx`; no UI framework yet | Fewest moving parts; verifiable offline |
| 2026-10-08 | Old code moved to `old/` (kept for reference) | Clean root for the rewrite |
| 2026-10-08 | Region display order = reverse of v0 file order (`regionsTopDown`) | Matches GTK editor's stack-based load/save |
| 2026-10-08 | v1 format: references by **id**, **relative** coordinates, layout in the **same file** (`diagram` section) | Jonas's choice; ids survive renames, relative coords give small diffs |
| 2026-10-08 | v1 details: string enums, `on`/`auto`/`completion` triggers, guards as ANDed term list, actions `{call}`/`{emit}`, strict reader (unknown keys rejected, flags `true` or absent), canonical writer (100 cols) | Readable diffs, one way to say each thing |
| 2026-10-08 | Declaration names must be C identifiers and unique across events/signals/actions/guards; state names are free text | Shared generated namespace; display names may contain spaces/% |
| 2026-10-08 | Editor writes only v1; opening v0 converts in memory and the first save asks for a location (never silently overwrites v0) | Start using v1 immediately without losing originals |
| 2026-10-08 | Legacy models converted into `examples/` and `tests/models/`; a test keeps them equal to the converter output | v1 files are the working set from now on |
| 2026-10-09 | Run-time semantics written down in `docs/semantics.md` (normative), SCXML-based: microstep = all selected transitions (exits, then actions, then entries); one transition per leaf, innermost first, conflicts by exit-set overlap; all transitions external | One precise definition every backend is tested against |
| 2026-10-09 | Entry in document order, exit in exact reverse (each region left completely, lowest region first); initial-transition actions run when their region is reached | Mirror-symmetric and easy to precompute; replaces v0.5's depth-sorted exit (children still always exit before parents; only the order between orthogonal regions differs). Changes 4 old trace steps (documented in the trace files). Confirmed by Jonas |
| 2026-10-09 | `auto` and `completion` are evaluated in the settle phase after every microstep and after every event (even one that fired nothing); queued signals run after eventless transitions, FIFO, drained per call | SCXML eventless semantics; v0.5 only checked autos right after entering a state |
| 2026-10-09 | Completion is a condition (all regions in a final state; simple states are always complete), not a one-shot completion event | Static, flattens to a guard; UML's consumed-once completion event would need extra state |
| 2026-10-09 | Shallow/deep history do not record a region resting in its final state; `reset()` clears history and the queue without exit actions; terminate clears everything without exit actions | UML-like; simple to generate |
| 2026-10-09 | Conformance traces are JSON (`tests/traces/*.json`) keyed by names (events, guards, actions, states); runner in core, `ufsm trace` on the CLI | No YAML dependency in core; names are what generated code exposes |
| 2026-10-09 | Selection redefined so it can be precomputed: active states visited in post-order, each offers its first enabled transition, an offer is taken unless its domain is comparable with an already taken one. A join is offered by its last source and only if it is the first enabled transition of every source | Static order + per-transition region mask instead of SCXML's per-leaf walk; identical to SCXML without joins (3000 random machines, 0 differences); SCXML's rule cannot be precomputed for joins |
| 2026-10-09 | A transition to terminate enters nothing (no ancestors of the terminate vertex); a history region left in its final state forgets its record | Found while flattening: the interpreter entered ancestors of the terminate vertex, and kept a stale record |
| 2026-10-09 | Flat model: cfg[region] = slot (1-based), shallow history = slot per region, deep history = cfg snapshot of the region's subtree; per trigger an offer list in post-order; per transition domain, `blocks` region list, entry program (`RegionOp`/`EntryOp`) | Integer arrays only, what the C backend will hold; JSON-dumpable (`ufsm flatten --json`) |
| 2026-10-09 | IR = structured statements (if/switch/set/call/emit/invoke/flags/history/microstep/terminate) over integer cfg/hist/deep arrays, plus a fixed runtime loop (reset/process/settle) each backend writes once. Selection lowered to if/else-if chains with one local flag per transition; conflicts resolved at generation time, skipping pairs whose sources can never be active together. No recursion between IR functions | Backends become printers with no semantic decisions; straight-line code with no tables suits small static C |
| 2026-10-09 | Editor mouse: left = select (click, rectangle), right/middle drag = pan; rectangle direction picks enclosed vs touching (CAD convention; colours from the old editor) | Jonas's request; left drag will also move selected items once editing lands |
| 2026-10-09 | New design rule checks: `join-trigger` (error: trigger on a transition into a join), `shadowed` (warning: later transition with the same trigger as an earlier unguarded one out of the same state), `no-trigger` now also for join outgoing transitions | Make the priority rules visible while modelling |
| 2026-10-09 | C API: every public name = prefix (`targets.c.prefix`, default model name + `_`) + fixed name or declaration name; event enum constants use the upper-case prefix and keep the event's spelling (`DIMMER_eButton`); actions/guards are `void <p>name(void *user)` / `int <p>name(void *user)`; `<p>init(m, user)`, `<p>reset(m)`, `<p>process(m, event)` return `<P>OK` or a negative `<P>ERR_*`. Clashing names (incl. C keywords with an empty prefix) are a generator error | Declaration names are unique, so prefix + name never clashes between them; canvas.ufsm has names that differ only in case, so no case folding. One prefix lets several machines share a program |
| 2026-10-09 | C runtime: errors propagate as return codes (every function that can emit or count a microstep returns one), queue = ring buffer with exact capacity (default 16), livelock limit default 10000 (as in the interpreter; 0 = no check), integer widths sized to the model, only used parts emitted (queue, history, terminated flag, signal steps). No heap, recursion, function pointers or libc beyond `stdint.h`/`stdbool.h` | Embedded targets; an error stops the call at once, like the interpreter's exceptions |
| 2026-10-09 | IR: exit and history recording are emitted once per transition domain (`if (take_a or take_b) exit_rN()`), since transitions with the same domain block each other; the eventless step function is named `eventless` (was `step_eventless`, which clashed with an event called `eventless`) | Smaller code for every backend; no name clash |
| 2026-10-09 | Trace format: step key `inactive` (states that must not be active) and `options.maxMicrosteps` (livelock limit) next to `signalQueue`; options are non-negative integers | Terminate, final and exit checks need negative assertions; a livelock trace stays short |
| 2026-10-09 | Trace expectations are derived from `docs/semantics.md` by hand, never copied from the interpreter's output; the suite is checked by planting bugs in a copy of the interpreter (each must fail a trace) | Traces are the conformance spec for every backend; differential runs only compare backends with the interpreter |
| 2026-10-09 | semantics.md now states where a join sits in a source's transition list: at the position of that source's transition into the join (what `structure.ts` already did) | `test_join_agreement` depends on it |
| 2026-10-09 | Python backend: one typed module per model for CPython 3.8+ that imports only `enum` and `typing` and passes `pyright --strict`; `<Class>Error` (with the interpreter's error `code`), `<Class>Event` (IntEnum), `<Class>Handler` (Protocol: one method per action, `-> None`, and per guard, `-> int`), `<Class>(handler)` calling them; the constructor runs nothing, `reset()` starts, `process(event: <Class>Event)` before it raises `not-started`; step dispatch through tuples of bound methods built in `__init__`; defaults equal C's (queue 16, livelock 10000); options in `targets.python` (`className`, `module`, `signalQueue`, `maxMicrosteps`) | Jonas: generated Python must be typed (first version was untyped, import-free for MicroPython; dropped). A Protocol lets a type checker reject an incomplete handler where the machine is built, without inheritance; an explicit start lets the handler hold the machine before entry actions run; equal defaults keep both targets' behaviour identical |
| 2026-10-09 | Python names: a declaration that is a Python keyword gets a trailing underscore (PEP 8, `not` -> `not_`); names starting with `__` and names equal after that mapping are generator errors | test_guard_terms has an event `not`; the conformance suite must run on every backend |
| 2026-10-09 | IR simplifier carries slot facts from enclosing ifs and switch cases (`if cfg[2] == 2: if cfg[2] != 1 and ...` drops the inner test); facts are dropped at a `set` on the region or any `invoke` | pyright --strict reports such tests as always true (test_in_guards); smaller code for every backend |
| 2026-10-09 | TypeScript backend: one module per model that imports nothing and uses only erasable syntax (const object + union type for events instead of `enum`, `private` fields, no parameter properties); `<Class>Error`/`<Class>ErrorCode`, `<Class>Event`, `<Class>Handler` (interface; guards return `number \| boolean`, compare terms use `Number()` so booleans compare as 1/0), `<Class>(handler)`; same lifecycle, errors and defaults as Python; options in `targets.ts`; JavaScript keywords are fine as names (they are only property names), names every object has (`constructor`, `toString`, ...) are errors. No separate JS output: stripping the types gives it | Runs under Node's type stripping, Deno, Bun and every bundler without a build step; the editor can import it directly |
| 2026-10-09 | Editor: dogfood uFSM. The editor's interaction logic (tools, drag, selection, transition drawing) becomes a uFSM model generated with the TypeScript backend, as the old editor did with canvas.ufsm | Jonas; exercises the TS backend and the simulator on a real model |
| 2026-10-09 | Transition routing: the file stores intent, a pure function in core derives the geometry, so transitions follow when states move. Route styles in `diagram.transitions[id]`: `"s"` (default for new transitions): orthogonal step leaving one side, one jog, entering the other, with automatic L (perpendicular sides) and U (same side) variants; ends pick their sides automatically until the user pins one; the jog position is stored as an absolute coordinate (relative to the transition's region, like `via`). `"free"`: today's bend points (converted v0 files stay free so they look as before; bend points are mapped when one end moves); a "convert to S" command. Later `"auto"`: obstacle-avoiding routing with libavoid (libavoid-js, LGPL-2.1+, shipped as a separate `libavoid.wasm`) | Jonas: S as default, absolute jog, LGPL acceptable for the auto router |
| 2026-10-09 | Licence: GPL-3.0-or-later for all of uFSM (editor, CLI, @ufsm/core) with the uFSM output exception (LICENSE-EXCEPTION, modelled on Bison's): generated code, including the template code the generators copy into it, may be used under any terms; models stay the user's. SPDX header + copyright line in every source file; generated files carry `OUTPUT_NOTICE` and no GPL header; old/ keeps BSD-3 in old/LICENSE (it has contributions by Jaremy Creechley and vkensou). LICENSE is the verbatim FSF text (sha256 3972dc97…6986) | Jonas chose option 2 of: stay BSD / GPL everywhere / LGPL core + GPL tools. GPL-3 rather than GPL-2: compatible with Apache-2.0; "or later" keeps options open. libavoid (LGPL-2.1+) is compatible |
| 2026-10-09 | Editor stack: Preact for panels and dialogs (canvas stays vanilla TS); Immer patches for undo/redo; the generated editor state machine is committed (with a freshness test); grid of 10 units, always on; the old editor's key map is kept (`a`/`e`/`z`/`j` + key, plain `o`/`s`/`S`/`n`/`t`, Ctrl+`a`/`z`/`r`/`c`/`x`/`v`), so the sidebar moves from `t` to `n` and fit from `f` to `z f` | Jonas |
| 2026-10-09 | Internal transitions (UML; visualSTATE: static reactions): a state's `internal` list of `{id, on, guard?, do?, doc?}` (ids share the `t…` space; `on` an event or signal, no `auto`/`completion`, which would fire forever). They never leave the state: no exit, entry or history recording, regions keep their configuration. Selection and conflicts as for a transition from the state to itself (domain = the state's region): a substate's transition beats it, it beats its ancestors' transitions, orthogonal regions fire alongside; a state's outgoing transitions are tried before its internal ones (DRC `shadowed` covers both). No diagram layout: drawn as `event [guard] / actions` lines in the action block after entry and exit (block height counts them) | Jonas: self-transitions as text in the state, like entry/exit, and internal so the state is never left |
| 2026-10-09 | S route format: `{"route":"s", from?, to?, jog?: {x} \| {y}, label?}`; `via` is an error on S and `jog` on free routes; `route` is written only when `"s"` (absent = free, so converted files are unchanged). Unpinned ends pick the side pair facing across the largest gap (overlapping boxes: right to right) and are spread evenly along a side, ordered by the other end so they don't cross; parallel edges between the same pair are staggered 14 units; a stored jog is used only on the axis it was set for; the label is stored relative to a route anchor (first horizontal segment of 40+ units, else the longest horizontal, else the middle segment), so it moves with the route; a self-transition with auto ends loops around the state's top-right corner. Geometry is a pure function of the document (`sRoute`, `routeInfo`, `edgeGeometry`); nothing derived is stored | Moving a state must never rewrite other transitions' data; deterministic for tests; editing (E3) only pins ends, sets the jog or moves the label |
| 2026-10-09 | E3 interaction: a left press decides at once what a drag would do (a "grip", guard `pressedOnGrip`): a handle of the selection (8 resize handles and the region separators of a single selected vertex; transition ends, the S jog, free bend points of selected transitions), a transition label, or a vertex; a composite state is grabbed by its header and action block only, unless it is selected, so a rubber band can still start inside it; with Shift only handles grab. One new state `Dragging` (entered from `Pressed` past the threshold, before the rubber band transition); Esc or pointer loss cancels and keeps the selection; Ctrl+Z / Ctrl+R (old key map) undo and redo, not while dragging. A click on a transition line or label now selects it; a click on a handle keeps the selection; double-click on a pinned S end, the jog or an S label makes it automatic again | Jonas's plan for E3 (move, resize, handles); the press-time decision keeps the model small (one state, one guard) and the drag kind in one place (`handles.ts`) |
| 2026-10-09 | E3 edits are core functions (`v1/edit.ts`) that change only `diagram`, run on an Immer draft; a drag previews by re-running from the document at its start and commits one undo step; the document is dirty when the history version differs from the saved one. Grid 10: the pressed vertex's top-left, dragged edges, separators, end offsets, jogs, bend points and labels snap. Limits: a vertex stays in its region band (on a sheet: non-negative coordinates), a state keeps its contents and at least 40×40 (and its header and lines), a band at least 40, a fork/join bar at least 20 along its axis; a limit never pushes an element that already breaks it. Top edge: the first band takes the change; bottom edge: the last band (if it has a height); contents and transition ends keep their absolute positions. Free routes follow (`followPolyline`; labels by the blend at their nearest point, `followOffset`); an S jog shifts only when both ends move by the same amount, else keeps its absolute position | Platform-neutral and unit-testable; matches "moving a state never rewrites other transitions' data" for S routes; one undo step per gesture |
| 2026-10-09 | Parallel S routes get a lane per route (0, 14, 28, …) for shapes whose jog goes around the ends (U, detours, perpendicular not-ahead), next to the centred stagger for jogs between the ends; `sRoute(…, stagger, lane)` | `abs(stagger)` made the outer routes of 2 or 3 parallel U routes coincide (found laying out the editor model's returns) |
| 2026-10-09 | App icon: one orange ribbon (gruvbox `#fe8019`) folded into a lightning bolt that ends in a sharp arrowhead pointing up (a transition that folds onto itself); the fold faces are darker orange (`#d65d0e`); no background tile (transparent). Source `apps/editor/src-tauri/icons/icon.svg` | Jonas: the old pale tile with thin lines and text became a white/yellow blob in the Windows taskbar; one bold shape stays readable at 16–24 px on dark and light taskbars |
| 2026-10-09 | Editor window after VS Code: frameless window with a custom title bar on Windows/Linux (app icon, menu bar File/Edit/View/Go/Help, a centred search field, minimize/maximize/close; empty parts are `data-tauri-drag-region`), macOS keeps its traffic lights (`tauri.macos.conf.json`: title bar style Overlay, hidden title). Below: explorer (tool palette above, one section per open machine with its tree) \| tab strip + breadcrumbs + canvas \| right panel with tabs Properties and Project \| status bar (status text, problems, zoom). Every open machine is a tab with its own document, undo history, page, selection and view; closing an unsaved one (tab, window) asks first. Keys: `p` toggles the right panel (the old editor's project-settings key; Ctrl+P kept free for the search field), `n` the explorer, Ctrl+Tab / Ctrl+Shift+Tab switch machines (only while no button is held). Properties follows the selection (read-only until E5; add buttons for entry, exit, internal transitions, regions, guards, actions are placeholders); Project shows the active file's settings (name, format, declarations, code generator options with defaults) until a project format exists. Side panels resize with sashes (widths remembered per profile). The explorer, the editor (tabs + canvas) and the panel are rounded cards (8 px radius, 1 px edge) floating on a darker window background (`--chrome` #141617, shared with title and status bar) with 6 px gaps that are the sashes, as in current VS Code | Jonas: layout inspired by VS Code, several machines open at once, Properties to configure states/transitions, Project for global settings; custom title bar, `p`, "project" a placeholder for now |
| 2026-10-09 | E4 interaction: a third region `Tool` in editor.ufsm (Select / Armed {Place, Connect}) holds the armed tool and is switched by signals `sPlace`, `sConnect`, `sSelect`; the old `a` + key map is a Keys state `Add` whose keys are internal transitions emitting the tool signal and `sDone` (as the old editor's `sToolDone`); palette clicks are `ePalette` internals of Pointer `Idle` (so they act only while no gesture is in progress). Tools are one-shot (placing or connecting disarms), Esc disarms, a refused action says why in the status line and keeps the tool. Pointer gets `Sizing` (press places, drag sizes a state or bar, release commits one undo step) and `Linking` (click source then target, or drag between them; clicks on empty canvas add bend points, Shift-click forces one, Backspace removes the last). Keys: `a s/t/r/i/f/h/H/F/j/T/v`, `r` turns a fork/join tool, Delete, Ctrl+C/X/V; Backspace (up one level) and Delete/copy/paste only while the pointer is idle; Tools' Esc (clear selection) only with the select tool | Dogfoods signals; one place (the Tool region) decides which tool is armed for keys, palette and menu; the old editor's key map and its one-shot tools |
| 2026-10-09 | Structure edits in core (`v1/ids.ts`, `v1/create.ts`, `v1/clipboard.ts`), run on Immer drafts like the layout edits. Ids: per prefix, one above the highest in use (not the first gap). New vertices: states "StateN" (first free number in the document), 160×80 on a click; round pseudo states 20×20; fork/join bars 10×100 (vertical unless turned); kept inside the region band under the press. One initializer (initial/history) per region, refused otherwise; transitions refused out of final/terminate and out of an initializer that already has one; transitions into initial and history states are allowed (semantics.md). New transitions have no trigger and an S route with automatic ends, or a free route when bend points were clicked. A new region goes at the bottom: the state grows by 100 (a first region gets at least 100 below the header), the previous last region keeps its height; the growth is not limited by the state's own band. Delete cascades: a vertex takes its regions and contents, transitions into or out of anything deleted go, `in`/`not in` guard terms on deleted states are dropped (an empty guard is removed), layouts are removed, declarations stay; deleting a region keeps the state's size, the regions below move up with their contents and the last one fills | Platform-neutral and unit-tested like edit.ts; the design rule check still reports the rest (no trigger, no initial) |
| 2026-10-09 | Copy/paste through an in-app clipboard holding a fragment: the copied vertices with their subtrees, the transitions whose both ends are copied, the declarations used, layouts with top-level positions relative to the fragment's corner (so are bend points, free labels and jogs of transitions whose common region is outside the fragment). Paste: fresh ids everywhere, declarations matched by kind and name (added when missing, renamed `name_2` on a clash with another kind), `in` terms on states outside the fragment kept only when pasting into the machine it came from, top-left corner at the pointer (else the middle of the view) in the region under it, the pasted items selected. Names are kept (a paste beside the original gives a duplicate-name warning). Cut = copy + delete, one undo step | Pasting between open machines works; the system clipboard is left for later |
| 2026-10-09 | Bend points: `a v` (Add › Bend Point) inserts one at the pointer into the selected transition's nearest segment, turning an S route into a free route with the same shape first; double-click on a bend point removes it; Add › Convert to S Route (the E3 follow-up) gives free routes automatic S routing | The old `a v`; S routes have no bend points of their own |
| 2026-10-09 | E5: properties are edited in the right panel, not in dialogs. Properties edits the selection (state: name, entry, exit, internal transitions with their trigger/guard/actions/doc, regions with name, off-page and delete, documentation; pseudo state: optional name, fork/join orientation; transition: trigger, guard terms, actions, documentation; no trigger or guard offered where the design rules forbid them). Lists have + Add (a picker), ↑ ↓ and ×; pickers filter as you type and offer to declare the typed name (`^name` = a signal to emit), declaring and using it in one undo step. Guard terms are a guard function (true, false, or compared with a whole number) or a state (active, not active). Project edits the machine name and description, the declarations (rename with a check: identifier, unique across all four kinds; every use follows because uses are ids; delete removes the uses: calls, emits and guard terms go, transitions lose that trigger, internal transitions on it are deleted) and the code generator options (empty = default, numbers checked). Problems is a third tab listing the check live (errors first), with a count badge; a click goes to the element (a declaration: Project, scrolled to it); the status bar count opens it; canvas badges (red/yellow) mark the elements with findings. Keys: `e n` name, `e t` trigger, `e r` turn fork/join, `e O` region under the pointer off-page or back (refused while transitions cross its border; contents keep their place relative to the band); `a e`/`a x`/`a g`/`a a` add entry/exit/guard/action (the old editor's keys): they open the panel's field or picker. Text fields commit on Enter or blur, revert on Esc, then give the keys back to the canvas | One place to see and change everything about an element, VS Code style; no modal dialogs; the old editor's key maps |
| 2026-10-09 | Mapped editor keys never do their browser default (preventDefault for every key the interaction model gets) | `a g` moves the focus into the guard picker during the keydown, and the `g` was then typed into it |
| 2026-10-09 | E6 simulator: a Simulator tab in the right panel runs the reference interpreter on a snapshot of the active machine (`apps/editor/src/sim.ts`, no DOM). F5 starts or restarts, Shift+F5 stops (Tools internals in editor.ufsm; Run menu). Editing stays allowed: the simulation goes out of date (no highlight, events off, "restart" banner, yellow status) as soon as the machine or the declarations are not the objects it started from (Immer shares untouched parts, so layout edits keep it running). Events are buttons, marked when `Interpreter.wouldTake` finds a transition for them now; hovering one draws those transitions dashed aqua. Guard values are kept per machine by name across runs (checkbox 0/1 plus a number). Canvas: active states get a green outline, the innermost ones a green fill, the last step's transitions (fork/join legs included) are green. Options: signal queue 16 and livelock limit 10000 (the generated code's defaults, both at least 1) | Watch the machine run on the diagram while it is being drawn; one engine (the interpreter every backend is tested against), so what the simulator shows is what generated code does; out of date rather than silently restarting keeps the log readable |
| 2026-10-09 | Recorded traces: every simulator step is a trace step: `reset`/`send`, the guards that changed since the previous step, `expect` (or `error` when it failed), and `active` = the innermost active states (name when unique, else id; left out after an error, when the machine is undefined; optional). `options.signalQueue` is written when the queue differs from 16 or overflowed, `maxMicrosteps` when it differs from 10000. The model path is relative to the trace file in the desktop app, the bare file name in a browser. `formatTrace` in core writes the layout of tests/traces (one step per line up to 120 columns) | A session in the editor becomes a regression test for `ufsm trace` and every backend without hand-writing JSON; recorded expectations document behaviour, they do not replace hand-derived conformance traces (semantics.md says so) |
| 2026-10-09 | E6 code preview: a Code tab shows C header, C source, Python or TypeScript as `ufsm generate` writes them, with the Project tab's options, live; regenerated only when the machine, declarations, name or targets object changes (cache keyed on the machine object), so drags cost nothing. A small regex highlighter (comments, strings, numbers, keywords, preprocessor) builds HTML once per text. Copy, Save… (one file), Save both… (C), and File › Generate C/Python/TypeScript Code… writes a target's files into a folder. `generateFiles(doc, target, overrides)` in core is the one entry point (the CLI uses it too) | Shows at once what a model change does to the code, without a terminal |
| 2026-10-09 | The right panel's tab strip (Properties, Project, Problems, Simulator, Code) scrolls sideways when the panel is narrow (wheel too); the active tab is kept in view | Five tabs do not fit the default 300 px |
| 2026-10-09 | File › New (Ctrl+N; New in the empty explorer): an empty machine in a new tab (`newDocument(name)` in core: no declarations, root region `r0` without states, A4; valid, clean, generates code), named `untitled` (`untitled2`, ... while those file names are open), clean until edited, so closing it untouched does not ask. Its first save asks where (no path yet) and renames the machine to the file's base name if it still has its placeholder name (one ordinary undo step, saved with the file); a machine renamed in the Project tab keeps its name. Key: Tools internal `eKey_n [ctrl, in Idle] / newModel`, and the sidebar toggle became `eKey_n [not ctrl]` (Ctrl+N used to toggle the sidebar too; mid-drag Ctrl+N now does nothing instead of switching tabs under an interactive edit) | Start a model without a file; generated code is named after the machine, so `untitled.c` after saving `blinker.ufsm` would be a trap |
| 2026-10-09 | Color themes in the W3C Design Tokens Community Group format 2025.10 (stable since 2025-10-28; Format, Color and Resolver modules), no build step: `apps/editor/src/tokens.ts` reads them at run time. A theme is a resolver (`themes/<name>/<name>.resolver.json`): a base set (`themes/ui.tokens.json`, the editor's token names, plus the theme's absolute palette) and modifiers; a modifier named `appearance` with contexts `dark`/`light` follows the OS when the setting is "system", every other modifier is offered as an option. `ui.tokens.json` maps palette roles (bg0, bgDeep, bgGrid, bg1, bg2, fg1, fg4, gray, the seven accents, chrome, edge, shadow) to `ui.*` (CSS custom properties, `--name` and `--name-rgb`), `syntax.*` (`--syntax-*`) and `canvas.*` (the renderer's `C`); a theme may override any of them. Sources are deep-merged (groups and their `$type` merge, tokens replace), then aliases resolve. Alpha on an alias is not expressible in DTCG, so the code applies fixed opacities (rubber band 8%, simulator fill 13%, scrollbars, flash) via `--name-rgb` / `canvasAlpha` | Jonas asked for a standard; DTCG is the one design tools (Figma variables, Tokens Studio, Style Dictionary, Terrazzo) exchange; the resolver module expresses gruvbox's dark/light × contrast without six copied files, and other DTCG tools can read the same files |
| 2026-10-09 | Gruvbox (morhetz/gruvbox, MIT/X11; palette copied exactly from colors/gruvbox.vim, checked by a test) is the only bundled theme: appearance dark/light (bright accents and light foregrounds, or faded accents and dark foregrounds, as gruvbox.vim) × contrast hard/medium/soft (bg0 = dark0_hard/dark0/dark0_soft or light0_hard/light0/light0_soft). ufsm's extra roles: the sheet's surround and fields (`bgDeep`) are darker than bg0 in both appearances (dark: one step down the dark0 ladder, `#141617` for hard; light: light1, paper on a desk), grid dots one step from bg0, window chrome `#141617` (dark) / light1 (light), card edges bg1 (dark) / bg2 (light), menu shadow black 45% / dark0 20%. Dark medium reproduces the colors from before themes exactly (test), except the simulator's innermost-state fill (`#3a3d26` -> green at 13% over bg0, `#3a3a27`) | Jonas: all of gruvbox, every variant selectable |
| 2026-10-09 | Global editor settings in `settings.json` in the app's config folder (Tauri `app_config_dir`: `%APPDATA%\se.blxt.ufsm`, `~/Library/Application Support/se.blxt.ufsm`, `~/.config/se.blxt.ufsm`), through two Rust commands that touch only that file (`read_settings` returns path + contents or null; `write_settings` creates the folder, writes a temp file and renames it); `dev:web` keeps the same text in localStorage (`ufsm.settings`), which the desktop app also uses as a cache so the first paint has the right theme. Format: `{"theme": {"name": "gruvbox", "appearance": "system"\|"dark"\|"light", "<modifier>": "<context>"}}`; reading never fails (defaults + problems shown in the tab), unknown keys are written back unchanged, a change is saved at once. Default: follow the OS (gruvbox dark or light, medium). Settings tab in the right panel (after Code; File › Settings, View › Settings): theme, Appearance System/Dark/Light, one segmented control per other modifier (Contrast Hard/Medium/Soft), palette swatches, where the file is, problems. OS changes: `prefers-color-scheme` plus Tauri's window theme (`theme()`, `onThemeChanged`) | Jonas: a Settings tab in the right panel, a settings file, follow the OS by default; one contrast for both appearances (gruvbox.vim has one per appearance; not needed yet) |
| 2026-10-09 | Two transition tools: S transition (`a t`, palette icon an orthogonal S) adds a derived S route as before and takes no bend points (a click on empty canvas says to use the other tool); straight transition (`a l`, new event `eKey_l`, action `toolStraight`) adds a free route: without bend points one line where the line between the two centres leaves each box (a composite containing the other's centre attaches at its side nearest to it; a self-transition gets a small free loop round the top-right corner), with bend points as before. `addTransition(..., { route: "straight" })` in core. While drawing, the canvas previews the exact route a click on the target under the pointer would give (computed on a copy), or an S towards the pointer | Jonas's feedback: the old single tool mixed both; seeing the S before clicking avoids surprises |
| 2026-10-09 | Derived S routes keep to the 10-unit grid (`GRID` moved to model.ts): automatic end offsets snap to the nearest grid line (absolute), unless two ends would coincide or touch a corner, and a U whose snapped ends end up level keeps exact offsets; default jogs snap to the nearest grid line that keeps the shape (nearest, then the lines either side, then exact); stubs and lanes outside the ends snap outwards; self-loop ends at 20 + 10k. Stored values are unchanged, so files do not change | "When adding a transition, make sure it's aligned to grid": a new S between grid-aligned states had its jog at x 467 |
| 2026-10-09 | An initial state is never a transition target (`cannotConnect` refuses it with a reason). Only the editor refuses: semantics.md still defines entering through one, the design rule check does not flag it, and no repository model has one | UML: an initial pseudo-state has no incoming transitions; Jonas called it a bug |
| 2026-10-09 | Selection on the canvas: a selected vertex is drawn in the selection color (orange, 3 wide; the old editor did the same) instead of an outline box around it; no resize squares are drawn. A single selected vertex resizes from any point along a side (a hidden line grip, 7 px either side) and from its corners (hidden point grips that reach 1.5x as far and beat the sides near them); the cursor shows which | Jonas's feedback: resize boxes were small targets and cluttered the state |
| 2026-10-09 | The wheel zooms while panning (right button held, before or after the pointer moved): internal `eWheel / zoomAtPointer()` on PanPressed and Panning in editor.ufsm; the pan goes on from the zoomed view | Jonas's bug report |
| 2026-10-09 | Texts inside a state are clipped: everything to the state's outline, the name to the header, entry/exit/internal lines to the action block, a region's name to its band | A state drawn smaller than its text spilled it over the sheet |
| 2026-10-09 | Paper size is a Project-tab setting (`setPaper`, A4–A1, one undo step; nothing moves); the tab warns when states lie beyond the chosen sheet (`beyondPaper`) | Jonas's request; the size was shown but could not be changed |
| 2026-10-09 | Rust backend: one module per model (`<module>.rs`, default the model name in snake_case), as static as the C output (fixed arrays, ring-buffer queue, no heap, no `unsafe`, no dependencies, only `core::`, so `#![no_std]`; Rust 1.81+ for `core::error::Error`, editions 2021/2024). No inner attributes or `//!`, so it works as `mod x;` and through `include!` from `OUT_DIR`. The machine struct (`targets.rust.className`, `--class-name`; default PascalCase) owns its handler `H: Handler` (a trait: one `&mut self` method per action, guards `-> i32` because compare terms need a number and embedded-hal 1.0 pin reads need `&mut`); `new` (runs nothing), `reset`/`process -> Result<(), Error>`, `handler`/`handler_mut`/`into_handler`. `Error` is `NotStarted`/`QueueOverflow`/`Livelock` with the interpreter's `code()`. Names as declared (`Event::eButton`, lints allowed on the items), keywords as raw identifiers (`r#type`), `self`/`Self`/`super`/`crate`/`_` get a trailing underscore (clash checked); actions called fully qualified (`Handler::into(&mut self.handler)`) so blanket-impl methods cannot capture them. Guard values that are not an `i32` are compared as `f64` (exact). The output must be warning-free (`-D warnings -W missing_docs`), clippy-clean (default + pedantic; only `similar_names`/`too_many_lines` allowed on the private impl) and equal to `rustfmt` (the printer breaks long conditions and or-patterns as rustfmt does), so a committed copy survives `cargo fmt --check` and `cargo clippy`; user-facing items carry `allow(dead_code)` because a binary crate would warn about unused events and accessors | Jonas: "Add rust generator". Choices to revisit: names as declared vs UpperCamelCase variants; guards `i32` vs `bool`; one owned handler vs a handler passed per call |
| 2026-10-09 | **Guards are bool-only**: a guard function takes no arguments and returns a boolean; a guard term is `{call}`, `{call, not}`, `{in}` or `{in, not}`, ANDed. `{call, op, value}` is gone from the format, schema, IR (`compare`), interpreter, flat runner and all four backends. Generated signatures: C `bool <p>g(void *user)` (the header includes `<stdbool.h>`), Python `-> bool`, TypeScript `(): boolean`, Rust `fn g(&mut self) -> bool`. Traces and the simulator use `true`/`false` (numbers are rejected), `ufsm run -g name[=true\|false]`. The v0 converter turns each distinct compare term into a new guard named after it (`canvas_selection_count_gt_1`; `eq gt ge lt le`, `m1` for -1, `2p5` for 2.5, `_2` on a clash) and removes a guard that was only compared, with a note per change. Supersedes the int/`number \| boolean`/`i32` guard types in the C, Python, TypeScript and Rust rows above | Jonas, after discussing "bool only vs much more": the int + literal compare split one condition between the model (threshold) and the application (value), leaked per-language typing rules (Rust `i32` vs `f64`, TS booleans as 1/0) and made the simulator ask for numbers, while the only real use was canvas.ufsm's `canvas_selection_count` against 1. Named predicates read better on the diagram and are testable in the application. Richer conditions, if ever wanted, should come from model-owned data (machine variables, event parameters, expressions the simulator can evaluate itself; see open questions), which bool-only does not block |
| 2026-10-09 | UI zoom ("appearance zoom"): `settings.json` key `zoom` (percent, 50–300, written only when not 100; out of range is clamped and reported) scales the parts around the canvas with CSS `zoom: var(--ui-zoom)` on the title bar, explorer, tab strip, breadcrumbs, empty-state message, right panel and status bar; their px sizes (fonts, heights, panel widths) grow with it and the canvas takes the room that is left. The canvas and its ancestors are never zoomed: the diagram, its own zoom/pan and pointer coordinates on it are unchanged (no Tauri webview zoom, which would scale the canvas too). Steps are a browser's page zoom levels (50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300). Keys Ctrl++ (also Ctrl+= and the keypad) / Ctrl+- / Ctrl+0 as Tools internals `[ctrl, in Idle]` in editor.ufsm (events `eKey_plus`/`eKey_minus`/`eKey_0`, actions `uiZoomIn`/`uiZoomOut`/`uiZoomReset`); they also work while a text field has the focus. View › Zoom In / Zoom Out / Reset Zoom; Settings tab › Zoom: − value + Reset. Sashes divide the pointer's movement by the zoom | Jonas: "Appearance zoom in/out that increases font size", only for the editor UI, never the canvas (it has its own zoom and pan) |
| 2026-10-09 | Three more bundled themes, built like gruvbox (one folder each under `themes/`: the upstream palette copied exactly into `<name>.tokens.json`, ufsm's role choices in separate files): **Everforest** (sainnhe/everforest, MIT; autoload/everforest.vim) with appearance dark/light × contrast hard/medium/soft (`g:everforest_background`); **Solarized** (altercation/solarized, MIT; the README's table, green `#859900`) with appearance only; **Catppuccin** (catppuccin/palette v1.8.0, MIT) with appearance (light = Latte) and `flavor` frappe/macchiato/mocha (default mocha), the flavor used when dark. Roles: Everforest bg0, bg_dim around the sheet and as chrome, bg1 grid, edges bg2 (dark) / bg4 (light), fg4 = grey2, gray = grey1; Catppuccin after its style guide: base, mantle around the sheet, crust chrome, surface0 grid and edges, subtext0 secondary, purple = mauve, aqua = teal, orange = peach; Solarized dark base03/base02/base0/base01 and light base3/base2/base00/base1, purple = violet, aqua = cyan, plus three shades Solarized lacks, computed by continuing its L\*a\*b ladder 5 L\* per step at the same a\*b\* (dark L\*10 `#00202b` chrome and surround, L\*25 `#16414d` bg2; light L\*87 `#e0d9c7` bg2 and edges; the formula reproduces the canonical base colors). Diagram ink = body text where the secondary color is under 3.5:1 on the sheet (Solarized both, Everforest light); otherwise fg4 as gruvbox. Code colors follow each scheme's own rules (everforest.vim, vim-colors-solarized, Catppuccin's style guide). The palettes are not adjusted for contrast: the weakest upstream pairs (Solarized light body text 4.1:1, Everforest light soft orange on the sheet 2.2:1, text on orange 2.0:1) are kept and pinned by floors in theme.test.ts. The Settings tab lists themes alphabetically (gruvbox stays the default and the fallback for an unknown name) and greys out a modifier whose contexts would all give the same colors (`modifierHasEffect`: Catppuccin's flavor while light) | Jonas: "download Everforest, Solarized, Catppuccin and integrate them"; faithful to upstream so they look like the themes people know |
| 2026-10-10 | **The sheet stays (no infinite canvas); it gets a drawing frame and a title block.** Diagrams are drawings to print, like blueprints or KiCad schematic sheets: the root region and each off-page region is a sheet (KiCad's hierarchical sheets), drawn at true scale (2 units per pt, so the 18/14-unit fonts print at 9/7 pt) and exported/printed 1:1. The frame carries zone references (numbers along the long edges, letters along the short ones, as KiCad) so off-page markers, Problems and jump-to can name "sheet 3, B4". The title block is filled from the model: name, description, sheet path, sheet n of m, file name, date of last save, revision; at most a few free fields (author, company, document number) in a small map in `diagram`. "Fits" (`beyondPaper`) is measured against the area inside the frame, and overlapping the title block is reported too. The frame uses the canvas ink color on screen; print and export always use a light print palette. No `"paper": "none"` mode | Jonas and Claude: the sheet is already part of the format (off-page regions are sheets); a bounded sheet pushes large machines into off-page regions instead of sprawling; print/PDF/SVG need no scaling or pagination; a title block and zones give traceability for embedded design reviews. An optional infinite mode would be a second case for every feature |
| 2026-10-10 | **Sheet frame and title block, as built** (refines the decision above). Frame after ISO 5457: drawing area 50 units (8.8 mm) inside the paper edge, border line at 30 (5.3 mm, printable), zone numbers along the top and bottom, letters A, B, … without I and O down the sides, A1 top-left, ISO's counts (A4 6×4, A3 8×6, A2 12×8, A1 16×12; zones 42–58 mm). **The sheet origin (0, 0) is the drawing area's top-left corner**, so the paper spans (-50, -50)…(w-50, h-50): no coordinate in any file changes, and the edit rule "vertices on a sheet stay at x, y ≥ 0" now keeps them inside the frame's left and top edges. Title block 600×190 units (106×34 mm, KiCad-sized) in the drawing area's bottom-right corner, five rows: Title (machine name, bold) · Rev / Description (first line of `doc`) / Sheet path · Sheet n / m / File · Date · Size / Author · Company · Document no.; a small caption top-left in every cell. Sheets are numbered in document order (root 1, a sheet before the sheets inside it); paths KiCad-style (`/`, `/Owner/Inner`; a sheet of a state with several regions is "Owner · Region"). Free fields in `diagram.titleBlock` {revision, date, author, company, document}: strings, written only when non-empty, unknown keys rejected (reader and schema); edited in the Project tab (Date has a Today button; double-click on the title block or the search opens them). **Date is a free field, not "date of last save"**: an automatic date would make every save a change in git; set it with the revision. File name comes from the editor/CLI (blank before File › New's first save). Fit = design rule warnings `outside-frame` and `title-block` (vertices and route points/segments; only the outermost element: contents of a listed state and transitions attached to it are not listed again; labels not measured; skipped while positions or transition ends are missing); `beyondPaper` removed. Problems, the status line and `ufsm check` name where an element is drawn ("sheet 2, B4": a vertex by its centre, a transition by its label, else the middle of its route); an off-page marker shows "sheet n". The v0 converter keeps the v0 paper unless the drawing no longer fits inside the frame, then takes the smallest larger paper that fits (reported as a note; nothing moves): 7 converted models went A4→A3 or A3→A2. `z f` on an empty page shows the whole sheet. Print/export in a light palette waits for E7's export | Jonas: "come up with a suggestion on sheet frame and title block; free to implement what you see fit". Origin inside the frame: frame and files stay independent; the paper is just drawn around the area. Fixed block size on every paper: it prints the same size whatever the sheet, as on engineering drawings |
| 2026-10-10 | **Search after VS Code's Quick Open and command palette**, in the title bar's search field: one list of everything a name finds: states (and named pseudo-states), off-page regions and named regions of states with several, transitions (by their label, e.g. the trigger), internal transitions, declarations of **every open machine**, the machines, every enabled menu command ("Add: S transition", with its keys) and the settings (global: color theme, appearance, the theme's options, UI zoom; the focused machine's Project settings: paper size, name, description, each code generator option). Prefixes as in VS Code: `>` commands and settings (Ctrl+Shift+P, F1), `@` the focused machine, `#` all machines, `?` the list of prefixes; Ctrl+P opens it (it was kept free for this). Ranking: the match's class first (exact name, prefix of the name, every word at a word start, anything else), then the **focused machine** (with commands and settings) before other machines, then recently picked items, then the fuzzy score. Fuzzy matching as VS Code's: letters in order, word starts and runs score; scattered letters must start at a word start; a state's parents and a transition's ends (shown dimmed) and hidden words (a state's entry/exit actions, other words for a setting) only match as whole runs. A highlighted color-theme/appearance row is previewed and put back on Esc; picking saves it. Disabled commands are not listed. Recent picks: localStorage (`ufsm.searchRecent`), per profile | Jonas: "search all open machines, priority to the one in focus, also settings and actions (add transition), essentially any command; take inspiration from VS Code". Match class before focus so an exact name in another machine still beats scattered letters here; the commands come from the menus, so a new menu item is searchable without more code |

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

## 7. Tasks

### Housekeeping (now)
- [x] `.github/workflows/ci.yml` in the repo (tracked since commit 518e6bd)
- [x] `npm install` re-run and `package-lock.json` committed (518e6bd)
- [x] First commit on `ts-rewrite`: move to `old/` + scaffold + v1 (518e6bd "wip", 2026-10-09, 311 files)
- [ ] Commit the work since 518e6bd (20 modified, 38 new files: C and Python backends, conformance suite, IR
      simplifier, CLI, docs); suggested split: C backend / conformance suite / Python backend
- [ ] Add `build/` to `.gitignore` (generated C/Python and test scratch land there)
- [ ] Confirm CI green on Windows/macOS/Linux (Rust shell has only been built on Jonas's machine; tests run on
      Ubuntu only and now require gcc, Python and pyright)

### Phase S — semantics (done; one review open)
- [ ] Jonas: review the remaining semantics choices in `docs/semantics.md` ("Changes from v0.5"): B12 and
      eventless timing, before backends depend on them (entry/exit order confirmed 2026-10-09)
- [x] S1 Trace format + runner: `tests/traces/*.json` from `old/tests/C/*.c` (2026-10-09)
- [x] S2 Reference interpreter over the v1 model; passes S1 traces (2026-10-09)
- [x] S3 Priority/conflict resolution (fixes B1); `test_priority*.ufsm` regression models (2026-10-09)
- [x] S4 Fork/join incl. join targets with regions (B8), in the interpreter (2026-10-09)
- [x] S5 Signal queue semantics: drained per `process()` call, optional bound (B2), in the interpreter;
      bound from `targets.c.signalQueue` and B3 belong to B-C (2026-10-09)
- [x] S6 Deep history and terminate (B7), in the interpreter (2026-10-09)
- [x] S7 Flattening into static tables (`semantics/flatten.ts`) + a table runner (`semantics/flat-run.ts`) that
      matches the interpreter on all traces, all repo models and 1800 random models (2026-10-09)
- [x] S8 IR (`ir/ir.ts`), lowering from the flat tables (`ir/lower.ts`), evaluator (`ir/eval.ts`), pseudo-code
      printer (`ir/print.ts`, `ufsm ir`); IR matches the interpreter on all traces, repo models and 1800 random
      models (2026-10-09)
- [x] S9 Conformance coverage: models + hand-checked traces for every rule in semantics.md, `inactive` and
      `maxMicrosteps` in traces, wider random models, planted-bug check (2026-10-09)
- [ ] Rerun the planted-bug check (16 interpreter mutants, see progress log) whenever semantics.md changes; consider
      committing it as a script under `packages/core/test/`
- [ ] Optional: a short canvas.ufsm trace as a real-world regression (it is only covered by differential runs);
      not added because its expectations would have to be checked by hand over 127 states

### Phase B — backends
- [x] B-C C backend = printer for the IR (prefix from `targets.c`, enums, static dispatch, fixes B3/B4/B6/B10);
      traces + differential runs against the interpreter with gcc/clang (2026-10-09)
- [ ] B-C follow-up: CI needs a C compiler on all three OSes (Linux/macOS: `cc`; Windows: check that `gcc` is on
      PATH on the runner, else set `CC`); add an MSVC step (`cl /W4 /WX /c` on the generated repo models)
- [x] B-PY Python backend + trace runner (2026-10-09)
- [ ] B-PY follow-up: also check the generated Python with `mypy --strict` (only pyright is checked so far)
- [x] B-TS TypeScript backend + trace runner (2026-10-09)
- [x] B-RS Rust backend + trace runner (`no_std`, no heap; warning-, clippy- and rustfmt-clean) (2026-10-09)
- [ ] B-RS follow-ups: Jonas to run `npm test` on Windows (rustc via MSVC; `clippy-driver` and `rustfmt` from rustup) and
      review the API choices (decisions log); check the oldest supported Rust (1.81) in CI, not only stable; a
      `State` enum / `is_active()` would need the state `ident` question settled (open questions); a build.rs recipe
      (generate into `OUT_DIR`) once the single-binary CLI exists?
- [ ] B-FZ Differential fuzzer: the per-backend differential runs exist (C, Python, TypeScript and Rust, 300 random
      models each, `UFSM_C_RANDOM`/`UFSM_PY_RANDOM`/`UFSM_TS_RANDOM`/`UFSM_RUST_RANDOM` for more); left: a long-running fuzz command or nightly CI job that
      saves failing seeds
- [x] `ufsm generate c` in the CLI (2026-10-09)
- [x] `ufsm generate python` (2026-10-09)
- [x] `ufsm generate ts` (2026-10-09)
- [x] `ufsm generate rust` (2026-10-09)
- [ ] Single-binary CLI build

### Phase E — editor (plan agreed 2026-10-09)
Principles: the document is the only state (every edit is a command with an inverse: undo/redo); geometry is derived
in core; input goes through the editor's own uFSM model (generated with the TS backend); every milestone ships working,
tested behaviour (unit tests, traces of the editor model, headless browser checks via `window.ufsm`).
- [x] E1 Foundations: `apps/editor/src/fsm/editor.ufsm` (interaction model, old key map) + committed generated
      `editor-fsm.ts` + freshness test + a conformance trace (replayed by every backend); today's select, lasso, pan,
      zoom, navigation and file keys ported onto it; Preact 11 and Immer 11 added, JSX configured (2026-10-09)
- [x] E2 Transition routing in core (E-ROUTE): `route` (`"s"` | `"free"`) + absolute jog in the v1 diagram section (spec,
      schema, reader, canonical writer; migrator keeps converted files `"free"`), S geometry with L/U variants and automatic
      sides, labels anchored to the route, free bend points mapped when an end moves; property tests; renderer uses it
      (2026-10-09; `followPolyline` is in core and tested, the editor calls it once E3 can move states)
- [x] E3 Commands + undo/redo (Immer patches); move states and multi-selections, resize states and region heights,
      children stay inside, 10-unit grid always on; transitions follow; handles for the S jog, pinning an end, free bend
      points; labels movable (2026-10-09)
- [ ] E3 follow-ups: moving a vertex into another region (reparenting) by dropping it there; arrow-key nudging?; drag
      cost (each preview re-indexes and re-derives every route twice: fine at ~16 ms on canvas.ufsm, cache per route if
      it grows). ("Convert to S" landed with E4 as Add › Convert to S Route, no key.)
- [x] E-UI Window layout after VS Code: title bar with menus and search field, machines in tabs, explorer, tabbed
      right panel (Properties, Project) toggled with `p`, status bar, resizable side panels (2026-10-09)
- [x] File › New: empty machine in a new tab, Ctrl+N, named after its file on the first save (2026-10-09)
- [x] Search after VS Code (Ctrl+P, Ctrl+Shift+P / F1, prefixes `>` `@` `#` `?`): elements of every open machine (the
      focused one first), menu commands, settings and the focused machine's Project settings (2026-10-10)
- [ ] Search follow-ups: Jonas to try it in `npm run dev` (WebView2 must not open its print dialog on Ctrl+P; macOS: Cmd+P
      and Cmd+Shift+P reach the same keys); "find references" of a declaration (the transitions and states using it,
      VS Code's Shift+F12) instead of only the declaration; while simulating, events as rows ("Simulator: Send eButton");
      `:` sheet and zone (VS Code's go to line) once the drawing frame has zones; show Cmd instead of Ctrl on macOS
      (menus too); search the documentation texts?; frequency as well as recency (VS Code's MRU only)
- [ ] File › New follow-ups: Jonas to try the first save in `npm run dev` (native dialog; machine renamed to the file);
      a starting template (an initial state and one state) instead of an empty sheet?; choose the paper size on New?
- [ ] E-UI follow-ups: Jonas to check in `npm run dev` on Windows (drag the title bar, double-click maximizes, resize at
      the window edges of the frameless window, window buttons, close with unsaved changes) and on macOS (traffic lights
      fit the 34 px bar); a real project format (folder or project file)
      for the Project tab and the explorer; remember open machines and panel visibility between runs; keyboard
      navigation of the menus (Alt, arrows)
- [x] E4 Create/delete: palette tools and the old `a` + key map (state, region, transition, initial, final, histories,
      fork, join, terminate, bend point), delete with cascade, copy/cut/paste (Ctrl+c/x/v), id generation (2026-10-09)
- [ ] E4 follow-ups: Jonas to try it in `npm run dev`; reconnect a transition end to another vertex by dragging it (E3's
      end handles only slide along the same vertex); the system clipboard (JSON text) so fragments survive a restart and
      reach other windows; macOS: its "delete" key sends Backspace (up one level), so Delete needs fn+Delete or the
      Edit menu (make Backspace delete when something is selected, on macOS only?); delete a region from the canvas
      (today only via Properties); a region added to a nested state can stick out of its parent band (grow ancestors
      too?); paste could follow the pointer until a click places it (the old editor's paste mode)
- [x] E5 Properties and declarations (Preact panels): names, entry/exit, triggers, guards, actions, declarations with
      rename propagation; `e` + key edit map; live problems panel with jump-to (2026-10-09)
- [ ] E5 follow-ups: Jonas to try it in `npm run dev`; edit an action in place (today: remove and add); drag to reorder
      list rows; change a declaration's kind (event <-> signal); documentation of declarations (shown as a tooltip only);
      a region selected on the canvas (today regions are edited through their state); keyboard navigation inside the
      panel (Tab moves between fields; no shortcut back to the canvas but Esc/Enter in a field); canvas badges can cover a
      transition label
- [x] E6 Simulator (interpreter in the editor: events, guard values, active-state highlight, action log, record a trace)
      and live code preview (C, Python, TS) (2026-10-09)
- [ ] E6 follow-ups: Jonas to try it in `npm run dev` (Save trace…, Save…, Save both…, File › Generate into a folder and Copy
      through Tauri's dialogs and clipboard); replay a saved trace in the simulator (step through it, show failures);
      mark active states in the explorer tree and on breadcrumbs of off-page regions; send an event by double-clicking a
      transition or its label while simulating; jump from the selection to its code in the preview; an IR view; the Code
      tab wants a wider panel (remember a width per tab?); simulate on the generated TypeScript as a second engine
- [x] E7 Light theme: DTCG color themes (gruvbox dark/light × hard/medium/soft), Settings tab, settings.json, follows
      the OS by default (2026-10-09)
- [x] UI zoom: Ctrl++/-/0, View menu, Settings tab, settings.json; the canvas is never zoomed (2026-10-09)
- [x] More themes: Everforest, Solarized, Catppuccin (2026-10-09)
- [ ] More-themes follow-ups: Jonas to look at them in `npm run dev`; accept the low-contrast spots of the light variants (Everforest light's orange selection and text on orange, Solarized's secondary text) or give ufsm's selection a darker accent there; Catppuccin's accent is peach (ufsm's orange role); most Catppuccin ports let the user pick an accent (mauve, lavender, ...): an `accent` modifier?; show "Frappé" with its accent (contexts are identifiers; a display name would need `$extensions`); copy the upstream MIT notices into the theme folders (today: README credits, as for gruvbox)
- [ ] UI zoom follow-ups: Jonas to try it in `npm run dev` (WebView2; macOS/Linux WebKit render CSS `zoom` too, not yet
      checked there); Ctrl+wheel over the panels to zoom the UI?; a separate font size for the diagram's texts?
- [ ] Themes follow-ups: Jonas to try in `npm run dev` (the Rust settings commands compile and write
      `%APPDATA%\se.blxt.ufsm\settings.json`; System follows Windows' dark/light switch live; macOS/Linux too); a key to
      toggle dark/light (the old `t`; needs editor.ufsm); Ctrl+, for Settings; user themes: load `*.resolver.json` from a
      `themes/` folder next to settings.json; separate contrast per appearance (gruvbox.vim has both); import VS Code
      color themes?; the native window theme (`setTheme`) for the macOS title bar overlay
- [x] Jonas's feedback 2026-10-09: clip texts in small states; zoom while panning; paper size in the Project tab; resize
      from whole sides and corners instead of handle boxes; selection drawn as the state's color; initial state never a
      target; new transitions on the grid; S and straight transition tools (2026-10-09)
- [ ] Feedback follow-ups: Jonas to try them in `npm run dev`; zoom during other drags too (moving, rubber band, drawing a
      transition already zooms)?; a design rule for transitions into an initial state (semantics.md still allows entering
      through one); resize an unselected state from its sides too?; snap labels of new S routes to the grid?; the selection
      color for selected transitions too (today a thick orange line over them)
- [x] Sheet frame and title block: frame with zone references, title block from the model + free fields in
      `diagram.titleBlock`, fit as design rule warnings, sheet and zone in Problems, the status line and `ufsm check`,
      off-page markers name their sheet (2026-10-10)
- [ ] Sheet follow-ups: Jonas to look at it in `npm run dev` and decide the open points: one paper size per sheet instead
      of one per file (as KiCad; decide while format v1 can still change); portrait sheets?; a "move to its own sheet"
      command so hitting the edge is cheap; `:` in the search to go to "sheet 2, B4"; the zone under the pointer in the
      status bar; the light print palette comes with E7's export/print; a uFSM version/logo cell in the title block?
      (not deterministic across versions, so only when printing); a second free line for the description (only the
      first line of `doc` is shown)
- [ ] E7 Polish: export SVG/PDF/print, Tauri hardening (dialog-picked paths only, CSP), autosave/recovery
- [ ] Later: `"auto"` route via libavoid-js (trial on canvas.ufsm first; LGPL-2.1+, compatible with uFSM's GPL-3; keep its
      licence notice and source link)

### Open questions
- Event parameters, machine variables, expression guards (`&&`/`||`/`!`), timers (`after(100ms)`)? Guards are bool-only
  (decided 2026-10-09); conditions on data beyond named predicates would come with model-owned variables, not with
  arguments or typed return values on guard functions.
- Optional code identifier for states (`ident`) for languages that emit state enums?
- Multiple machines per file / includes?
- Minimum macOS (currently Safari 15 / macOS 12 assumed)?
- Completion as a condition (current) vs UML's one-shot completion event: matters only for guarded completion transitions.
- Should guard functions be called at most once per microstep (cache values) so backends can't differ on side effects?
- C: action/guard functions carry the prefix (`dimmer_lamp_off`); `--prefix ""` gives v0.5-style bare names. Keep, or
  add a separate `targets.c.userPrefix` for the application functions?

## 8. Known issues / caveats in the new code
- Traces that never fire some transitions on purpose: the losers in `test_priority*`, `B -s3-> Wrong` in test_signals
  (would show LIFO order), `X -s1-> X2` in test_terminate (the queue is dropped), and `A -completion-> End` in
  test_nested_finals (A can never complete: region Ar2 has no final state of its own; the model must stay equal to
  the converter output, so it is not changed).
- Traces without `options.signalQueue` must never have more than 16 signals waiting (the C default).
- Tauri file commands accept any path; CSP is `null` (fine for local use, revisit before release).
- `icon.ico` uses PNG entries for all sizes (works on modern Windows). Regenerate the set from `icons/icon.svg`
  (`npx tauri icon apps/editor/src-tauri/icons/icon.svg` resizes one render; the committed small sizes are rendered per size).
- Tree view lists normal states only (pseudo-states omitted on purpose).
- Label height is not stored; page bounds assume ~60 units.
- Automatic S labels can overlap on dense diagrams (dhcpclient converted to S: two labels between Requesting and Init);
  the default placement doesn't look at other labels.
- Writing files on Jonas's machine: tar must extract with `--overwrite` (deleting is not allowed there, so tar cannot
  replace a file by unlinking it); `.claude/` is writable that way (2026-10-09).
- A stored S jog is kept when only one end moves, even when it no longer lies between the ends (the route then folds
  back); double-click the jog to reset it. Automatic ends of parallel U routes are spread in document order on both
  sides, so their U's can cross; pin the ends to nest them (the editor model's Dragging returns do).
- Dragging a composite state with a transition line over it grabs the line (no move): the line wins the hit test.
- The same file opened twice in the browser build (`dev:web`) gives two tabs: without a path there is nothing to compare.
  In Tauri an already open path just activates its tab.
- The explorer tree is rebuilt whenever an edit, undo or redo changes the machine section (fine at canvas.ufsm's size;
  collapsed/expanded rows are not remembered across a rebuild).
- Paste allows what the design rule check then reports: a second initial state in a region, state names repeated in a
  region. Placing and connecting refuse these up front.
- Palette clicks while drawing a transition (pointer in Linking) are ignored; Esc first.
- Putting a region back inline keeps its contents where they were relative to the band; a band smaller than its contents
  then shows them sticking out until the state or band is resized.

- `maxMicrosteps: 0` means "no livelock check" to the generators but makes the interpreter fail at the first microstep,
  and the trace format accepts 0; no trace uses it. The simulator only allows 1 and up. Decide one meaning (semantics.md).
- The simulator log shows the last 400 steps (the recorded trace keeps all of them).
- The sheet fit check does not measure transition labels (their size depends on the font), so a label can stick out of the
  frame or over the title block without a warning. The title block is drawn under the diagram, so a state over it hides it
  (and gets a `title-block` warning).

## 9. Handy facts
- Old generator CLI: `ufsm-generate c --sq_length 16 <model> <outdir>` (subcommand before positionals). Run without installing by stubbing `importlib.metadata.version`.
- The old CMake test build always used signal queue length 16.
- v0 transitions are stored under their source state; no transitions cross sheets in the legacy models.
- Old editor colours: gruvbox dark (`old/compose/src/render.c`, `ufsmm_color_set`).
- Downloading from GitHub in the cloud workspace: `git clone --depth 1 https://github.com/<owner>/<repo>` works; raw.githubusercontent.com
  and `gh api` are refused (2026-10-09).
- Claude's shell on Jonas's machine is a Linux VM where npm is blocked and the Windows `node_modules` can't run
  (native esbuild). It tests in a copy outside the repo (`~/w`) with pure-JS packages copied over, Node 22's
  `--experimental-transform-types` and a resolve hook for extensionless imports, then rsyncs results back.
  Never run `npm install` there.
- UI checks run in the cloud workspace instead (npm is blocked there too, but `/opt/npm-tools/node_modules` has
  esbuild, tsx, typescript and playwright): stage `packages/core/src`, `apps/editor/src` and `index.html` from the device, bundle
  `main.ts` with an alias for `@ufsm/core` and a stub for `@tauri-apps/*`, serve, drive with Playwright.
- Fastest full setup in the cloud workspace (2026-10-09): on the device `tar czf build/sync.tgz` the repo without
  `node_modules`/`.git`/`build`/`src-tauri/target`, plus the pure-JS packages (`node_modules/{@types,@tauri-apps,ajv,
  fast-deep-equal,fast-uri,json-schema-traverse,require-from-string,immer,preact,typescript}`); stage it, extract,
  symlink `node_modules/@ufsm/*` to the workspaces and `tsx`/`esbuild` from `/opt/npm-tools`. The cloud workspace has
  gcc, clang, Python 3 and pyright, so `npm test` runs with nothing skipped; then
  `UFSM_NODE_TOOLS=/opt/npm-tools node apps/editor/test/browser/check.mjs`. Copy results back file by file.
