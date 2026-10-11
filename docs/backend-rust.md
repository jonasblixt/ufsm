# Rust backend

`ufsm generate rust` turns a model into one Rust module (`<name>.rs`). It
is as static as the [C output](backend-c.md): fixed-size arrays, a ring
buffer for signals, no heap, no `unsafe`, no dependencies and only `core::`
paths, so it builds in `#![no_std]` crates for microcontrollers as well as
in ordinary programs. It needs Rust 1.81 or newer and works with editions
2021 and 2024.

The module has no inner attributes (`#![...]`) or `//!` comments, so it can
be a module file (`mod dimmer;`) or be pulled in with `include!` (for
example from a build script's `OUT_DIR`). It compiles without warnings
under `-D warnings -W missing_docs`, passes clippy's default and pedantic
lints, and is formatted as `rustfmt` formats it, so `cargo fmt --check` and
`cargo clippy` leave a committed copy alone.

Behaviour is defined by [semantics.md](semantics.md); the generated code is
a direct print of the IR (`ufsm ir <model>`), the same IR the
[C](backend-c.md), [Python](backend-python.md) and
[TypeScript](backend-ts.md) backends print, and it is tested against the
reference interpreter (see [Testing](#testing)).

The generated code may be used under any terms ([output exception](../LICENSE-EXCEPTION)); uFSM itself is GPL-3.0-or-later.

## Generating

```sh
npm run ufsm -- generate rust examples/dimmer.ufsm -o build/
# wrote build/dimmer.rs
```

The model must pass `ufsm check` without errors. Settings come from the
model's `targets.rust` section and can be overridden on the command line:

| `targets.rust` key | Flag | Default | Meaning |
|--------------------|------|---------|---------|
| `className` | `--class-name` | model name in PascalCase (`test_guard1` → `TestGuard1`) | Name of the machine struct |
| `module` | | model name in snake_case (`New model` → `new_model`) | File name: `<module>.rs` |
| `out` | `-o` | current directory | Output folder, relative to the model's file or absolute ([targets](format-v1.md#targets)) |

Unknown keys, and the behaviour options below, are reported as warnings and ignored there.

The model's [`options`](format-v1.md#options) section sets what every target
shares; the flags override it for one run:

| `options` key | Flag | Default | Meaning |
|---------------|------|---------|---------|
| `signalQueue` | `--signal-queue` | 16 | Capacity of the signal queue (only generated if the model emits signals) |
| `maxMicrosteps` | `--max-microsteps` | 10000 | Microsteps per `reset`/`process` call before a `Livelock` error; 0 removes the check |
| `debugInfo` | `--debug-info` | false | Name lookup and an is-active query ([Debugging](#debugging)) |
| `trace` | `--trace` | false | A trace hook the application implements ([Debugging](#debugging)) |

`signalQueue` and `maxMicrosteps` change behaviour, so they are set in
`options` only, never per target: a model behaves the same in every language
and in the simulator, queue overflows included. `debugInfo` and `trace` change
only the generated API, so `targets.rust` may override them for this language.

## Generated API

For `examples/dimmer.ufsm`:

```rust
pub enum Error { NotStarted, QueueOverflow, Livelock, Busy } // Copy, Eq, Hash, Display, core::error::Error
impl Error {
    pub fn code(self) -> &'static str; // "not-started", "queue-overflow", "livelock", "busy"
}

pub enum Event { eButton, eOffButton } // Copy, Eq, Hash, Debug

pub trait Handler {
    fn lamp_off(&mut self);
    fn lamp_10_percent(&mut self);
    // ... one method per action; guards: fn <guard>(&mut self) -> bool;
}

pub struct Dimmer<H> { /* private */ }
impl<H> Dimmer<H> {
    pub fn new(handler: H) -> Self;     // stores the handler; runs nothing yet
    pub fn handler(&self) -> &H;
    pub fn handler_mut(&mut self) -> &mut H;
    pub fn into_handler(self) -> H;
}
impl<H: Handler> Dimmer<H> {
    pub fn reset(&mut self) -> Result<(), Error>;   // start, or restart; no exit actions run
    pub fn process(&mut self, event: Event) -> Result<(), Error>;
}
```

- The machine owns its handler, any type that implements `Handler`: one
  method per action and guard, named as in the model. Use `handler()` and
  `handler_mut()` to reach it between events (for example to read what the
  actions recorded, or to change what a guard will return), and
  `into_handler()` to get it back.
- Guards take `&mut self` (reading a pin through embedded-hal 1.0 needs
  that) and return `bool`. They may be called more than once per event and
  in any order, so they should not have side effects.
- `new()` does not start the machine. Call `reset()` first; `process()`
  before that returns `Err(Error::NotStarted)`.
- Errors are returned, never panics. After an error the machine is in an
  undefined state until `reset()`, and `process()` returns
  `Err(Error::Busy)` until then. `code()` gives the interpreter's error
  code; `Display` gives a sentence.
- A panic in an action or guard unwinds through the machine. With
  `panic = "abort"` (usual on embedded targets) that ends the program; if
  the application catches it (`catch_unwind`, std only), the machine is
  left half-way and `process()` returns `Err(Error::Busy)` until `reset()`.
  An action cannot call `process()` on its own machine: the machine is
  borrowed while it runs, so the nested call that the other languages
  refuse at run time does not compile. See
  [Failed and nested calls](semantics.md#failed-and-nested-calls).
- Names are used as written, so events keep their case
  (`Event::eButton`; `#[allow(non_camel_case_types)]` is on the enum).
  Rust keywords become raw identifiers (`Event::r#type`, `fn r#match`);
  the few that cannot be raw (`self`, `Self`, `super`, `crate`, `_`) get a
  trailing underscore (`self_`), and the generator refuses a model where
  that would clash with another name.
- The machine calls actions as `Handler::lamp_off(&mut self.handler)`, so
  an action named like a method every type has (`into`, `clone`) cannot be
  confused with it.
- Signals are internal: actions emit them, and `process` runs them (FIFO)
  after the event until the queue is empty. `QueueOverflow` means more
  than `signalQueue` signals were waiting at once.
- After a terminate pseudo-state is reached, `process` does nothing until
  `reset()`.
- The machine derives `Debug` and `Clone` (when the handler does). Its
  fields and the private methods (`step_eButton`, `enter_r0`, ...) may
  change between uFSM versions.

## Timers

A model with [timers](format-v1.md#timers) gets a `Timer` enum and two more
`Handler` methods (none of this without timers). For `door` with timers
`travel` and `poll`:

```rust
pub enum Timer { travel, poll } // Copy, Eq, Hash, Debug
impl Timer {
    pub const COUNT: usize = 2;
    pub fn event(self) -> Event;  // the event to process when it expires
    pub fn index(self) -> usize;  // 0..COUNT, e.g. into an array of platform timers
}

pub trait Handler {
    fn timer_start(&mut self, timer: Timer, ms: u32, periodic: bool);
    fn timer_stop(&mut self, timer: Timer);
    // ... actions and guards
}
```

The handler runs the clock (an embassy or RTIC timer, a hardware timer, ...)
and the application calls `machine.process(timer.event())` on expiry, from
the context that owns the machine. With `debugInfo`, `Timer` has `name()` and
`from_index()` like the other enums. An action or guard named `timer_start`
or `timer_stop` clashes with them. Durations above 9 999 ms are printed with
digit groups (`3_600_000`) for clippy. The contract:

- Stopping a timer that is not running does nothing.
- A periodic timer is started once; the application re-arms it every period.
- After a stop returns, no expiry of the earlier start should be delivered.
  One that is already queued arrives as an ordinary event and is handled as
  such (in a state that does not react to it, nothing happens).
- Start and stop run inside `reset()` and `process()`: they must not block or
  call the machine. `reset()` stops every timer first, whatever runs.

See [Timers](semantics.md#timers) for when the machine starts and stops them.

## Debugging

Always generated: a state enum (normal and final states in document order,
named after the states; a name that repeats is qualified with its parent
states, and free text is made an identifier: `10%` becomes `s10_`) and the
model's fingerprint, which identifies how events, signals, states and
transitions are numbered (`ufsm info` prints it for a model file; see
[Numbering and trace hooks](semantics.md#numbering-and-trace-hooks)). A host
that decodes ids should check it.

```rust
pub enum State {
    Off,
    On,
    s10_, // 10%
    // ...
}

pub const FINGERPRINT: u32 = 0xc57a_c6ea;
```

With `debugInfo`, names as in the model and lookups by number on `Event`,
`State` (and `Signal`, generated when the model has signals), and an is-active
query (the names are strings in flash; nothing of this exists without the
option):

```rust
impl State {
    pub fn name(self) -> &'static str;          // "10%"
    pub fn from_index(index: u16) -> Option<Self>;
}
impl<H> Dimmer<H> {
    pub fn is_active(&self, state: State) -> bool;
}
```

With `trace`, `TraceKind` (`Event`, `Signal`, `Transition`, `Enter`, `Exit`)
and one more `Handler` method, called with ids only (the transition numbers are
listed in a comment in the struct):

```rust
pub trait Handler {
    // ... actions and guards ...
    fn trace(&mut self, kind: TraceKind, id: u16);
}
```

`trace` runs inside `reset()` and `process()`, so it must not block (the
machine is borrowed, so it cannot call it). An action named `trace` clashes
with it while `trace` is on.

## Example

```rust
mod dimmer;

use dimmer::{Dimmer, Event, Handler};

#[derive(Default)]
struct Lamp {
    percent: u32,
}

impl Handler for Lamp {
    fn lamp_off(&mut self) {
        self.percent = 0;
    }
    fn lamp_10_percent(&mut self) {
        self.percent = 10;
    }
    fn lamp_30_percent(&mut self) {
        self.percent = 30;
    }
    fn lamp_50_percent(&mut self) {
        self.percent = 50;
    }
    fn lamp_100_percent(&mut self) {
        self.percent = 100;
    }
}

fn main() -> Result<(), dimmer::Error> {
    let mut machine = Dimmer::new(Lamp::default());
    machine.reset()?; // Off
    machine.process(Event::eButton)?; // On, 10%
    machine.process(Event::eButton)?; // 30%
    machine.process(Event::eOffButton)?; // Off
    machine.process(Event::eButton)?; // On again: history restores 30%
    println!("lamp at {}%", machine.handler().percent); // lamp at 30%
    Ok(())
}
```

With a build script instead of a committed file, generate into `OUT_DIR`
and include it: `mod dimmer { include!(concat!(env!("OUT_DIR"), "/dimmer.rs")); }`.

## Inside the generated module

The machine struct starts with a table of regions and their states (the
value of `cfg[region]` for each state). Its private methods are the IR
functions: `enter_rN`, `exit_rN`, `record_rN`, `restore_rN`,
`step_<event>` / `step_<signal>` / `eventless` (one microstep; they return
whether one ran) and `settle`. Methods that can fail (they emit a signal,
count a microstep, or call one that can) return a `Result` and pass errors
up with `?`; the others return plain values. The state is `u8` per region
(wider only for regions with more than 255 states), so a machine is a few
bytes plus the queue.

## Testing

`packages/core/test/backend-rust.test.ts` needs `rustc` (`$RUSTC`, else
`rustc` on PATH); the lint and format checks also need `clippy-driver` and
`rustfmt` (`$CLIPPY_DRIVER`, `$RUSTFMT`), which come with rustup's default
profile. Without them those tests are skipped; CI sets
`UFSM_REQUIRE_RUST=1` so that missing tools fail instead. The machines
under test are modules of one library crate, built with `-D warnings`
(and with clippy when available) and driven by one test program, so the
whole run builds two crates. It checks that:

- all conformance traces in `tests/traces/` pass;
- on random event sequences (with random guard values), every repo model,
  300 random models (`UFSM_RUST_RANDOM=<n>` for more), 100 random models
  with a 2-slot queue and a hand-built IR covering every expression shape
  call exactly the same
  actions, end in the same states and fail with the same errors as the
  reference interpreter;
- every repo model builds without warnings (`-D warnings -W missing_docs`)
  in a `#![no_std]` crate with `#![forbid(unsafe_code)]`, as module files
  and through `include!`, with editions 2021 and 2024, and passes clippy's
  default and pedantic lints;
- `rustfmt --check` accepts every repo model, 60 random models and a model
  with conditions and patterns too long for one line;
- a handler that misses an action and a number passed as an event are
  compile errors;
- the example above builds and prints `lamp at 30%`.
