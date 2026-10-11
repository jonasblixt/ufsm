// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The v1 file format as a JSON Schema, written with TypeBox: the one definition the reader validates against
 * (`parse.ts`) and the published `schema/ufsm-v1.schema.json` is generated from (`v1JsonSchema`, `ufsm schema`).
 * The interfaces in `model.ts` are checked against it at compile time (bottom of this file), so a field added to one
 * and not the other fails `tsc`.
 *
 * Messages for readers of a broken file follow the ajv-errors convention: `errorMessage` on a node, a string or an
 * object keyed by the failing keyword; `${0}` stands for the value. Rules the schema cannot express (references,
 * names, structure) are the design rule check's (`check.ts`).
 */
import Type, { type Static, type TSchema } from "typebox";
import { ID_PATTERN, PAPER_SIZES, PSEUDO_KINDS, TIMER_UNITS } from "./model";
import type * as M from "./model";

const closed = { additionalProperties: false } as const;
const ref = <N extends string>(name: N) => Type.Ref(name);
const list = <N extends string>(name: N) => Type.Array(Type.Ref(name));
const opt = <T extends TSchema>(t: T) => Type.Optional(t);
const str = () => Type.String();
const num = () => Type.Number();

const defs = {
  id: Type.String({ pattern: ID_PATTERN.source, errorMessage: "invalid id '${0}'" }),
  flag: Type.Literal(true, { errorMessage: "expected true (omit the field for false)" }),
  decl: Type.Object({ id: ref("id"), name: str(), doc: opt(str()) }, closed),
  declarations: Type.Object(
    { events: list("decl"), signals: list("decl"), actions: list("decl"), guards: list("decl") },
    closed,
  ),
  action: Type.Union([Type.Object({ call: ref("id") }, closed), Type.Object({ emit: ref("id") }, closed)], {
    description: "Call an action function or emit a signal.",
    errorMessage: "expected exactly one of 'call' or 'emit'",
  }),
  guardTerm: Type.Union(
    [
      Type.Object(
        { call: ref("id"), not: opt(ref("flag")) },
        { ...closed, description: "guard() is true, or false with not" },
      ),
      Type.Object(
        { in: ref("id"), not: opt(ref("flag")) },
        { ...closed, description: "state is active, or not active with not" },
      ),
    ],
    { errorMessage: "expected exactly one of 'call' or 'in'" },
  ),
  region: Type.Object({ id: ref("id"), name: opt(str()), states: list("vertex") }, closed),
  vertex: Type.Union([ref("state"), ref("pseudo")]),
  state: Type.Object(
    {
      id: ref("id"),
      kind: Type.Literal("state"),
      name: str(),
      doc: opt(str()),
      entry: opt(list("action")),
      exit: opt(list("action")),
      timers: opt(list("timer")),
      internal: opt(list("internalTransition")),
      regions: opt(list("region")),
    },
    closed,
  ),
  pseudo: Type.Object({ id: ref("id"), kind: Type.Enum([...PSEUDO_KINDS]), name: opt(str()) }, closed),
  timer: Type.Object(
    {
      id: ref("id"),
      name: str(),
      after: opt(Type.Integer({ minimum: 1, description: "One-shot: expires once, this many units after the start." })),
      every: opt(Type.Integer({ minimum: 1, description: "Periodic: expires every this many units until stopped." })),
      unit: ref("timerUnit"),
      event: ref("id"),
      doc: opt(str()),
    },
    {
      ...closed,
      description:
        "A timer of a state, started after its entry actions and stopped before its exit actions; when it expires the application sends `event` through process(). Exactly one of after and every.",
      not: { required: ["after", "every"] },
      anyOf: [{ required: ["after"] }, { required: ["every"] }],
      errorMessage: {
        not: "expected exactly one of 'after' or 'every'",
        anyOf: "expected exactly one of 'after' or 'every'",
      },
    },
  ),
  timerUnit: Type.Enum([...TIMER_UNITS]),
  internalTransition: Type.Object(
    { id: ref("id"), on: ref("id"), guard: opt(list("guardTerm")), do: opt(list("action")), doc: opt(str()) },
    closed,
  ),
  transition: Type.Object(
    {
      id: ref("id"),
      from: ref("id"),
      to: ref("id"),
      on: opt(ref("id")),
      auto: opt(ref("flag")),
      completion: opt(ref("flag")),
      guard: opt(list("guardTerm")),
      do: opt(list("action")),
      doc: opt(str()),
    },
    {
      ...closed,
      not: {
        anyOf: [{ required: ["on", "auto"] }, { required: ["on", "completion"] }, { required: ["auto", "completion"] }],
      },
      errorMessage: { not: "at most one of 'on', 'auto' and 'completion'" },
    },
  ),
  machine: Type.Object({ root: ref("region"), transitions: list("transition") }, closed),
  stateLayout: Type.Object(
    {
      x: num(),
      y: num(),
      w: num(),
      h: num(),
      orientation: opt(Type.Enum(["horizontal", "vertical"])),
      actionsHeight: opt(num()),
    },
    closed,
  ),
  regionLayout: Type.Object({ h: opt(num()), offPage: opt(ref("flag")) }, closed),
  edgeEnd: Type.Object({ side: Type.Enum(["left", "right", "top", "bottom"]), offset: num() }, closed),
  labelLayout: Type.Object({ x: num(), y: num(), w: num() }, closed),
  point: Type.Tuple([num(), num()], { errorMessage: "expected [x, y]" }),
  jog: Type.Union([Type.Object({ x: num() }, closed), Type.Object({ y: num() }, closed)], {
    description: "Position of the movable segment: x for a vertical segment, y for a horizontal one.",
    errorMessage: "expected exactly one of x or y",
  }),
  freeEdgeLayout: Type.Object(
    {
      route: opt(Type.Literal("free")),
      from: ref("edgeEnd"),
      to: ref("edgeEnd"),
      via: opt(Type.Array(ref("point"))),
      jog: opt(Type.Never({ errorMessage: "a jog belongs to S routes" })),
      label: opt(ref("labelLayout")),
    },
    { ...closed, description: "Stored polyline: from, via (bend points), to." },
  ),
  sEdgeLayout: Type.Object(
    {
      route: Type.Literal("s"),
      from: opt(ref("edgeEnd")),
      to: opt(ref("edgeEnd")),
      jog: opt(ref("jog")),
      via: opt(Type.Never({ errorMessage: "bend points belong to free routes; an S route is derived" })),
      label: opt(ref("labelLayout")),
    },
    { ...closed, description: "Derived orthogonal route; from/to absent = automatic." },
  ),
  edgeLayout: Type.Union([ref("freeEdgeLayout"), ref("sEdgeLayout")]),
  titleBlock: Type.Object(
    { revision: opt(str()), date: opt(str()), author: opt(str()), company: opt(str()), document: opt(str()) },
    { ...closed, description: "Free fields of the title block drawn on every sheet; written only when not empty." },
  ),
  diagram: Type.Object(
    {
      paper: Type.Enum(Object.keys(PAPER_SIZES) as M.Paper[], {
        description: "Paper size of every sheet (landscape, 2 units per pt).",
      }),
      titleBlock: opt(ref("titleBlock")),
      states: Type.Record(str(), ref("stateLayout"), {
        description:
          "Keyed by state id. x/y are relative to the owning state's top-left, or to the sheet origin (the top-left corner of the drawing area inside the frame) for the root region and off-page regions.",
      }),
      regions: Type.Record(str(), ref("regionLayout"), { description: "Keyed by region id." }),
      transitions: Type.Record(str(), ref("edgeLayout"), {
        description:
          'Keyed by transition id. route absent or "free": from/to required, via bend points. route "s": derived orthogonal route; from/to optional (absent = automatic), jog = position of the movable segment. via, jog and free labels are relative to the innermost region containing both endpoints; S labels to the route\'s label anchor.',
      }),
    },
    closed,
  ),
  options: Type.Object(
    {
      signalQueue: opt(Type.Integer({ minimum: 0, description: "Capacity of the signal queue. Default 16." })),
      maxMicrosteps: opt(
        Type.Integer({
          minimum: 0,
          description:
            "Microsteps per reset/process call before a livelock error; 0: no check in generated code. Default 10000.",
        }),
      ),
      debugInfo: opt(
        Type.Boolean({
          description:
            "API option: name lookup for events, signals and states, and an is-active query in the generated code. Default false.",
        }),
      ),
      trace: opt(
        Type.Boolean({
          description:
            "API option: the generated code calls a trace hook the application implements (event, signal, transition, enter, exit; ids only). Default false.",
        }),
      ),
    },
    {
      ...closed,
      description:
        "Shared by every code generator, the interpreter and the simulator. Behaviour options (signalQueue, maxMicrosteps) are set here only, so a model behaves the same in every language; API options (debugInfo, trace) may be overridden in targets.<name>.",
    },
  ),
  document: Type.Object(
    {
      $schema: opt(str()),
      format: Type.Literal("ufsm"),
      version: Type.Literal(1),
      name: str(),
      doc: opt(str()),
      declarations: ref("declarations"),
      machine: ref("machine"),
      diagram: opt(ref("diagram")),
      options: opt(ref("options")),
      target: opt(
        Type.String({
          description:
            "The code generator the editor's Generate and `ufsm generate <model>` use: c, python, ts, rust, go or cpp.",
        }),
      ),
      targets: opt(
        Type.Record(str(), Type.Record(str(), Type.Unknown()), {
          description:
            "Per code generator settings, keyed by target name (c, python, ts, rust, go, cpp, ...): the generator's own keys, out (the output folder, relative to the model's file or absolute) and overrides of API options; behaviour options belong in options.",
        }),
      ),
    },
    closed,
  ),
};

