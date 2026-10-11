// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The editor model's region Tool: arming a tool (keys, palette, Add menu), placing a vertex (click, or drag for its
 * size) and drawing a transition (source, bend points, target), with the ghost and route previews drawn over the sheet.
 */
import { indexV1, type DocIndex, type EdgeEnd, type UfsmDocument, type Vertex } from "@ufsm/core";
import { addTransition, addVertex, cannotAdd, cannotConnect, draggedVertexBox, endAt, isRoundKind, newVertexBox, regionAt, type VertexKind } from "@ufsm/core/edit";
import { attachPoint, autoSides, edgeGeometry, sRoute, vertexBox, type Box, type Point } from "@ufsm/core/diagram";
import type { App } from "../app";
import type { EditorFsmHandler } from "../fsm/editor-fsm";
import type { InputState } from "../fsm/input";
import { hitTest } from "../hit";
import type { ToolId } from "../palette";
import { drawGhost, drawLink, drawLinkRoute } from "../preview";
import type { DocSession } from "../session";
import { isLinkTool, isVertexTool } from "./state";

const DRAG_THRESHOLD = 4;

/** The innermost vertex drawn at world point p on the active sheet. */
export function vertexAt(app: App, p: Point): Vertex | undefined {
  const d = app.ws.active;
  return d ? hitTest(d.index, d.sheet, p.x, p.y, 6 / app.canvas.view.scale).vertex : undefined;
}

/** Box of the vertex a press at p0 and the pointer at p would create (dragged: past the threshold). */
function placeBox(kind: VertexKind, p0: Point, p: Point, dragged: boolean, horizontal: boolean): Box {
  if (isRoundKind(kind)) return newVertexBox(kind, p);
  return dragged ? draggedVertexBox(kind, p0, p, horizontal) : newVertexBox(kind, p0, horizontal);
}

/** The last route computed for each document version, by what decides it (see linkRoute). */
const linkRoutes = new WeakMap<DocIndex, { key: string; points: Point[] | undefined }>();

/** The route a click on `target` would give the transition being drawn (computed on a copy; cached per target). */
function linkRoute(tool: ToolId, d: DocSession, source: string, from: Point, target: string, to: Point, bends: readonly Point[]): Point[] | undefined {
  // the ends the click would get, not the raw points: the route only changes when one of them does
  const end = (vid: string, p: Point): string => {
    const e = endAt(d.index, vid, p);
    return `${e.side}:${e.offset}`;
  };
  const key = `${tool} ${source} ${end(source, from)} ${target} ${end(target, to)} ${bends.map((p) => `${p.x},${p.y}`).join(" ")}`;
  const cached = linkRoutes.get(d.index);
  if (cached?.key === key) return cached.points;
  const copy = structuredClone(d.history.current) as UfsmDocument;
  let points: Point[] | undefined;
  try {
    const id = addTransition(copy, source, target, { via: [...bends], route: tool === "straight" ? "straight" : "s", fromAt: from, toAt: to });
    points = edgeGeometry(indexV1(copy), id)?.points;
  } catch {
    points = undefined;
  }
  linkRoutes.set(d.index, { key, points });
  return points;
}

/** An S route from end `start` of `source` to point `p` (the preview before a target is under the pointer). */
function sRouteTowards(index: DocIndex, source: string, start: EdgeEnd, p: Point): Point[] {
  const b = vertexBox(index, source);
  const inside = p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
  if (inside) return [];
  const [, into] = autoSides(b, { x: p.x, y: p.y, w: 0, h: 0 });
  return sRoute(attachPoint(index, source, start), start.side, p, into).points;
}

/** Tool overlay: the ghost of what a click places, or the transition being drawn. */
export function drawOverlay(app: App, c: CanvasRenderingContext2D, scale: number): void {
  const d = app.ws.active;
  const { link, ghost, tool } = app.tools;
  if (!d) return;
  if (link && d.index.vertices.has(link.source)) {
    const v = vertexAt(app, link.to);
    const ok = v !== undefined && cannotConnect(d.index, link.source, v.id) === undefined;
    const target = v && { box: vertexBox(d.index, v.id), ok };
    const source = vertexBox(d.index, link.source);
    // Over a valid target: the route the click would draw, exactly. Elsewhere: an S towards the pointer, or the
    // straight line through the bend points so far, both from the source end nearest to where it was clicked.
    const route = ok ? linkRoute(tool, d, link.source, link.from, v.id, link.to, link.bends) : undefined;
    const start = endAt(d.index, link.source, link.from);
    if (route) drawLinkRoute(c, source, route, target, scale);
    else if (tool === "transition") drawLinkRoute(c, source, sRouteTowards(d.index, link.source, start, link.to), target, scale);
    else drawLink(c, source, attachPoint(d.index, link.source, start), link.bends, link.to, target, scale);
  } else if (ghost) drawGhost(c, ghost.box, isVertexTool(ghost.kind) && isRoundKind(ghost.kind), scale);
}

