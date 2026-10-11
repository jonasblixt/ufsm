# uFSM file format, version 1

A `.ufsm` file is a UTF-8 JSON document describing one hierarchical state
machine. Machine-readable definitions:

- TypeScript types: [`packages/core/src/v1/model.ts`](../packages/core/src/v1/model.ts)
- JSON Schema (draft-07): [`packages/core/schema/ufsm-v1.schema.json`](../packages/core/schema/ufsm-v1.schema.json),
  generated from `packages/core/src/v1/schema.ts` (the definition the reader validates against) by
  `npm run gen:schema` (`ufsm schema`); never edit the JSON by hand

What a machine does at run time is defined in [semantics.md](semantics.md).

The editor and the `ufsm` CLI read both this format and the legacy v0 format
(uFSM 0.4/0.5); v0 files are converted on load and always written back as v1.

## Design rules

1. **Three sections, three readers.** `declarations` name what the machine
   talks to, `machine` holds the semantics, `diagram` holds the drawing.
   Code generators never read `diagram`; a file without `diagram` is valid.
2. **Everything is referenced by id.** Ids are unique across the whole file
   and never change when something is renamed. The converter and editor
   generate short ids (`ev1`, `sig1`, `act1`, `grd1`, `r0`, `s1`, `t1`);
   any string matching `^[A-Za-z_][A-Za-z0-9_.-]*$` is allowed.
3. **Coordinates are relative.** Moving a state moves everything inside it
   without touching the children's numbers.
