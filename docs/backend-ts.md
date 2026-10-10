# TypeScript backend

`ufsm generate ts` turns a model into one typed TypeScript module. It
imports nothing and uses only *erasable* syntax (no `enum`, `namespace` or
parameter properties), so it runs as-is with Node's type stripping, Deno,
Bun, esbuild, Vite or `tsc`, and stripping the types gives plain modern
JavaScript. It compiles under `strict` together with
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature` and
`erasableSyntaxOnly`, with only the ES2020 library (no DOM or Node types).

Behaviour is defined by [semantics.md](semantics.md); the generated code is
a direct print of the IR (`ufsm ir <model>`), the same IR the
[C](backend-c.md), [Python](backend-python.md) and [Rust](backend-rust.md) backends print, and it is
tested against the reference interpreter (see [Testing](#testing)). The
editor's own interaction logic is generated with it.

The generated code may be used under any terms ([output exception](../LICENSE-EXCEPTION)); uFSM itself is GPL-3.0-or-later.

## Generating

```sh
npm run ufsm -- generate ts examples/dimmer.ufsm -o build/
# wrote build/dimmer.ts
```

The model must pass `ufsm check` without errors. Settings come from the
model's `targets.ts` section and can be overridden on the command line:

| `targets.ts` key | Flag | Default | Meaning |
|------------------|------|---------|---------|
| `className` | `--class-name` | model name in PascalCase (`test_guard1` → `TestGuard1`) | Machine class; also names `<Class>Event`, `<Class>Handler`, `<Class>Error`, `<Class>ErrorCode` |
| `module` | | model name as an identifier | File name: `<module>.ts` |

Unknown keys, and the behaviour options below, are reported as warnings and ignored there.

The model's [`options`](format-v1.md#options) section sets what every target
shares; the flags override it for one run:

| `options` key | Flag | Default | Meaning |
|---------------|------|---------|---------|
| `signalQueue` | `--signal-queue` | 16 | Capacity of the signal queue (only generated if the model emits signals) |
| `maxMicrosteps` | `--max-microsteps` | 10000 | Microsteps per `reset`/`process` call before a `livelock` error; 0 removes the check |
| `debugInfo` | `--debug-info` | false | Name lookup and an is-active query ([Debugging](#debugging)) |
| `trace` | `--trace` | false | A trace hook the application implements ([Debugging](#debugging)) |

`signalQueue` and `maxMicrosteps` change behaviour, so they are set in
`options` only, never per target: a model behaves the same in every language
and in the simulator, queue overflows included. `debugInfo` and `trace` change
only the generated API, so `targets.ts` may override them for this language.

## Generated API

For `examples/dimmer.ufsm`:

```ts
export type DimmerErrorCode = "queue-overflow" | "livelock" | "unknown-event" | "not-started" | "busy";
export class DimmerError extends Error {
  readonly code: DimmerErrorCode;
}

export const DimmerEvent = { eButton: 0, eOffButton: 1 } as const;
export type DimmerEvent = (typeof DimmerEvent)[keyof typeof DimmerEvent]; // 0 | 1

export interface DimmerHandler {
  lamp_off(): void;
  lamp_10_percent(): void;
  // ... one method per action; guards: <guard>(): boolean;
}

export class Dimmer {
  constructor(handler: DimmerHandler); // stores the handler; runs nothing yet
  reset(): void;                       // start, or restart; no exit actions run
  process(event: DimmerEvent): void;
}
```

- The handler is any object with one method per action and guard, named as
  in the model: a class that `implements DimmerHandler`, or an object
  literal. The compiler reports a missing or misspelled method where the
  machine is constructed. Guards return a `boolean`. They may be called more
  than once per event and in any order, so they should not have side
  effects.
- The constructor does not start the machine, so the handler can keep a
  reference to it before the first entry action runs. Call `reset()` first;
  `process()` before that throws `not-started`.
- Errors throw `<Class>Error` with the interpreter's error code. After an
  error the machine is in an undefined state until `reset()`.
- An exception thrown by an action or guard is not caught: it leaves
  `reset()`/`process()` unchanged, half-way through a microstep. Until the
  next `reset()`, `process()` then throws `busy`, as it does when an action
  or guard calls `process()` itself (that nested call changes nothing; the
  outer call goes on). See
  [Failed and nested calls](semantics.md#failed-and-nested-calls).
- Events are a const object plus a union type of its values, the erasable
  replacement for an `enum`. `process` checks at run time too: anything
  else throws `unknown-event`.
- Declaration names are used as written. JavaScript keywords are fine (they
  are only property names: `TestGuardTermsEvent.not`); names every object
  already has (`constructor`, `toString`, `valueOf`, ...) are rejected.
- Signals are internal: actions emit them, and `process` runs them (FIFO)
  after the event until the queue is empty. `queue-overflow` means more
  than `signalQueue` signals were waiting at once.
- After a terminate pseudo-state is reached, `process` does nothing until
  `reset()`.
- Everything `private` (`cfg`, `step_eButton`, ...) is internal and may
  change between uFSM versions.

## Debugging

Always generated: a state enum (normal and final states in document order,
named after the states; a name that repeats is qualified with its parent
states, and free text is made an identifier: `10%` becomes `s10_`) and the
model's fingerprint, which identifies how events, signals, states and
transitions are numbered (`ufsm info` prints it for a model file; see
[Numbering and trace hooks](semantics.md#numbering-and-trace-hooks)). A host
that decodes ids should check it.

```ts
export const DimmerState = { Off: 0, On: 1, s10_: 2 /* 10% */, /* ... */ } as const;
export type DimmerState = (typeof DimmerState)[keyof typeof DimmerState];

