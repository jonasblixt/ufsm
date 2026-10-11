# Contributing

Setup is in the [README](../README.md); how the code fits together is in [architecture.md](architecture.md), and the
words it uses are in the [glossary](glossary.md). This page has the everyday rules and recipes for the changes people
make most.

## Every change

- `npm run typecheck`, `npm test` and `npm run format:check` pass (CI runs all three; `npm run format` fixes the
  formatting). The tests skip generated-code checks when a tool is missing: C needs a compiler (`CC`, else `cc`, `gcc`
  or `clang`), Python 3.8+ and pyright, Rust needs rustc, clippy and rustfmt. CI has all of them.
- Editor changes that touch drawing, hit testing or interaction: run the browser check too
  (`apps/editor/test/browser/check.mjs`; `.claude/rules/editor.md` says how).
- Every source file starts with the SPDX licence header (a test checks it); generated code never does.
- Behaviour changes come with tests. A change to what a model *does* updates [semantics.md](semantics.md), the
  interpreter and a trace in `tests/traces/` together, the trace's expectations worked out from the document by hand.
- Model files are written by the canonical writer only: `npm run ufsm -- fmt <file>`, never by hand.
- Commit messages: a subject under ~60 characters with an area prefix (`core:`, `editor:`, `gen/c:`, `test:`, `docs:`,
  `ci:`), a short body only when the reason is not obvious.

## Add a design rule

1. Decide where it goes. A rule about what the machine does goes in `packages/core/src/check/semantic.ts`; a rule about
   how it is drawn goes in `check/diagram.ts` and is only ever a warning. An *error* means a later stage would fail or
   be wrong without it: the check is the one validity gate, so if a stage (structure, flattening, lowering, a printer)
   cannot handle a construct, the rule that rejects it belongs here, not a throw there.
2. Report it with `err(code, message, id)` or `warn(...)`: a stable kebab-case `code`, a message that names the
   element, and the `id` of the element the editor should jump to.
3. Test it in `packages/core/test/v1.test.ts` (design rule check). If it guards a later stage, add a case to
   `test/gate.test.ts` too: the model gets the error, and `generateFiles` and the interpreter refuse it with their own
   error classes.
4. List it in [format-v1.md](format-v1.md#design-rule-check).

The editor's Problems tab, the canvas badges and `ufsm check` pick it up by themselves.

## Add an editor command

1. Add an entry to the table in `apps/editor/src/commands.ts`: `id`, `label`, `keys` as shown, `run`, and `enabled`
   when it only applies sometimes. Put its id into a menu in `menus` to show it there; every enabled menu entry is also
   in the command palette (`>` in the search).
2. To give it a key, add a transition (or an internal transition) in the editor's model
   `apps/editor/src/fsm/editor.ufsm` whose action has the command's id as its name. Edit the model in the editor
   itself, then `npm run gen:editor-fsm`: it regenerates `editor-fsm.ts` and `KEYMAP.md`. Add the id to
   `COMMAND_ACTIONS` in `canvas/keys.ts`; the compiler then insists the handler implements it.
3. When the key changes how the interaction behaves (a new mode, a guard), extend `tests/traces/editor.json`; every
   backend replays it.
4. Add it to the README's controls table, and check it in the browser check if it changes what is drawn.

## Add a code generator option

- **An option for every target** (like `signalQueue` or `debugInfo`): decide whether it changes behaviour (set in
  `options` only, the same for every language) or only the generated API (overridable in `targets.<name>`). Add it to
  `format/model.ts`, `format/schema.ts` (then `npm run gen:schema`), `format/options.ts` (defaults, behaviour vs API),
  `CommonOptions` in `backends/common.ts`, the IR or the lowering when it changes what is generated (a printer makes no
  semantic decision), each printer, [format-v1.md](format-v1.md#options), the backend docs, the CLI flags and the
  editor's Project tab (`apps/editor/src/panel/project.tsx`). A behaviour option also reaches the interpreter, the
  simulator and the trace format.
- **An option of one target** (like `prefix` for C): add its key to `<TARGET>_TARGET_KEYS` and the backend's options
  interface, use it in the printer's context function, document it in `docs/backend-<lang>.md`, add it to `TARGETS` in
  `panel/project.tsx`, and test reading `targets.<name>` and its effect in `test/backend-<lang>.test.ts`.

## Add a backend

1. Write `packages/core/src/backends/<lang>.ts` in the shape the others have: a context function that resolves names,
   checks clashes and calls `prepare()`, then named parts that take the context and a line writer. Import only
   `common.ts` and the IR, never another backend. The output is deterministic and clean under the language's strictest
   compiler, type checker and linter settings.
2. Register it in `backends/generate.ts` (`CodeTarget`, `CODE_TARGETS`, its options), the CLI's `generate` command and
   the editor's code preview (`apps/editor/src/code.ts`) and Project tab.
3. Test it: `test/backend-<lang>.test.ts` is a `BackendSpec` passed to `describeBackend` (`test/backend-contract.ts`),
   which runs every trace, the differential runs against the interpreter and the contract checks, plus what is
   specific to the language (compile, type check, lint, the documented example). A driver that runs scripts follows the
   protocol in `test/harness.ts` (`driverLines`, `parseDriverOutput`); an in-process backend gives `machines` too.
4. Document it in `docs/backend-<lang>.md` and give CI the tools it needs.