4. **One canonical text form.** `ufsm fmt` and the editor always write the
   same bytes for the same document (see [Canonical form](#canonical-form)).
5. **Strict.** Unknown fields are errors. Optional booleans are `true` or
   absent, never `false`.

## Top level

```jsonc
{
  "format": "ufsm",          // required, always "ufsm"
  "version": 1,              // required
  "name": "dimmer",          // machine name; generators derive symbol prefixes from it
  "doc": "…",                // optional description
  "declarations": { … },
  "machine": { … },
  "diagram": { … },          // optional
  "options": { … },          // optional, shared by every generator and the simulator
  "targets": { … }           // optional, per code generator settings
}
```

A `$schema` key is accepted (for editor tooling) and dropped on save.

## Declarations

```jsonc
"declarations": {
  "events":  [{ "id": "ev1", "name": "eButton", "doc": "Button pressed" }],
  "signals": [{ "id": "sig1", "name": "sDone" }],
  "actions": [{ "id": "act1", "name": "lamp_off" }],
  "guards":  [{ "id": "grd1", "name": "battery_low" }]
}
```

| List | Meaning |
|------|---------|
| `events` | External inputs, passed to the generated `process()` function |
| `signals` | Internal events the machine emits itself (`{ "emit": … }`) |
| `actions` | Functions called on entry, exit and transitions |
| `guards` | Functions without arguments returning a boolean that decides whether a transition may fire |

`name` must be a C identifier (`^[A-Za-z_][A-Za-z0-9_]*$`) and unique across
**all four** lists, because they share the generated namespace.

## Machine

```jsonc
"machine": {
  "root": { "id": "r0", "name": "Root", "states": [ … ] },
  "transitions": [ … ]
}
```

### Regions and states

A region holds an ordered list of vertices. A vertex is either a state or a
pseudo-state, told apart by `kind`.

```jsonc
{ "id": "s3", "kind": "state", "name": "On",
  "entry": [{ "call": "act2" }],
  "exit":  [{ "emit": "sig1" }],
  "timers": [{ "id": "tm1", "name": "travel", "after": 20, "unit": "s", "event": "ev3" }],
  "internal": [{ "id": "t7", "on": "ev2", "guard": [{ "call": "grd1" }], "do": [{ "call": "act3" }] }],
  "regions": [ { "id": "r1", "name": "Lamp", "states": [ … ] } ] }

{ "id": "s2", "kind": "initial" }
```

| `kind` | Notes |
|--------|-------|
| `state` | `name` required (free text, used for display); optional `doc`, `entry`, `exit`, `timers`, `internal`, `regions` |
| `initial` | One per region at most; exactly one outgoing transition, no trigger or guard |
| `shallow-history`, `deep-history` | Act as the region's initializer; same rules as `initial` |
| `final` | No outgoing transitions |
| `fork`, `join` | Bars that split into / merge from several orthogonal regions |
| `terminate` | No outgoing transitions |

Pseudo-states may have a `name`; it is only for display.

A state's `regions` are **orthogonal** (all active at once) and listed
**top-down**, in the order they are drawn. The order also fixes their index
in generated code.

### Internal transitions

A state's `internal` list holds transitions that react to an event without
leaving the state (UML internal transitions). No exit or entry actions run, 
and the state's regions keep their configuration. They have no diagram 
layout: the editor lists them in the state's action block, after `entry`, `exit` and `timers`.

```jsonc
{ "id": "t7", "on": "ev2", "guard": [{ "call": "grd1" }], "do": [{ "call": "act3" }], "doc": "…" }
```

| Field | Meaning |
|-------|---------|
| `id` | Shares the id space of transitions (`t…`) |
| `on` | Required: an event or signal (no `auto` or `completion`; they would fire forever) |
| `guard`, `do`, `doc` | As for transitions |

Selection and priority are those of a transition from the state to itself;
only the execution differs. See [semantics.md](semantics.md#internal-transitions).

### Timers

A state's `timers` list holds timers the machine starts when the state is
entered (after its `entry` actions) and stops when it is left (before its
`exit` actions). The application runs them and, when one expires, sends its
`event` through `process()`. They have no diagram layout: the editor lists
them in the state's action block after `entry` and `exit`, as
`20 s → eTravelTimeout` behind an icon that tells a one-shot timer from a
periodic one (lists such as the CLI's write `t/travel(20 s, eTravelTimeout)`
or `t/poll(every 500 ms, ePoll)`).

```jsonc
{ "id": "tm1", "name": "travel", "after": 20, "unit": "s", "event": "ev3" }
{ "id": "tm2", "name": "poll", "every": 500, "unit": "ms", "event": "ev4", "doc": "…" }
```

| Field | Meaning |
|-------|---------|
| `id` | Unique in the document like every id; new ones are `tm1`, `tm2`, … |
| `name` | Identifier, unique among the machine's timers; it names the timer in generated code |
| `after` / `every` | Exactly one: one-shot or periodic. A whole number from 1 up |
| `unit` | `"ms"`, `"s"`, `"min"` or `"h"` (required) |
| `event` | Id of a declared **event** (not a signal: signals are internal) |
| `doc` | Optional |

The duration in ms must fit an unsigned 32-bit integer (at most
4 294 967 295 ms, about 49.7 days); the design rule check enforces it.
No option turns timers on: generated code has a timer API exactly when the
model has timers. See [semantics.md](semantics.md#timers).

### Actions

Used in `entry`, `exit` and the `do` of transitions and internal
transitions, executed in list order:

| Form | Meaning |
|------|---------|
| `{ "call": "act1" }` | Call action function `act1` |
| `{ "emit": "sig1" }` | Queue signal `sig1`; processed after the current step |

### Transitions

```jsonc
{ "id": "t2", "from": "s1", "to": "s3", "on": "ev1",
  "guard": [{ "call": "grd1", "not": true }, { "in": "s7", "not": true }],
  "do": [{ "call": "act1" }, { "emit": "sig1" }],
  "doc": "…" }
```

Trigger: at most one of

| Field | Meaning |
|-------|---------|
| `"on": "<event or signal id>"` | Fires when that event or signal is processed |
| `"auto": true` | Trigger-less; evaluated after every step until nothing more fires |
| `"completion": true` | Fires when all regions of the source state have reached a final state |
| none | Only valid out of `initial`/history/`fork` and into `join` |

`guard` is a list of terms that must **all** hold:

| Term | Meaning |
|------|---------|
| `{ "call": "grd1" }` | `grd1()` is true |
| `{ "call": "grd1", "not": true }` | `grd1()` is false |
| `{ "in": "s7" }` | State `s7` is active |
| `{ "in": "s7", "not": true }` | State `s7` is not active |

Guard functions take no arguments and return a boolean. A condition on the
application's data is a guard function of its own (`battery_low()`), not a
comparison in the model; the model only knows its own states (`in`).

## Diagram

```jsonc
"diagram": {
  "paper": "A3",
  "titleBlock":  { "revision": "B", "date": "2026-10-10", "author": "Jonas Blixt" },
  "states":      { "s1": { "x": 340, "y": 370, "w": 290, "h": 220 },
                   "s9": { "x": 40, "y": 220, "w": 170, "h": 10, "orientation": "horizontal" },
                   "s4": { "x": 40, "y": 300, "w": 300, "h": 200, "actionsHeight": 90 } },
  "regions":     { "r1": { "h": 940 }, "r2": { "h": 300, "offPage": true } },
  "transitions": { "t1": { "from": { "side": "right", "offset": 70 },
                           "to":   { "side": "left",  "offset": 70 },
                           "via":  [[480, 1150]],
                           "label": { "x": 710, "y": 390, "w": 100 } },
                   "t2": { "route": "s", "jog": { "x": 520 } } }
}
```

All maps are keyed by element id. Units are canvas units; `paper` is one of
`A4` (1684×1190), `A3` (2380×1684), `A2` (3368×2380), `A1` (4768×3368),
landscape, at 2 units per point, so a sheet prints 1:1 on that paper (the
14 and 18 unit fonts print at 7 and 9 pt). Every sheet of a document has the
same paper.

`titleBlock` (optional) holds the free fields of the title block, all plain
strings: `revision`, `date`, `author`, `company`, `document` (document
number), in that order. Fields are written only when not empty, the block
only when it has one; any other key is an error. The other cells are filled
from the model (see below).

### Drawing frame and title block

Every sheet is drawn as a sheet of paper with a drawing frame in the manner
of ISO 5457 (`core/src/v1/sheet.ts`):

- The **drawing area** starts 50 units (8.8 mm) inside the paper edge on all
  four sides; its top-left corner is the sheet's origin `(0, 0)`. So the
  paper spans `(-50, -50)` to `(w - 50, h - 50)` and the drawing area
  `(0, 0)` to `(w - 100, h - 100)`.
- A border line runs 30 units (5.3 mm) from the paper edge. The band between
  it and the drawing area carries **zone references**: numbers along the top
  and bottom, letters (A, B, …, without I and O) down the sides, A1 in the
  top-left corner; ISO 5457's counts, zones of 42–58 mm: A4 6×4, A3 8×6,
  A2 12×8, A1 16×12. A point is named by letter then number (`B4`); an
  element by its centre (a transition by its label, else the middle of its
  route), with its sheet: "sheet 2, B4".
- The **title block** (600×190 units, 106×34 mm) sits in the drawing area's
  bottom-right corner:

  | Row | Cells |
  |-----|-------|
  | 1 | Title (the machine's `name`) · Rev |
  | 2 | Description (first line of `doc`) |
  | 3 | Sheet path · Sheet (*n* / *m*) |
  | 4 | File · Date · Size (the paper) |
  | 5 | Author · Company · Document no. |

  Sheets are numbered in document order: 1 is the root, then each off-page
  region before the off-page regions inside it. The sheet path is `/` for
  the root and `/Owner/Inner` below it (KiCad style); a sheet is named after
  its owner state, followed by ` · ` and the region's name when the owner has
  several regions. The file name is not stored (the editor and the CLI know
  it).
- A drawing **fits** when every vertex and transition route of a sheet lies
  inside its drawing area and clear of the title block; the design rule
  check warns otherwise (`outside-frame`, `title-block`), naming only the
  outermost element. Labels are not measured.

### Sheets and origins

- A **sheet** is the root region or an **off-page** region
  (`"offPage": true`). An off-page region's contents are drawn on a sheet of
  their own; its owner state only shows a marker.
- The **origin** of a region is `(0, 0)` if it is a sheet (the top-left
  corner of its drawing area, inside the frame), otherwise the absolute
  top-left corner of the state that owns it.
- A state's `x`/`y` are relative to the origin of its region.
- A free transition's `via` points and `label`, and an S route's `jog`, are
  relative to the origin of the innermost region containing both of its
  endpoints.
- `from`/`to` attach the edge to a side of the source/target box;
  `offset` is measured from the side's top (left/right) or left (top/bottom)
  end. Round pseudo-states always attach at the middle of the side.

### Transition routes

A transition layout has one of two route styles, chosen by `route`:

- **free** (`route` absent, or `"free"`): the edge is the polyline
  `from`, `via`..., `to`, exactly as stored. `from` and `to` are required.
  This is how v0 models convert and how hand-placed edges are kept.
- **S** (`"route": "s"`): the file stores intent, and the geometry is
  derived from the current state boxes, so the edge follows when states move
  or resize. The route is orthogonal: a short stub straight out of each side,
  then an S (one jog between facing sides), an L (perpendicular sides) or a
  U/detour when the sides face away. `via` is not allowed.

The optional keys of an S route:

| Key | Meaning |
| --- | --- |
| `from`, `to` | Pin that end to a side and offset (same shape as for free routes). Without it the side is chosen automatically: the pair of sides facing across the largest gap between the two boxes, with the ends of several edges on one side spread evenly along it (each on the nearest 10-unit grid line, unless that would make two ends coincide or put one in a corner). |
| `jog` | Position of the middle segment: `{ "x": n }` places a vertical jog, `{ "y": n }` a horizontal one, relative to the transition's origin (as for `via`). It applies when its axis matches the movable segment of the current route shape (so it survives moves that keep the shape); otherwise, or when absent, the jog takes its default place (centred between the ends, or just outside them for a U or a detour), with parallel edges between the same two states 14 units apart. Default places, and the stubs a U or a detour starts with, are moved to the nearest 10-unit grid line (outwards for those outside the ends) as long as the shape stays valid, so a route between grid-aligned states lies on the grid. |
| `label` | Label box relative to the route's **label anchor**: the start of the first horizontal segment at least 40 units long, else of the longest horizontal segment, else the middle of the middle segment. Without it the label sits just above the anchor. Because it is relative, the label travels with the route. |

A self-transition on an S route with automatic ends loops around the top-right
corner of its state.

### State bands

A state is drawn as a 30-unit name header, then (if it has entry or exit
actions, timers or internal transitions) an action block, then its
regions stacked top-down. Each region takes `diagram.regions[id].h`; a region
without `h` fills the rest of the state.

### Action block

The action block lists, in this order, the entry actions, the exit actions,
the timers and the internal transitions. Every line starts with an icon for
its kind (entry, exit, one-shot timer, periodic timer, internal transition)
and is written in a fixed-width font. The layout is derived from the state's
width `w`, with a text cell of 7 units and 20-unit lines:

- text starts 30 units from the state's left edge (10 margin, a 16-unit icon,
  4 between them) and ends 10 units before the right edge, so a line holds
  `floor((w - 40) / 7)` characters, at least one;
- the entry actions share a line, separated by `, `; a list that is too long
  wraps between actions and the following lines start under the first action
  (no icon). The exit actions start a new line and wrap the same way;
- timers stand side by side, 16 units apart, each with its icon, while they
  fit before the right margin; the next one starts a new line;
- every internal transition starts a line (`event [guards] / actions`) and
  wraps at spaces.

The block is `10 + 20 × lines` units tall. `diagram.states[id].actionsHeight`
(states only, optional) makes it smaller: it then shows the first
`floor((actionsHeight - 10) / 20)` lines, at least one, and a marker on its
bottom line counts the hidden actions, timers and internal transitions per
kind (one total when the state is too narrow for that). When only one line is
left of several, the block shows the number of items of each kind instead of
the first line. A value that is not smaller than the block's own height has
no effect, and the editor does not write one. The regions start below the
block as drawn.

The design rule check warns when a state is too low or too narrow for what
its block shows (`actions-clipped`) and when the block reaches over a vertex
in the state's first region (`actions-overlap`). Lines hidden by
`actionsHeight` are not reported.

`orientation` applies to `fork`/`join` only (`vertical` by default).

## Options

Shared by every code generator, the interpreter and the simulator. All keys
are optional; unknown keys are an error.

```jsonc
"options": { "signalQueue": 8, "maxMicrosteps": 1000 }
```

| Key | Default | Meaning |
|-----|---------|---------|
| `signalQueue` | 16 | Capacity of the signal queue; emitting into a full queue is a `queue-overflow` error. At least 1 when the model emits signals |
| `maxMicrosteps` | 10000 | Microsteps per reset/process call before a `livelock` error; in generated code 0 removes the check |
| `debugInfo` | false | Generated code can look up event, signal and state names and ask whether a state is active (costs the name strings in flash in C and Rust) |
| `trace` | false | Generated code calls a trace hook the application implements, with ids only: event received, signal taken, transition taken, state entered, state exited ([semantics](semantics.md#numbering-and-trace-hooks)) |

There are two kinds of option:

- **Behaviour options** change what the machine does: `signalQueue` and
  `maxMicrosteps`. They are set here and nowhere else, so a model behaves the
  same in every language and in the simulator. A behaviour option under
  `targets` is ignored (a design rule warning).
- **API options** change only the shape of the generated code: `debugInfo` and
  `trace`, both `true`/`false`. They are set here and may be overridden per
  target in `targets.<name>` (a value that is not `true`/`false` there is
  ignored with a warning). Off, they generate nothing.

Every generated file also has, with no option, a state enum (document order)
and the model's fingerprint ([semantics](semantics.md#numbering-and-trace-hooks)).

A code generator resolves an option from `options`, then `targets.<name>`
(API options only), then its command line flags. A conformance trace's
`options` override the model's for that trace.

## Targets

Settings per code generator, keyed by target name: the target's own keys
(`prefix`, `className`, ...) and overrides of API options. Unknown targets are
preserved.

```jsonc
"targets": { "c": { "prefix": "dimmer_", "trace": true } }
```

Settings of the generators: [C](backend-c.md#generating) (`c`),
[Python](backend-python.md#generating) (`python`),
[TypeScript](backend-ts.md#generating) (`ts`), [Rust](backend-rust.md#generating) (`rust`).

## Canonical form

The writer (`serializeV1`, used by the editor and `ufsm fmt`) produces:

- keys in the order shown in this document; diagram maps in document order
- optional empty lists (`entry`, `exit`, `timers`, `internal`, `regions`, `guard`, `do`) omitted
- whole numbers without a decimal point, others rounded to 3 decimals
- 2-space indentation; an array or object stays on one line if it fits in
  100 columns
- LF line endings and a trailing newline

## Design rule check

`ufsm check` and the editor's problems list report what the schema cannot
express. Errors: duplicate ids, dangling or wrongly typed references, invalid
or duplicate declaration names, initial/history states without exactly one
outgoing transition, more than one initializer in a region, triggers out of
pseudo-states or into joins, transitions out of final/terminate, fork
targets or join sources that are not in different orthogonal regions of one
state, `options.signalQueue` of 0 in a model that emits signals, timers whose name is not an identifier or is
used by another timer (`timer-name`), timers firing something other than a declared event, timer durations of 0 or
over 2^32 - 1 ms (`timer-duration`). Warnings:
transitions and internal transitions that can never fire (no trigger, or
shadowed by an earlier transition of the same state with the same trigger
and no guard; a state's outgoing transitions come before its internal ones),
regions entered by default without an initial state,
duplicate state names in a region, two timers that can run at the same time (on one state, a state and one inside
it, or states in orthogonal regions) firing the same event (`timer-same-event`), unused declarations, behaviour options
under `targets` and API options there that are not `true`/`false`, stale or missing
layout, and drawings that do not fit their sheet (outside the drawing frame,
or over the title block; see "Drawing frame and title block").

## Converting from v0

`ufsm migrate old.ufsm -o new.ufsm`, or open the file in the editor and save.
The converter:

- replaces UUIDs with short ids in document order
- stores regions top-down (v0 files list them bottom-up)
- converts absolute coordinates to relative ones (losslessly; tested on every
  legacy model)
- maps numeric enums to strings and guards to structured terms; a v0 term
  that compares a guard's value (`count() > 1`) becomes a call of a new
  boolean guard named after it (`count_gt_1`; operators `eq` `gt` `ge` `lt`
  `le`, `m1` for -1, `2p5` for 2.5), and a guard that was only ever
  compared is removed; each change is reported
- makes declaration names valid and unique, merges duplicates, and resolves
  transitions whose trigger kind is missing; each change is reported
- keeps the v0 paper size unless the drawing does not fit inside the v1
  drawing frame (v0 drew on the bare paper): then it takes the smallest
  larger paper on which every sheet fits (nothing moves; reported)
- drops default pseudo-state names ("Init", "Fork", …) and v0 bookkeeping
  (per-reference UUIDs, label heights, unused guard values)