/** The editor model's tool actions and guards. */
export function toolActions(app: App, input: InputState) {
  const s = app.tools;
  const at = (): Point => app.canvas.worldAt(input.x, input.y);
  const arm = (tool: ToolId) => (): void => void (s.tool = tool);

  /** Show (in the document, as an uncommitted edit) the vertex being placed. */
  const previewPlace = (p: Point, dragged: boolean): void => {
    const d = app.ws.active;
    const pl = s.placing;
    if (!d || !pl || pl.error || pl.kind === "region") return;
    const kind = pl.kind;
    const box = placeBox(kind, pl.p0, p, dragged, s.horizontal);
    d.preview((x) => void (pl.created = addVertex(x, pl.region, kind, box, { horizontal: s.horizontal })));
    app.ws.changed("document");
  };

  return {
    toolState: arm("state"),
    toolTransition: arm("transition"),
    toolStraight: arm("straight"),
    toolRegion: arm("region"),
    toolInitial: arm("initial"),
    toolFinal: arm("final"),
    toolHistory: arm("shallow-history"),
    toolDeepHistory: arm("deep-history"),
    toolFork: arm("fork"),
    toolJoin: arm("join"),
    toolTerminate: arm("terminate"),
    paletteTool: () => void (s.tool = input.tool as ToolId),
    showTool: () => {
      app.shell.palette.setActive(s.tool);
      app.canvas.canvas.style.cursor = "crosshair";
      s.ghost = undefined;
      app.ws.changed("chrome", "view");
    },
    toolSelect: () => {
      s.tool = "select";
      s.horizontal = false;
      s.ghost = undefined;
      app.shell.palette.setActive("select");
      app.canvas.canvas.style.cursor = "";
      app.ws.changed("chrome", "view");
    },
    rotateTool: () => {
      if (s.tool !== "fork" && s.tool !== "join") return;
      s.horizontal = !s.horizontal;
      s.ghost = { kind: s.tool, box: newVertexBox(s.tool, at(), s.horizontal) };
      app.ws.changed("chrome", "view");
    },
    placeMove: () => {
      const d = app.ws.active;
      if (!d) return;
      const p = at();
      if (isVertexTool(s.tool)) s.ghost = { kind: s.tool, box: newVertexBox(s.tool, p, s.horizontal) };
      else if (s.tool === "region") {
        const v = vertexAt(app, p);
        s.ghost = v?.kind === "state" ? { kind: s.tool, box: vertexBox(d.index, v.id) } : undefined;
      }
      app.canvas.canvas.style.cursor = "crosshair";
      app.canvas.requestDraw();
    },
    placeStart: () => {
      const d = app.ws.active;
      if (!d) return;
      s.ghost = undefined;
      const p0 = app.canvas.worldAt(input.startX, input.startY);
      if (!isVertexTool(s.tool)) {
        s.placing = { kind: "region", p0, region: "", error: undefined, created: undefined };
        return;
      }
      const region = regionAt(d.index, d.sheet, p0);
      s.placing = { kind: s.tool, p0, region: region.id, error: cannotAdd(d.index, region.id, s.tool), created: undefined };
      if (s.placing.error) return;
      d.begin();
      previewPlace(p0, false);
    },
    placeUpdate: () => {
      const dragged = Math.hypot(input.x - input.startX, input.y - input.startY) >= DRAG_THRESHOLD;
      previewPlace(at(), dragged);
    },
    placeFinish: () => {
      const d = app.ws.active;
      const pl = s.placing;
      s.placing = undefined;
      if (!d || !pl) return;
      if (pl.kind === "region") {
        const v = vertexAt(app, at());
        if (v?.kind === "state") {
          app.edits.addRegionTo(v.id);
          app.ws.select([v.id]);
        } else app.ws.say("Click a state to add a region to it.");
        return;
      }
      if (pl.error) {
        app.ws.say(pl.error);
        return;
      }
      d.commit();
      app.ws.changed("document");
      if (pl.created) app.ws.select([pl.created]);
    },
    placeCancel: () => {
      const d = app.ws.active;
      const pl = s.placing;
      s.placing = undefined;
      if (!d || !pl || pl.kind === "region" || pl.error) return;
      d.cancel();
      app.ws.changed("document");
    },
    validSource: () => {
      const d = app.ws.active;
      const v = d && vertexAt(app, at());
      return !!d && !!v && cannotConnect(d.index, v.id) === undefined;
    },
    overVertex: () => vertexAt(app, at()) !== undefined,
    validTarget: () => {
      const d = app.ws.active;
      const v = d && s.link && vertexAt(app, at());
      return !!d && !!s.link && !!v && cannotConnect(d.index, s.link.source, v.id) === undefined;
    },
    linkStart: () => {
      const v = vertexAt(app, at());
      if (!v) return;
      const p = at();
      s.link = { source: v.id, from: p, bends: [], to: p };
      app.ws.changed("chrome", "view");
    },
    linkUpdate: () => {
      if (!s.link) return;
      s.link.to = at();
      app.canvas.requestDraw();
    },
    linkBend: () => {
      if (!s.link) return;
      if (s.tool === "transition") {
        app.ws.say("An S transition lays out its own route: use the straight transition (A L) to place bend points.");
        return;
      }
      const p = at();
      s.link.bends.push({ x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 });
      app.canvas.requestDraw();
    },
    linkUnbend: () => {
      s.link?.bends.pop();
      app.canvas.requestDraw();
    },
    linkRefuse: () => {
      const d = app.ws.active;
      if (!d) return;
      const v = vertexAt(app, at());
      const why = v ? (s.link ? cannotConnect(d.index, s.link.source, v.id) : cannotConnect(d.index, v.id)) : undefined;
      app.ws.say(why ?? (s.link ? "Click the target state." : "Click the state the transition starts from."));
    },
    linkFinish: () => {
      const l = s.link;
      s.link = undefined;
      const p = at();
      const v = vertexAt(app, p);
      if (!app.ws.active || !l || !v) return;
      let id = "";
      const route = s.tool === "straight" ? "straight" : "s";
      app.ws.edit((d) => void (id = addTransition(d, l.source, v.id, { via: l.bends, route, fromAt: l.from, toAt: p })));
      if (id) app.ws.select([id]);
    },
    linkCancel: () => {
      s.link = undefined;
      app.ws.changed("chrome", "view");
    },
    paletteSelect: () => input.tool === "select",
    paletteConnect: () => isLinkTool(input.tool as ToolId),
  } satisfies Partial<EditorFsmHandler>;
}
