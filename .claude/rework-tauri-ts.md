# Rework: C/GTK + Python → TypeScript + Tauri

Living plan for the rewrite on branch `ts-rewrite`, imported into every session by `CLAUDE.md`. It holds what is
needed for day-to-day work: the old-generator bugs (2), the strategy (4), the task list (7), known issues (8) and
handy facts (9). Section numbers are kept from when everything was one file; the rest lives in files that are only
read when needed:

- `.claude/rework-decisions.md`: 5. Decisions log (every design decision with its reason)
- `.claude/rework-log.md`: 1. Starting point, 3. v0 format findings, 6. Progress log (dated history)

Update section 7 here, and the progress log in `rework-log.md`, whenever work lands.

---

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

## 7. Tasks

### Housekeeping (now)
- [x] `.github/workflows/ci.yml` in the repo (tracked since commit 518e6bd)
- [x] `npm install` re-run and `package-lock.json` committed (518e6bd)
- [x] First commit on `ts-rewrite`: move to `old/` + scaffold + v1 (518e6bd "wip", 2026-10-09, 311 files)
- [x] Commit the work since 518e6bd (20 modified, 38 new files: C and Python backends, conformance suite, IR
      simplifier, CLI, docs); suggested split: C backend / conformance suite / Python backend
- [x] Add `build/` to `.gitignore` (generated C/Python and test scratch land there)
- [x] Confirm CI green on Windows/macOS/Linux (green at 8cc5061, 2026-10-11) (Rust shell has only been built on Jonas's machine; tests run on
      Ubuntu only and now require gcc, Python and pyright)
- [ ] Merge `ts-rewrite` into master with a merge commit (never squash or rebase: `.git-blame-ignore-revs` names
      c861e89); readthedocs: turn the project off or set its default version to v0.5.3 (`.readthedocs.yml` is in `old/`)

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
- [x] Busy latch: a failed call (error, exception, caught panic, longjmp) or a nested `process()` leaves/meets the
      machine busy, `process()` fails with `busy` until `reset()`; interpreter, runners and all four backends; trace keys
      `raise`/`reenter`, `test_busy.json` (2026-10-10)
- [x] Busy follow-ups: Jonas reviewed the semantics (2026-10-10: fine as written); the simulator stays as it is (after
      an error, Stop/Start or Reset)
- [ ] Later, optional: SCXML-style `error.execution` as an opt-in (catch, finish the transition, queue an error event
      the model can handle)
- [x] `ufsm generate c` in the CLI (2026-10-09)
- [x] `ufsm generate python` (2026-10-09)
- [x] `ufsm generate ts` (2026-10-09)
- [x] `ufsm generate rust` (2026-10-09)
- [ ] Single-binary CLI build
- [x] Timers (decisions log 2026-10-10/11): `timers` on states in format v1 (schema, reader, writer, design rules),
      semantics.md "Timers" + interpreter + flat runner + hand-derived `test_timers` trace, IR statements and lowering,
      C/Python/TS/Rust APIs (traces + random models with timers in every differential pass), CLI (`run`, `info`, `list`),
      editor (action block, Properties › Timers, Edit › Add Timer, clipboard, search, simulator Timers with Fire), docs incl.
      the Zephyr example in backend-c.md (2026-10-11)
- [ ] Timers follow-ups: Jonas to review the generated APIs (`npm run ufsm -- generate c tests/models/test_timers.ufsm -o build
      --debug-info`, also python/ts/rust) and try Properties › Timers and the simulator's Fire in `npm run dev`; an `e` key for
      Add Timer (needs editor.ufsm and a regenerated editor-fsm.ts); reorder timers in Properties (as for other lists);
      a "restart" action (decided: not for now); a wall-clock mode in the simulator?; a host-side check that a late expiry
      cannot reach the wrong state (generation counter recipe in backend-c.md)
- [x] Common `options` section (format v1): `signalQueue`/`maxMicrosteps` moved out of `targets.*`; behaviour options
      only there, API options overridable per target (resolution `options` -> `targets.<name>` -> CLI flags); interpreter,
      trace runner, simulator and `ufsm run` honour it; Project tab shows it once; design rules `signal-queue` and
      `target-option`; `test_options` model + two traces (2026-10-10)
- [x] State ids, `debugInfo` and `trace` (decisions log 2026-10-10/11): state enum and fingerprint always; `debugInfo` and
      `trace` API options in all four backends, decided in the lowering; hooks documented in semantics.md; differential
      pass per backend with both on; Project tab, CLI flags, `ufsm info` fingerprint (2026-10-11)
- [ ] Debug/trace follow-ups: Jonas to review the generated API (`npm run ufsm -- generate c examples/dimmer.ufsm -o build
      --debug-info --trace`) and the Project tab in `npm run dev`; a host decoder (`ufsm decode <model> <log>`: kind/id
      records -> names, checking the fingerprint), maybe with the simulator replaying a recorded log (docs/live-trace.md);
      a `reset` trace kind (today a host infers a reset from enter reports at the root); a state `ident` override
      (open question) instead of generated identifiers like `s10_` for "10%"