export class Dimmer {
  static readonly FINGERPRINT = 0xc57ac6ea;
  // ...
}
```

With `debugInfo`, the machine class gets the names as in the model, by number,
and an is-active query:

```ts
  static readonly EVENT_NAMES: readonly string[] = ["eButton", "eOffButton"];
  static readonly SIGNAL_NAMES: readonly string[] = [];
  static readonly STATE_NAMES: readonly string[] = ["Off", "On", "10%", "30%", "50%", "100%"];
  isActive(state: DimmerState): boolean;
```

With `trace`, `DimmerTraceKind` (`event`, `signal`, `transition`, `enter`,
`exit`) and one more handler method, called with ids only (the transition
numbers are listed in a comment in the class; a `DimmerSignal` object is
generated when the model has signals):

```ts
export interface DimmerHandler {
  // ... actions and guards ...
  trace(kind: DimmerTraceKind, id: number): void;
}
```

`trace` runs inside `reset()` and `process()`, so it must not block or call the
machine. An action named `trace` clashes with it while `trace` is on.

## Example

```ts
import { Dimmer, DimmerEvent, type DimmerHandler } from "./dimmer.ts";

class Lamp implements DimmerHandler {
  percent = 0;
  lamp_off(): void {
    this.percent = 0;
  }
  lamp_10_percent(): void {
    this.percent = 10;
  }
  lamp_30_percent(): void {
    this.percent = 30;
  }
  lamp_50_percent(): void {
    this.percent = 50;
  }
  lamp_100_percent(): void {
    this.percent = 100;
  }
}

const lamp = new Lamp();
const machine = new Dimmer(lamp);
machine.reset(); // Off
machine.process(DimmerEvent.eButton); // On, 10%
machine.process(DimmerEvent.eButton); // 30%
machine.process(DimmerEvent.eOffButton); // Off
machine.process(DimmerEvent.eButton); // On again: history restores 30%
console.log(`lamp at ${lamp.percent}%`); // lamp at 30%
```

`./dimmer.ts` with the extension is what Node's type stripping needs
(`allowImportingTsExtensions` in a tsconfig); with a bundler, `./dimmer`
works too.

## Inside the generated module

The machine class starts with a table of regions and their states (the
value of `cfg[region]` for each state). Its private methods are the IR
functions: `enter_rN`, `exit_rN`, `record_rN`, `restore_rN`,
`step_<event>` / `step_<signal>` / `eventless` (one microstep; they return
whether one ran) and `settle`. Errors are exceptions, so no return codes
are passed around. `onEvent` and `onSignal` map event and signal numbers
to step methods.

## Testing

`packages/core/test/backend-ts.test.ts` imports the generated modules into
the test process, so it needs nothing beyond the repository's own
dependencies. It checks that:

- all conformance traces in `tests/traces/` pass;
- on random event sequences (with random guard values), every repo model,
  300 random models (`UFSM_TS_RANDOM=<n>` for more), 100 random models with
  a 2-slot queue and a hand-built IR covering every expression shape call
  exactly the same actions, end in the same states and fail with the same
  errors as the reference interpreter;
- every module type-checks under the settings above with only the ES2020
  library, and so does the example above, while a caller with an
  incomplete handler or an out-of-range event number is rejected;
- the example runs under plain Node and prints `lamp at 30%`.
