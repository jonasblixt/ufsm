// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The legacy (v0.4 / v0.5) `.ufsm` JSON format, exactly as written by the
 * GTK editor in `old/compose`. Kept as-is so every existing model can be
 * loaded and later migrated to the v1 format.
 */

export type V0Side = "left" | "right" | "top" | "bottom";

export type V0StateKind =
  "state" | "init" | "final" | "shallow-history" | "deep-history" | "fork" | "join" | "terminate";

export const V0_STATE_KINDS: readonly V0StateKind[] = [
  "state",
  "init",
  "final",
  "shallow-history",
  "deep-history",
  "fork",
  "join",
  "terminate",
];

/** `trigger-kind` on transitions. */
export const V0TriggerKind = {
  Event: 0,
  Signal: 1,
  Auto: 2,
  Completion: 3,
} as const;

/** `kind` on entry/exit/transition action references. */
export const V0ActionRefKind = {
  Function: 0,
  Signal: 1,
} as const;

/** `kind` on guard references. */
export const V0GuardKind = {
  True: 0,
  False: 1,
  Eq: 2,
  Gt: 3,
  Gte: 4,
  Lt: 5,
  Lte: 6,
  /** Guard is true when the referenced state is active. */
  PState: 7,
  /** Guard is true when the referenced state is NOT active. */
  NState: 8,
} as const;

export const V0Orientation = {
  NotApplicable: 0,
  Vertical: 1,
  Horizontal: 2,
} as const;

/** `paper-size`; the values are canvas units used by the old editor. */
export const V0_PAPER_SIZES: Readonly<Record<number, { name: string; w: number; h: number }>> = {
  1: { name: "A4", w: 1684, h: 1190 },
  2: { name: "A3", w: 2380, h: 1684 },
  3: { name: "A2", w: 3368, h: 2380 },
  4: { name: "A1", w: 4768, h: 3368 },
};

export interface V0Named {
  id: string;
  name: string;
}

export interface V0ActionRef {
  id: string;
  kind: number;
  "action-id"?: string;
  "signal-id"?: string;
}

export interface V0GuardRef {
  id: string;
  kind: number;
  "action-id"?: string;
  value?: number;
  "state-id"?: string;
}

export interface V0Endpoint {
  state: string;
  side: V0Side;
  offset: number;
}

export interface V0Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface V0Point {
  x: number;
  y: number;
}

export interface V0Transition {
  id: string;
  /** Trigger or signal id, depending on `trigger-kind`. */
  trigger?: string;
  "trigger-kind"?: number;
  source: V0Endpoint;
  dest: V0Endpoint;
  "text-block": V0Rect;
  vertices: V0Point[];
  guards: V0GuardRef[];
  actions: V0ActionRef[];
}

export interface V0State {
  id: string;
  name: string;
  kind: V0StateKind;
  /** Absolute canvas coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  orientation: number;
  entries: V0ActionRef[];
  exits: V0ActionRef[];
  region: V0Region[];
  transitions: V0Transition[];
}

export interface V0Region {
  id: string;
  name: string;
  off_page: boolean;
  /** -1 means "fill the remaining height of the parent state". */
  height: number;
  states: V0State[];
}

export interface V0Model {
  kind: "uFSM Model";
  version: 0;
  name: string;
  "paper-size": number;
  triggers: V0Named[];
  signals: V0Named[];
  actions: V0Named[];
  guards: V0Named[];
  region: V0Region;
}
