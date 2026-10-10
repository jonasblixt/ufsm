# uFSM execution semantics

This document defines what a uFSM machine does at run time. It is
normative: the reference interpreter (`packages/core/src/interp/`)
implements it, and every code generator backend must produce the same
action trace for the same inputs. The conformance traces in
`tests/traces/` pin it down by example.

The rules follow the W3C SCXML algorithm (document order,
run-to-completion, one microstep per set of non-conflicting transitions),
mapped onto uFSM's model of states with orthogonal regions, and phrased so
that a code generator can precompute everything but the configuration (see
`packages/core/src/semantics/flatten.ts`). Where uFSM v0.5 behaved
differently, this is noted under [Changes from v0.5](#changes-from-v05).

## Terms

- **Configuration**: the set of active vertices. An active state has
  exactly one active vertex in each of its regions; the root region has one
  as well. Only states and final states are ever active; other
  pseudo-states are passed through.
- **Document order**: pre-order over the model as stored: a state comes
  before its regions, a region before its vertices, regions top-down,
  vertices in list order. A state's transitions are ordered as they
  appear in `machine.transitions`, followed by its internal transitions in
  list order.
- **Post-order**: a state's regions (top-down, each region's states in
  list order, recursively) come before the state itself. Inner states come
  before the states containing them; the upper of two orthogonal regions
  comes before the lower.
- **Domain** of a transition: the innermost region containing its source
  state(s), its target(s) and any fork or join in between. A transition
  from a state to itself, to its own substate or to its parent therefore
  leaves and re-enters that state (all transitions are external). An
  internal transition's domain is the region of its state.
- **Exit set**: the active vertices inside the domain; empty for an internal
  transition.

## Steps

The machine reacts in **macrosteps**. `reset()` and `process(event)` each
run one macrostep and return when the machine is stable.

`process(event)`:

1. Run one **microstep** for `event`.
2. **Settle**: while any eventless transition is enabled, run a microstep
   for them. When none is, take the oldest queued signal (if any) and run
   a microstep for it, then settle again. Stop when nothing is enabled and
   the signal queue is empty.

Eventless transitions are re-evaluated after every process() call, even if
the event itself fired nothing, so an `auto` transition whose guard became
true in the meantime fires then.