/** A v1 document, for `Value.Check`/`Value.Errors`. */
export const V1_SCHEMA = Type.Cyclic(defs, "document");

/** The named definitions, for following `$ref`s (`{ "$ref": "region" }`) when explaining a validation error. */
export const V1_DEFS: Readonly<Record<string, unknown>> = defs;

const ANY_KEY = "^.*$";
const ID = "https://github.com/jonasblixt/ufsm/schema/ufsm-v1.schema.json";

/**
 * The published JSON Schema (draft-07): the document's definition at the top, every other definition under
 * `definitions`, references as `#/definitions/<name>`.
 */
export function v1JsonSchema(): Record<string, unknown> {
  const plain = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(plain);
    if (typeof v !== "object" || v === null) return v;
    const out: Record<string, unknown> = {};
    // Descriptions first, as a reader of the file looks for them.
    const entries = Object.entries(v).sort(([a], [b]) => Number(b === "description") - Number(a === "description"));
    for (const [k, x] of entries) {
      // A record's catch-all pattern says the same as additionalProperties, which reads better.
      if (k === "patternProperties" && Object.keys(x as object).join() === ANY_KEY) {
        out["additionalProperties"] = plain((x as Record<string, unknown>)[ANY_KEY]);
        continue;
      }
      if (k === "$id") continue;
      out[k] = k === "$ref" && typeof x === "string" ? `#/definitions/${x}` : plain(x);
    }
    return out;
  };
  const { document, ...rest } = defs;
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: ID,
    title: "uFSM model, format version 1",
    description:
      "Hierarchical state machine with declarations, semantics (machine) and layout (diagram). See docs/format-v1.md.",
    ...(plain(document) as Record<string, unknown>),
    definitions: plain(rest),
  };
}

