// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The editor model's region Tool: arming a tool (keys, palette, Add menu), placing a vertex, note or frame (click, or
 * drag for its size) and drawing a transition (source, bend points, target) or an arrow (start, end), with the ghost
 * and route previews drawn over the sheet.
 */
import { indexV1, type DocIndex, type EdgeEnd, type UfsmDocument, type Vertex } from "@ufsm/core";
import {
  addArrow,
  addFrame,
  addNote,
  addTransition,
  addVertex,
  snap,
  cannotAdd,
  cannotConnect,
  draggedVertexBox,
  endAt,
  isRoundKind,
  newVertexBox,
  regionAt,
  type VertexKind,
} from "@ufsm/core/edit";
import {
  MIN_FRAME,
  MIN_NOTE_H,
  MIN_NOTE_W,
  NEW_FRAME_H,
  NEW_FRAME_W,
  NEW_NOTE_H,
  NEW_NOTE_W,
  attachBox,
  attachPoint,
  autoSides,
  edgeGeometry,
  sRoute,
  vertexBox,
  type Box,
  type Point,
} from "@ufsm/core/diagram";
import type { App } from "../app";
import type { EditorFsmHandler } from "../fsm/editor-fsm";
import type { InputState } from "../fsm/input";
import { arrowTargetAt, hitTest } from "../hit";
import type { ToolId } from "../palette";
import { drawArrowPreview, drawGhost, drawLink, drawLinkRoute } from "../preview";
import type { DocSession } from "../session";
import { isLinkTool, isNoteTool, isVertexTool } from "./state";

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

/** Box of a note or frame placed with a click at `p0` (its top-left there) or dragged from `p0` to `p`. */
function noteBox(kind: "note" | "frame", p0: Point, p: Point, dragged: boolean): Box {
  const [w, h] = kind === "note" ? [NEW_NOTE_W, NEW_NOTE_H] : [NEW_FRAME_W, NEW_FRAME_H];
  const [mw, mh] = kind === "note" ? [MIN_NOTE_W, MIN_NOTE_H] : [MIN_FRAME, MIN_FRAME];
  if (!dragged) return { x: snap(p0.x), y: snap(p0.y), w, h };
  const x0 = snap(Math.min(p0.x, p.x)),
    y0 = snap(Math.min(p0.y, p.y));
  return {
    x: x0,
    y: y0,
    w: Math.max(snap(Math.max(p0.x, p.x)) - x0, mw),
    h: Math.max(snap(Math.max(p0.y, p.y)) - y0, mh),
  };
}

/** What an arrow end at world point p attaches to (undefined: nothing, a free end). */
function arrowTarget(app: App, p: Point): string | undefined {
  const d = app.ws.active;
  return d ? arrowTargetAt(d.index, d.sheet, p.x, p.y, 6 / app.canvas.view.scale, app.canvas.measure) : undefined;
}

/** The last route computed for each document version, by what decides it (see linkRoute). */
const linkRoutes = new WeakMap<DocIndex, { key: string; points: Point[] | undefined }>();

