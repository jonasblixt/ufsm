// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * uFSM file format, version 1. See docs/format-v1.md for the specification
 * and packages/core/schema/ufsm-v1.schema.json for the JSON Schema.
 *
 * Three sections with different readers:
 *   declarations  events, signals, actions, guards (what the machine talks to)
 *   machine       states, regions, transitions (semantics; what generators read)
 *   diagram       positions and sizes keyed by element id (only the editor reads it)
 *
 * All ids are unique within one document; every reference is by id.
 */

export type Id = string;

export const FORMAT = "ufsm";
export const VERSION = 1;

// ---------------------------------------------------------------- declarations

export interface Decl {
  id: Id;
  /** Must be a C identifier; unique across all four declaration lists. */
  name: string;
  doc?: string;
}

export interface Declarations {
  /** External inputs, passed to process(). */
  events: Decl[];
  /** Internal events, emitted by the machine itself. */
  signals: Decl[];
  /** Functions the machine calls: entry/exit/transition actions. */
  actions: Decl[];
  /** Functions the machine calls to decide whether a transition may fire. */
  guards: Decl[];
}

export type DeclKind = "event" | "signal" | "action" | "guard";

// ---------------------------------------------------------------- behaviour

/** Call an action function, or emit a signal. */
export type Action = { call: Id } | { emit: Id };

/**
 * One guard condition. A transition's `guard` list is a conjunction: all
 * terms must hold. Guard functions return a boolean and take no arguments.
 *   { call }               guard() is true
 *   { call, not: true }    guard() is false
 *   { in }                 state is active
 *   { in, not: true }      state is not active
 */
export type GuardTerm = { call: Id; not?: true } | { in: Id; not?: true };

// ---------------------------------------------------------------- structure

export type PseudoKind = "initial" | "final" | "shallow-history" | "deep-history" | "fork" | "join" | "terminate";

export const PSEUDO_KINDS: readonly PseudoKind[] = [
  "initial",
  "final",
  "shallow-history",
  "deep-history",
  "fork",
  "join",
  "terminate",
];

export interface State {
  id: Id;
  kind: "state";
  /** Display name, free text. */
  name: string;
  doc?: string;
  entry?: Action[];
  exit?: Action[];
  /**
   * Internal transitions (UML; visualSTATE: static reactions): react to an event without leaving the state, so no
   * exit or entry actions run and the state's regions keep their configuration. Drawn as text in the action block.
   */
  internal?: InternalTransition[];
  /** Orthogonal regions, top-down in the diagram. */
  regions?: Region[];
}

/** An internal transition of a state: trigger, guard and actions, no target. Ids share the transition id space. */
export interface InternalTransition {
  id: Id;
  /** Event or signal id (required: internal transitions are always triggered). */
  on: Id;
  guard?: GuardTerm[];
  do?: Action[];
  doc?: string;
}

export interface Pseudo {
  id: Id;
  kind: PseudoKind;
  name?: string;
}

export type Vertex = State | Pseudo;

export interface Region {
  id: Id;
  name?: string;
  /** In drawing order. */
  states: Vertex[];
}

export interface Transition {
  id: Id;
  from: Id;
  to: Id;
  /** Event or signal id. At most one of on / auto / completion. */
  on?: Id;
  /** Trigger-less: evaluated after every step. */
  auto?: true;
  /** Fires when the source state's regions have all reached a final state. */
  completion?: true;
  /** All terms must hold. */
  guard?: GuardTerm[];
  do?: Action[];
  doc?: string;
}

export interface Machine {
  root: Region;
  transitions: Transition[];
}

// ---------------------------------------------------------------- diagram

export type Side = "left" | "right" | "top" | "bottom";
export type Paper = "A4" | "A3" | "A2" | "A1";

/** Grid every placed or dragged position snaps to, and that derived S routes keep to (canvas units). */
export const GRID = 10;

