# Live tracing from a target (planned)

Status: proposal, not implemented. Discussed 2026-10-10; nothing here is
decided until the open questions below are settled.

Goal: collect trace data from a running embedded C application (serial,
USB, debug probe, anything) and show it in the editor in real time: the
active states, every event, transition and action call. The view can be
paused, stepped forwards and backwards, and browsed through history. The
cost on the target must stay small enough for very size-constrained
devices.

## Idea: log only what the host cannot derive

A generated machine is deterministic. Everything `process()` does follows
from the configuration before the call, the event, and the values the
guard functions return. Signals, priority and conflicts, history,
completion, livelock and queue-full errors follow from the model. The
editor has the model and the IR the C code was printed from
(`packages/core/src/ir/eval.ts`), so the target only has to send:

- `init` / `reset`;
- the event id (one byte or a varint);
- one bit per guard call, in call order;
- optionally a timestamp delta.

The host replays this on the IR evaluator and recovers every microstep:
transitions taken, states exited and entered, actions called, signals
emitted and processed, errors. That is about 1–2 bytes per event, compared
with tens of bytes per record for conventional software tracing (QP/Spy,
SEGGER SystemView). The code on the target is one call per `process()` and
one per guard call; with tracing compiled out it costs nothing.

### Prerequisite: a fixed guard call order

Replay only works if the target calls the guards in exactly the order, and
as many times, as the host replay does. Today `backend-c.md` says guards
"may be called more than once per event and in any order". In practice the
order is fixed by the IR, but it is not promised. Before this feature:

- `semantics.md` (or the IR documentation) promises that the IR fixes the
  guard call order and every backend keeps it;
- a differential test compares the guard-call sequences of the generated
  code and the IR evaluator.

The open question "call each guard at most once per microstep (cache
values)?" is related: with caching, the log becomes one fixed bitmap per
microstep and the order problem goes away.

## Modes

- **Replay** (default candidate): events + guard bits, as above.
- **Full**: also the transitions fired per microstep (the generated C
  already keeps one flag per transition) and possibly action ids. Larger,
  but does not depend on host replay and shows when the target does not
  match the model (stale build, memory corruption).
- **Replay + checksum**: a small configuration checksum every N events, so
  a mismatch is detected quickly at little cost.

## Target side

- **Hook**: the generated code calls an application-defined function behind
  a macro, e.g. `#ifdef DIMMER_TRACE` …
  `void dimmer_trace(void *user, const uint8_t *p, uint8_t n);`. No weak
  symbols (not portable C99).
- **Ring buffer helper** (optional, generated): the hook writes into RAM,
  the application drains it from its idle loop; on overflow it records a
  "lost N bytes" marker.
- **Model identity**: the generator puts a hash of the IR (or of the
  canonical machine section) in the header; the target sends it in a
  "hello" record together with a protocol version and flags. The editor
  warns when the open model does not match. Generated code is already
  deterministic, so the hash is stable.
- **Keyframes**: a generated `<prefix>trace_snapshot()` writes the active
  state per region and the history and deep-history slots in a defined
  order (not raw struct memory: padding, endianness). The signal queue is
  always empty between `process()` calls, so a snapshot is a few bytes.
  Keyframes let the host join a running target, resynchronise after lost
  data and seek quickly.
- **Framing**: COBS or SLIP with CRC-8/16, and a channel byte so several
  machines or instances can share one link.
- **Other backends**: the trace points are IR nodes added in the lowering
  (backends make no semantic decisions), so Python, TS and Rust get the same
  protocol. A Node script running generated TypeScript can feed the editor,
  which lets the host side be developed and tested without hardware.

## Host side

- **Transports** in the Tauri (Rust) shell, since Web Serial is missing in
  the macOS and Linux webviews:
  - serial / USB CDC (a Rust serial crate);
  - TCP, which covers most debug probes: J-Link RTT, OpenOCD's RTT server,
    ITM/SWO bridges (RTT is a good fit: no UART, non-blocking);
  - file / pipe, for captured logs and replaying recordings.
- **Live mode** in the simulator panel (E6): active-state highlight, action
  log and event list driven by the stream instead of buttons.
- **Timeline**: the recording is a list of records; the state at any point
  is derived by replaying from the nearest keyframe, with host-side
  snapshots every N steps for instant scrubbing. A logic-analyzer view (one
  row per region, a bar per active state) shows timing as well.
- **Pause and step (host side)**: recording continues while the view is
  frozen, with a "follow live" toggle; step forwards and backwards by event
  or by microstep; host breakpoints pause the view when a state is entered,
  a transition fires or an action is called.
- **Halting the target** needs a link in both directions or a debugger (an
  SWD halt also stops RTT). A two-way link would allow injecting events from
  the editor into the target, a "remote simulator". Later and opt-in, since
  it interferes with real-time behaviour.
- **Recordings as traces**: saved in (an extension of) the trace format in
  `tests/traces/`: guard results per call instead of fixed values,
  timestamps, keyframes. A captured field session then becomes a regression
  test every backend replays, and a starting point for "what if" in the
  simulator.

## Open questions

1. Replay mode as the default with full mode optional? Depends on making
   the guard call order part of the semantics.
2. Timestamps: optional; unit = the target's tick, with the tick rate in
   the hello record?
3. One-way first, or design event injection and target halt in from the
   start?
4. A protocol shared by all backends (IR nodes) from the start, or C only
   first?

Suggested first step: replay mode with keyframes, one-way, hooks generated
in the lowering, TCP + serial + file on the host. Start with the guard-order
promise and its differential test, since everything else depends on it.
