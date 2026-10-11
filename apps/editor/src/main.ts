// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import {
  UFSM_VERSION,
  UfsmFormatError,
  MachineError,
  formatTrace,
  addDecl,
  addRegion,
  cannotOffPage,
  setBarOrientation,
  setOffPage,
  addTransition,
  addVertex,
  attachPoint,
  autoSides,
  endAt,
  cannotAdd,
  HEADER_H,
  actionBlock,
  cannotConnect,
  checkV1,
  copyFragment,
  deleteElements,
  draggedVertexBox,
  edgeGeometry,
  insertBendPoint,
  isRoundKind,
  newVertexBox,
  pasteFragment,
  regionAt,
  removeBendPoint,
  toSRoute,
  indexV1,
  loadModel,
  moveRegionSplit,
  moveVertices,
  newDocument,
  regionBoxes,
  resetActionsHeight,
  resetJog,
  resetLabel,
  resizeVertex,
  routeInfo,
  sRoute,
  serializeV1,
  setActionsHeight,
  setBendPoint,
  setEdgeEnd,
  setJog,
  setLabel,
  setMachineName,
  setPaper,
  unpinEdgeEnd,
  PAPER_SIZES,
  vertexBox,
  type Diagnostic,
  type DocIndex,
  type EdgeEnd,
  type Box,
  type CodeTarget,
  type EdgeTargets,
  type Fragment,
  type GeneratedFile,
  type LoadedModel,
  type Paper,
  type Point,
  type Region,
  type State,
  type UfsmDocument,
  type Vertex,
  type VertexKind,
  TITLE_BLOCK_FIELDS,
  locate,
  locationText,
  behaviourOptions,
  OPTION_DEFAULTS,
  paperOf,
  sheetFrame,
  sheetOfRegion,
  sheetOfVertex,
} from "@ufsm/core";
import { sheetLabel, sheetPath, parentSheet } from "./nav";
import {
  baseName,
  cachedSettings,
  confirmDiscard,
  copyText,
  saveFilesToFolder,
  saveTextFile,
  customWindowControls,
  inTauri,
  isMac,
  onCloseRequested,
  onSystemAppearance,
  openModelFile,
  readSettings,
  saveModelFile,
  setWindowTitle,
  systemPrefersDark,
  windowControls,
  writeSettings,
} from "./platform";
import { boxSelect, hitTest, hitTransition, sheetBounds, pillAt, renderSheet, vertexBounds, type BoxMode, type Bounds, type SimHighlight, type View } from "./render";
import { C, FALLBACK_THEME, THEMES, canvasAlpha, findTheme, modifierHasEffect, resolveTheme, setCanvasTheme, themeInfo, type ResolvedTheme } from "./theme";
import { parseSettings, serializeSettings, zoomStep, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, type AppearanceChoice, type Settings, type ThemeSetting } from "./settings";
import { Simulation, relativePath, type SimOptions } from "./sim";
import type { SimOps, SimProps } from "./simpanel";
import type { CodeOps } from "./codepanel";
import { generatedCode } from "./code";
import { gripAt, handlesFor, type Grip, type Handle } from "./handles";
import { History } from "./history";
import { nameOnSave, untitledName } from "./untitled";
import { TOOL_KEYS, TOOL_NAMES, buildPalette, type ToolId } from "./palette";
import { drawGhost, drawLink, drawLinkRoute } from "./preview";
import { buildTree, type Tree } from "./tree";
import { explorerEntry, type ExplorerEntry } from "./explorer";
import { API_OPTION_INFO, MODEL_OPTIONS, TARGETS, TITLE_FIELD_LABELS, TITLE_FIELD_NAMES, renderPanel, type FocusField, type PanelOps, type PanelTab } from "./panel";
import { attachSash } from "./sash";
import { autoHideScrollbars, wheelScrollsHorizontally } from "./scrollbars";
import { renderTabs } from "./tabs";
import { renderTitleBar, type Menu, type MenuItem } from "./titlebar";
import { openQuickPick } from "./quickpick";
import { elementItems, helpItems, menuCommands, remember, search, type SearchItem } from "./search";
import { attachInput, type Input } from "./fsm/input";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

const canvas = el<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const titleBarEl = el<HTMLElement>("titlebar");
const tabsEl = el<HTMLElement>("tabs");
const breadcrumbsEl = el<HTMLElement>("breadcrumbs");
const panelEl = el<HTMLElement>("panel");
const explorerEl = el<HTMLElement>("explorer");
const explorerEmptyEl = el<HTMLElement>("explorer-empty");
const zoomEl = el<HTMLSpanElement>("zoom");
const fitBtn = el<HTMLButtonElement>("fit");
const upBtn = el<HTMLButtonElement>("up");
const crumbsEl = el<HTMLElement>("crumbs");
const statusEl = el<HTMLSpanElement>("status");
const problemsEl = el<HTMLButtonElement>("problems");
const simStatusEl = el<HTMLButtonElement>("sim-status");
const emptyEl = el<HTMLDivElement>("empty");
/** Set once the interaction model is attached (bottom of this file): a palette click goes through it. */
let pickTool: (tool: ToolId) => void = () => undefined;
const palette = buildPalette(el<HTMLElement>("palette"), (id) => pickTool(id));
const fileInput = el<HTMLInputElement>("file-input");

/** One open machine (a tab). Everything about it lives here, so switching tabs swaps the whole editing context. */
interface Doc {
  /** Stable key for the tab strip. */
  key: number;
  /** The document and its undo steps; `index` is always built from `history.current`. */
  history: History<UfsmDocument>;
  index: DocIndex;
  fileName: string;
  /** Where Ctrl+S writes. Undefined until the document has been saved as v1. */
  path: string | undefined;
  /** History version that equals the file; -1 when no version does (converted from v0, never saved). */
  savedVersion: number;
  /** Made with File › New and never saved: the placeholder machine name, which the first save replaces by the file's name. */
  untitled: string | undefined;
  notes: LoadedModel["notes"];
  diagnostics: Diagnostic[];
  sheet: Region;
  /** Selected vertex and transition ids. */
  selection: Set<string>;
  /** Remembered pan/zoom per sheet so going back up restores the view. */
  views: Map<string, View>;
  /** Pan/zoom of the sheet on screen. */
  view: View;
  tree: Tree;
  /** Build the tree again when the machine section changed since it was built (edits, undo, redo). */
  syncTree(): void;
  /** This machine's section in the explorer. */
  entry: ExplorerEntry;
  /** The running simulation (undefined: stopped) and why the last start failed. */
  sim: Simulation | undefined;
  simError: string | undefined;
  /** Guard values by guard name, kept across simulations; bumped `guardsVersion` on every change. */
  guards: Map<string, boolean>;
  guardsVersion: number;
  /** The session's overrides of the model's options for the simulator (the Simulator tab's Options). */
  simOptions: Partial<SimOptions>;
  /** Record the innermost active states in saved traces. */
  recordActive: boolean;
  /** Event under the pointer in the Simulator tab: its transitions are shown on the canvas. */
  hoverEvent: string | undefined;
  /** Events that would take transitions now, for the current step and guard values. */
  would: { sim: Simulation; version: number; guards: number; map: Map<string, string[]> } | undefined;
  /** Which generated file the Code tab shows. */
  codeView: string;
}

/** Open machines in tab order, and the one shown. */
const docs: Doc[] = [];
let doc: Doc | undefined;
let nextKey = 1;

/** True when the in-memory document differs from the file. */
const isDirty = (d: Doc): boolean => d.history.version !== d.savedVersion;
/** The active machine's view (the same object as `doc.view`), or a placeholder while nothing is open. */
let view: View = { scale: 0.5, x: 0, y: 0 };
let frame = 0;
let panelTab: PanelTab = "properties";
/** Field of the Properties tab to focus on the next render (from the `e`/`a` keys). */
let panelFocus: FocusField | undefined;
/** Declaration to show in the Project tab on the next render (a problem's target). */
let panelHighlight: string | undefined;
let maximized = false;

// ---------------------------------------------------------------- settings and theme

/** Global settings: from the browser-storage copy at once (right colors on the first paint), then settings.json. */
let settings: Settings;
let settingsProblems: string[];
({ settings, problems: settingsProblems } = parseSettings(cachedSettings()));
/** Where settings live (shown in the Settings tab); undefined until read. */
let settingsLocation: string | undefined;
let systemDark = systemPrefersDark();
let theme: ResolvedTheme;
let themeProblems: string[] = [];

/** Resolve the theme for the current settings and OS appearance (or a theme being previewed in the search), and apply
 * it to the CSS and the canvas. */
function applyTheme(preview?: ThemeSetting): void {
  const r = resolveTheme(preview ?? settings.theme, systemDark);
  theme = r.theme;
  themeProblems = r.problems;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.css)) root.style.setProperty(k, v);
  root.style.colorScheme = theme.appearance;
  root.dataset.theme = [theme.id, ...Object.values(theme.inputs)].join("-");
  setCanvasTheme(theme);
}
applyTheme();
applyZoom();

/** UI zoom: scale the title bar, explorer, tabs, breadcrumbs, panel and status bar (CSS `zoom: var(--ui-zoom)`). The
 * canvas is not inside any of them, so the diagram, its own zoom and pointer coordinates on it are unaffected. */
function applyZoom(): void {
  document.documentElement.style.setProperty("--ui-zoom", String(settings.zoom / 100));
}

async function loadSettings(): Promise<void> {
  try {
    const f = await readSettings();
    settingsLocation = f.location;
    ({ settings, problems: settingsProblems } = parseSettings(f.text));
  } catch (e) {
    settingsLocation = "settings.json could not be read";
    settingsProblems = [String(e)];
  }
  applyTheme();
  applyZoom();
  renderShell();
  requestDraw();
}

/** A change in the Settings tab: apply it at once and save. */
function setThemeSetting(t: ThemeSetting): void {
  settings = { ...settings, theme: t };
  settingsProblems = [];
  applyTheme();
  renderShell();
  requestDraw();
  writeSettings(serializeSettings(settings)).catch((e: unknown) => say(`Settings not saved: ${String(e)}`));
}

/** Zoom the UI to `percent` (View › Zoom In/Out, Ctrl++/-/0, the Settings tab) and save it; the canvas keeps its own zoom. */
function setZoomSetting(percent: number): void {
  const zoom = Math.min(Math.max(Math.round(percent), ZOOM_MIN), ZOOM_MAX);
  if (zoom === settings.zoom) {
    say(`UI zoom ${zoom}%${zoom === ZOOM_MAX ? " (largest)" : zoom === ZOOM_MIN ? " (smallest)" : ""}`);
    return;
  }
  settings = { ...settings, zoom };
  applyZoom();
  say(`UI zoom ${zoom}%`);
  renderShell();
  requestDraw();
  writeSettings(serializeSettings(settings)).catch((e: unknown) => say(`Settings not saved: ${String(e)}`));
}
const zoomIn = (): void => setZoomSetting(zoomStep(settings.zoom, 1));
const zoomOut = (): void => setZoomSetting(zoomStep(settings.zoom, -1));
const zoomReset = (): void => setZoomSetting(100);
const uiZoom = (): number => settings.zoom / 100;