/** The route a click on `target` would give the transition being drawn (computed on a copy; cached per target). */
function linkRoute(
  tool: ToolId,
  d: DocSession,
  source: string,
  from: Point,
  target: string,
  to: Point,
  bends: readonly Point[],
): Point[] | undefined {
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
    const id = addTransition(copy, source, target, {
      via: [...bends],
      route: tool === "straight" ? "straight" : "s",
      fromAt: from,
      toAt: to,
    });
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
  const { link, ghost, tool, arrow } = app.tools;
  if (!d) return;
  if (arrow) {
    const target = arrowTarget(app, arrow.to);
    drawArrowPreview(c, arrow.from, arrow.to, target === undefined ? undefined : attachBox(d.index, target), scale);
  } else if (link && d.index.vertices.has(link.source)) {
    const v = vertexAt(app, link.to);
    const ok = v !== undefined && cannotConnect(d.index, link.source, v.id) === undefined;
    const target = v && { box: vertexBox(d.index, v.id), ok };
    const source = vertexBox(d.index, link.source);
    // Over a valid target: the route the click would draw, exactly. Elsewhere: an S towards the pointer, or the
    // straight line through the bend points so far, both from the source end nearest to where it was clicked.
    const route = ok ? linkRoute(tool, d, link.source, link.from, v.id, link.to, link.bends) : undefined;
    const start = endAt(d.index, link.source, link.from);
    if (route) drawLinkRoute(c, source, route, target, scale);
    else if (tool === "transition")
      drawLinkRoute(c, source, sRouteTowards(d.index, link.source, start, link.to), target, scale);
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
    if (kind === "note" || kind === "frame") {
      const box = noteBox(kind, pl.p0, p, dragged);
      pl.box = box;
      d.preview((x) => void (pl.created = kind === "note" ? addNote(x, pl.region, box) : addFrame(x, pl.region, box)));
      app.ws.changed("document");
      return;
    }
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
    toolNote: arm("note"),
    toolArrow: arm("arrow"),
    toolFrame: arm("frame"),
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
      else if (isNoteTool(s.tool)) s.ghost = { kind: s.tool, box: noteBox(s.tool, p, p, false) };
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
      if (isNoteTool(s.tool)) {
        s.placing = {
          kind: s.tool,
          p0,
          region: regionAt(d.index, d.sheet, p0).id,
          error: undefined,
          created: undefined,
        };
        d.begin();
        previewPlace(p0, false);
        return;
      }
      if (!isVertexTool(s.tool)) {
        s.placing = { kind: "region", p0, region: "", error: undefined, created: undefined };
        return;
      }
      const region = regionAt(d.index, d.sheet, p0);
      s.placing = {
        kind: s.tool,
        p0,
        region: region.id,
        error: cannotAdd(d.index, region.id, s.tool),
        created: undefined,
      };
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
      if (pl.kind === "note") {
        // the note exists once its text is typed (text-edit.ts creates it)
        d.cancel();
        app.ws.changed("document");
        if (pl.box) app.textEdit.openNew(pl.region, pl.box);
        return;
      }
      d.commit();
      if (pl.kind === "frame" && pl.created) {
        app.ws.changed("document");
        app.ws.select([pl.created]);
        app.textEdit.open(pl.created);
        return;
      }
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
      if (s.tool === "arrow") return !!d;
      const v = d && vertexAt(app, at());
      return !!d && !!v && cannotConnect(d.index, v.id) === undefined;
    },
    overVertex: () => s.tool !== "arrow" && vertexAt(app, at()) !== undefined,
    validTarget: () => {
      const d = app.ws.active;
      if (s.tool === "arrow") return !!d && !!s.arrow;
      const v = d && s.link && vertexAt(app, at());
      return !!d && !!s.link && !!v && cannotConnect(d.index, s.link.source, v.id) === undefined;
    },
    linkStart: () => {
      if (s.tool === "arrow") {
        const p = at();
        s.arrow = { from: p, target: arrowTarget(app, p), to: p };
        app.ws.changed("chrome", "view");
        return;
      }
      const v = vertexAt(app, at());
      if (!v) return;
      const p = at();
      s.link = { source: v.id, from: p, bends: [], to: p };
      app.ws.changed("chrome", "view");
    },
    linkUpdate: () => {
      if (s.arrow) {
        s.arrow.to = at();
        app.canvas.requestDraw();
        return;
      }
      if (!s.link) return;
      s.link.to = at();
      app.canvas.requestDraw();
    },
    linkBend: () => {
      if (s.arrow) {
        app.ws.say("An arrow is one straight line: click where it points.");
        return;
      }
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
      const a = s.arrow;
      if (a) {
        s.arrow = undefined;
        const d = app.ws.active;
        const p = at();
        if (!d) return;
        let id = "";
        const sheet = d.sheet.id;
        app.ws.edit(
          (x) => void (id = addArrow(x, sheet, { target: a.target, p: a.from }, { target: arrowTarget(app, p), p })),
        );
        if (id) app.ws.select([id]);
        return;
      }
      const l = s.link;
      s.link = undefined;
      const p = at();
      const v = vertexAt(app, p);
      if (!app.ws.active || !l || !v) return;
      let id = "";
      const route = s.tool === "straight" ? "straight" : "s";
      app.ws.edit(
        (d) => void (id = addTransition(d, l.source, v.id, { via: l.bends, route, fromAt: l.from, toAt: p })),
      );
      if (id) app.ws.select([id]);
    },
    linkCancel: () => {
      s.link = undefined;
      s.arrow = undefined;
      app.ws.changed("chrome", "view");
    },
    paletteSelect: () => input.tool === "select",
    paletteConnect: () => isLinkTool(input.tool as ToolId),
  } satisfies Partial<EditorFsmHandler>;
}