export const PAPER_SIZES: Readonly<Record<Paper, { w: number; h: number }>> = {
  A4: { w: 1684, h: 1190 },
  A3: { w: 2380, h: 1684 },
  A2: { w: 3368, h: 2380 },
  A1: { w: 4768, h: 3368 },
};

/**
 * State geometry. x/y are relative to the origin of the state's region:
 * the top-left corner of the state owning the region, or the sheet origin
 * for the root region and for off-page regions.
 */
export interface StateLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fork/join bars only; default vertical. */
  orientation?: "horizontal" | "vertical";
}

export interface RegionLayout {
  /** Height of the region band inside its state. Omitted: fill the rest of the state. */
  h?: number;
  /** Draw the region's contents on a sheet of its own. */
  offPage?: true;
}

export interface EdgeEnd {
  side: Side;
  /** Distance along the side from its top/left end. */
  offset: number;
}

/** Top-left of a transition label and the width it wraps at. */
export interface LabelLayout {
  x: number;
  y: number;
  w: number;
}

/**
 * Hand-drawn transition (`route` absent or "free"): fixed ends and bend points.
 * `via` and `label` are relative to the origin of the innermost region that
 * contains both endpoints (see StateLayout).
 */
export interface FreeEdgeLayout {
  route?: "free";
  from: EdgeEnd;
  to: EdgeEnd;
  via?: [number, number][];
  label?: LabelLayout;
}

/**
 * Orthogonal S route (`route: "s"`): the geometry is derived (v1/route.ts),
 * so the transition follows its states. An end without `from`/`to` picks its
 * side and offset automatically; a given one is pinned. `jog` is the position
 * of the movable segment, on the axis it was set for, relative to the same
 * origin as `via`; absent, it is centred. `label` is relative to the route's
 * label anchor (route.ts `labelAnchor`).
 */
export interface SEdgeLayout {
  route: "s";
  from?: EdgeEnd;
  to?: EdgeEnd;
  jog?: { x: number } | { y: number };
  label?: LabelLayout;
}

export type EdgeLayout = FreeEdgeLayout | SEdgeLayout;
export type RouteStyle = "free" | "s";

/**
 * Free fields of the title block (every other cell is filled from the model). Plain text, written only when not empty;
 * the editor sets them in the Project tab.
 */
export interface TitleBlock {
  revision?: string;
  /** Usually the date of the revision (ISO 8601, YYYY-MM-DD), set by hand: a date written on every save would make
   * every save a change. */
  date?: string;
  author?: string;
  company?: string;
  document?: string;
}

/** The title block's free fields in canonical order. */
export const TITLE_BLOCK_FIELDS: readonly (keyof TitleBlock)[] = ["revision", "date", "author", "company", "document"];

export interface Diagram {
  paper: Paper;
  titleBlock?: TitleBlock;
  states: Record<Id, StateLayout>;
  regions: Record<Id, RegionLayout>;
  transitions: Record<Id, EdgeLayout>;
}

// ---------------------------------------------------------------- options

/** The `options` section, shared by every code generator, the interpreter and the simulator (`v1/options.ts`). */
export interface ModelOptions {
  /** Capacity of the signal queue; emitting into a full queue is an error. Default 16. */
  signalQueue?: number;
  /** Microsteps per reset/process call before a livelock error; 0 disables the check in generated code. Default 10000. */
  maxMicrosteps?: number;
  /** API option: name lookup for events, signals and states, and an "is this state active" query. Default false. */
  debugInfo?: boolean;
  /** API option: a trace hook the application implements (event, signal, transition, enter, exit; ids only). Default false. */
  trace?: boolean;
}

// ---------------------------------------------------------------- document

export interface UfsmDocument {
  format: "ufsm";
  version: 1;
  name: string;
  doc?: string;
  declarations: Declarations;
  machine: Machine;
  diagram?: Diagram;
  options?: ModelOptions;
  /** Per code generator settings, e.g. { "c": { "prefix": "dimmer_" } }; API options from `options` may be overridden here. */
  targets?: Record<string, Record<string, unknown>>;
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function isState(v: Vertex): v is State {
  return v.kind === "state";
}
