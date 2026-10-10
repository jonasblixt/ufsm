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

Unknown keys, and the options below, are reported as warnings and ignored there.

The model's [`options`](format-v1.md#options) section sets what every target
shares; the flags override it for one run:

| `options` key | Flag | Default | Meaning |
|---------------|------|---------|---------|
| `signalQueue` | `--signal-queue` | 16 | Capacity of the signal queue (only generated if the model emits signals) |
| `maxMicrosteps` | `--max-microsteps` | 10000 | Microsteps per `init`/`reset`/`process` call before `ERR_LIVELOCK`; 0 removes the check |

These change behaviour, so they are set in `options` only, never per target: a
model behaves the same in every language and in the simulator, queue overflows
included.

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
