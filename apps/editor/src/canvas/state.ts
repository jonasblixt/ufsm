// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * What the canvas interaction is in the middle of: the armed tool (region Tool of the editor's model), a vertex being
 * placed, a transition being drawn, a drag, a rubber band. Plain data shared by the handler parts (pointer.ts,
 * tools.ts) and the drawing (view.ts); it is reset when another machine is shown.
 */
import type { DocIndex, Region } from "@ufsm/core";
import type { VertexKind } from "@ufsm/core/edit";
import type { Box, Point } from "@ufsm/core/diagram";
import type { Grip } from "../handles";
import type { BoxMode } from "../hit";
import { TOOL_NAMES, type ToolId } from "../palette";

/** Rubber-band selection in progress, in client coordinates. */
export interface Lasso {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Dragging to the right selects what is enclosed, to the left what is touched. */
export const lassoMode = (l: Lasso): BoxMode => (l.x1 >= l.x0 ? "enclosed" : "touching");

export interface Drag {
  grip: Grip;
  /** World point where the button went down. */
  x0: number;
  y0: number;
  /** The document as it was when the drag began; every preview starts from it. */
  base: DocIndex;
  /** Vertices, notes, frames and arrows to move (the selection when the drag began). */
  ids: string[];
  /** The sheet shown when the drag began (an arrow end attaches to what is under the pointer there). */
  sheet: Region;
}

export interface CanvasState {
  /** The tool the interaction model has armed (region Tool: Select, or Armed with Place/Connect). */
  tool: ToolId;
  /** Fork/join tools: place the bar horizontally (`r` turns it). */
  horizontal: boolean;
  /** Ghost of what a click would place, at the pointer (placing tools while the pointer is idle). */
  ghost: { kind: ToolId; box: Box } | undefined;
  /** A vertex being placed (the press went down; the vertex is previewed in the document). */
  placing:
    | {
        kind: VertexKind | "region" | "note" | "frame";
        p0: Point;
        region: string;
        error: string | undefined;
        created: string | undefined;
        box?: Box;
      }
    | undefined;
  /** A transition being drawn: its source and where it was clicked, the bend points so far and the pointer. */
  link: { source: string; from: Point; bends: Point[]; to: Point } | undefined;
  /** An arrow being drawn: where it starts and what that end attaches to (undefined: a free end), and the pointer. */
  arrow: { from: Point; target: string | undefined; to: Point } | undefined;
  drag: Drag | undefined;
  lasso: Lasso | undefined;
  /** Shift was held when the rubber band started: add to the selection. */
  lassoAdd: boolean;
  /** What the left button went down on (decided at the press: the machine's pressedOnGrip guard). */
  pressGrip: Grip | undefined;
}

export function canvasState(): CanvasState {
  return {
    tool: "select",
    horizontal: false,
    ghost: undefined,
    placing: undefined,
    link: undefined,
    arrow: undefined,
    drag: undefined,
    lasso: undefined,
    lassoAdd: false,
    pressGrip: undefined,
  };
}

export const isLinkTool = (t: ToolId): boolean => t === "transition" || t === "straight" || t === "arrow";
/** Tools that place a note or frame (click, or drag for its size). */
export const isNoteTool = (t: ToolId): t is "note" | "frame" => t === "note" || t === "frame";
export const isVertexTool = (t: ToolId): t is VertexKind =>
  t !== "select" && !isLinkTool(t) && t !== "region" && !isNoteTool(t);

/** Status line text while a tool is armed. */
export function toolHint(s: CanvasState): string {
  const name = TOOL_NAMES[s.tool];
  switch (s.tool) {
    case "transition":
      return s.link
        ? "S transition: click the target; the route lays itself out and follows the states · Esc cancels"
        : "S transition: click the source, then the target (or drag from one to the other) · Esc cancels";
    case "straight":
      return s.link
        ? "Straight transition: click the target · a click on empty canvas adds a bend point, Backspace removes the last · Esc cancels"
        : "Straight transition: click the source, then the target (or drag from one to the other) · Esc cancels";
    case "region":
      return "Region: click a state to add a region at its bottom · Esc cancels";
    case "note":
      return "Note: click to place, or drag for its size, then type · Esc cancels";
    case "frame":
      return "Group frame: drag around what it groups, then type its caption · Esc cancels";
    case "arrow":
      return s.arrow
        ? "Arrow: click where it points (on an element it stays attached; on empty canvas it is free) · Esc cancels"
        : "Arrow: click where it starts, then where it points (or drag) · Esc cancels";
    case "state":
      return "State: click to place, or drag to draw it · Esc cancels";
    case "fork":
    case "join":
      return `${name}: click to place, or drag for its length · r turns it (now ${s.horizontal ? "horizontal" : "vertical"}) · Esc cancels`;
    default:
      return `${name}: click to place · Esc cancels`;
  }
}