- [x] Code generator settings and Generate (Jonas 2026-10-11): `target` + `targets.<name>.out` in format v1, CLI
      `ufsm generate <model>`, Project › Behaviour and Code generator, File › Generate Code (Ctrl+Shift+B), Generate in
      the Code tab, `write_generated` in the Rust shell with an overwrite guard (2026-10-11)
- [ ] Generate follow-ups: Jonas to try it in `npm run dev` (Browse…, first Generate on an unsaved machine: Save As, then
      the folder; a folder outside the model's folder asks once; a hand-written file of the same name is refused);
      reopening a model in a later run needs its dialog grant (recent files would need persisted scope); generate on
      save?; several targets at once (firmware C + host TS)?; File › Generate Code To… and the Code tab's Save both… still
      overwrite anything in the picked folder (the fs plugin)
- [ ] Options follow-ups: Jonas to try the Project tab's Behaviour section and the Simulator's options (model's values,
      session overrides, saved traces) in `npm run dev`

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
- [x] Mouse back button goes up one level (2026-10-10)
- [ ] Mouse-button follow-ups: Jonas to try it in `npm run dev` (WebView2 reports the side buttons as 3/4; macOS WKWebView
      and Linux WebKitGTK not yet checked); forward button: enter the selected state (Enter), or a page history (back/forward
      through visited sheets, as VS Code's Alt+Left/Right) instead of the hierarchy?
- [x] E-AB Action block rework: icon gutter instead of `e/` `x/` `t/`, entry and exit lists wrapped on their own lines,
      timers packed, 10-unit padding, resizable block (`actionsHeight`, whole lines, double-click = automatic), marker
      with hidden counts per kind, one-line summary at the minimum, design rules `actions-clipped`/`actions-overlap`
      (2026-10-11)
- [ ] E-AB follow-ups: Jonas to try it in `npm run dev` on Windows (the monospace font there is Cascadia Mono or
      Consolas; `npm test` and the browser check were run in the cloud workspace only); the timer's name is not drawn on
      the canvas (only in Properties, search and the CLI): show it dimmed when the state is selected?; resizing a state
      narrower re-wraps the block, which can push it over the first region's contents (reported as `actions-overlap`,
      not prevented); an ellipsis on a cut line can be clipped at the right edge when the line is full
- [ ] E7 Polish: export SVG/PDF/print, Tauri hardening (CSP; dialog-picked paths only is done: fs plugin, 2026-10-10),
      autosave/recovery
- [x] File access through `tauri-plugin-fs` instead of own read/write commands: only paths picked in a dialog this run
      (2026-10-10)
- [ ] fs-plugin follow-ups: Jonas to try open, save, Save As, File › Generate into a folder and Save trace in `npm run dev`;
      reopening files by path in a later run (recent files, restoring open machines) needs `tauri-plugin-persisted-scope`
      or a static scope, since dialog grants last only until the app exits
- [x] One schema source for format v1: TypeBox definitions in `core/src/v1/schema.ts` drive the reader and generate
      `schema/ufsm-v1.schema.json`; `model.ts` checked against them at compile time (2026-10-10)
- [ ] Later: live tracing from a target (compact replay log of events + guard bits, keyframes, timeline in the
      simulator); proposal in `docs/live-trace.md`, needs a fixed guard call order first
- [ ] Later: `"auto"` route via libavoid-js (trial on canvas.ufsm first; LGPL-2.1+, compatible with uFSM's GPL-3; keep its
      licence notice and source link)

### Phase R — review 2026-10-11 (`docs/review-2026-10-11.md`, section 6; all done 2026-10-11)
- [x] R1 One validity gate: the structural rules of `semantics/` are design rules (`fork-no-outgoing`, `fork-cycle`,
      `join-incoming`, `initial-target`); throws in structure/flatten are assertions; mutation test (2026-10-11)
- [x] R2 Human documentation: `docs/architecture.md`, `docs/glossary.md`, `docs/contributing.md`; CLAUDE.md points
      there; summary at the top of the decisions log (2026-10-11)
- [x] R3 Runtime contract out of the interpreter (`runtime/contract.ts`; `MachineHost`, `RunOptions`, `MachineError`,
      `RunningMachine`) (2026-10-11)
- [x] R4 Shared backend layer (`ir/analyze.ts`, `backends/common.ts`, resolved options, printers in named parts)
      (2026-10-11)
- [x] R5 Public surface of core (subpath exports; oracles out of the main entry) (2026-10-11)
- [x] R6 Core folders by domain (2026-10-11)
- [x] R7 Transition label layout in core (`diagram/label-layout.ts`) (2026-10-11)
- [x] R8 Split the editor's `main.ts` (workspace, sessions, shell, commands, canvas parts, controllers; panel by tab)
      (2026-10-11)
- [x] R9 Key map generated from editor.ufsm (`apps/editor/src/fsm/KEYMAP.md`) (2026-10-11)
- [x] R10 Vocabulary: StepEvent/onStep, sheet not page, hidden marker not pill (2026-10-11)
- [x] R11 Formatter (Prettier, printWidth 120, CI `format:check`, `.git-blame-ignore-revs`) and import-boundary
      check (`test/boundaries.test.ts`) (2026-10-11)
- [x] R12 One backend contract suite (`test/backend-contract.ts`) (2026-10-11)

### Open questions
- Event parameters, machine variables, expression guards (`&&`/`||`/`!`)? Guards are bool-only
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
- CSP is `null` (fine for local use, revisit before release). File access is limited to dialog-picked paths (fs plugin).
- The published schema no longer requires declaration names to be identifiers (it did, the reader never did); the design
  rule check reports them (`bad-name`), so such a file still opens.
- `@ufsm/core` depends on TypeBox at run time: about +140 kB minified (+38 kB gzipped) in the editor bundle.
- A `model.ts`/schema mismatch shows as `Type 'true' is not assignable to type 'false'` at the definition's row of
  `agree` in `v1/schema.ts`; compare the two definitions named there.
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

- `maxMicrosteps: 0` means "no livelock check" to the generators but makes the interpreter fail at the first microstep;
  `options` and the trace format accept 0; no model or trace uses it. The simulator only allows 1 and up. Decide one
  meaning (semantics.md).
- Differential runs of generated code against the interpreter set a queue of 4096 (`DIFF_QUEUE` in test/harness.ts) on
  both sides unless a test sets one; the interpreter no longer has an unbounded queue (it takes the model's options).
- The simulator log shows the last 400 steps (the recorded trace keeps all of them).
- `reset()` called from inside an action or guard is not detected (only `process()` is refused while busy): the outer
  call goes on with the new configuration. Rust cannot do it (borrow); the other languages document it.
- The busy flag in C is a plain `bool`, not a lock: it detects a call from an interrupt handler on one core, not
  concurrent calls from two threads or cores.
- State enum identifiers are generated from free-text names (`10%` -> `s10_`, repeated names qualified with parent states:
  `Door_Open`, as a last resort the id appended); renaming a state renames its constant and changes the fingerprint.
- Transition numbers follow `machine.transitions`, then internal transitions in state post-order (children first), not
  strictly document order; stable for a given model, listed in a comment in every file generated with `trace`.
- The trace hook reports no `reset` and no exits on reset or terminate (no exit actions run there either); a host sees a
  reset only as enter reports for the root's states.
- `generateFiles` lowers once per `trace` value; the editor's code preview passes its cached IR, which is lowered again
  for a target whose resolved `trace` differs.
- Timers: every `reset()` stops every timer first (by design, also at the first reset), so reset steps in traces list one
  `stop:` per timer. An expiry the application queued before a stop arrives as an ordinary event; uFSM adds no generation
  counter (backend-c.md says how an application can). The simulator runs on virtual time only (Fire sends the event).
- Timer numbers and timers are not part of the fingerprint and not reported by the trace hook (the application sees
  start/stop itself).
- In the Properties panel, Esc in the "Add timer" event picker leaves an empty event button until the state is reselected
  (internal transitions behave the same).
- The action block's height follows the state's width (lines wrap), so adding an action, or making a state narrower,
  moves the first region band's top; contents do not move with it. The design rule check reports a block drawn over a
  vertex (`actions-overlap`); only dragging the block's own handle keeps the bands below in place.
- Action block text assumes a monospace font is available (`ui-monospace`, Cascadia Mono, Consolas, Menlo, DejaVu Sans
  Mono, `monospace`); the font size is derived from the measured advance, so a fallback to a proportional font would
  show uneven spacing but still fit roughly.
- The sheet fit check measures transition labels with `estimateLabelWidth` (7 units per character), not the editor's
  font, so a label near the edge can be reported a little early or late. test_external_transitions has one such
  finding (t6's label past the right edge; the converted file stays as it is). The title block is drawn under the diagram, so a state over it hides it
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
- The browser check also runs directly on Jonas's Windows machine (2026-10-10): `npm i playwright esbuild` in a scratch folder,
  `npx playwright install chromium` there, then `UFSM_NODE_TOOLS=<folder>/node_modules node apps/editor/test/browser/check.mjs`
  from the repo. The first run after installing can fail a dozen drag checks (cold start); rerun.
- Fastest full setup in the cloud workspace (2026-10-09): on the device `tar czf build/sync.tgz` the repo without
  `node_modules`/`.git`/`build`/`src-tauri/target`, plus the pure-JS packages (`node_modules/{@types,@tauri-apps,ajv,
  fast-deep-equal,fast-uri,json-schema-traverse,require-from-string,immer,preact,typescript}`); stage it, extract,
  symlink `node_modules/@ufsm/*` to the workspaces and `tsx`/`esbuild` from `/opt/npm-tools`. The cloud workspace has
  gcc, clang, Python 3 and pyright, so `npm test` runs with nothing skipped; then
  `UFSM_NODE_TOOLS=/opt/npm-tools node apps/editor/test/browser/check.mjs`. Copy results back file by file.