// ---------------------------------------------------------------- model.ts must describe the same shapes

type Def<K extends keyof typeof defs & string> = Static<ReturnType<typeof Type.Cyclic<typeof defs, K>>>;

/** Keys of every union member, leaving out fields typed `never` (the schema's "not allowed here" fields). */
type Keys<T> = T extends unknown ? { [K in keyof T]-?: [T[K]] extends [undefined] ? never : K }[keyof T] : never;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Agree<Schema, Model> =
  Same<Schema, Model> extends true ? (Same<Keys<Schema>, Keys<Model>> extends true ? true : false) : false;

// "Type 'true' is not assignable to type 'false'" on a row below: that model.ts interface and its definition above
// differ (a field on one side only, an optional field, or a type).
const agree: {
  [K in keyof Checked]: Agree<Def<Checked[K][0]>, Checked[K][1]>;
} = {
  decl: true,
  declarations: true,
  action: true,
  guardTerm: true,
  region: true,
  state: true,
  pseudo: true,
  timer: true,
  internalTransition: true,
  transition: true,
  machine: true,
  stateLayout: true,
  regionLayout: true,
  edgeEnd: true,
  labelLayout: true,
  freeEdgeLayout: true,
  sEdgeLayout: true,
  titleBlock: true,
  diagram: true,
  options: true,
  document: true,
};
void agree;

interface Checked {
  decl: ["decl", M.Decl];
  declarations: ["declarations", M.Declarations];
  action: ["action", M.Action];
  guardTerm: ["guardTerm", M.GuardTerm];
  region: ["region", M.Region];
  state: ["state", M.State];
  pseudo: ["pseudo", M.Pseudo];
  timer: ["timer", M.Timer];
  internalTransition: ["internalTransition", M.InternalTransition];
  transition: ["transition", M.Transition];
  machine: ["machine", M.Machine];
  stateLayout: ["stateLayout", M.StateLayout];
  regionLayout: ["regionLayout", M.RegionLayout];
  edgeEnd: ["edgeEnd", M.EdgeEnd];
  labelLayout: ["labelLayout", M.LabelLayout];
  freeEdgeLayout: ["freeEdgeLayout", M.FreeEdgeLayout];
  sEdgeLayout: ["sEdgeLayout", M.SEdgeLayout];
  titleBlock: ["titleBlock", M.TitleBlock];
  diagram: ["diagram", M.Diagram];
  options: ["options", M.ModelOptions];
  document: ["document", M.UfsmDocument & { $schema?: string }];
}
