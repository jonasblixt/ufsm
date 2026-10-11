# C++ backend

`ufsm generate cpp` turns a model into one header-only C++ file
(`<name>.hpp`). It is as static as the [C output](backend-c.md): fixed-size
arrays, a ring buffer for signals, no heap, no virtual functions, no
exceptions thrown and no RTTI, and it includes nothing but `<cstdint>`, so
it builds for microcontrollers with `-fno-exceptions -fno-rtti` as well as
in ordinary programs. It needs C++11 or newer.

The machine is a class template over the application's handler type: the
actions and guards are ordinary member calls the compiler can inline, and a
missing one is a compile error, not a link error or a crash. The header
compiles without warnings under g++ and clang++ with `-Wall -Wextra
-Wpedantic -Wconversion -Wsign-conversion -Wshadow -Wold-style-cast
-Wzero-as-null-pointer-constant` and the other flags listed under
[Testing](#testing).

Behaviour is defined by [semantics.md](semantics.md); the generated code is
a direct print of the IR (`ufsm ir <model>`), the same IR the
[C](backend-c.md), [Python](backend-python.md), [TypeScript](backend-ts.md),
[Rust](backend-rust.md) and [Go](backend-go.md) backends print, and it is
tested against the reference interpreter.

The generated code may be used under any terms ([output exception](../LICENSE-EXCEPTION)); uFSM itself is GPL-3.0-or-later.

## Generating

```sh
npm run ufsm -- generate cpp examples/dimmer.ufsm -o build/
# wrote build/dimmer.hpp
```

The model must pass `ufsm check` without errors. Settings come from the
model's `targets.cpp` section and can be overridden on the command line:

| `targets.cpp` key | Flag | Default | Meaning |
|-------------------|------|---------|---------|
| `namespace` | | model name as an identifier, lower case (`New model` → `new_model`) | The namespace everything is declared in |
| `className` | `--class-name` | model name in PascalCase (`test_guard1` → `TestGuard1`) | Name of the machine class template |
| `file` | | the namespace | File name: `<file>.hpp` (also the include guard) |
| `out` | `-o` | current directory | Output folder, relative to the model's file or absolute ([targets](format-v1.md#targets)) |

Unknown keys, and the behaviour options below, are reported as warnings and ignored there.

The model's [`options`](format-v1.md#options) section sets what every target
shares; the flags override it for one run:

| `options` key | Flag | Default | Meaning |
|---------------|------|---------|---------|
| `signalQueue` | `--signal-queue` | 16 | Capacity of the signal queue (only generated if the model emits signals) |
| `maxMicrosteps` | `--max-microsteps` | 10000 | Microsteps per `reset`/`process` call before `Status::livelock`; 0 removes the check |
| `debugInfo` | `--debug-info` | false | Name lookup and an is-active query ([Debugging](#debugging)) |
| `trace` | `--trace` | false | A trace hook the handler implements ([Debugging](#debugging)) |

`signalQueue` and `maxMicrosteps` change behaviour, so they are set in
`options` only, never per target: a model behaves the same in every language
and in the simulator, queue overflows included. `debugInfo` and `trace` change
only the generated API, so `targets.cpp` may override them for this language.

## Generated API

For `examples/dimmer.ufsm`:

```cpp
namespace dimmer {

enum class Status : std::int8_t {
    ok = 0, queue_overflow = -1, livelock = -2, unknown_event = -3, busy = -4, not_started = -5,
};
const char *status_code(Status status); // "ok", "queue-overflow", "livelock", ...

enum class Event : std::uint16_t { eButton = 0, eOffButton = 1 };

template <typename Handler>
class Dimmer {
public:
    explicit Dimmer(Handler &handler); // keeps a reference; runs nothing yet
    Handler &handler();
    Status reset();                    // start, or restart; no exit actions run
    Status process(Event event);
};

} // namespace dimmer
```

- The handler is any class with one member function per action
  (`void lamp_off()`) and guard (`bool door_open()`), named as in the model.
  The machine keeps a reference to it, so it must outlive the machine.
  Guards may be called more than once per event and in any order, so they
  should not have side effects.
- The constructor does not start the machine. Call `reset()` first;
  `process()` before that returns `Status::not_started`.
- Errors are returned, never thrown. After an error the machine is in an
  undefined state until `reset()`, and `process()` returns `Status::busy`
  until then. `status_code()` gives the interpreter's error code.
- An exception from an action or guard is not caught: it unwinds through
  the machine and leaves it half-way, and `process()` returns
  `Status::busy` until `reset()`, as it does when an action or guard calls
  `process()` on its own machine (that nested call changes nothing; the
  outer call goes on). See
  [Failed and nested calls](semantics.md#failed-and-nested-calls).
- The busy flag is a plain `bool`, not a lock: it detects a call from an
  interrupt handler on the same core, not concurrent calls from two threads.
- Names are used as written (`Event::eButton`, `h.lamp_off()`); a C++
  keyword gets a trailing underscore (`Event::not_`, `Timer::long_`), and
  the generator refuses a model where that would clash with another name,
  or where a name is a macro of `<cstdint>` (`INT8_MAX`, ...).
- Signals are internal: actions emit them, and `process()` runs them (FIFO)
  after the event until the queue is empty. `Status::queue_overflow` means
  more than `signalQueue` signals were waiting at once.
- After a terminate pseudo-state is reached, `process()` does nothing until
  `reset()`.
- Everything `private` (`cfg_`, `step_eButton`, ...) is internal and may
  change between uFSM versions.

## Timers

A model with [timers](format-v1.md#timers) gets a `Timer` enum,
`timer_count`, `timer_event()` (the event to process when a timer expires)
and two more handler functions (none of this without timers):

```cpp
enum class Timer : std::uint16_t { travel = 0, poll = 1 };
constexpr std::uint16_t timer_count = 2u;
Event timer_event(Timer timer);

struct DoorHandler {
    void timer_start(door::Timer timer, std::uint32_t ms, bool periodic);
    void timer_stop(door::Timer timer);
    // ... actions and guards
};
```

The contract, as in every language:

- Stopping a timer that is not running does nothing.
- A periodic timer is started once; the application re-arms it every period.
- After a stop returns, no expiry of the earlier start should be delivered.
  One that is already queued arrives as an ordinary event and is handled as
  such (in a state that does not react to it, nothing happens).
- Start and stop run inside `reset()` and `process()`: they must not block or
  call the machine. `reset()` stops every timer first, whatever runs.

The [C backend's Zephyr example](backend-c.md#timers) carries over: keep one
`k_timer` per timer and queue `timer_event(timer)` for the thread that runs
the machine.

## Debugging

Always generated: a `State` enum (normal and final states in document order,
named after the states; a name that repeats is qualified with its parent
states, and free text is made an identifier: `10%` becomes `s10_`) and the
model's fingerprint, which identifies how events, signals, states and
transitions are numbered (`ufsm info` prints it for a model file; see
[Numbering and trace hooks](semantics.md#numbering-and-trace-hooks)).

```cpp
enum class State : std::uint16_t { Off = 0, On = 1, s10_ = 2, /* ... */ };
constexpr std::uint32_t fingerprint = 0xc57ac6eau;
```

With `debugInfo`, name lookup (names as in the model, `nullptr` for a value
out of range; the strings cost flash) and an is-active query:

```cpp
const char *event_name(Event value);
const char *signal_name(Signal value); // when the model has signals
const char *state_name(State value);
const char *timer_name(Timer value);   // when the model has timers
bool Dimmer<Handler>::is_active(State state) const;
```

With `trace`, a `TraceKind` enum (`event`, `signal`, `transition`, `enter`,
`exit`) and one more handler function, called with ids only (the transition
numbers are listed in a comment above the class; a `Signal` enum is
generated when the model has signals):

```cpp
void trace(dimmer::TraceKind kind, std::uint16_t id);
```

It runs inside `reset()` and `process()`, so it must not block or call the
machine. An action named `trace` clashes with it while `trace` is on.

## Example

```cpp
#include <cstdio>

#include "dimmer.hpp"

struct Lamp {
    int percent = 0;
    void lamp_off() { percent = 0; }
    void lamp_10_percent() { percent = 10; }
    void lamp_30_percent() { percent = 30; }
    void lamp_50_percent() { percent = 50; }
    void lamp_100_percent() { percent = 100; }
};

int main()
{
    Lamp lamp;
    dimmer::Dimmer<Lamp> machine(lamp);
    machine.reset();                             // Off
    machine.process(dimmer::Event::eButton);     // On, 10%
    machine.process(dimmer::Event::eButton);     // 30%
    machine.process(dimmer::Event::eOffButton);  // Off
    machine.process(dimmer::Event::eButton);     // On again: history restores 30%
    std::printf("lamp at %d%%\n", lamp.percent); // lamp at 30%
    return 0;
}
```

## Inside the generated header

A comment above the class lists the regions and their states (the value of
`cfg_[region]` for each state). The private member functions are the IR
functions: `enter_rN`, `exit_rN`, `record_rN`, `restore_rN`,
`step_<event>` / `step_<signal>` / `eventless` (one microstep; they return
whether one ran) and `settle_`. As in C, a function that can fail returns
an `int`, negative for an error, and every caller passes it up; only
`reset()` and `process()` turn it into a `Status`.

## Testing

`packages/core/test/backend-cpp.test.ts` compiles the generated headers and
runs them against the same scripts as the interpreter. It skips without a
C++ compiler (`$CXX`, else the C++ driver next to `$CC`, else `c++`, `g++`
or `clang++`); CI sets `UFSM_REQUIRE_CXX` so a missing compiler fails
instead. It checks that:

- all conformance traces in `tests/traces/` pass (including an action that
  throws and one that calls `process()` on its own machine);
- on random event sequences (with random guard values), every repo model,
  300 random models (`UFSM_CPP_RANDOM=<n>` for more), the debugInfo + trace
  hooks, 100 random models with a 2-slot queue and a hand-built IR covering
  every expression shape call exactly the same actions, end in the same
  states and fail with the same errors as the reference interpreter;
- every repo model and 40 random models, with and without `debugInfo` and
  `trace`, compile with every member function instantiated, as C++11 and
  C++20, with `-fno-exceptions -fno-rtti` and `-Wall -Wextra -Wpedantic
  -Werror -Wconversion -Wsign-conversion -Wshadow -Wold-style-cast
  -Wcast-qual -Wundef -Wzero-as-null-pointer-constant -Wextra-semi
  -Wnon-virtual-dtor` (clang also `-Wtautological-overlap-compare
  -Wunreachable-code`);
- a handler that misses an action, or an `int` passed as an event, does not
  compile;
- the example above prints `lamp at 30%`.
