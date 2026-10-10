# Python backend

`ufsm generate python` turns a model into one fully typed Python module
for Python 3.8 or newer. It passes `pyright --strict` and imports only
`enum` and `typing` from the standard library, so there is nothing to
install.

Behaviour is defined by [semantics.md](semantics.md); the generated code is
a direct print of the IR (`ufsm ir <model>` shows it as pseudo-code), the
same IR the [C backend](backend-c.md) prints, and it is tested against the
reference interpreter (see [Testing](#testing)).

The generated code may be used under any terms ([output exception](../LICENSE-EXCEPTION)); uFSM itself is GPL-3.0-or-later.

## Generating

```sh
npm run ufsm -- generate python examples/dimmer.ufsm -o build/
# wrote build/dimmer.py
```

The model must pass `ufsm check` without errors. Settings come from the
model's `targets.python` section and can be overridden on the command line:

| `targets.python` key | Flag | Default | Meaning |
|----------------------|------|---------|---------|
| `className` | `--class-name` | model name in PascalCase (`test_guard1` → `TestGuard1`) | Machine class; also names `<Class>Event`, `<Class>Handler` and `<Class>Error` |
| `module` | | model name as an identifier | File name: `<module>.py` |

```jsonc
"targets": { "python": { "className": "Dimmer" } }
```

Unknown keys, and the options below, are reported as warnings and ignored there.

The model's [`options`](format-v1.md#options) section sets what every target
shares; the flags override it for one run:

| `options` key | Flag | Default | Meaning |
|---------------|------|---------|---------|
| `signalQueue` | `--signal-queue` | 16 | Capacity of the signal queue (only generated if the model emits signals) |
| `maxMicrosteps` | `--max-microsteps` | 10000 | Microsteps per `reset`/`process` call before a `livelock` error; 0 removes the check |

These change behaviour, so they are set in `options` only, never per target: a
model behaves the same in every language and in the simulator, queue overflows
included.

## Generated API

For `examples/dimmer.ufsm`:

```python
class DimmerError(Exception):
    code: str  # "queue-overflow", "livelock", "unknown-event", "not-started" or "busy"

class DimmerEvent(IntEnum):
    eButton = 0
    eOffButton = 1

class DimmerHandler(Protocol):  # what the machine calls
    def lamp_off(self) -> None: ...
    def lamp_10_percent(self) -> None: ...
    # ... one method per action; guards: def <guard>(self) -> bool: ...

class Dimmer:
    def __init__(self, handler: DimmerHandler) -> None: ...  # stores the handler; runs nothing yet
    def reset(self) -> None: ...                             # start, or restart; no exit actions run
    def process(self, event: DimmerEvent) -> None: ...
```

- The handler is any object with one method per action and guard, named as
  in the model and called without arguments: `handler.lamp_off()`.
  `<Class>Handler` is a `typing.Protocol`, so the handler does not inherit
  from anything; a type checker reports a missing or misspelled method where
  the machine is constructed. Guards return a `bool`. They may be called
  more than once per event and in any order, so they should not have side
  effects.
- The constructor does not start the machine, so the handler can keep a
  reference to it before the first entry action runs. Call `reset()` first;
  `process()` before that raises `not-started`.
- Errors raise `<Class>Error` with the interpreter's error code. After an
  error the machine is in an undefined state until `reset()`.
- An exception raised by an action or guard is not caught: it leaves
  `reset()`/`process()` unchanged, half-way through a microstep. Until the
  next `reset()`, `process()` then raises `busy`, as it does when an action
  or guard calls `process()` itself (that nested call changes nothing; the
  outer call goes on). See
  [Failed and nested calls](semantics.md#failed-and-nested-calls).
- Events are an `IntEnum` in declaration order. `process` also accepts
  plain ints at run time (untyped callers), and rejects numbers outside the
  enum with `unknown-event`.
- A declaration name that is a Python keyword gets a trailing underscore
  (PEP 8): the event `not` is `TestGuardTermsEvent.not_`, an action `pass`
  would be `handler.pass_()`. The generator stops with an error if that
  makes two names equal, or for names starting with `__` (Python would
  mangle them inside the class).
- Signals are internal: actions emit them, and `process` runs them (FIFO)
  after the event until the queue is empty. `queue-overflow` means more
  than `signalQueue` signals were waiting at once.
- After a terminate pseudo-state is reached, `process` does nothing until
  `reset()`.
- Everything else (`_cfg`, `_step_eButton`, ...) is internal and may change
  between uFSM versions.

## Example

```python
from dimmer import Dimmer, DimmerEvent


class Lamp:  # implements DimmerHandler
    def __init__(self) -> None:
        self.percent = 0

    def lamp_off(self) -> None:
        self.percent = 0

    def lamp_10_percent(self) -> None:
        self.percent = 10

    def lamp_30_percent(self) -> None:
        self.percent = 30

    def lamp_50_percent(self) -> None:
        self.percent = 50

    def lamp_100_percent(self) -> None:
        self.percent = 100


lamp = Lamp()
machine = Dimmer(lamp)
machine.reset()                          # Off
machine.process(DimmerEvent.eButton)     # On, 10%
machine.process(DimmerEvent.eButton)     # 30%
machine.process(DimmerEvent.eOffButton)  # Off
machine.process(DimmerEvent.eButton)     # On again: history restores 30%
print("lamp at %d%%" % lamp.percent)     # lamp at 30%
```

## Inside the generated module

The machine class starts with a table of regions and their states (the
value of `_cfg[region]` for each state). Its private methods are the IR
functions: `_enter_rN`, `_exit_rN`, `_record_rN`, `_restore_rN`,
`_step_<event>` / `_step_<signal>` / `_eventless` (one microstep; they
return whether one ran) and `_settle`. Errors are exceptions, so unlike in
C no return codes are passed around. The constructor builds `_on_event` and
`_on_signal`, tuples of bound step methods indexed by event and signal
number.

## Testing

`packages/core/test/backend-python.test.ts` needs Python 3.8 or newer
(`$PYTHON`, else `python3`, `python` or `py -3`; the tests skip without
one, and fail instead when `UFSM_REQUIRE_PYTHON=1`). It runs many generated
machines in one Python process and checks that:

- all conformance traces in `tests/traces/` pass;
- on random event sequences (with random guard values), every repo model,
  300 random models (`UFSM_PY_RANDOM=<n>` for more) and 100 random models
  with a 2-slot queue call exactly the same actions, end in the same states
  and fail with the same errors as the reference interpreter;
- the modules parse with the Python 3.8 grammar and import only `enum` and
  `typing`;
- the modules, and the example above, pass `pyright --strict` with Python
  3.8 rules, while a caller with an incomplete handler or a plain int event
  is rejected (needs `pyright` on PATH or `$PYRIGHT`; skipped without it,
  required when `UFSM_REQUIRE_PYRIGHT=1`);
- the example above prints `lamp at 30%`.