`reset()` forgets the configuration, history and queued signals without
running exit actions, enters the root region by default (see
[Entering](#entering)) and settles.

A macrostep that runs more microsteps than a fixed limit (10 000 in the
interpreter) is a **livelock** error, e.g. two `auto` transitions that
undo each other.

### Failed and nested calls

A `reset()` or `process()` call that does not finish leaves the machine
half-way through a microstep: some states exited, others not yet entered,
signals of the macrostep still queued. That happens on an error
(`queue-overflow`, `livelock`) and when an action or guard throws (an
exception in Python and TypeScript, a panic caught with `catch_unwind` in
Rust, a `longjmp` out of it in C). The machine never catches the
application's exceptions: they leave the call unchanged.

So the machine is **busy** from the start of every `reset()` and
`process()` call until that call finishes, and stays busy after a call
that did not finish. `process()` on a busy machine fails with `busy` and
changes nothing. Only `reset()` starts it again.

The same check refuses a **nested call**: `process()` called from inside
an action or guard, or from an interrupt handler while the main program
is inside `process()`, fails with `busy` and changes nothing; the event is
lost, and the outer call goes on. (In Rust a nested call does not compile.)
An application that wants to react to an event from inside an action
queues it itself, or emits a signal instead.

`reset()` is not refused, since it is the way out of a failed call; it must
not be called from inside an action or guard (the outer call would go on
with the new configuration), and that is not detected.

`process()` checks, in this order: `not-started`, `unknown-event`, `busy`;
then a terminated machine ignores the event.

## Selecting transitions

For one microstep, transitions are selected against the configuration as
it was before the microstep:

1. Visit the active states in post-order. Each one **offers** its first
   enabled transition (in transition order). A join is listed under each of
   its sources, at the position of that source's transition into the join,
   but offered only by the last of them in post-order, and only
   if it is the first enabled transition of every source: sources that
   disagree block the join.
2. An offer is **taken** unless it conflicts with a transition already
   taken in this microstep. Two transitions conflict when the domain of one
   contains the domain of the other, so their exit sets could overlap.

So a transition out of a substate beats a conflicting one out of an
ancestor, between unrelated states the one earlier in document order wins,
and non-conflicting transitions in orthogonal regions fire together. For
machines without joins this is exactly SCXML's optimal enabled transition
set (checked against an SCXML-style selection on 3000 random machines).

A transition is **enabled** when its trigger matches, all its source states
are active and every guard term holds:

- `on: X` matches when processing event or signal `X`;
- `auto` matches in the settle phase;
- `completion` matches in the settle phase when the source state is
  complete: each of its regions rests in a final state (a state without
  regions is always complete);
- transitions without trigger never match (they only occur out of
  initial/history/fork and into join).

Guard terms: `{call}` is true when the function returns true and
`{call, not}` when it returns false (guard functions return a boolean and
take no arguments); `{in}` tests the configuration before the microstep. Guard functions may be called more
than once per microstep and must not have side effects.

## Executing a microstep

All selected transitions run together:

1. **Exit**: the union of their exit sets, in reverse document order
   (innermost first; of two orthogonal regions, the lower one first). Before
   anything is exited, history is recorded for every region with a history
   pseudo-state whose owner is about to be exited. Each exited state runs
   its `exit` actions.
2. **Transition actions**: each taken transition's `do` actions, in the
   order they were taken (which is the document order of their sources). For a compound transition: a transition into a fork
   runs its own `do` and then those of the fork's outgoing transitions;
   a join runs the `do` of the transitions into the join (in file order)
   and then that of its outgoing transition.
3. **Enter**: the union of their entry sets, in document order (outermost
   first; of two orthogonal regions, the upper one first). Each entered state
   runs its `entry` actions.

An internal transition contributes nothing to steps 1 and 3: it only runs
its actions in step 2.

`{emit}` actions append the signal to the queue; it is processed in the
settle phase, never in the middle of a microstep. Signals are processed one
at a time, oldest first. A bounded queue (C target option `signalQueue`)
reports an overflow error when full.

## Internal transitions

An internal transition reacts to an event or signal without leaving its state:
no exit or entry actions run, history is not recorded, and the state's
regions keep their configuration. It always has an `on` trigger.

For selection it is exactly a transition from the state to itself: it is
one of the state's candidates (after the outgoing transitions), it is
offered when the state is visited in post-order, and it conflicts like a
self-transition, its domain being the state's region. So:

- a transition taken inside the state (by a substate) beats the state's
  internal transition, as it beats any transition of an ancestor;
- once an internal transition is taken, an ancestor's transition that would
  exit the state is dropped;
- transitions in orthogonal regions fire alongside it, and its actions run
  with theirs in step 2, in the order the transitions were taken.

A microstep made only of internal transitions still counts towards the
livelock limit, and eventless transitions are evaluated after it as after
any microstep.

## Entering

The entry set of a transition is built from its targets:

- a **state or final state** is entered; each of its regions that has no
  other vertex in the entry set is **entered by default**;
- each ancestor of a target inside the domain is entered as well, and its
  other regions are entered by default;
- a **fork** contributes the targets of all its outgoing transitions;
- a **history** pseudo-state restores its region's recorded history, or
  if there is none, follows its default (outgoing) transition;
- an **initial** pseudo-state follows its outgoing transition;
- a **terminate** pseudo-state enters nothing; the machine stops after the
  microstep (see below).

A region is **entered by default** through its initializer (its `initial`,
`shallow-history` or `deep-history` pseudo-state). The initializer's
transition may lead to a state nested deeper in the region; the states in
between are entered too. Its `do` actions run when the region is reached
in document order: after the owner's entry actions and after everything in
the regions above it, before the states in the region itself. A region
without an initializer stays empty (the design rule check warns).

### History

When the owner of a region with a history pseudo-state is exited:

- **shallow history** records the region's active vertex; restoring enters
  that vertex and then its regions by default;
- **deep history** records every leaf inside the region; restoring enters
  those leaves and all states between them and the region.

A region resting in its final state records no history, so the next entry
through history follows the default transition. `reset()` clears history.

### Final and terminate

A final state has no actions. When the root region reaches a final state,
the machine is finished: nothing is enabled any more.

A transition to a **terminate** pseudo-state exits its exit set and runs
its actions like any other, but enters nothing. At the end of that
microstep the machine ends: the configuration and the signal queue are
cleared without running exit actions, and later events are ignored until
`reset()`.

## Traces

A trace file (`tests/traces/*.json`) lists steps to run against one model
and the action calls each step must produce, by name:

```jsonc
{
  "model": "../models/test_guard1.ufsm",     // relative to the trace file
  "doc": "…",
  "options": { "signalQueue": 4 },           // optional; also maxMicrosteps
  "steps": [
    { "reset": true, "expect": ["eA"] },
    { "send": "e1", "expect": [] },
    { "guards": { "g1": true }, "send": "e1", "expect": ["xA", "eB"], "active": ["B"] },
    { "send": "e9", "error": "queue-overflow" }
  ]
}
```

| Key | Meaning |
|-----|---------|
| `reset` | Run `reset()` |
| `send` | Process this event (by name) |
| `guards` | Guard values (`true`/`false`) from this step on (default false), applied before the step runs |
| `expect` | Action calls of the step, in order; required with `reset`/`send` unless `error` is given |
| `active` | States that must be active afterwards (name, or id where names repeat); others may be too |
| `inactive` | States that must not be active afterwards (same references as `active`) |
| `error` | The step must fail with this error code |
| `raise` | This action or guard (by name) throws when it is called in this step; the step must end with that exception, unchanged. `expect` lists the calls up to and including the action. Not with `error` |
| `reenter` | This action (by name) calls `process()` with the step's event (`send` steps only); that nested call must fail with `busy` |
| `doc` | Free text, e.g. why an expectation differs from v0.5 |

`options` sets what the machine is built with for the whole trace:
`signalQueue` (queue capacity; without it the interpreter is unbounded and
generated code uses its default, 16 for C, so such a trace must never have
more signals waiting) and
`maxMicrosteps` (livelock limit per `reset()`/`process()` call; default
10 000). Both are non-negative integers; a backend runner passes them to
its generator (the C, Python, TypeScript and Rust options of the same name).

`ufsm trace tests/traces/*.json` replays them on the interpreter; each
backend gets a runner that replays the same files against generated code
(`packages/core/test/backend-c.test.ts`, `backend-python.test.ts`, `backend-ts.test.ts`,
`backend-rust.test.ts`).

The editor's simulator records every step it takes as such a trace (Simulator
tab › Trace › Save trace…): each `reset` or `send` with the guard values that
changed since the previous step, its calls as `expect` (or its `error`), and
the innermost active states as `active`. `formatTrace` in
`packages/core/src/interp/trace.ts` writes the layout used here. Expectations
recorded this way come from the interpreter, so they document behaviour; a
conformance trace for a new rule is still derived from this document by hand.

## Changes from v0.5

The v0.5 Python generator decided these things differently (bug numbers
refer to `.claude/rework-tauri-ts.md`):

- **Priority (B1)**: v0.5 fired every transition whose source was active,
  including a parent's and a child's on the same event, or two out of one
  state. Now each state offers at most one transition and conflicting
  offers are dropped, as described above.
- **Signal queue (B2)**: v0.5 never emptied the queue, so old signals were
  replayed on every later event.
- **Exit order**: v0.5 exited by depth (all deepest states first, across
  regions). Now exit is the exact reverse of entry: each region is
  left completely, the lowest region first.
- **Entry order**: v0.5 entered the path to an explicit target first and
  the other regions afterwards; now everything enters in document order.
- **Completion (B12)**: v0.5 treated a region without a final state as
  already complete, so a composite could complete while one of its regions
  was still busy. Now every region must rest in a final state.
- **Eventless transitions**: v0.5 evaluated `auto` transitions only right
  after entering a state that has one. Now they are evaluated after every
  microstep and after every processed event.
- **Deep history and terminate (B7)** were ignored by v0.5.
