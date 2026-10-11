// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The editor model's region Pointer with the select tool: click and Shift-click selection, the rubber band, panning
 * (right button), wheel zoom, double-click (enter a state, reset a handle, fit) and dragging what the press went down
 * on (a vertex, a handle, a label).
 */
import type { State, UfsmDocument } from "@ufsm/core";
import {
  moveRegionSplit,
  moveVertices,
  removeBendPoint,
  resetActionsHeight,
  resetJog,
  resetLabel,
  resizeVertex,
  setActionsHeight,
  setBendPoint,
  setEdgeEnd,
  setJog,
  setLabel,
  unpinEdgeEnd,
  type EdgeTargets,
} from "@ufsm/core/edit";
import { HEADER_H, actionBlock, edgeGeometry, regionBoxes, routeInfo, vertexBox } from "@ufsm/core/diagram";
import type { App } from "../app";
import type { EditorFsmHandler } from "../fsm/editor-fsm";
import type { InputState } from "../fsm/input";
import { gripAt, type Grip } from "../handles";
import { boxSelect, hiddenMarkerAt, hitTest, hitTransition } from "../hit";
import { TITLE_FIELD_LABELS } from "../panel";
import { lassoMode, type Drag } from "./state";

const DRAG_THRESHOLD = 4;

/** What the current drag does to the document at pointer world position (x, y). */
function applyDrag(d: UfsmDocument, drag: Drag, x: number, y: number): void {
  const { grip, base } = drag;
  const dx = x - drag.x0, dy = y - drag.y0;
  switch (grip.kind) {
    case "move":
      moveVertices(d, drag.ids, dx, dy, grip.id);
      break;
    case "resize": {
      const b = vertexBox(base, grip.id);
      const at = { left: b.x + dx, right: b.x + b.w + dx, top: b.y + dy, bottom: b.y + b.h + dy };
      const targets: EdgeTargets = {};
      for (const e of grip.edges) targets[e] = at[e];
      resizeVertex(d, grip.id, targets);
      break;
    }
    case "split": {
      const band = regionBoxes(base, base.vertices.get(grip.id)!.vertex as State)[grip.k]!.box;
      moveRegionSplit(d, grip.id, grip.k, band.y + band.h + dy);
      break;
    }
    case "actions": {
      const s = base.vertices.get(grip.id)!.vertex as State;
      setActionsHeight(d, grip.id, vertexBox(base, grip.id).y + HEADER_H + actionBlock(base, s).height + dy);
      break;
    }
    case "end":
      setEdgeEnd(d, grip.id, grip.end, { x, y });
      break;
    case "jog": {
      const j = routeInfo(base, grip.id)?.jog;
      if (j) setJog(d, grip.id, j.value + (j.axis === "x" ? dx : dy));
      break;
    }
    case "bend": {
      const p = edgeGeometry(base, grip.id)?.points[grip.i + 1];
      if (p) setBendPoint(d, grip.id, grip.i, { x: p.x + dx, y: p.y + dy });
      break;
    }
    case "label": {
      const l = edgeGeometry(base, grip.id)?.label;
      if (l) setLabel(d, grip.id, { x: l.x + dx, y: l.y + dy });
      break;
    }
  }
}

