# C backend

`ufsm generate c` turns a model into one header and one source file of
plain C99. The code is static: no heap, no recursion, no function
pointers, and nothing from the C library except `<stdint.h>` and
`<stdbool.h>`, so it builds freestanding for small embedded targets. It
also compiles as C++ (the header has `extern "C"` guards).

Behaviour is defined by [semantics.md](semantics.md); the generated code is
a direct print of the IR (`ufsm ir <model>` shows it as pseudo-code), and
it is tested against the reference interpreter (see [Testing](#testing)).

The generated code may be used under any terms ([output exception](../LICENSE-EXCEPTION)); uFSM itself is GPL-3.0-or-later.

## Generating

```sh
npm run ufsm -- generate c examples/dimmer.ufsm -o build/
# wrote build/dimmer.h
# wrote build/dimmer.c
```

The model must pass `ufsm check` without errors. Settings come from the
model's `targets.c` section and can be overridden on the command line:

| `targets.c` key | Flag | Default | Meaning |
|-----------------|------|---------|---------|
| `prefix` | `--prefix` | model name + `_` | Prefix of every public identifier |
| `file` | | prefix without the trailing `_` | Base name of the files: `<file>.h`, `<file>.c` |

```jsonc
"targets": { "c": { "prefix": "dimmer_" } }
```

Unknown keys, and the behaviour options below, are reported as warnings and ignored there.

The model's [`options`](format-v1.md#options) section sets what every target
shares; the flags override it for one run:

| `options` key | Flag | Default | Meaning |
|---------------|------|---------|---------|
| `signalQueue` | `--signal-queue` | 16 | Capacity of the signal queue (only generated if the model emits signals) |
| `maxMicrosteps` | `--max-microsteps` | 10000 | Microsteps per `init`/`reset`/`process` call before `ERR_LIVELOCK`; 0 removes the check |
| `debugInfo` | `--debug-info` | false | Name lookup and an is-active query ([Debugging](#debugging)) |
| `trace` | `--trace` | false | A trace hook the application implements ([Debugging](#debugging)) |

`signalQueue` and `maxMicrosteps` change behaviour, so they are set in
`options` only, never per target: a model behaves the same in every language
and in the simulator, queue overflows included. `debugInfo` and `trace` change
only the generated API, so `targets.c` may override them for this language.

## Generated API

For `examples/dimmer.ufsm` (prefix `dimmer_`):

```c
enum dimmer_status {
    DIMMER_OK = 0,
    DIMMER_ERR_QUEUE_FULL = -1, /* signal queue full */
    DIMMER_ERR_LIVELOCK = -2,   /* too many microsteps in one call */
    DIMMER_ERR_EVENT = -3,      /* unknown event */
    DIMMER_ERR_BUSY = -4,       /* an earlier call failed, or this one was made from inside a call */
};

enum dimmer_event {
    DIMMER_eButton = 0,
    DIMMER_eOffButton = 1,
};

struct dimmer_machine { /* treat as opaque */ };

int dimmer_init(struct dimmer_machine *m, void *user);   /* stores user, then reset */
int dimmer_reset(struct dimmer_machine *m);              /* restart; no exit actions run */
int dimmer_process(struct dimmer_machine *m, enum dimmer_event event);

/* Implemented by the application */
void dimmer_lamp_off(void *user);
void dimmer_lamp_10_percent(void *user);
/* ... one function per action; guards return bool: bool <prefix><guard>(void *user); */
```

- Every name is the prefix followed by a fixed name or a declaration name
  from the model. Event constants use the prefix in upper case and keep the
  event's own spelling (`DIMMER_eButton`), because declaration names may
  differ only in case (`eKey_s_down` and `eKey_S_down` in canvas.ufsm).
- Actions and guards are ordinary functions the application defines; each
  receives the `user` pointer given to `init`. Guards return `bool`
  (`<stdbool.h>`, which the header includes). They may be called more
  than once per event and in any order, so they should not have side
  effects.
- `init`, `reset` and `process` return `<PREFIX>OK` or a negative error.
  After an error the machine is in an undefined state until `reset`, and
  `process` returns `ERR_BUSY` until then. It returns `ERR_BUSY` too when
  it is called while another call runs: from an action or guard, or from an
  interrupt handler while the main loop is inside `process`. Such a call
  changes nothing and its event is lost; queue events for later instead
  (see [Failed and nested calls](semantics.md#failed-and-nested-calls)).
  The check is a plain `bool`, not a lock: it is enough on one core, where
  an interrupt runs to its end before the interrupted call goes on.
  A `longjmp` out of an action leaves the machine busy as an error does.
- A model without events has no event enum and no `process`.
- The struct holds one small integer per region (active state), one per
  history region, the deep-history snapshots, the signal queue, a
  microstep counter, a terminated flag, a busy flag and the user pointer; each part is
  only present if the model needs it. `dimmer_machine` is 16 bytes on
  x86-64. Zero-initialized storage is fine before `init`.
- Signals are internal: actions emit them, `process` runs them (FIFO) after
  the event, until the queue is empty. `ERR_QUEUE_FULL` means more than
  `signalQueue` signals were waiting at once.
- After a terminate pseudo-state is reached, `process` does nothing until
  `reset`.

The generator stops with an error, rather than producing code that does not
compile, when a generated name clashes: an action called `init` with prefix
`dimmer_` would become `dimmer_init`; with an empty prefix, names can also
clash with C keywords or the generated file's internal helpers. Rename the
declaration or choose another prefix.

## Timers

A model with [timers](format-v1.md#timers) gets a timer enum, two functions
the application implements, however many timers there are, and a lookup of
the event a timer sends when it expires. A model without timers gets none of
this. For `door` with timers `travel` and `poll`:

```c
enum door_timer {
    DOOR_TIMER_travel = 0, /* after 20000 ms -> eTravelTimeout */
    DOOR_TIMER_poll = 1,   /* every 500 ms -> ePoll */
};
#define DOOR_TIMER_COUNT 2

/* Generated: the event to process when a timer expires. */
enum door_event door_timer_event(enum door_timer timer);

/* Implemented by the application */
void door_timer_start(void *user, enum door_timer timer, uint32_t ms, bool periodic);
void door_timer_stop(void *user, enum door_timer timer);
```

The application owns the clock: on expiry it passes
`door_timer_event(timer)` to `door_process()`, like any other event. There is
no `timer_expired()` entry point and nothing is allocated. Durations reach the
application in ms (`uint32_t`, up to about 49.7 days). The contract:

- Stopping a timer that is not running does nothing.
- A periodic timer is started once; the application re-arms it every period.
- After a stop returns, no expiry of the earlier start should be delivered.
  One that is already queued arrives as an ordinary event and is handled as
  such (in a state that does not react to it, nothing happens).
- Start and stop run inside `reset()` and `process()`: they must not block or
  call the machine. `reset()` stops every timer first, whatever runs.

See [Timers](semantics.md#timers) for when the machine starts and stops them.

With Zephyr, one `k_timer` per timer and the same message queue as the other
events (no Zephyr code ships with uFSM; this is a sketch for the application):

```c
#include <zephyr/kernel.h>
#include "door.h"

K_MSGQ_DEFINE(door_q, sizeof(enum door_event), 16, 4);
static struct k_timer door_timers[DOOR_TIMER_COUNT];

static void door_expired(struct k_timer *t)
{
    /* runs in interrupt context: queue the event, the thread runs the machine */
    enum door_event e = (enum door_event)(uintptr_t)k_timer_user_data_get(t);
    (void)k_msgq_put(&door_q, &e, K_NO_WAIT);
}

void door_timer_start(void *user, enum door_timer timer, uint32_t ms, bool periodic)
{
    (void)user;
    k_timer_start(&door_timers[timer], K_MSEC(ms), periodic ? K_MSEC(ms) : K_NO_WAIT);
}

void door_timer_stop(void *user, enum door_timer timer)
{
    (void)user;
    k_timer_stop(&door_timers[timer]);
}

void door_timers_init(void)
{
    for (int i = 0; i < DOOR_TIMER_COUNT; i++) {
        k_timer_init(&door_timers[i], door_expired, NULL);
        k_timer_user_data_set(&door_timers[i], (void *)(uintptr_t)door_timer_event((enum door_timer)i));
    }
}

/* the machine's thread: door_timers_init(); door_init(&m, &app); then
 * for (;;) { enum door_event e; k_msgq_get(&door_q, &e, K_FOREVER); door_process(&m, e); } */
```

`k_timer_stop()` cannot take back an expiry that `door_expired()` already put
in the queue. The machine handles such a late event as an ordinary one; an
application that must not see it can count starts per timer and drop stale
expiries.

## Debugging

Always generated: a state enum (normal and final states in document order,
named after the states; a name that repeats is qualified with its parent
states, and free text is made an identifier: `10%` becomes `s10_`) and the
model's fingerprint, which identifies how events, signals, states and
transitions are numbered (`ufsm info` prints it for a model file; see
[Numbering and trace hooks](semantics.md#numbering-and-trace-hooks)). A host
that decodes ids should check it.

```c
enum dimmer_state {
    DIMMER_STATE_Off = 0,
    DIMMER_STATE_On = 1,
    DIMMER_STATE_s10_ = 2, /* 10% */
    /* ... */
};

#define DIMMER_FINGERPRINT 0xc57ac6eau
```

With `debugInfo`, names as in the model and an is-active query (the names are
strings in flash; nothing of this exists without the option):

```c
const char *dimmer_event_name(uint16_t event);   /* NULL for a number out of range */
const char *dimmer_signal_name(uint16_t signal); /* only when the model has signals */
const char *dimmer_state_name(uint16_t state);   /* "10%" */
bool dimmer_is_active(const struct dimmer_machine *m, uint16_t state);
const char *door_timer_name(uint16_t timer);     /* a model with timers: "travel" */
```

With `trace`, the machine calls one more function the application implements,
with ids only (a signal enum `enum dimmer_signal` is public then too):

```c
enum dimmer_trace_kind {
    DIMMER_TRACE_EVENT = 0,      /* id: enum dimmer_event; process() accepted it */
    DIMMER_TRACE_SIGNAL = 1,     /* id: signal number; taken from the queue */
    DIMMER_TRACE_TRANSITION = 2, /* id: transition number; before its actions */
    DIMMER_TRACE_ENTER = 3,      /* id: enum dimmer_state; before its entry actions */
    DIMMER_TRACE_EXIT = 4,       /* id: enum dimmer_state; before its exit actions */
};

void dimmer_trace(void *user, enum dimmer_trace_kind kind, uint16_t id);
```

The header lists the transition numbers in a comment. `dimmer_trace` runs
inside `init`, `reset` and `process`, so it must not block or call the
machine; it would typically put `kind` and `id` with a timestamp in a ring
buffer that a host decodes with the model file. The two options are
independent: ids alone are enough for a host, and with `debugInfo` the
firmware can also print names itself. An action named `trace` clashes with the
hook while `trace` is on.

## Example

```c
#include <stdio.h>
#include "dimmer.h"

struct lamp { int percent; };

void dimmer_lamp_off(void *user)         { ((struct lamp *)user)->percent = 0; }
void dimmer_lamp_10_percent(void *user)  { ((struct lamp *)user)->percent = 10; }
void dimmer_lamp_30_percent(void *user)  { ((struct lamp *)user)->percent = 30; }
void dimmer_lamp_50_percent(void *user)  { ((struct lamp *)user)->percent = 50; }
void dimmer_lamp_100_percent(void *user) { ((struct lamp *)user)->percent = 100; }

int main(void)
{
    static struct dimmer_machine m;
    struct lamp lamp = { 0 };

    if (dimmer_init(&m, &lamp) != DIMMER_OK)
        return 1;
    dimmer_process(&m, DIMMER_eButton);      /* Off -> On, 10% */
    dimmer_process(&m, DIMMER_eButton);      /* 30% */
    dimmer_process(&m, DIMMER_eOffButton);   /* Off */
    dimmer_process(&m, DIMMER_eButton);      /* On again: history restores 30% */
    printf("lamp at %d%%\n", lamp.percent);  /* lamp at 30% */
    return 0;
}
```

## Inside the generated source

The `.c` file starts with a table of regions and their states (the value
of `cfg[region]` for each state). Then come, as `static` functions:

- `enter_rN`, `exit_rN`, `record_rN`, `restore_rN`: default entry, exit,
  history recording and deep-history restore of region N;
- `step_<event>` / `step_<signal>` / `eventless`: one microstep for a
  trigger: select the transitions to take (one flag per transition), then
  exit, run transition actions, enter. They return 1 if a microstep ran,
  0 if nothing was enabled, or a negative error;
- `settle`: runs `eventless` and queued signals until the machine is stable.

Functions that can fail (they emit a signal or count a microstep, directly
or through a helper) return an error code that every caller passes on, so
an error stops the call at once, as in the interpreter.

## Changes from the v0.5 generator

- Every public name is prefixed; events are an enum instead of bare
  `#define`s (B10). There is no `UFSM_RESET` event: call `<prefix>reset()`.
- `user` is always stored by `init` (B4).
- The queue overflow check uses the full capacity (B3), the queue is a FIFO
  emptied on every call (B2), and transitions follow the priority and
  conflict rules in semantics.md (B1).
- Action and guard functions carry the prefix: `dimmer_lamp_off`, not
  `lamp_off`. Use `--prefix ""` to keep the old names (then the machine
  type is `struct machine` and the functions are `init`/`reset`/`process`).

## Testing

`packages/core/test/backend-c.test.ts` needs a C compiler (`$CC`, else
`cc`, `gcc` or `clang`; the tests skip without one). It links many
generated machines into one test program and checks that:

- all conformance traces in `tests/traces/` pass;
- on random event sequences (with random guard values), every repo model,
  300 random models (`UFSM_C_RANDOM=<n>` for more) and 100 random models
  with a 2-slot queue call exactly the same actions, end in the same states
  and fail with the same errors as the reference interpreter;
- the files compile with `-std=c99 -Wall -Wextra -Wpedantic -Wconversion
  -Wsign-conversion -Wshadow -Werror` (and more) as freestanding C.
