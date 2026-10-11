---
paths:
  - "packages/core/src/backends/**"
  - "packages/core/src/ir/**"
  - "packages/core/test/**"
  - "docs/backend-*.md"
  - ".github/**"
---

# Code generators: requirements on generated code and their tests

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
  Generated Go is one package per machine, imports nothing, builds with Go 1.20+, passes `go vet` and must equal
  `gofmt` output (struct fields aligned by the printer, enumerations with `iota` so const blocks need no alignment,
  no trailing comments on statements). Its tests skip without go (`$GO`, else `go`; gofmt from `$GOFMT`, else
  `GOROOT/bin`); CI sets `UFSM_REQUIRE_GO`. `UFSM_GO_RANDOM=<n>` runs more random models. The driver builds one module
  (package `u<k>` per unit) with `GOTOOLCHAIN=local GOPROXY=off`.
- Timers: a test driver implements `timer_start`/`timer_stop` and logs them
  among the action calls as `~start:<name>:<ms>:<0|1>` / `~stop:<name>`
  (`driverCall` in `test/harness.ts` turns them into the trace spelling); it
  also checks the timer's expiry event (and name with `debugInfo`). Random
  models have timers (`test/random-model.ts`), so every differential pass
  covers them; `tests/traces/test_timers.json` pins the order down.
- Every backend's differential runs include a pass with `debugInfo` and
  `trace` on: generated trace hook calls are logged among the action calls as
  pseudo-calls (`decodeHooks`/`interpreterHooks` in `test/harness.ts`) and
  compared with the interpreter's `onStep`; the type/lint checks also cover a
  debug variant of every repo model. A new backend implements the same.
- Printer layout (all of them): a context function (`cContext`, `pyContext`, ...) resolves names, checks clashes and
  calls `prepare()` from `backends/common.ts` (options with defaults, `ir/analyze.ts` facts, the queue and trace
  checks); then named parts take the context and a line writer (`lines()`): expressions, statements, and one function
  per section of the output. A new backend copies that shape and imports only `common.ts` and the IR, never another
  backend. Refactorings of a printer must keep the output byte-identical (generate every repo model and some random
  models before and after, with and without `debugInfo`/`trace`, and compare).
- `test/backend-contract.ts` holds every test all backends share (traces, differential runs incl. the keyword model,
  debugInfo + trace hooks, small queue, hand-built IR shapes and tail return, determinism, timer API presence,
  `targets.<name>` reading, CodegenError); a backend's test file is a `BackendSpec` (`run`, for in-process languages
  also `machines`) plus its language-specific tests. In-process backends record script results with `recordScript`.
