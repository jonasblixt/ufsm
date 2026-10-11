# Glossary

Words the code and the documents use with a specific meaning, with the file that owns each. Where a word is defined
normatively, the definition there wins.

## Models and diagrams

| Term | Meaning | Where |
|---|---|---|
| model, machine | One `.ufsm` file: declarations, the machine (root region, transitions), its diagram, options and targets. "Machine" also names the `machine` section | [format-v1.md](format-v1.md), `format/model.ts` |
| vertex | Anything a transition can start or end at: a state or a pseudo-state | `format/model.ts` |
| pseudo-state | initial, shallow/deep history, final, fork, join, terminate. Only states and final states are ever active | [format-v1.md](format-v1.md#regions-and-states) |
| region | A container of vertices; a state's regions are orthogonal (all active at once) and listed top-down | [format-v1.md](format-v1.md#regions-and-states) |
| initializer | A region's initial or history pseudo-state: how the region is entered by default | `semantics/structure.ts`, [semantics.md](semantics.md#entering) |
| internal transition | A reaction listed in a state (event, guard, actions) that never leaves the state (visualSTATE's static reaction) | [format-v1.md](format-v1.md#internal-transitions) |
| declaration | An event, signal, action or guard, referenced by id | [format-v1.md](format-v1.md#declarations) |
| signal | An event the machine sends itself (`{emit}`), queued and taken after the current microstep | [semantics.md](semantics.md#steps) |
| design rule check | `checkV1`: what the schema cannot express. No errors means the model can be simulated and generated in every language (the validity gate) | `check/`, [format-v1.md](format-v1.md#design-rule-check) |
| `DocIndex` | Maps from ids to vertices, regions, transitions, declarations, timers, built from a document by `indexV1`; every query takes one | `model/doc-index.ts` |
| sheet | What the canvas shows at one time: the root region or an off-page region, drawn on one paper with a frame and title block. (Never "page" in code.) | `diagram/sheet.ts` |
| off-page region | A region drawn on a sheet of its own; its state shows a marker naming the sheet | [format-v1.md](format-v1.md#sheets-and-origins) |
| band | The strip of a state a region is drawn in, below the header and the action block | [format-v1.md](format-v1.md#state-bands) |
| action block | The lines under a state's name: entry and exit actions, timers, internal transitions, laid out in core on a 7-unit character cell | `diagram/action-block.ts` |
| hidden marker | The marker on an action block's bottom line that counts the lines a smaller block hides; a click shows them all again | `diagram/action-block.ts` (`hiddenMarker`) |
| free route | A transition drawn as the stored polyline (`from`, `via`, `to`) | [format-v1.md](format-v1.md#transition-routes) |
| S route | A transition whose orthogonal route is derived from the state boxes (an S, L or U), storing only what the user pinned | `diagram/route.ts` |
| jog | The movable middle segment of an S route, stored as `{x}` or `{y}` once dragged | `diagram/route.ts` |
| label anchor | The point on a route a transition's label position is relative to | `diagram/route.ts` |
| label layout | A transition label's items wrapped at its width; widths come from a measure (the editor's canvas, or an estimate) | `diagram/label-layout.ts` |

## Semantics and code generation

| Term | Meaning | Where |
|---|---|---|
| configuration | The set of active vertices | [semantics.md](semantics.md#terms) |
| document order, post-order | The two traversal orders everything is defined in: entry follows document order, selection visits states in post-order | [semantics.md](semantics.md#terms) |
| macrostep, microstep | `reset()`/`process()` run one macrostep: a microstep for the event, then microsteps until the machine is stable | [semantics.md](semantics.md#steps) |
| settle | The part of a macrostep after the event's microstep: eventless transitions, then queued signals, until nothing is enabled | [semantics.md](semantics.md#steps) |
| livelock | A macrostep longer than `maxMicrosteps`: an error | [semantics.md](semantics.md#steps) |
| compound transition | A transition with forks and joins resolved: the model transitions it is made of, its sources and targets | `semantics/structure.ts` |
| domain | The innermost region containing a transition's sources, targets and any fork or join between; its exit set is the active vertices inside it | [semantics.md](semantics.md#terms) |
| conflict | Two transitions whose domains contain one another: their exit sets could overlap, only the first one selected fires | [semantics.md](semantics.md#selecting-transitions) |
| busy | A call that did not finish (an error, an exception from an action, a nested `process()`): `process()` then fails with `busy` until `reset()` | [semantics.md](semantics.md#failed-and-nested-calls), `runtime/contract.ts` |
| flat tables | The machine as static arrays: what generated code runs | `semantics/flatten.ts` |
| slot | A vertex's number in its region's flat table, 1-based; `cfg[region]` holds the active slot, 0 for none | `semantics/flatten.ts` |
| offer | Per trigger, a state in post-order with its candidate transitions | `semantics/flatten.ts` |
| candidate | One transition an offer tries, in order; the first enabled one is taken if nothing it conflicts with was | `semantics/flatten.ts` |
| blocks | The regions a transition marks as taken: a later candidate whose domain is blocked is skipped (the conflict check, precomputed) | `semantics/flatten.ts` |
| IR | The imperative code every backend prints, lowered from the flat tables; every semantic decision is made in the lowering | `ir/ir.ts`, `ir/lower.ts` |
| fallible | An IR function that can fail (it emits a signal, counts a microstep, or calls one that can): printed with an error return | `ir/analyze.ts` |
| fingerprint | A 32-bit hash of the numbering of events, signals, states and transitions; a host decoding trace hooks checks it | `ir/ids.ts` |
| target | A code generator (`c`, `python`, `ts`, `rust`, `go`) and its settings under `targets.<name>` | [format-v1.md](format-v1.md#targets) |
| behaviour option, API option | Options that change what the machine does (`signalQueue`, `maxMicrosteps`; set in `options` only) or only the generated API (`debugInfo`, `trace`; overridable per target) | `format/options.ts` |

## Four meanings of "trace", and the other words for them

| Term | Meaning | Where |
|---|---|---|
| trace (conformance trace) | A test case as data: a model, then steps (reset, send, guard values) and the action calls expected. Replayed against every engine | `tests/traces/*.json`, `interp/trace.ts` (`Trace`, `TraceStep`, `runTrace`) |
| trace hook | With the `trace` option, generated code calls a function the application implements with ids only: event taken, signal taken, transition taken, state entered, state exited | [semantics.md](semantics.md#numbering-and-trace-hooks) |
| step event | What the interpreter reports to `RunOptions.onStep` while it runs (a call, an entry, a transition, ...); the simulator and tests use it. Not a trace | `runtime/contract.ts` (`StepEvent`) |
| live trace | A planned compact recording of a run on the target, replayed in the simulator | [live-trace.md](live-trace.md) |

## Editor

| Term | Meaning | Where |
|---|---|---|
| workspace | The editor's one store: open machines, the active one, clipboard, status message | `apps/editor/src/workspace.ts` |
| session | One open machine (a tab): document, undo history, index, findings, sheet, selection, view, simulator state | `apps/editor/src/session.ts` |
| change kind | What a change touched (`document`, `selection`, `view`, `sim`, `chrome`, `shell`, `active`); the shell redraws accordingly | `apps/editor/src/workspace.ts` |
| command | A menu entry, palette row and key action, defined once | `apps/editor/src/commands.ts` |
| editor model | The editor's own interaction state machine | `apps/editor/src/fsm/editor.ufsm`, `KEYMAP.md` |
| tool | What a click does: select, or place a vertex / draw a transition (armed from the palette, the Add menu or `a` + key) | `apps/editor/src/canvas/state.ts` |
| ghost | The outline of what a click would place, following the pointer while a tool is armed | `apps/editor/src/canvas/tools.ts` |
| grip, handle | What a press at a point would drag (a vertex, a side or corner, an end, a jog, a bend point, a label); handles are the grips drawn on the selection | `apps/editor/src/handles.ts` |
| preview | An interactive edit shown before it is committed as one undo step (`begin`/`preview`/`commit`) | `apps/editor/src/history.ts`, `session.ts` |