/** The editor model's pointer actions and guards. */
export function pointerActions(app: App, input: InputState) {
  const s = app.tools;
  const { canvas } = app;
  const slop = (): number => 6 / canvas.view.scale;

  /** The grip under a client point. */
  const gripUnder = (clientX: number, clientY: number, shift: boolean): { grip: Grip; cursor: string } | undefined => {
    const d = app.ws.active;
    if (!d) return undefined;
    const [x, y] = canvas.screenToWorld(clientX, clientY);
    return gripAt(d.index, d.sheet, d.selection, canvas.handles(), x, y, canvas.view.scale, shift, canvas.measure);
  };
  /** What a click at a client point selects: a transition (line or label), else the innermost vertex. */
  const pickAt = (clientX: number, clientY: number): string | undefined => {
    const d = app.ws.active;
    if (!d) return undefined;
    const [x, y] = canvas.screenToWorld(clientX, clientY);
    return hitTransition(d.index, d.sheet, x, y, slop(), canvas.measure)?.id ?? hitTest(d.index, d.sheet, x, y, slop()).vertex?.id;
  };
  /** A click on a handle keeps the selection (the handle belongs to it). */
  const onHandle = (): boolean => s.pressGrip !== undefined && s.pressGrip.kind !== "move" && s.pressGrip.kind !== "label";
  /** Status line while dragging: position or size of what is dragged. */
  const dragStatus = (drag: Drag): string => {
    const d = app.ws.active;
    if (!d) return "";
    const g = drag.grip;
    if (g.kind === "move" || g.kind === "resize") {
      const b = vertexBox(d.index, g.id);
      return g.kind === "move" ? `x ${b.x} · y ${b.y}` : `${b.w} × ${b.h}`;
    }
    return "Esc cancels";
  };

  return {
    pressStart: () => {
      s.lassoAdd = input.shift;
      s.pressGrip = gripUnder(input.startX, input.startY, input.shift)?.grip;
    },
    lassoUpdate: () => {
      s.lasso = { x0: input.startX, y0: input.startY, x1: input.x, y1: input.y };
      canvas.requestDraw();
    },
    lassoFinish: () => {
      const l = s.lasso;
      const d = app.ws.active;
      s.lasso = undefined;
      canvas.requestDraw();
      if (!d || !l) return;
      const [ax, ay] = canvas.screenToWorld(l.x0, l.y0);
      const [bx, by] = canvas.screenToWorld(l.x1, l.y1);
      const rect = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
      const picked = boxSelect(d.index, d.sheet, rect, lassoMode(l));
      app.ws.select(s.lassoAdd ? [...d.selection, ...picked] : picked);
    },
    lassoCancel: () => {
      s.lasso = undefined;
      canvas.requestDraw();
    },
    selectAtPointer: () => {
      const d = app.ws.active;
      if (!d) return;
      // A click on a state's hidden-lines marker shows every line again (and selects the state).
      const [wx, wy] = canvas.screenToWorld(input.x, input.y);
      const marked = hiddenMarkerAt(d.index, d.sheet, wx, wy);
      if (marked) {
        app.ws.select([marked.id]);
        app.ws.edit((x) => resetActionsHeight(x, marked.id));
        return;
      }
      if (onHandle()) return;
      const id = pickAt(input.x, input.y);
      app.ws.select(id ? [id] : []);
    },
    toggleAtPointer: () => {
      const d = app.ws.active;
      if (!d || onHandle()) return;
      const id = pickAt(input.x, input.y);
      if (!id) return;
      const next = new Set(d.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      app.ws.select(next);
    },
    panStart: () => undefined,
    panBegin: () => {
      canvas.canvas.style.cursor = "";
      canvas.canvas.classList.add("panning");
    },
    panMove: () => {
      const v = canvas.view;
      v.x += input.x - input.lastX;
      v.y += input.y - input.lastY;
      canvas.requestDraw();
    },
    panEnd: () => canvas.canvas.classList.remove("panning"),
    zoomAtPointer: () => {
      const r = canvas.canvas.getBoundingClientRect();
      canvas.zoomAround(input.x - r.left, input.y - r.top, Math.min(Math.max(canvas.view.scale * Math.exp(-input.wheelDeltaY * 0.0015), 0.05), 8));
    },
    openAtPointer: () => {
      const d = app.ws.active;
      if (!d) return;
      // On a handle or label: give a pinned S end, a jog, an S label or an action block's height back to automatic.
      const g = gripUnder(input.x, input.y, false)?.grip;
      if (g && g.kind !== "move") {
        const sRoute = routeInfo(d.index, g.id) !== undefined;
        if (g.kind === "end" && sRoute && g.pinned) app.ws.edit((x) => unpinEdgeEnd(x, g.id, g.end));
        else if (g.kind === "jog") app.ws.edit((x) => resetJog(x, g.id));
        else if (g.kind === "actions") app.ws.edit((x) => resetActionsHeight(x, g.id));
        else if (g.kind === "label" && sRoute) app.ws.edit((x) => resetLabel(x, g.id));
        else if (g.kind === "bend") app.ws.edit((x) => removeBendPoint(x, g.id, g.i));
        return;
      }
      const [x, y] = canvas.screenToWorld(input.x, input.y);
      if (hitTransition(d.index, d.sheet, x, y, slop(), canvas.measure)) return;
      const hit = hitTest(d.index, d.sheet, x, y, slop());
      if (hit.vertex?.kind === "state") app.nav.enterState(hit.vertex, hit.region);
      else if (!hit.vertex && canvas.onTitleBlock(x, y)) app.shell.focusProjectField(TITLE_FIELD_LABELS.revision);
      else if (!hit.vertex) canvas.fit();
    },
    dragBegin: () => {
      const d = app.ws.active;
      if (!d || !s.pressGrip) return;
      const g = s.pressGrip;
      if ((g.kind === "move" || g.kind === "label") && !d.selection.has(g.id)) app.ws.select([g.id]);
      const [x0, y0] = canvas.screenToWorld(input.startX, input.startY);
      s.drag = { grip: g, x0, y0, base: d.index, ids: [...d.selection].filter((id) => d.index.vertices.has(id)) };
      d.begin();
    },
    dragUpdate: () => {
      const d = app.ws.active;
      const drag = s.drag;
      if (!d || !drag) return;
      const [x, y] = canvas.screenToWorld(input.x, input.y);
      d.preview((draft) => applyDrag(draft, drag, x, y));
      app.ws.changed("document");
      app.shell.setStatus(dragStatus(drag));
    },
    dragFinish: () => {
      const d = app.ws.active;
      if (!d || !s.drag) return;
      s.drag = undefined;
      d.commit();
      app.ws.changed("document");
    },
    dragCancel: () => {
      const d = app.ws.active;
      if (!d || !s.drag) return;
      s.drag = undefined;
      d.cancel();
      app.ws.changed("document");
    },
    hover: () => {
      canvas.canvas.style.cursor = s.tool !== "select" ? "crosshair" : (gripUnder(input.x, input.y, input.shift)?.cursor ?? "");
    },
    beyondThreshold: () => Math.hypot(input.x - input.startX, input.y - input.startY) >= DRAG_THRESHOLD,
    pressedOnGrip: () => s.pressGrip !== undefined,
  } satisfies Partial<EditorFsmHandler>;
}