function onSystemDark(dark: boolean): void {
  if (dark === systemDark) return;
  systemDark = dark;
  if (settings.theme.appearance !== "system") return;
  applyTheme();
  renderShell();
  requestDraw();
}

/** Rubber-band selection in progress, in client coordinates. */
interface Lasso {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
let lasso: Lasso | undefined;

/** Dragging to the right selects what is enclosed, to the left what is touched. */
const lassoMode = (l: Lasso): BoxMode => (l.x1 >= l.x0 ? "enclosed" : "touching");

/** The tool the interaction model has armed (region Tool: Select, or Armed with Place/Connect). */
let tool: ToolId = "select";
/** Fork/join tools: place the bar horizontally (`r` turns it). */
let horizontal = false;
/** Ghost of what a click would place, at the pointer (placing tools while the pointer is idle). */
let ghost: { kind: ToolId; box: Box } | undefined;
/** A vertex being placed (the press went down; the vertex is previewed in the document). */
let placing: { kind: VertexKind | "region"; p0: Point; region: string; error: string | undefined; created: string | undefined } | undefined;
/** A transition being drawn: its source and where it was clicked, the bend points so far and the pointer. */
let link: { source: string; from: Point; bends: Point[]; to: Point } | undefined;
/** Copied fragment and the machine it came from (state references outside it are kept only when pasting there). */
let clipboard: { frag: Fragment; key: number } | undefined;
/** A message for the status line that stays until the next key or button press. */
let note: string | undefined;

// ---------------------------------------------------------------- drawing

function cssSize(): { w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function draw(): void {
  frame = 0;
  const { w, h } = cssSize();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (doc) {
    const sim = simHighlight(doc);
    renderSheet(ctx, doc.index, doc.sheet, view, w, h, {
      selection: doc.selection,
      handles: currentHandles(),
      overlay: drawOverlay,
      marks: problemMarks(doc),
      ...(sim ? { sim } : {}),
      // No file name in the title block before File › New's first save.
      ...(doc.untitled ? {} : { fileName: doc.fileName }),
    });
    if (lasso) drawLasso(lasso);
    zoomEl.textContent = `${Math.round(view.scale * 100)}%`;
  } else {
    ctx.fillStyle = C.background;
    ctx.fillRect(0, 0, w, h);
  }
}

const marksCache = new WeakMap<readonly Diagnostic[], Map<string, "error" | "warning">>();

/** Canvas badges for the design rule findings: on the element, or on the state owning a region or internal transition. */
function problemMarks(d: Doc): Map<string, "error" | "warning"> {
  const cached = marksCache.get(d.diagnostics);
  if (cached) return cached;
  const marks = new Map<string, "error" | "warning">();
  for (const x of d.diagnostics) {
    if (!x.id) continue;
    const id = d.index.vertices.has(x.id) || d.index.transitions.has(x.id) ? x.id : (d.index.internals.get(x.id)?.state.id ?? d.index.timers.get(x.id)?.state.id ?? d.index.regions.get(x.id)?.owner?.id);
    if (id && marks.get(id) !== "error") marks.set(id, x.severity === "error" ? "error" : "warning");
  }
  marksCache.set(d.diagnostics, marks);
  return marks;
}

function drawLasso(l: Lasso): void {
  const r = canvas.getBoundingClientRect();
  const x = Math.min(l.x0, l.x1) - r.left;
  const y = Math.min(l.y0, l.y1) - r.top;
  const w = Math.abs(l.x1 - l.x0);
  const h = Math.abs(l.y1 - l.y0);
  // As in the old editor: the selection color (orange) encloses, blue selects what it touches.
  const color = lassoMode(l) === "enclosed" ? "selection" : "touching";
  ctx.save();
  ctx.fillStyle = canvasAlpha(color, 0.08);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C[color];
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.restore();
}

function requestDraw(): void {
  if (!frame) frame = requestAnimationFrame(draw);
}

function fitBounds(b: Bounds, maxScale = 2): void {
  const { w, h } = cssSize();
  const pad = 40;
  const scale = Math.min((w - 2 * pad) / Math.max(b.x1 - b.x0, 1), (h - 2 * pad) / Math.max(b.y1 - b.y0, 1), maxScale);
  view.scale = scale;
  view.x = (w - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale;
  view.y = (h - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale;
  requestDraw();
}

function fit(): void {
  if (!doc) return;
  // The drawing, or the whole sheet when it is empty.
  const s = sheetFrame(paperOf(doc.index)).sheet;
  fitBounds(sheetBounds(doc.index, doc.sheet) ?? { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h });
}

/** Is a world point on the title block (double-click there opens its fields)? */
function onTitleBlock(x: number, y: number): boolean {
  if (!doc) return false;
  const tb = sheetFrame(paperOf(doc.index)).titleBlock;
  return x >= tb.x && x <= tb.x + tb.w && y >= tb.y && y <= tb.y + tb.h;
}

function screenToWorld(clientX: number, clientY: number): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [(clientX - r.left - view.x) / view.scale, (clientY - r.top - view.y) / view.scale];
}

// ---------------------------------------------------------------- chrome

function vertexById(id: string | undefined): Vertex | undefined {
  return id ? doc?.index.vertices.get(id)?.vertex : undefined;
}

/** The selected vertex when exactly one thing is selected and it is a vertex. */
function single(): Vertex | undefined {
  if (!doc || doc.selection.size !== 1) return undefined;
  return vertexById(doc.selection.values().next().value);
}

function updateTitle(): void {
  void setWindowTitle(doc ? `${isDirty(doc) ? "• " : ""}${doc.fileName} — uFSM ${UFSM_VERSION}` : `uFSM ${UFSM_VERSION}`);
  renderShell();
}

function updateProblems(): void {
  if (!doc) {
    problemsEl.hidden = true;
    return;
  }
  const errors = doc.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = doc.diagnostics.length - errors;
  const lines = [
    ...doc.notes.map((n) => `converted: ${n.message}`),
    ...doc.diagnostics.map((d) => `${d.severity}: ${d.message}`),
  ];
  problemsEl.hidden = lines.length === 0;
  problemsEl.textContent = [
    errors ? `${errors} error${errors > 1 ? "s" : ""}` : "",
    warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "",
    doc.notes.length ? `${doc.notes.length} converted` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  problemsEl.title = lines.join("\n");
  problemsEl.classList.toggle("has-errors", errors > 0);
}

function updateChrome(): void {
  if (!doc) {
    crumbsEl.replaceChildren();
    statusEl.textContent = docs.length === 0 ? "" : statusEl.textContent;
    renderShell();
    return;
  }
  const { index, sheet } = doc;

  crumbsEl.replaceChildren(
    ...sheetPath(index, sheet).flatMap((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "crumb";
      b.textContent = sheetLabel(index, p);
      b.disabled = p === sheet;
      b.addEventListener("click", () => showSheet(p));
      if (i === 0) return [b];
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      return [sep, b];
    }),
  );
  upBtn.disabled = sheet === index.doc.machine.root;

  const v = single();
  const nSel = doc.selection.size;
  if (nSel > 1) {
    let states = 0;
    for (const id of doc.selection) if (index.vertices.has(id)) states++;
    const ts = nSel - states;
    statusEl.textContent = [
      states ? `${states} state${states > 1 ? "s" : ""}` : "",
      ts ? `${ts} transition${ts > 1 ? "s" : ""}` : "",
    ]
      .filter(Boolean)
      .join(" · ") + " selected";
  } else if (nSel === 1 && !v) {
    const t = index.transitions.get(doc.selection.values().next().value!);
    const loc = t && locate(index, t.id);
    statusEl.textContent = t ? `transition · ${t.id}${loc ? ` · ${locationText(loc)}` : ""}` : "";
  } else if (v) {
    const parts = [v.kind === "state" ? v.name || "(unnamed)" : (v.name ?? v.kind)];
    if (v.kind === "state") {
      const regions = v.regions?.length ?? 0;
      if (regions) parts.push(`${regions} region${regions > 1 ? "s" : ""}`);
      if (v.regions?.some((r) => index.doc.diagram?.regions[r.id]?.offPage)) parts.push("double-click or Enter to open");
    } else {
      parts.push(v.kind);
    }
    parts.push(v.id);
    const loc = locate(index, v.id);
    if (loc) parts.push(locationText(loc));
    statusEl.textContent = parts.join(" · ");
  } else {
    statusEl.textContent = `${index.vertices.size} states · ${index.transitions.size} transitions · ${index.doc.declarations.events.length} events`;
  }
  if (tool !== "select") statusEl.textContent = toolHint();
  if (note) statusEl.textContent = note;
  doc.tree.reveal(v?.id);
  doc.tree.setSheet(sheet.id);
  renderShell();
}

// ---------------------------------------------------------------- navigation

function select(ids: Iterable<string>): void {
  if (!doc) return;
  doc.selection = new Set(ids);
  updateChrome();
  requestDraw();
}

/** Switch sheet. With `focus`, select that vertex and zoom to it. */
function showSheet(sheet: Region, focus?: Vertex): void {
  if (!doc) return;
  if (sheet !== doc.sheet) {
    doc.views.set(doc.sheet.id, { ...view });
    doc.sheet = sheet;
    const saved = doc.views.get(sheet.id);
    if (saved && !focus) {
      Object.assign(view, saved);
      requestDraw();
    } else {
      fit();
    }
  }
  if (focus) {
    doc.selection = new Set([focus.id]);
    fitBounds(vertexBounds(doc.index, focus.id), 1.5);
  }
  updateChrome();
  requestDraw();
}

function revealVertex(v: Vertex): void {
  if (!doc) return;
  showSheet(sheetOfVertex(doc.index, v.id), v);
}

/** "Enter" a state: open its off-page region, or zoom in on it if everything is inline. */
function enterState(s: State, region?: Region): void {
  if (!doc) return;
  const offPage = (r: Region): boolean => doc!.index.doc.diagram?.regions[r.id]?.offPage === true;
  const target = region && offPage(region) ? region : s.regions?.find(offPage);
  if (target) {
    doc.selection = new Set();
    showSheet(target);
  } else {
    select([s.id]);
    fitBounds(vertexBounds(doc.index, s.id), 1.5);
  }
}

function goUp(): void {
  if (!doc) return;
  const up = parentSheet(doc.index, doc.sheet);
  if (up) showSheet(up.sheet, up.owner);
}

function onTreeRegion(r: Region): void {
  if (!doc) return;
  if (sheetOfRegion(doc.index, r) === r) {
    doc.selection = new Set();
    showSheet(r);
    fit();
    return;
  }
  const owner = doc.index.regions.get(r.id)?.owner;
  showSheet(sheetOfRegion(doc.index, r), owner);
}

// ---------------------------------------------------------------- machines (tabs)

/** Show another machine (or none). Its view, sheet, selection and undo history come with it. */
function activate(d: Doc | undefined, force = false): void {
  if (d === doc && !force) return;
  lasso = undefined;
  pressGrip = undefined;
  doc = d;
  view = d ? d.view : { scale: 0.5, x: 0, y: 0 };
  emptyEl.hidden = d !== undefined;
  breadcrumbsEl.hidden = d === undefined;
  zoomEl.hidden = d === undefined;
  fitBtn.disabled = d === undefined;
  palette.setEnabled(d !== undefined);
  canvas.style.cursor = "";
  updateTitle();
  updateProblems();
  updateChrome();
  requestDraw();
}

function cycleTab(step: number): void {
  if (!doc || docs.length < 2) return;
  const i = docs.indexOf(doc);
  activate(docs[(i + step + docs.length) % docs.length]);
}

/** Close a machine; asks first when it has unsaved changes. Resolves true when it was closed. */
async function closeDoc(d: Doc | undefined, force = false): Promise<boolean> {
  if (!d) return false;
  if (!force && isDirty(d) && !(await confirmDiscard(`${d.fileName} has unsaved changes. Close it and discard them?`))) return false;
  const i = docs.indexOf(d);
  if (i < 0) return false;
  docs.splice(i, 1);
  d.entry.root.remove();
  explorerEmptyEl.hidden = docs.length > 0;
  if (doc === d) activate(docs[Math.min(i, docs.length - 1)]);
  else renderShell();
  return true;
}

function showModel(loaded: LoadedModel, fileName: string, path: string | undefined, untitled?: string): void {
  const index = indexV1(loaded.doc);
  const converted = loaded.sourceVersion === 0;
  // Filled in below: the explorer callbacks need the doc they belong to.
  const d = { key: nextKey++ } as Doc;
  const entry = explorerEntry(
    () => activate(d),
    () => void closeDoc(d),
  );
  const inDoc = (go: () => void) => (): void => {
    activate(d);
    go();
  };
  const makeTree = (ix: DocIndex): Tree =>
    buildTree(entry.body, ix, {
      onState: (s) => inDoc(() => revealVertex(s))(),
      onRegion: (r) => inDoc(() => onTreeRegion(r))(),
    });
  const tree = makeTree(index);
  let treeMachine = loaded.doc.machine;
  Object.assign(d, {
    history: new History(loaded.doc),
    index,
    fileName,
    // A converted v0 file is never overwritten silently: the first save asks where to put the v1 file.
    path: converted ? undefined : path,
    savedVersion: converted ? -1 : 0,
    untitled,
    notes: loaded.notes,
    diagnostics: checkV1(loaded.doc, index),
    sheet: index.doc.machine.root,
    selection: new Set<string>(),
    views: new Map<string, View>(),
    view: { scale: 0.5, x: 0, y: 0 },
    tree,
    syncTree: () => {
      if (d.history.current.machine === treeMachine) return;
      treeMachine = d.history.current.machine;
      d.tree = makeTree(d.index);
      d.tree.setSheet(d.sheet.id);
    },
    entry,
    sim: undefined,
    simError: undefined,
    guards: new Map<string, boolean>(),
    guardsVersion: 0,
    simOptions: {},
    recordActive: true,
    hoverEvent: undefined,
    would: undefined,
    codeView: "c-header",
  } satisfies Omit<Doc, "key">);
  docs.push(d);
  explorerEl.append(entry.root);
  explorerEmptyEl.hidden = true;
  activate(d);
  if (converted) statusEl.textContent = "Converted from the v0 format. Save to write it as v1.";
  requestAnimationFrame(() => {
    if (doc === d) fit();
  });
}

async function openModel(): Promise<void> {
  try {
    const file = await openModelFile(fileInput);
    if (!file) return;
    // The same file twice would be two diverging copies: show the open one instead.
    const open = inTauri ? docs.find((d) => d.path === file.path) : undefined;
    if (open) {
      activate(open);
      statusEl.textContent = `${open.fileName} is already open`;
      return;
    }
    showModel(loadModel(file.text), file.name, inTauri ? file.path : undefined);
  } catch (e) {
    const msg = e instanceof UfsmFormatError ? `Not a valid uFSM model: ${e.message}` : String(e);
    statusEl.textContent = msg;
    console.error(e);
  }
}

/** File › New: an empty machine in a new tab, named untitled (untitled2, ... while those are open). */
function newModel(): void {
  const name = untitledName(docs.map((d) => d.fileName));
  showModel({ doc: newDocument(name), sourceVersion: 1, notes: [] }, `${name}.ufsm`, undefined, name);
  statusEl.textContent = `New machine ${name}. Add a state with A then S, or from the palette.`;
}

async function saveModel(saveAs = false): Promise<void> {
  const d = doc;
  if (!d) return;
  try {
    let version = d.history.version;
    const written = await saveModelFile(
      (target) => {
        // A new machine still called by its placeholder takes the name of its file (the generated code is named after it).
        const name = nameOnSave(d.history.current.name, d.untitled, baseName(target));
        if (name !== undefined) {
          d.history.edit((x) => setMachineName(x as UfsmDocument, name));
          if (d === doc) refresh(true);
          else {
            d.index = indexV1(d.history.current);
            d.sheet = d.index.regions.get(d.sheet.id)?.region ?? d.index.doc.machine.root;
            d.diagnostics = checkV1(d.index.doc, d.index);
          }
        }
        version = d.history.version;
        return serializeV1(d.history.current);
      },
      saveAs ? undefined : d.path,
      d.fileName,
    );
    if (!written) return;
    d.path = inTauri ? written : undefined;
    d.fileName = baseName(written);
    d.savedVersion = version;
    d.untitled = undefined;
    d.notes = [];
    updateTitle();
    updateProblems();
    statusEl.textContent = `Saved ${d.fileName}`;
  } catch (e) {
    statusEl.textContent = `Save failed: ${String(e)}`;
    console.error(e);
  }
}

// ---------------------------------------------------------------- shell (title bar, tabs, explorer, panel)

function toggleSidebar(): void {
  document.body.classList.toggle("sidebar-hidden");
  renderShell();
  requestDraw();
}

function togglePanel(): void {
  document.body.classList.toggle("panel-hidden");
  renderShell();
  requestDraw();
}

function showPanelTab(tab: PanelTab): void {
  panelTab = tab;
  document.body.classList.remove("panel-hidden");
  renderShell();
  requestDraw();
}

const sidebarShown = (): boolean => !document.body.classList.contains("sidebar-hidden");
const panelShown = (): boolean => !document.body.classList.contains("panel-hidden");

function selectAll(): void {
  if (!doc) return;
  const all = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  select(boxSelect(doc.index, doc.sheet, all, "enclosed"));
}

function zoomNormal(): void {
  const { w, h } = cssSize();
  zoomAround(w / 2, h / 2, 1);
}

function goRoot(): void {
  if (doc) showSheet(doc.index.doc.machine.root);
}

function enterSelected(): void {
  const v = single();
  if (v?.kind === "state") enterState(v);
}

/** Select a vertex or transition from a link in the panel, switching sheet when it lives on another one. */
function selectFromPanel(id: string): void {
  if (!doc) return;
  const index = doc.index;
  const vid = index.vertices.has(id) ? id : index.transitions.get(id)?.from;
  if (!vid) return;
  const sheet = sheetOfVertex(index, vid);
  if (sheet !== doc.sheet) showSheet(sheet);
  select([id]);
}

const hasDoc = (): boolean => doc !== undefined;
const hasSelection = (): boolean => (doc?.selection.size ?? 0) > 0;
/** An Add menu item arming a tool, like its palette button. */
const toolItem = (t: ToolId): MenuItem => ({ label: TOOL_NAMES[t], keys: TOOL_KEYS[t], run: () => pickTool(t), enabled: hasDoc });

const MENUS: Menu[] = [
  {
    label: "File",
    items: [
      { label: "New", keys: "Ctrl+N", run: newModel },
      { label: "Open…", keys: "O", run: () => void openModel() },
      "-",
      { label: "Save", keys: "S", run: () => void saveModel(), enabled: hasDoc },
      { label: "Save As…", keys: "Shift+S", run: () => void saveModel(true), enabled: hasDoc },
      "-",
      { label: "Generate C Code…", run: () => void generateTo("c"), enabled: hasDoc },
      { label: "Generate Python Code…", run: () => void generateTo("python"), enabled: hasDoc },
      { label: "Generate TypeScript Code…", run: () => void generateTo("ts"), enabled: hasDoc },
      { label: "Generate Rust Code…", run: () => void generateTo("rust"), enabled: hasDoc },
      "-",
      { label: "Close Machine", run: () => void closeDoc(doc), enabled: hasDoc },
      "-",
      { label: "Settings", run: () => showPanelTab("settings") },
      "-",
      { label: "Exit", run: () => void windowControls.close(), enabled: () => inTauri },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo", keys: "Ctrl+Z", run: () => undo(), enabled: () => doc?.history.canUndo ?? false },
      { label: "Redo", keys: "Ctrl+R", run: () => redo(), enabled: () => doc?.history.canRedo ?? false },
      "-",
      { label: "Cut", keys: "Ctrl+X", run: cutSelection, enabled: hasSelection },
      { label: "Copy", keys: "Ctrl+C", run: () => void copySelection(), enabled: hasSelection },
      { label: "Paste", keys: "Ctrl+V", run: pasteClipboard, enabled: () => hasDoc() && clipboard !== undefined },
      { label: "Delete", keys: "Del", run: deleteSelection, enabled: hasSelection },
      "-",
      { label: "Rename", keys: "E N", run: () => focusPanel("name"), enabled: () => single() !== undefined },
      { label: "Trigger", keys: "E T", run: () => focusPanel("trigger"), enabled: () => singleTransition() !== undefined },
      { label: "Add Entry Action", keys: "A E", run: () => focusPanel("entry"), enabled: () => single()?.kind === "state" },
      { label: "Add Exit Action", keys: "A X", run: () => focusPanel("exit"), enabled: () => single()?.kind === "state" },
      { label: "Add Timer", run: () => focusPanel("timer"), enabled: () => single()?.kind === "state" },
      { label: "Add Guard Term", keys: "A G", run: () => focusPanel("guard"), enabled: () => singleTransition() !== undefined },
      { label: "Add Action", keys: "A A", run: () => focusPanel("action"), enabled: () => singleTransition() !== undefined },
      "-",
      { label: "Select All", keys: "Ctrl+A", run: selectAll, enabled: hasDoc },
      { label: "Clear Selection", keys: "Esc", run: () => select([]), enabled: () => (doc?.selection.size ?? 0) > 0 },
    ],
  },
  {
    label: "Add",
    items: [
      ...(["state", "transition", "straight"] as const).map((t) => toolItem(t)),
      {
        label: "Region",
        keys: "A R",
        run: () => {
          const v = single();
          if (v?.kind === "state") addRegionTo(v.id);
          else pickTool("region");
        },
        enabled: hasDoc,
      },
      "-",
      ...(["initial", "final", "shallow-history", "deep-history", "fork", "join", "terminate"] as const).map((t) => toolItem(t)),
      "-",
      { label: "Bend Point", keys: "A V", run: addBendPointToSelected, enabled: () => singleTransition() !== undefined },
      { label: "Convert to S Route", run: convertToS, enabled: () => !!doc && [...doc.selection].some((id) => doc!.index.transitions.has(id) && doc!.index.doc.diagram?.transitions[id]?.route !== "s") },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Command Palette…", keys: "Ctrl+Shift+P", run: () => openQuickPick(">") },
      "-",
      { label: "Explorer", keys: "N", run: toggleSidebar, checked: sidebarShown },
      { label: "Properties Panel", keys: "P", run: togglePanel, checked: panelShown },
      "-",
      { label: "Properties", run: () => showPanelTab("properties") },
      { label: "Project", run: () => showPanelTab("project") },
      { label: "Simulator", run: () => showPanelTab("simulator") },
      { label: "Code", run: () => showPanelTab("code") },
      { label: "Settings", run: () => showPanelTab("settings") },
      "-",
      { label: "Fit Sheet", keys: "Z F", run: fit, enabled: hasDoc },
      { label: "Actual Size", keys: "Z N", run: zoomNormal, enabled: hasDoc },
      "-",
      { label: "Zoom In", keys: "Ctrl++", run: zoomIn, enabled: () => settings.zoom < ZOOM_MAX },
      { label: "Zoom Out", keys: "Ctrl+-", run: zoomOut, enabled: () => settings.zoom > ZOOM_MIN },
      { label: "Reset Zoom", keys: "Ctrl+0", run: zoomReset, enabled: () => settings.zoom !== 100 },
      "-",
      { label: "Problems", run: () => showPanelTab("problems") },
    ],
  },
  {
    label: "Go",
    items: [
      { label: "Open State", keys: "Enter", run: enterSelected, enabled: () => single()?.kind === "state" },
      { label: "Up One Level", keys: "J A", run: goUp, enabled: () => !!doc && doc.sheet !== doc.index.doc.machine.root },
      { label: "Root", keys: "J R", run: goRoot, enabled: () => !!doc && doc.sheet !== doc.index.doc.machine.root },
      "-",
      { label: "Search…", keys: "Ctrl+P", run: () => openQuickPick("") },
      { label: "Go to Element in Machine…", run: () => openQuickPick("@"), enabled: hasDoc },
      { label: "Go to Element in All Machines…", run: () => openQuickPick("#"), enabled: hasDoc },
      "-",
      { label: "Next Machine", keys: "Ctrl+Tab", run: () => cycleTab(1), enabled: () => docs.length > 1 },
      { label: "Previous Machine", keys: "Ctrl+Shift+Tab", run: () => cycleTab(-1), enabled: () => docs.length > 1 },
    ],
  },
  {
    label: "Run",
    items: [
      { label: () => (doc?.sim ? "Restart Simulation" : "Start Simulation"), keys: "F5", run: simStart, enabled: hasDoc },
      { label: "Stop Simulation", keys: "Shift+F5", run: simStop, enabled: () => doc?.sim !== undefined },
      "-",
      { label: "Save Trace…", run: () => void saveTrace(), enabled: () => (doc?.sim?.steps.length ?? 0) > 0 },
      { label: "Copy Trace", run: () => void copyTrace(), enabled: () => (doc?.sim?.steps.length ?? 0) > 0 },
    ],
  },
  {
    label: "Help",
    items: [{ label: `About uFSM ${UFSM_VERSION}`, run: () => void (statusEl.textContent = `uFSM ${UFSM_VERSION} · GPL-3.0-or-later · github.com/jonasblixt/ufsm`) }],
  },
];

/** Re-render the Preact parts of the window and the explorer rows from the current state. */
function renderShell(): void {
  renderTitleBar(titleBarEl, {
    menus: MENUS,
    search: {
      hint: doc ? `Search ${doc.fileName}` : "Search",
      machine: doc?.fileName,
      items: searchItems,
      activeDoc: doc?.key,
      recent: () => recentPicks,
      onPick: onSearchPick,
      onPreview: onSearchPreview,
    },
    windowControls: customWindowControls,
    mac: isMac && inTauri,
    maximized,
    onMinimize: () => void windowControls.minimize(),
    onToggleMaximize: () => void windowControls.toggleMaximize(),
    onClose: () => void windowControls.close(),
  });
  renderTabs(tabsEl, {
    tabs: docs.map((d) => ({ key: d.key, name: d.fileName, title: d.path ?? d.fileName, dirty: isDirty(d), active: d === doc })),
    onActivate: (key) => activate(docs.find((d) => d.key === key)),
    onClose: (key) => void closeDoc(docs.find((d) => d.key === key)),
  });
  for (const d of docs) d.entry.update(d.fileName, d.path ?? d.fileName, isDirty(d), d === doc);
  const focus = panelFocus;
  panelFocus = undefined;
  renderPanel(panelEl, {
    tab: panelTab,
    onTab: showPanelTab,
    doc: doc && {
      index: doc.index,
      selection: doc.selection,
      fileName: doc.fileName,
      path: doc.path,
      converted: doc.savedVersion < 0,
      dirty: isDirty(doc),
      diagnostics: doc.diagnostics,
      notes: doc.notes,
    },
    ops: panelOps,
    ...(focus ? { focus } : {}),
    ...(panelHighlight ? { highlight: panelHighlight } : {}),
    ...(doc ? { sim: simProps(doc), code: { doc: doc.history.current, view: doc.codeView, ops: codeOps } } : {}),
    settings: {
      settings,
      theme,
      systemDark,
      location: settingsLocation,
      problems: [...settingsProblems, ...themeProblems],
      onTheme: setThemeSetting,
      onZoom: setZoomSetting,
    },
  });
  updateSimStatus();
}

/** What the panel may do: every change goes through edit() as one undo step. */
const panelOps: PanelOps = {
  select: selectFromPanel,
  jump: jumpTo,
  edit: (recipe) => edit(recipe),
  use: (choice, recipe) =>
    edit((d) => {
      const id = "id" in choice ? choice.id : addDecl(d, choice.create.kind, choice.create.name);
      recipe(d, id);
    }),
  say: (msg) => say(msg),
};

/** Open the Properties tab and ask it to focus a field (or open a picker) of the selection, once. */
function focusPanel(field: FocusField): void {
  panelFocus = field;
  panelTab = "properties";
  document.body.classList.remove("panel-hidden");
  renderShell();
  requestDraw();
}

/** Show the element a problem is about: a vertex, a transition, a region's or internal transition's state, a declaration. */
function jumpTo(id: string): void {
  if (!doc) return;
  const index = doc.index;
  if (index.decls.has(id)) {
    panelHighlight = id;
    showPanelTab("project");
    panelHighlight = undefined;
    return;
  }
  const t = index.transitions.get(id);
  if (t) {
    const sheet = sheetOfVertex(index, t.from);
    if (sheet !== doc.sheet) showSheet(sheet);
    select([id]);
    return;
  }
  const vid = index.vertices.has(id) ? id : (index.internals.get(id)?.state.id ?? index.timers.get(id)?.state.id ?? index.regions.get(id)?.owner?.id);
  const v = vid ? index.vertices.get(vid)?.vertex : undefined;
  if (v) revealVertex(v);
}

// ---------------------------------------------------------------- search (title bar, Ctrl+P / Ctrl+Shift+P)

const RECENT_KEY = "ufsm.searchRecent";
/** Keys of recently picked search rows, most recent first (remembered per browser profile, best effort). */
let recentPicks: readonly string[] = ((): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
})();

/** A machine's search rows, built again when an edit gives it a new index (or a save renames it). */
const elementCache = new WeakMap<DocIndex, { key: number; name: string; items: SearchItem[] }>();
function docElements(d: Doc): SearchItem[] {
  const c = elementCache.get(d.index);
  if (c && c.key === d.key && c.name === d.fileName) return c.items;
  const items = elementItems(d.index, d.key, d.fileName);
  elementCache.set(d.index, { key: d.key, name: d.fileName, items });
  return items;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Global settings (settings.json) as search rows: color theme, appearance, the theme's other options, UI zoom. */
function settingItems(): SearchItem[] {
  const t = settings.theme;
  const entry = findTheme(t.name) ?? FALLBACK_THEME;
  const info = themeInfo(entry);
  const themeRow = (key: string, label: string, next: ThemeSetting, checked: boolean, keywords: string): SearchItem => ({
    key,
    kind: "setting",
    label,
    checked,
    keywords,
    run: () => setThemeSetting(next),
    preview: () => previewTheme(next),
  });
  const out: SearchItem[] = THEMES.map((x) =>
    themeRow(`set:theme:${x.id}`, `Preferences: Color Theme: ${themeInfo(x).name ?? x.id}`, { ...t, name: x.id, inputs: {} }, x.id === entry.id, "colour scheme palette"),
  );
  if (info.modifiers.some((m) => m.name === "appearance")) {
    const choices: [AppearanceChoice, string, string][] = [
      ["system", "System", "follow the operating system dark light mode"],
      ["dark", "Dark", "dark mode"],
      ["light", "Light", "light mode"],
    ];
    for (const [a, text, words] of choices) out.push(themeRow(`set:appearance:${a}`, `Preferences: Appearance: ${text}`, { ...t, appearance: a }, t.appearance === a, words));
  }
  for (const m of info.modifiers) {
    if (m.name === "appearance" || !modifierHasEffect(entry, theme.inputs, m.name)) continue;
    const now = theme.inputs[m.name] ?? m.default;
    for (const c of m.contexts) {
      out.push(themeRow(`set:${entry.id}:${m.name}:${c}`, `Preferences: ${capital(m.name)}: ${capital(c)}`, { ...t, inputs: { ...t.inputs, [m.name]: c } }, c === now, `${info.name ?? entry.id} theme`));
    }
  }
  for (const z of ZOOM_STEPS) {
    out.push({ key: `set:zoom:${z}`, kind: "setting", label: `Preferences: UI Zoom: ${z}%`, checked: settings.zoom === z, keywords: "interface text size scale", run: () => setZoomSetting(z) });
  }
  out.push({ key: "set:open", kind: "setting", label: "Preferences: Open Settings", keywords: "settings.json", run: () => showPanelTab("settings") });
  return out;
}

/** The focused machine's file-level settings (the Project tab) as search rows: paper, name, description, options, generator settings. */
function projectItems(d: Doc): SearchItem[] {
  const x = d.index.doc;
  const paper = x.diagram?.paper ?? "A4";
  const out: SearchItem[] = (Object.keys(PAPER_SIZES) as Paper[]).map((p) => ({
    key: `proj:paper:${p}`,
    kind: "setting",
    label: `Project: Paper Size: ${p}`,
    detail: `${PAPER_SIZES[p].w} × ${PAPER_SIZES[p].h}`,
    checked: p === paper,
    keywords: "sheet",
    run: () => edit((y) => setPaper(y, p)),
  }));
  out.push({ key: "proj:name", kind: "setting", label: "Project: Machine Name", detail: x.name, keywords: "rename", run: () => focusProjectField("Machine name") });
  out.push({ key: "proj:description", kind: "setting", label: "Project: Description", detail: x.doc ?? "", keywords: "documentation", run: () => focusProjectField("Description") });
  for (const k of TITLE_BLOCK_FIELDS) {
    const label = TITLE_FIELD_LABELS[k];
    out.push({ key: `proj:title:${k}`, kind: "setting", label: `Project: Title Block: ${TITLE_FIELD_NAMES[k]}`, detail: x.diagram?.titleBlock?.[k] ?? "", keywords: "title block sheet frame", run: () => focusProjectField(label) });
  }
  for (const o of MODEL_OPTIONS) {
    out.push({
      key: `proj:options:${o.key}`,
      kind: "setting",
      label: `Project: Options: ${o.label}`,
      detail: x.options?.[o.key] !== undefined ? String(x.options[o.key]) : `${OPTION_DEFAULTS[o.key]} (default)`,
      keywords: "generator simulator option",
      run: () => focusProjectField(o.label),
    });
  }
  for (const o of API_OPTION_INFO) {
    out.push({
      key: `proj:options:${o.key}`,
      kind: "setting",
      label: `Project: Options: ${o.label}`,
      detail: x.options?.[o.key] === true ? "on" : "off (default)",
      keywords: "generator option debug trace",
      run: () => focusProjectField(o.label),
    });
  }
  for (const t of TARGETS) {
    const set = x.targets?.[t.key] ?? {};
    for (const o of API_OPTION_INFO) {
      out.push({
        key: `proj:${t.key}:${o.key}`,
        kind: "setting",
        label: `Project: Code Generation: ${t.title} ${o.label}`,
        detail: set[o.key] === true ? "on" : set[o.key] === false ? "off" : "as in Options",
        keywords: "generator target option debug trace",
        run: () => focusProjectField(`${t.title} ${o.label}`),
      });
    }
    for (const o of t.options) {
      out.push({
        key: `proj:${t.key}:${o.key}`,
        kind: "setting",
        label: `Project: Code Generation: ${t.title} ${o.label}`,
        detail: o.key in set ? String(set[o.key]) : `${o.fallback(x.name, set)} (default)`,
        keywords: "generator target option",
        run: () => focusProjectField(`${t.title} ${o.label}`),
      });
    }
  }
  return out;
}

/** Open the Project tab and put the cursor in the field with this label. */
function focusProjectField(label: string): void {
  showPanelTab("project");
  const f = panelEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${CSS.escape(label)}"]`);
  if (!f) return;
  f.scrollIntoView({ block: "nearest" });
  f.focus();
  f.select();
}

/** Everything the search field can find now: elements of every open machine (the focused one first), the machines,
 * every enabled menu command, the settings and the focused machine's project settings. */
function searchItems(): SearchItem[] {
  const active = doc;
  const opensSearch = (menu: string, label: string): boolean => (menu === "File" && label === "Settings") || /^(Search|Command Palette|Go to Element)/.test(label);
  return [
    ...(active ? docElements(active) : []),
    ...docs.filter((d) => d !== active).flatMap(docElements),
    ...docs.map(
      (d): SearchItem => ({
        key: `machine:${d.fileName}`,
        kind: "machine",
        label: d.fileName,
        detail: d.path ?? (d.untitled ? "not saved yet" : d.index.doc.name),
        doc: d.key,
        docName: d.fileName,
        run: () => activate(d),
      }),
    ),
    ...menuCommands(MENUS, opensSearch),
    ...settingItems(),
    ...(active ? projectItems(active) : []),
    ...helpItems(active?.fileName),
  ];
}

/** Show an element picked in the search: a region's sheet (or its state), else what a problem's jump shows. */
function revealElement(id: string): void {
  if (!doc) return;
  const r = doc.index.regions.get(id);
  if (r) onTreeRegion(r.region);
  else jumpTo(id);
}

function onSearchPick(it: SearchItem): void {
  endThemePreview();
  recentPicks = remember(recentPicks, it.key);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentPicks));
  } catch {
    // storage unavailable (private window): remembered for this run only
  }
  if (it.run) it.run();
  else if (it.id !== undefined) {
    const d = docs.find((x) => x.key === it.doc);
    if (d) {
      activate(d);
      revealElement(it.id);
    }
  }
}

/** A color theme highlighted in the search is shown until the search closes; picking it saves it. */
let previewing = false;
function previewTheme(t: ThemeSetting): void {
  previewing = true;
  applyTheme(t);
  requestDraw();
}
function endThemePreview(): void {
  if (!previewing) return;
  previewing = false;
  applyTheme();
  requestDraw();
}
function onSearchPreview(it: SearchItem | undefined): void {
  if (it?.preview) it.preview();
  else endThemePreview();
}

// ---------------------------------------------------------------- simulator and code preview

/** True when the machine changed since the simulation started (layout edits do not count). */
const simStale = (d: Doc): boolean => d.sim !== undefined && d.sim.staleFor(d.history.current);

/** Events that would take transitions now, recomputed only after a step or a guard change. */
function wouldMap(d: Doc): Map<string, string[]> {
  const sim = d.sim;
  if (!sim || simStale(d)) return new Map();
  const w = d.would;
  if (w && w.sim === sim && w.version === sim.version && w.guards === d.guardsVersion) return w.map;
  const map = new Map<string, string[]>();
  for (const e of sim.doc.declarations.events) {
    const ids = sim.wouldTake(e.name);
    if (ids.length) map.set(e.name, ids);
  }
  d.would = { sim, version: sim.version, guards: d.guardsVersion, map };
  return map;
}

/** What the canvas shows of the simulation: active states, the last step's transitions, the hovered event's. */
function simHighlight(d: Doc): SimHighlight | undefined {
  const sim = d.sim;
  if (!sim || simStale(d)) return undefined;
  return {
    active: new Set(sim.activeIds()),
    leaves: new Set(sim.leafIds()),
    fired: sim.fired,
    would: new Set(d.hoverEvent ? (wouldMap(d).get(d.hoverEvent) ?? []) : []),
  };
}

/** Redraw what shows the simulation: the panel, the canvas, the status bar. */
function simChanged(): void {
  renderShell();
  requestDraw();
}

/** Start the simulation of the active machine, or start it over (F5). */
function simStart(): void {
  const d = doc;
  if (!d) return;
  d.hoverEvent = undefined;
  try {
    d.sim = new Simulation(d.history.current, d.guards, d.simOptions);
    d.simError = undefined;
    d.sim.reset();
  } catch (e) {
    d.sim = undefined;
    const errors = d.diagnostics.filter((x) => x.severity === "error").length;
    d.simError =
      e instanceof MachineError && e.code === "invalid-model"
        ? `The machine has ${errors || "some"} error${errors === 1 ? "" : "s"} (see Problems); fix ${errors === 1 ? "it" : "them"} to simulate.`
        : `Cannot simulate: ${String(e)}`;
  }
  panelTab = "simulator";
  document.body.classList.remove("panel-hidden");
  simChanged();
}

/** Stop the simulation (Shift+F5); the canvas goes back to plain colours. */
function simStop(): void {
  const d = doc;
  if (!d?.sim && !d?.simError) return;
  d.sim = undefined;
  d.simError = undefined;
  d.hoverEvent = undefined;
  simChanged();
}

function updateSimStatus(): void {
  const sim = doc?.sim;
  simStatusEl.hidden = !sim;
  if (!doc || !sim) return;
  const stale = simStale(doc);
  simStatusEl.textContent = stale ? "Simulation out of date" : `Simulating · step ${sim.steps.length - 1}${sim.terminated ? " · terminated" : ""}`;
  simStatusEl.classList.toggle("stale", stale);
}

/** The trace of the running simulation, its model path relative to `tracePath` when both paths are known. */
function traceText(d: Doc, sim: Simulation, tracePath: string | undefined): string {
  const model = d.path && tracePath ? relativePath(tracePath, d.path) : d.path ? baseName(d.path) : d.fileName;
  return formatTrace(sim.trace(model, { active: d.recordActive }));
}

async function saveTrace(): Promise<void> {
  const d = doc, sim = doc?.sim;
  if (!d || !sim) return;
  try {
    const name = `${d.fileName.replace(/\.ufsm$/i, "")}.json`;
    const written = await saveTextFile(name, { name: "uFSM trace", extensions: ["json"] }, (path) => traceText(d, sim, inTauri ? path : undefined));
    if (written) say(`Saved the trace (${sim.steps.length} steps) as ${baseName(written)}. Replay it with: ufsm trace ${baseName(written)}`);
  } catch (e) {
    say(`Saving the trace failed: ${String(e)}`);
  }
}

async function copyTrace(): Promise<void> {
  const d = doc, sim = doc?.sim;
  if (!d || !sim) return;
  say((await copyText(traceText(d, sim, undefined))) ? `Copied the trace (${sim.steps.length} steps).` : "Could not use the clipboard.");
}

const simOps: SimOps = {
  start: simStart,
  stop: simStop,
  send: (event) => {
    const d = doc;
    if (!d?.sim || simStale(d)) return;
    d.sim.send(event);
    simChanged();
  },
  fire: (timerId) => {
    const d = doc;
    if (!d?.sim || simStale(d)) return;
    d.sim.fire(timerId);
    simChanged();
  },
  setGuard: (name, value) => {
    if (!doc) return;
    doc.guards.set(name, value);
    doc.guardsVersion++;
    simChanged();
  },
  setOption: (key, value) => {
    if (!doc) return;
    const { [key]: _, ...rest } = doc.simOptions;
    // The model's own value is no override: the run follows the model again when its options change.
    doc.simOptions = value === behaviourOptions(doc.history.current)[key] ? rest : { ...rest, [key]: value };
    renderShell();
  },
  hover: (event) => {
    if (!doc || doc.hoverEvent === event) return;
    doc.hoverEvent = event;
    requestDraw();
  },
  select: (id) => selectFromPanel(id),
  saveTrace: () => void saveTrace(),
  copyTrace: () => void copyTrace(),
  setRecordActive: (on) => {
    if (!doc) return;
    doc.recordActive = on;
    renderShell();
  },
};

function simProps(d: Doc): SimProps {
  const stale = simStale(d);
  return {
    index: d.index,
    sim: d.sim,
    stale,
    error: d.simError,
    would: wouldMap(d),
    guards: d.guards,
    options: { ...behaviourOptions(d.history.current), ...d.simOptions },
    overridden: d.simOptions,
    recordActive: d.recordActive,
    ops: simOps,
  };
}

/** Write the generated files of a target into a folder (File › Generate …). */
async function generateTo(target: CodeTarget): Promise<void> {
  const d = doc;
  if (!d) return;
  const r = generatedCode(d.history.current, target);
  if ("error" in r) {
    say(`Cannot generate code: ${r.error}`);
    return;
  }
  try {
    const dir = await saveFilesToFolder(r.files);
    if (dir) say(`Wrote ${r.files.map((f) => f.name).join(" and ")} to ${dir}`);
  } catch (e) {
    say(`Writing the files failed: ${String(e)}`);
  }
}

const codeOps: CodeOps = {
  setView: (id) => {
    if (!doc) return;
    doc.codeView = id;
    renderShell();
  },
  copy: (text, what) => void copyText(text).then((ok) => say(ok ? `Copied ${what}.` : "Could not use the clipboard.")),
  save: (file: GeneratedFile) =>
    void saveTextFile(file.name, { name: file.name.split(".").pop()!.toUpperCase(), extensions: [file.name.split(".").pop()!] }, () => file.text)
      .then((p) => p && say(`Saved ${baseName(p)}`))
      .catch((e: unknown) => say(`Saving failed: ${String(e)}`)),
  saveAll: (files) =>
    void saveFilesToFolder(files)
      .then((dir) => dir && say(`Wrote ${files.map((f) => f.name).join(" and ")} to ${dir}`))
      .catch((e: unknown) => say(`Writing the files failed: ${String(e)}`)),
  showProblems: () => showPanelTab("problems"),
};

// ---------------------------------------------------------------- editing

/** Handles of the current selection (drawn and grabbed). */
function currentHandles(): Handle[] {
  return doc ? handlesFor(doc.index, doc.sheet, doc.selection) : [];
}

/** Rebuild everything derived from the document after an edit, undo or redo. `recheck` reruns the design rule check. */
function refresh(recheck = false): void {
  if (!doc) return;
  const index = indexV1(doc.history.current);
  doc.index = index;
  doc.sheet = index.regions.get(doc.sheet.id)?.region ?? index.doc.machine.root;
  doc.selection = new Set([...doc.selection].filter((id) => index.vertices.has(id) || index.transitions.has(id)));
  if (recheck) {
    doc.diagnostics = checkV1(index.doc, index);
    updateProblems();
  }
  if (!doc.history.editing) doc.syncTree();
  updateTitle();
  requestDraw();
}

/** Apply one edit as one undo step. */
function edit(recipe: (d: UfsmDocument) => void): void {
  if (!doc?.history.edit((d) => recipe(d as UfsmDocument))) return;
  refresh(true);
  updateChrome();
}

function undo(): void {
  if (!doc?.history.undo()) return;
  refresh(true);
  updateChrome();
}

function redo(): void {
  if (!doc?.history.redo()) return;
  refresh(true);
  updateChrome();
}

// ---------------------------------------------------------------- adding, deleting, clipboard

/** Status line text while a tool is armed. */
function toolHint(): string {
  const name = TOOL_NAMES[tool];
  switch (tool) {
    case "transition":
      return link
        ? "S transition: click the target; the route lays itself out and follows the states · Esc cancels"
        : "S transition: click the source, then the target (or drag from one to the other) · Esc cancels";
    case "straight":
      return link
        ? "Straight transition: click the target · a click on empty canvas adds a bend point, Backspace removes the last · Esc cancels"
        : "Straight transition: click the source, then the target (or drag from one to the other) · Esc cancels";
    case "region":
      return "Region: click a state to add a region at its bottom · Esc cancels";
    case "state":
      return "State: click to place, or drag to draw it · Esc cancels";
    case "fork":
    case "join":
      return `${name}: click to place, or drag for its length · r turns it (now ${horizontal ? "horizontal" : "vertical"}) · Esc cancels`;
    default:
      return `${name}: click to place · Esc cancels`;
  }
}

/** Show a message in the status line until the next key or button press. */
function say(msg: string): void {
  note = msg;
  updateChrome();
}

function worldAt(clientX: number, clientY: number): Point {
  const [x, y] = screenToWorld(clientX, clientY);
  return { x, y };
}

/** The innermost vertex drawn at world point p on the current sheet. */
function vertexAt(p: Point): Vertex | undefined {
  return doc ? hitTest(doc.index, doc.sheet, p.x, p.y, 6 / view.scale).vertex : undefined;
}

/** The selected transition when exactly one thing is selected and it is a transition. */
function singleTransition(): string | undefined {
  if (!doc || doc.selection.size !== 1) return undefined;
  const id = doc.selection.values().next().value!;
  return doc.index.transitions.has(id) ? id : undefined;
}

/** Where paste puts things: the pointer while it is over the canvas, else the middle of the view. */
function targetPoint(): Point {
  const i = api?.input;
  if (i?.over) return worldAt(i.x, i.y);
  const r = canvas.getBoundingClientRect();
  return worldAt(r.left + r.width / 2, r.top + r.height / 2);
}

function deleteSelection(): void {
  if (!doc || doc.selection.size === 0) return;
  const ids = [...doc.selection];
  edit((d) => void deleteElements(d, ids));
}

function copySelection(): boolean {
  if (!doc) return false;
  const frag = copyFragment(doc.index, doc.selection);
  if (!frag) {
    say("Select the states to copy (a transition comes along when both its ends do).");
    return false;
  }
  clipboard = { frag, key: doc.key };
  const t = frag.transitions.length;
  say(`Copied ${frag.vertices.length} state${frag.vertices.length > 1 ? "s" : ""}${t ? ` and ${t} transition${t > 1 ? "s" : ""}` : ""}`);
  return true;
}

function cutSelection(): void {
  if (copySelection()) deleteSelection();
}

function pasteClipboard(): void {
  const d0 = doc, c = clipboard;
  if (!d0) return;
  if (!c) {
    say("Nothing to paste: copy (Ctrl+C) or cut (Ctrl+X) states first.");
    return;
  }
  const at = targetPoint();
  const region = regionAt(d0.index, d0.sheet, at);
  let ids: string[] = [];
  edit((d) => void (ids = pasteFragment(d, c.frag, region.id, at, { keepOuterStateRefs: c.key === d0.key })));
  select(ids);
}

function addRegionTo(stateId: string): void {
  edit((d) => void addRegion(d, stateId));
}

/** Add a bend point to the selected transition: at the pointer when it is over the canvas, else mid-route. */
function addBendPointToSelected(): void {
  const id = singleTransition();
  if (!doc || !id) return;
  let p = targetPoint();
  if (!api?.input.over) {
    const pts = edgeGeometry(doc.index, id)?.points ?? [];
    const k = Math.max(Math.floor((pts.length - 2) / 2), 0);
    const a = pts[k], b = pts[k + 1];
    if (a && b) p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  edit((d) => void insertBendPoint(d, id, p));
}

/** Selected transitions with free routes become S routes with automatic ends. */
function convertToS(): void {
  if (!doc) return;
  const ids = [...doc.selection].filter((id) => doc!.index.transitions.has(id) && doc!.index.doc.diagram?.transitions[id]?.route !== "s");
  if (ids.length) edit((d) => ids.forEach((id) => toSRoute(d, id)));
}

const isLinkTool = (t: ToolId): boolean => t === "transition" || t === "straight";
const isVertexTool = (t: ToolId): t is VertexKind => t !== "select" && !isLinkTool(t) && t !== "region";

/** Box of the vertex a press at p0 and the pointer at p would create (dragged: past the threshold). */
function placeBox(kind: VertexKind, p0: Point, p: Point, dragged: boolean): Box {
  if (isRoundKind(kind)) return newVertexBox(kind, p);
  return dragged ? draggedVertexBox(kind, p0, p, horizontal) : newVertexBox(kind, p0, horizontal);
}

/** Show (in the document, as an uncommitted edit) the vertex being placed. */
function previewPlace(p: Point, dragged: boolean): void {
  const pl = placing;
  if (!doc || !pl || pl.error || pl.kind === "region") return;
  const kind = pl.kind;
  const box = placeBox(kind, pl.p0, p, dragged);
  doc.history.preview((d) => void (pl.created = addVertex(d as UfsmDocument, pl.region, kind, box, { horizontal })));
  refresh();
}

/** Tool overlay: the ghost of what a click places, or the transition being drawn. */
function drawOverlay(c: CanvasRenderingContext2D, scale: number): void {
  if (!doc) return;
  if (link && doc.index.vertices.has(link.source)) {
    const v = vertexAt(link.to);
    const ok = v !== undefined && cannotConnect(doc.index, link.source, v.id) === undefined;
    const target = v && { box: vertexBox(doc.index, v.id), ok };
    const source = vertexBox(doc.index, link.source);
    // Over a valid target: the route the click would draw, exactly. Elsewhere: an S towards the pointer, or the
    // straight line through the bend points so far, both from the source end nearest to where it was clicked.
    const route = ok ? linkRoute(doc, link.source, link.from, v.id, link.to, link.bends) : undefined;
    const start = endAt(doc.index, link.source, link.from);
    if (route) drawLinkRoute(c, source, route, target, scale);
    else if (tool === "transition") drawLinkRoute(c, source, sRouteTowards(doc.index, link.source, start, link.to), target, scale);
    else drawLink(c, source, attachPoint(doc.index, link.source, start), link.bends, link.to, target, scale);
  } else if (ghost) drawGhost(c, ghost.box, isVertexTool(ghost.kind) && isRoundKind(ghost.kind), scale);
}

/** The route a click on `target` would give the transition being drawn (computed on a copy; cached per target). */
let linkRouteCache: { key: string; index: DocIndex; points: Point[] | undefined } | undefined;
function linkRoute(d: Doc, source: string, from: Point, target: string, to: Point, bends: readonly Point[]): Point[] | undefined {
  // the ends the click would get, not the raw points: the route only changes when one of them does
  const end = (vid: string, p: Point): string => {
    const e = endAt(d.index, vid, p);
    return `${e.side}:${e.offset}`;
  };
  const key = `${tool} ${source} ${end(source, from)} ${target} ${end(target, to)} ${bends.map((p) => `${p.x},${p.y}`).join(" ")}`;
  if (linkRouteCache?.key === key && linkRouteCache.index === d.index) return linkRouteCache.points;
  const copy = structuredClone(d.history.current) as UfsmDocument;
  let points: Point[] | undefined;
  try {
    const id = addTransition(copy, source, target, { via: [...bends], route: tool === "straight" ? "straight" : "s", fromAt: from, toAt: to });
    points = edgeGeometry(indexV1(copy), id)?.points;
  } catch {
    points = undefined;
  }
  linkRouteCache = { key, index: d.index, points };
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

interface Drag {
  grip: Grip;
  /** World point where the button went down. */
  x0: number;
  y0: number;
  /** The document as it was when the drag began; every preview starts from it. */
  base: DocIndex;
  /** Vertices to move (the selection when the drag began). */
  ids: string[];
}

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

/** Status line while dragging: position or size of what is dragged. */
function dragStatus(drag: Drag): string {
  if (!doc) return "";
  const g = drag.grip;
  if (g.kind === "move" || g.kind === "resize") {
    const b = vertexBox(doc.index, g.id);
    return g.kind === "move" ? `x ${b.x} · y ${b.y}` : `${b.w} × ${b.h}`;
  }
  return "Esc cancels";
}

// ---------------------------------------------------------------- input

// All canvas and keyboard input goes through the editor's interaction model
// (fsm/editor.ufsm). The handler below implements its actions and guards.
const DRAG_THRESHOLD = 4;
let lassoAdd = false;
/** What the left button went down on (decided at the press: the machine's pressedOnGrip guard). */
let pressGrip: Grip | undefined;
let drag: Drag | undefined;

/** The grip under a client point. */
function gripUnder(clientX: number, clientY: number, shift: boolean): { grip: Grip; cursor: string } | undefined {
  if (!doc) return undefined;
  const [x, y] = screenToWorld(clientX, clientY);
  return gripAt(doc.index, doc.sheet, doc.selection, currentHandles(), x, y, view.scale, shift);
}

/** What a click at a client point selects: a transition (line or label), else the innermost vertex. */
function pickAt(clientX: number, clientY: number): string | undefined {
  if (!doc) return undefined;
  const [x, y] = screenToWorld(clientX, clientY);
  return hitTransition(doc.index, doc.sheet, x, y, 6 / view.scale)?.id ?? hitTest(doc.index, doc.sheet, x, y, 6 / view.scale).vertex?.id;
}

/** A click on a handle keeps the selection (the handle belongs to it). */
const onHandle = (): boolean => pressGrip !== undefined && pressGrip.kind !== "move" && pressGrip.kind !== "label";

function zoomAround(mx: number, my: number, scale: number): void {
  view.x = mx - ((mx - view.x) * scale) / view.scale;
  view.y = my - ((my - view.y) * scale) / view.scale;
  view.scale = scale;
  requestDraw();
}

const hintText = {
  zoom: "z: f fit sheet · n 100% · Esc cancel",
  jump: "j: a up one level · r root · Esc cancel",
  edit: "e: n name · t trigger · r turn fork/join · O region on its own sheet · Esc cancel",
  add: "a: s state · t S transition · l straight transition · r region · i initial · f final · h history · H deep history · F fork · j join · T terminate · v bend point · e entry · x exit · g guard · a action · Esc cancel",
};

let api: Input | undefined;

api = attachInput(
  canvas,
  (input) => ({
    openFile: () => void openModel(),
    newModel,
    save: () => void saveModel(),
    saveAs: () => void saveModel(true),
    toggleSidebar,
    togglePanel,
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    selectAll,
    enterSelected,
    goUp,
    goRoot,
    clearSelection: () => select([]),
    closePanels: () => undefined,
    hintZoom: () => void (statusEl.textContent = hintText.zoom),
    hintJump: () => void (statusEl.textContent = hintText.jump),
    hintClear: () => updateChrome(),
    fit,
    zoomNormal,
    uiZoomIn: zoomIn,
    uiZoomOut: zoomOut,
    uiZoomReset: zoomReset,
    quickOpen: () => openQuickPick(""),
    commandPalette: () => openQuickPick(">"),
    pressStart: () => {
      lassoAdd = input.shift;
      pressGrip = gripUnder(input.startX, input.startY, input.shift)?.grip;
    },
    lassoUpdate: () => {
      lasso = { x0: input.startX, y0: input.startY, x1: input.x, y1: input.y };
      requestDraw();
    },
    lassoFinish: () => {
      const l = lasso;
      lasso = undefined;
      requestDraw();
      if (!doc || !l) return;
      const [ax, ay] = screenToWorld(l.x0, l.y0);
      const [bx, by] = screenToWorld(l.x1, l.y1);
      const rect = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
      const picked = boxSelect(doc.index, doc.sheet, rect, lassoMode(l));
      select(lassoAdd ? [...doc.selection, ...picked] : picked);
    },
    lassoCancel: () => {
      lasso = undefined;
      requestDraw();
    },
    selectAtPointer: () => {
      if (!doc) return;
      // A click on a state's hidden-lines marker shows every line again (and selects the state).
      const [wx, wy] = screenToWorld(input.x, input.y);
      const marked = pillAt(doc.index, doc.sheet, wx, wy);
      if (marked) {
        select([marked.id]);
        edit((d) => resetActionsHeight(d, marked.id));
        return;
      }
      if (onHandle()) return;
      const id = pickAt(input.x, input.y);
      select(id ? [id] : []);
    },
    toggleAtPointer: () => {
      if (!doc || onHandle()) return;
      const id = pickAt(input.x, input.y);
      if (!id) return;
      const next = new Set(doc.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      select(next);
    },
    panStart: () => undefined,
    panBegin: () => {
      canvas.style.cursor = "";
      canvas.classList.add("panning");
    },
    panMove: () => {
      view.x += input.x - input.lastX;
      view.y += input.y - input.lastY;
      requestDraw();
    },
    panEnd: () => canvas.classList.remove("panning"),
    zoomAtPointer: () => {
      const r = canvas.getBoundingClientRect();
      zoomAround(input.x - r.left, input.y - r.top, Math.min(Math.max(view.scale * Math.exp(-input.wheelDeltaY * 0.0015), 0.05), 8));
    },
    openAtPointer: () => {
      if (!doc) return;
      // On a handle or label: give a pinned S end, a jog, an S label or an action block's height back to automatic.
      const g = gripUnder(input.x, input.y, false)?.grip;
      if (g && g.kind !== "move") {
        const s = routeInfo(doc.index, g.id) !== undefined;
        if (g.kind === "end" && s && g.pinned) edit((d) => unpinEdgeEnd(d, g.id, g.end));
        else if (g.kind === "jog") edit((d) => resetJog(d, g.id));
        else if (g.kind === "actions") edit((d) => resetActionsHeight(d, g.id));
        else if (g.kind === "label" && s) edit((d) => resetLabel(d, g.id));
        else if (g.kind === "bend") edit((d) => removeBendPoint(d, g.id, g.i));
        return;
      }
      const [x, y] = screenToWorld(input.x, input.y);
      if (hitTransition(doc.index, doc.sheet, x, y, 6 / view.scale)) return;
      const hit = hitTest(doc.index, doc.sheet, x, y, 6 / view.scale);
      if (hit.vertex?.kind === "state") enterState(hit.vertex, hit.region);
      else if (!hit.vertex && onTitleBlock(x, y)) focusProjectField(TITLE_FIELD_LABELS.revision);
      else if (!hit.vertex) fit();
    },
    undo,
    redo,
    dragBegin: () => {
      if (!doc || !pressGrip) return;
      const g = pressGrip;
      if ((g.kind === "move" || g.kind === "label") && !doc.selection.has(g.id)) select([g.id]);
      const [x0, y0] = screenToWorld(input.startX, input.startY);
      drag = { grip: g, x0, y0, base: doc.index, ids: [...doc.selection].filter((id) => doc!.index.vertices.has(id)) };
      doc.history.begin();
    },
    dragUpdate: () => {
      if (!doc || !drag) return;
      const d = drag;
      const [x, y] = screenToWorld(input.x, input.y);
      doc.history.preview((draft) => applyDrag(draft as UfsmDocument, d, x, y));
      refresh();
      statusEl.textContent = dragStatus(d);
    },
    dragFinish: () => {
      if (!doc || !drag) return;
      drag = undefined;
      refresh(doc.history.commit());
      updateChrome();
    },
    dragCancel: () => {
      if (!doc || !drag) return;
      drag = undefined;
      doc.history.cancel();
      refresh();
      updateChrome();
    },
    hover: () => {
      canvas.style.cursor = tool !== "select" ? "crosshair" : (gripUnder(input.x, input.y, input.shift)?.cursor ?? "");
    },

    // add mode, tools (region Tool of the model) and structure edits
    hintAdd: () => void (statusEl.textContent = hintText.add),
    toolState: () => void (tool = "state"),
    toolTransition: () => void (tool = "transition"),
    toolStraight: () => void (tool = "straight"),
    toolRegion: () => void (tool = "region"),
    toolInitial: () => void (tool = "initial"),
    toolFinal: () => void (tool = "final"),
    toolHistory: () => void (tool = "shallow-history"),
    toolDeepHistory: () => void (tool = "deep-history"),
    toolFork: () => void (tool = "fork"),
    toolJoin: () => void (tool = "join"),
    toolTerminate: () => void (tool = "terminate"),
    paletteTool: () => void (tool = input.tool as ToolId),
    showTool: () => {
      palette.setActive(tool);
      canvas.style.cursor = "crosshair";
      ghost = undefined;
      updateChrome();
      requestDraw();
    },
    toolSelect: () => {
      tool = "select";
      horizontal = false;
      ghost = undefined;
      palette.setActive("select");
      canvas.style.cursor = "";
      updateChrome();
      requestDraw();
    },
    rotateTool: () => {
      if (tool !== "fork" && tool !== "join") return;
      horizontal = !horizontal;
      const p = worldAt(input.x, input.y);
      ghost = { kind: tool, box: newVertexBox(tool, p, horizontal) };
      updateChrome();
      requestDraw();
    },
    placeMove: () => {
      if (!doc) return;
      const p = worldAt(input.x, input.y);
      if (isVertexTool(tool)) ghost = { kind: tool, box: newVertexBox(tool, p, horizontal) };
      else if (tool === "region") {
        const v = vertexAt(p);
        ghost = v?.kind === "state" ? { kind: tool, box: vertexBox(doc.index, v.id) } : undefined;
      }
      canvas.style.cursor = "crosshair";
      requestDraw();
    },
    placeStart: () => {
      if (!doc) return;
      ghost = undefined;
      const p0 = worldAt(input.startX, input.startY);
      if (!isVertexTool(tool)) {
        placing = { kind: "region", p0, region: "", error: undefined, created: undefined };
        return;
      }
      const region = regionAt(doc.index, doc.sheet, p0);
      placing = { kind: tool, p0, region: region.id, error: cannotAdd(doc.index, region.id, tool), created: undefined };
      if (placing.error) return;
      doc.history.begin();
      previewPlace(p0, false);
    },
    placeUpdate: () => {
      const dragged = Math.hypot(input.x - input.startX, input.y - input.startY) >= DRAG_THRESHOLD;
      previewPlace(worldAt(input.x, input.y), dragged);
    },
    placeFinish: () => {
      const pl = placing;
      placing = undefined;
      if (!doc || !pl) return;
      if (pl.kind === "region") {
        const v = vertexAt(worldAt(input.x, input.y));
        if (v?.kind === "state") {
          addRegionTo(v.id);
          select([v.id]);
        } else say("Click a state to add a region to it.");
        return;
      }
      if (pl.error) {
        say(pl.error);
        return;
      }
      refresh(doc.history.commit());
      if (pl.created) select([pl.created]);
    },
    placeCancel: () => {
      const pl = placing;
      placing = undefined;
      if (!doc || !pl || pl.kind === "region" || pl.error) return;
      doc.history.cancel();
      refresh();
      updateChrome();
    },
    validSource: () => {
      const v = doc && vertexAt(worldAt(input.x, input.y));
      return !!doc && !!v && cannotConnect(doc.index, v.id) === undefined;
    },
    overVertex: () => vertexAt(worldAt(input.x, input.y)) !== undefined,
    validTarget: () => {
      const v = doc && link && vertexAt(worldAt(input.x, input.y));
      return !!doc && !!link && !!v && cannotConnect(doc.index, link.source, v.id) === undefined;
    },
    linkStart: () => {
      const v = vertexAt(worldAt(input.x, input.y));
      if (!v) return;
      const p = worldAt(input.x, input.y);
      link = { source: v.id, from: p, bends: [], to: p };
      updateChrome();
      requestDraw();
    },
    linkUpdate: () => {
      if (!link) return;
      link.to = worldAt(input.x, input.y);
      requestDraw();
    },
    linkBend: () => {
      if (!link) return;
      if (tool === "transition") {
        say("An S transition lays out its own route: use the straight transition (A L) to place bend points.");
        return;
      }
      const p = worldAt(input.x, input.y);
      link.bends.push({ x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 });
      requestDraw();
    },
    linkUnbend: () => {
      link?.bends.pop();
      requestDraw();
    },
    linkRefuse: () => {
      if (!doc) return;
      const v = vertexAt(worldAt(input.x, input.y));
      const why = v ? (link ? cannotConnect(doc.index, link.source, v.id) : cannotConnect(doc.index, v.id)) : undefined;
      say(why ?? (link ? "Click the target state." : "Click the state the transition starts from."));
    },
    linkFinish: () => {
      const l = link;
      link = undefined;
      const p = worldAt(input.x, input.y);
      const v = vertexAt(p);
      if (!doc || !l || !v) return;
      let id = "";
      const route = tool === "straight" ? "straight" : "s";
      edit((d) => void (id = addTransition(d, l.source, v.id, { via: l.bends, route, fromAt: l.from, toAt: p })));
      if (id) select([id]);
    },
    linkCancel: () => {
      link = undefined;
      requestDraw();
      updateChrome();
    },
    addRegion: () => {
      const v = single();
      if (v?.kind === "state") addRegionTo(v.id);
    },
    addBendPoint: addBendPointToSelected,
    deleteSelection,
    copy: () => void copySelection(),
    cut: cutSelection,
    paste: pasteClipboard,
    singleTransition: () => singleTransition() !== undefined,

    // edit mode (e + key) and the list keys of the add mode: they open the Properties panel where the change is made
    hintEdit: () => void (statusEl.textContent = hintText.edit),
    editName: () => focusPanel("name"),
    editTrigger: () => focusPanel("trigger"),
    addEntry: () => focusPanel("entry"),
    addExit: () => focusPanel("exit"),
    addGuard: () => focusPanel("guard"),
    addAction: () => focusPanel("action"),
    singleBar: () => {
      const v = single();
      return v?.kind === "fork" || v?.kind === "join";
    },
    turnBar: () => {
      const v = single();
      if (!doc || (v?.kind !== "fork" && v?.kind !== "join")) return;
      const horizontalNow = doc.index.doc.diagram?.states[v.id]?.orientation === "horizontal";
      edit((d) => setBarOrientation(d, v.id, !horizontalNow));
    },
    toggleOffPage: () => {
      const v = single();
      if (!doc || v?.kind !== "state") return;
      const regions = v.regions ?? [];
      // the region under the pointer, else the state's only region
      const p = worldAt(input.x, input.y);
      const hit = input.over ? hitTest(doc.index, doc.sheet, p.x, p.y).region : undefined;
      const r = regions.find((x) => x.id === hit?.id) ?? (regions.length === 1 ? regions[0] : undefined);
      if (!r) {
        say(regions.length ? "Point at the region to put on its own sheet (e O)." : `${v.name} has no regions.`);
        return;
      }
      const off = doc.index.doc.diagram?.regions[r.id]?.offPage === true;
      const why = off ? undefined : cannotOffPage(doc.index, r.id);
      if (why) say(why);
      else edit((d) => setOffPage(d, r.id, !off));
    },
    simStart,
    simStop,
    paletteSelect: () => input.tool === "select",
    paletteConnect: () => isLinkTool(input.tool as ToolId),
    ctrl: () => input.ctrl,
    shift: () => input.shift,
    singleState: () => single()?.kind === "state",
    beyondThreshold: () => Math.hypot(input.x - input.startX, input.y - input.startY) >= DRAG_THRESHOLD,
    pressedOnGrip: () => pressGrip !== undefined,
  }),
  () => doc !== undefined,
  () => {
    // a key or button press ends a status message
    if (note === undefined) return;
    note = undefined;
    updateChrome();
  },
);
pickTool = (t) => api?.pickTool(t);

el<HTMLButtonElement>("explorer-new").addEventListener("click", newModel);
el<HTMLButtonElement>("explorer-open").addEventListener("click", () => void openModel());
fitBtn.addEventListener("click", fit);
upBtn.addEventListener("click", goUp);
problemsEl.addEventListener("click", () => showPanelTab("problems"));
simStatusEl.addEventListener("click", () => showPanelTab("simulator"));
new ResizeObserver(requestDraw).observe(canvas);
attachSash(el("sash-left"), { property: "--sidebar-w", side: "left", initial: 260, min: 160, max: 600, storageKey: "ufsm.sidebarWidth", scale: uiZoom });
attachSash(el("sash-right"), { property: "--panel-w", side: "right", initial: 300, min: 200, max: 700, storageKey: "ufsm.panelWidth", scale: uiZoom });
autoHideScrollbars();
wheelScrollsHorizontally(tabsEl);
if (customWindowControls) document.body.classList.add("frameless");
if (isMac && inTauri) document.body.classList.add("mac-overlay");
const syncMaximized = async (): Promise<void> => {
  const m = await windowControls.isMaximized();
  if (m !== maximized) {
    maximized = m;
    renderShell();
  }
};
windowControls.onResized(() => void syncMaximized());
void syncMaximized();
onCloseRequested(
  async () => {
    const dirty = docs.filter(isDirty);
    if (dirty.length === 0) return true;
    const names = dirty.map((d) => d.fileName).join(", ");
    return confirmDiscard(`Unsaved changes in ${names}. Quit and discard them?`);
  },
  () => docs.some(isDirty),
);
activate(undefined, true);
onSystemAppearance(onSystemDark);
void loadSettings();
// The panel's tab strip exists once the panel has rendered (Preact keeps the element).
const panelTabsEl = panelEl.querySelector<HTMLElement>(".panel-tabs");
if (panelTabsEl) wheelScrollsHorizontally(panelTabsEl);

// Test/automation hook for headless checks: load without dialogs, map coordinates, read selection.
Object.assign(window, {
  ufsm: {
    /** Open a model in a new tab (no dialog). */
    load: (text: string, name: string) => showModel(loadModel(text), name, undefined),
    /** File › New. */
    newModel,
    /** Open machines in tab order. */
    tabs: () => docs.map((d) => ({ name: d.fileName, dirty: isDirty(d), active: d === doc })),
    activateTab: (i: number) => activate(docs[i]),
    /** Close tab i; `force` skips the unsaved-changes question. */
    closeTab: (i: number, force = false) => closeDoc(docs[i], force),
    view: () => ({ ...view }),
    worldToScreen: (x: number, y: number): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [r.left + view.x + x * view.scale, r.top + view.y + y * view.scale];
    },
    selectedName: () => {
      const v = single();
      return v ? (v.name ?? v.kind) : undefined;
    },
    /** All selected ids, vertices and transitions, in no particular order. */
    selectedIds: (): string[] => (doc ? [...doc.selection] : []),
    serialize: () => (doc ? serializeV1(doc.history.current) : undefined),
    /** The armed tool ("select" when none). */
    tool: () => tool,
    /** Pick a tool as a palette click does. */
    pickTool: (t: ToolId) => pickTool(t),
    /** The status line text. */
    status: () => statusEl.textContent,
    select: (ids: string[]) => select(ids),
    undo,
    redo,
    canUndo: () => doc?.history.canUndo ?? false,
    canRedo: () => doc?.history.canRedo ?? false,
    isDirty: () => (doc ? isDirty(doc) : false),
    /** Absolute world box of a vertex. */
    box: (id: string) => (doc ? vertexBox(doc.index, id) : undefined),
    /** The design rule check's findings for the active machine. */
    problems: () => doc?.diagnostics ?? [],
    /** A state's action block: lines, height, what is hidden and its marker (v1/action-block.ts), with the marker's screen centre. */
    actionBlock: (id: string) => {
      const v = doc?.index.vertices.get(id)?.vertex;
      if (!doc || v?.kind !== "state") return undefined;
      const block = actionBlock(doc.index, v);
      const b = vertexBox(doc.index, id);
      const r = canvas.getBoundingClientRect();
      const pill = block.pill && ([r.left + view.x + (b.x + block.pill.x + block.pill.w / 2) * view.scale, r.top + view.y + (b.y + block.pill.y + block.pill.h / 2) * view.scale] as [number, number]);
      return { ...block, pillScreen: pill };
    },
    /** Absolute polyline and label of a transition. */
    route: (id: string) => (doc ? edgeGeometry(doc.index, id) : undefined),
    /** Simulator: start (or restart), stop, send an event, set a guard, and what it shows. */
    simStart,
    simStop,
    simSend: (event: string) => simOps.send(event),
    /** Fire a running timer by name (its event is sent). */
    simFire: (name: string) => {
      const t = doc?.sim?.timers().find((x) => x.name === name);
      if (t) simOps.fire(t.id);
    },
    simGuard: (name: string, value: boolean) => simOps.setGuard(name, value),
    sim: () => {
      const sim = doc?.sim;
      if (!doc || !sim) return undefined;
      return {
        stale: simStale(doc),
        steps: sim.steps.length,
        active: sim.activeIds().map((id) => sim.index.vertices.get(id)?.vertex.name ?? id),
        fired: [...sim.fired],
        hover: doc.hoverEvent,
        would: doc.hoverEvent ? (wouldMap(doc).get(doc.hoverEvent) ?? []) : [],
        calls: sim.steps[sim.steps.length - 1]?.calls ?? [],
        timers: sim.timers().map((t) => t.name),
        error: doc.simError,
        trace: traceText(doc, sim, undefined),
      };
    },
    simError: () => doc?.simError,
    /** The panel tab shown. */
    panelTab: () => panelTab,
    /** Open the search field with this text (as Ctrl+P does with "", Ctrl+Shift+P with ">"). */
    openSearch: (text = "") => openQuickPick(text),
    /** The rows the search would list for this text, best first. */
    search: (text: string) =>
      search(searchItems(), text, { activeDoc: doc?.key, recent: recentPicks }).map((m) => ({
        label: m.item.label,
        kind: m.item.kind,
        detail: m.item.detail,
        machine: m.item.docName,
        checked: m.item.checked ?? false,
      })),
    /** The theme in use: id, modifier inputs, appearance. */
    theme: () => ({ id: theme.id, inputs: { ...theme.inputs }, appearance: theme.appearance }),
    /** The UI zoom in percent (Settings › Zoom). */
    zoom: () => settings.zoom,
    /** The settings as settings.json would hold them. */
    settings: () => serializeSettings(settings),
    /** Handles of the selection, with their screen positions. */
    handles: () =>
      currentHandles().map((h) => {
        const r = canvas.getBoundingClientRect();
        return { ...h.grip, screen: [r.left + view.x + h.x * view.scale, r.top + view.y + h.y * view.scale] as [number, number] };
      }),
  },
});
