# Go backend

`ufsm generate go` turns a model into one Go source file, a package of its
own. It imports nothing, is exactly what `gofmt` prints, passes `go vet`,
starts with the `// Code generated ... DO NOT EDIT.` line Go tools look for,
and needs Go 1.20 or newer. The machine is a fixed-size value (arrays, a
ring buffer for signals), so it allocates nothing after `New`.

Behaviour is defined by [semantics.md](semantics.md); the generated code is
a direct print of the IR (`ufsm ir <model>`), the same IR the
[C](backend-c.md), [Python](backend-python.md), [TypeScript](backend-ts.md)
and [Rust](backend-rust.md) backends print, and it is tested against the
reference interpreter (see [Testing](#testing)).

The generated code may be used under any terms ([output exception](../LICENSE-EXCEPTION)); uFSM itself is GPL-3.0-or-later.

## Generating

```sh
npm run ufsm -- generate go examples/dimmer.ufsm -o build/dimmer
# wrote build/dimmer/dimmer.go
```

The package is the namespace, as Go code is usually laid out: one machine
per package, in a folder of its own (`targets.go.out`). The model must pass
`ufsm check` without errors. Settings come from the model's `targets.go`
section and can be overridden on the command line:

| `targets.go` key | Flag | Default | Meaning |
|------------------|------|---------|---------|
| `package` | | model name as an identifier, lower case (`New model` → `new_model`) | Package name |
| `className` | `--class-name` | `Machine` | Name of the machine type (`New` returns a `*Machine`) |
| `file` | | the package name | File name: `<file>.go` |
| `out` | `-o` | current directory | Output folder, relative to the model's file or absolute ([targets](format-v1.md#targets)) |

Unknown keys, and the behaviour options below, are reported as warnings and ignored there.

The model's [`options`](format-v1.md#options) section sets what every target
shares; the flags override it for one run:

| `options` key | Flag | Default | Meaning |
|---------------|------|---------|---------|
| `signalQueue` | `--signal-queue` | 16 | Capacity of the signal queue (only generated if the model emits signals) |
| `maxMicrosteps` | `--max-microsteps` | 10000 | Microsteps per `Reset`/`Process` call before `ErrLivelock`; 0 removes the check |
| `debugInfo` | `--debug-info` | false | Names and an is-active query ([Debugging](#debugging)) |
| `trace` | `--trace` | false | A trace hook the application implements ([Debugging](#debugging)) |

`signalQueue` and `maxMicrosteps` change behaviour, so they are set in
`options` only, never per target: a model behaves the same in every language
and in the simulator, queue overflows included. `debugInfo` and `trace` change
only the generated API, so `targets.go` may override them for this language.

## Generated API

For `examples/dimmer.ufsm`:

```go
package dimmer

type Error struct{ /* private */ }
func (e *Error) Error() string
func (e *Error) Code() string // "queue-overflow", "livelock", "unknown-event", "not-started", "busy"

var ErrQueueOverflow, ErrLivelock, ErrUnknownEvent, ErrNotStarted, ErrBusy *Error

type Event int
const (
	EventEButton Event = iota
	EventEOffButton
)

type Handler interface {
	Lamp_off()
	Lamp_10_percent()
	// ... one method per action; guards: <Guard>() bool
}

type Machine struct{ /* private */ }
func New(handler Handler) *Machine         // stores the handler; runs nothing yet
func (m *Machine) Reset() error             // start, or restart; no exit actions run
func (m *Machine) Process(event Event) error
```

- Go only lets another package implement an interface with exported
  methods, so declaration names get their first letter capitalized and are
  otherwise kept as written: action `lamp_off` is `Lamp_off()`, event
  `eButton` is `EventEButton`, state `Off` is `StateOff`. Names that differ
  only further on stay apart (`eKey_F_down` and `eKey_f_down`); two names
  that differ only in their first letter's case, or that become a name the
  file defines (`TimerStart`, `Trace`, `New`, `Fingerprint`, ...), are
  refused with a message naming both.
- The handler is any type with those methods; the compiler reports a
  missing one where `New` is called. Guards return a `bool`. They may be
  called more than once per event and in any order, so they should not
  have side effects.
- `New` does not start the machine, so the handler can keep the `*Machine`
  before the first entry action runs. Call `Reset` first; `Process` before
  that returns `ErrNotStarted`.
- Errors are returned as one of the `Err` values (compare with `==` or
  `errors.Is`); `Code()` gives the interpreter's error code. After an error
  the machine is in an undefined state until `Reset`, and `Process`
  returns `ErrBusy` until then.
- A panic in an action or guard is not recovered: it unwinds through the
  machine and leaves it half-way. If the application recovers, `Process`
  returns `ErrBusy` until `Reset`, as it does when an action or guard calls
  `Process` on its own machine (that nested call changes nothing; the outer
  call goes on). See [Failed and nested calls](semantics.md#failed-and-nested-calls).
- A machine is not safe for concurrent use: call it from one goroutine, or
  guard it with a mutex (the busy latch detects a nested call, not a race).
- Signals are internal: actions emit them, and `Process` runs them (FIFO)
  after the event until the queue is empty. `ErrQueueOverflow` means more
  than `signalQueue` signals were waiting at once.
- After a terminate pseudo-state is reached, `Process` does nothing until
  `Reset`.
- Everything unexported (`cfg`, `step_eButton`, ...) is internal and may
  change between uFSM versions.

## Timers

A model with [timers](format-v1.md#timers) gets a `Timer` type, two more
handler methods and `Timer.Event()`, the event to process when a timer
expires (none of this without timers). For a model with timers `travel`
and `poll`:

```go
type Timer int
const (
	TimerTravel Timer = iota
	TimerPoll
)
func (t Timer) Event() Event

type Handler interface {
	TimerStart(timer Timer, ms uint32, periodic bool)
	TimerStop(timer Timer)
	// ... actions and guards
}
```

A handler can keep one `*time.Timer` per timer and send the expiry to the
goroutine that owns the machine:

```go
type doorHandler struct {
	timers  map[door.Timer]*time.Timer
	expired chan door.Timer // the machine's goroutine calls m.Process(t.Event()) for each
}

func (d *doorHandler) TimerStart(t door.Timer, ms uint32, periodic bool) {
	d.timers[t] = time.AfterFunc(time.Duration(ms)*time.Millisecond, func() { d.expired <- t })
	// periodic: start it again when the expiry is handled
}

func (d *doorHandler) TimerStop(t door.Timer) {
	if tm, ok := d.timers[t]; ok {
		tm.Stop()
		delete(d.timers, t)
	}
}
```

The contract, as in every language:

- Stopping a timer that is not running does nothing.
- A periodic timer is started once; the application re-arms it every period.
- After a stop returns, no expiry of the earlier start should be delivered.
  One that is already queued arrives as an ordinary event and is handled as
  such (in a state that does not react to it, nothing happens).
- Start and stop run inside `Reset` and `Process`: they must not block or
  call the machine. `Reset` stops every timer first, whatever runs.

See [Timers](semantics.md#timers) for when the machine starts and stops them.

## Debugging

Always generated: a `State` type (normal and final states in document order,
named after the states; a name that repeats is qualified with its parent
states, and free text is made an identifier: `10%` becomes `StateS10_`) and
the model's fingerprint, which identifies how events, signals, states and
transitions are numbered (`ufsm info` prints it for a model file; see
[Numbering and trace hooks](semantics.md#numbering-and-trace-hooks)). A host
that decodes ids should check it.

```go
type State int
const (
	StateOff State = iota
	StateOn
	// 10%
	StateS10_
	// ...
)

const Fingerprint uint32 = 0xc57ac6ea
```

With `debugInfo`, `Event`, `State`, `Timer` (and `Signal`, when the model has
signals) get a `String()` method that returns the name as in the model (""
for a number out of range), so `fmt` prints them by name, and the machine an
is-active query:

```go
func (m *Machine) IsActive(state State) bool
```

With `trace`, a `TraceKind` type (`TraceEvent`, `TraceSignal`,
`TraceTransition`, `TraceEnter`, `TraceExit`) and one more handler method,
called with ids only (the transition numbers are listed in a comment above
the machine type; a `Signal` type is generated when the model has signals):

```go
type Handler interface {
	// ... actions and guards ...
	Trace(kind TraceKind, id int)
}
```

`Trace` runs inside `Reset` and `Process`, so it must not block or call the
machine. An action named `Trace` clashes with it while `trace` is on.

## Example

```go
package main

import (
	"fmt"

	"example.com/lamp/dimmer"
)

type lamp struct{ percent int }

func (l *lamp) Lamp_off() { l.percent = 0 }
func (l *lamp) Lamp_10_percent() { l.percent = 10 }
func (l *lamp) Lamp_30_percent() { l.percent = 30 }
func (l *lamp) Lamp_50_percent() { l.percent = 50 }
func (l *lamp) Lamp_100_percent() { l.percent = 100 }

func main() {
	l := &lamp{}
	m := dimmer.New(l)
	steps := []func() error{
		m.Reset, // Off
		func() error { return m.Process(dimmer.EventEButton) },    // On, 10%
		func() error { return m.Process(dimmer.EventEButton) },    // 30%
		func() error { return m.Process(dimmer.EventEOffButton) }, // Off
		func() error { return m.Process(dimmer.EventEButton) },    // On again: history restores 30%
	}
	for _, step := range steps {
		if err := step(); err != nil {
			panic(err)
		}
	}
	fmt.Printf("lamp at %d%%\n", l.percent) // lamp at 30%
}
```

`example.com/lamp/dimmer` is the folder the file was generated into, inside
your module.

## Inside the generated file

A comment above the machine type lists the regions and their states (the
value of `cfg[region]` for each state). The unexported methods are the IR
functions: `enter_rN`, `exit_rN`, `record_rN`, `restore_rN`,
`step_<event>` / `step_<signal>` / `eventless` (one microstep; they return
whether one ran) and `settle`. A method that can fail (a full queue, a
livelock) also returns an `error`, and every caller passes it up.

## Testing

`packages/core/test/backend-go.test.ts` builds the generated packages with
`go` and runs them against the same scripts as the interpreter. It skips
without Go (`$GO`, else `go` on `PATH`; gofmt from `$GOFMT`, else
`GOROOT/bin`); CI sets `UFSM_REQUIRE_GO` so a missing toolchain fails
instead. It checks that:

- all conformance traces in `tests/traces/` pass (including an action that
  panics and one that calls `Process` on its own machine);
- on random event sequences (with random guard values), every repo model,
  300 random models (`UFSM_GO_RANDOM=<n>` for more), the debugInfo + trace
  hooks, 100 random models with a 2-slot queue and a hand-built IR covering
  every expression shape call exactly the same actions, end in the same
  states and fail with the same errors as the reference interpreter;
- every repo model and 40 random models, with and without `debugInfo` and
  `trace`, pass `go vet` and are unchanged by `gofmt`;
- a handler that misses an action, or an `int` passed as an event, does not
  compile;
- the example above prints `lamp at 30%`.
