// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The window around the canvas: title bar (menus, search field, window buttons), tab strip, explorer rows,
 * breadcrumbs, the right panel (Properties, Project, Problems, Simulator, Code, Settings) and the status bar. Everything
 * here is drawn from the workspace and the controllers; `update` redraws what a change touches (main.ts calls it).
 */
import { UFSM_VERSION, type Region } from "@ufsm/core";
import { addDecl } from "@ufsm/core/edit";
import { locate, locationText } from "@ufsm/core/diagram";
import { el, type App } from "./app";
import { toolHint } from "./canvas/state";
import { sheetLabel, sheetPath } from "./nav";
import { buildPalette, type Palette } from "./palette";
import { renderPanel, type FocusField, type PanelOps, type PanelTab } from "./panel";
import { customWindowControls, isMac, inTauri, setWindowTitle, windowControls } from "./platform";
import { openQuickPick } from "./quickpick";
import { renderTabs } from "./tabs";
import { renderTitleBar } from "./titlebar";
import type { Change } from "./workspace";

export interface Shell {
  readonly palette: Palette;
  /** Redraw what the changes touch (the canvas is the canvas view's). */
  update(changes: ReadonlySet<Change>): void;
  /** Replace the status line text until the next chrome update. */
  setStatus(text: string): void;
  status(): string;
  readonly panelTab: PanelTab;
  /** Show a panel tab (and the panel). `render` false leaves the redraw to the caller's change. */
  showPanelTab(tab: PanelTab, render?: boolean): void;
  /** Open the Properties tab and ask it to focus a field (or open a picker) of the selection, once. */
  focusPanel(field: FocusField): void;
  /** Open the Project tab and put the cursor in the field with this label. */
  focusProjectField(label: string): void;
  /** Show a declaration in the Project tab (a problem's target). */
  highlightDecl(id: string): void;
  toggleSidebar(): void;
  togglePanel(): void;
  sidebarShown(): boolean;
  panelShown(): boolean;
  /** Open the search field with this text (Ctrl+P "", Ctrl+Shift+P ">"). */
  openSearch(text: string): void;
}

export function createShell(app: App): Shell {
  const ws = app.ws;
  const titleBarEl = el<HTMLElement>("titlebar");
  const tabsEl = el<HTMLElement>("tabs");
  const breadcrumbsEl = el<HTMLElement>("breadcrumbs");
  const panelEl = el<HTMLElement>("panel");
  const zoomEl = el<HTMLSpanElement>("zoom");
  const fitBtn = el<HTMLButtonElement>("fit");
  const upBtn = el<HTMLButtonElement>("up");
  const crumbsEl = el<HTMLElement>("crumbs");
  const statusEl = el<HTMLSpanElement>("status");
  const problemsEl = el<HTMLButtonElement>("problems");
  const emptyEl = el<HTMLDivElement>("empty");
  const palette = buildPalette(el<HTMLElement>("palette"), (id) => app.pickTool(id));
  let panelTab: PanelTab = "properties";
  /** Field of the Properties tab to focus on the next render (from the `e`/`a` keys). */
  let panelFocus: FocusField | undefined;
  /** Declaration to show in the Project tab on the next render (a problem's target). */
  let panelHighlight: string | undefined;
  let maximized = false;

  /** What the panel may do: every change goes through ws.edit as one undo step. */
  const panelOps: PanelOps = {
    select: (id) => app.nav.selectFromPanel(id),
    jump: (id) => app.nav.jumpTo(id),
    edit: (recipe) => ws.edit(recipe),
    use: (choice, recipe) =>
      ws.edit((d) => {
        const id = "id" in choice ? choice.id : addDecl(d, choice.create.kind, choice.create.name);
        recipe(d, id);
      }),
    say: (msg) => ws.say(msg),
    generate: () => void app.sim.generate(),
    chooseOut: () => void app.sim.chooseOut(),
  };

  const updateTitle = (): void => {
    const d = ws.active;
    void setWindowTitle(d ? `${d.dirty ? "• " : ""}${d.fileName} — uFSM ${UFSM_VERSION}` : `uFSM ${UFSM_VERSION}`);
  };

  const updateProblems = (): void => {
    const d = ws.active;
    if (!d) {
      problemsEl.hidden = true;
      return;
    }
    const errors = d.diagnostics.filter((x) => x.severity === "error").length;
    const warnings = d.diagnostics.length - errors;
    const lines = [
      ...d.notes.map((n) => `converted: ${n.message}`),
      ...d.diagnostics.map((x) => `${x.severity}: ${x.message}`),
    ];
    problemsEl.hidden = lines.length === 0;
    problemsEl.textContent = [
      errors ? `${errors} error${errors > 1 ? "s" : ""}` : "",
      warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "",
      d.notes.length ? `${d.notes.length} converted` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    problemsEl.title = lines.join("\n");
    problemsEl.classList.toggle("has-errors", errors > 0);
  };

  /** Re-render the Preact parts of the window and the explorer rows from the current state. */
  const renderShell = (): void => {
    const d = ws.active;
    const search = app.search;
    renderTitleBar(titleBarEl, {
      menus: app.commands.menus,
      search: {
        hint: d ? `Search ${d.fileName}` : "Search",
        machine: d?.fileName,
        items: search.items,
        activeDoc: d?.key,
        recent: search.recent,
        onPick: search.onPick,
        onPreview: search.onPreview,
      },
      windowControls: customWindowControls,
      mac: isMac && inTauri,
      maximized,
      onMinimize: () => void windowControls.minimize(),
      onToggleMaximize: () => void windowControls.toggleMaximize(),
      onClose: () => void windowControls.close(),
    });
    renderTabs(tabsEl, {
      tabs: ws.sessions.map((x) => ({
        key: x.key,
        name: x.fileName,
        title: x.path ?? x.fileName,
        dirty: x.dirty,
        active: x === d,
      })),
      onActivate: (key) => ws.activate(ws.byKey(key)),
      onClose: (key) => void app.files.closeDoc(ws.byKey(key)),
    });
    for (const x of ws.sessions) x.explorer?.entry.update(x.fileName, x.path ?? x.fileName, x.dirty, x === d);
    const focus = panelFocus;
    panelFocus = undefined;
    const s = app.settings;
    renderPanel(panelEl, {
      tab: panelTab,
      onTab: (tab) => showPanelTab(tab),
      doc: d && {
        index: d.index,
        selection: d.selection,
        fileName: d.fileName,
        path: d.path,
        converted: d.savedVersion < 0,
        dirty: d.dirty,
        diagnostics: d.diagnostics,
        notes: d.notes,
      },
      ops: panelOps,
      ...(focus ? { focus } : {}),
      ...(panelHighlight ? { highlight: panelHighlight } : {}),
      ...(d ? { sim: app.sim.props(d), code: { doc: d.history.current, view: d.codeView, ops: app.sim.codeOps } } : {}),
      settings: {
        settings: s.settings,
        theme: s.theme,
        systemDark: s.systemDark,
        location: s.location,
        problems: s.problems(),
        onTheme: s.setTheme,
        onZoom: s.setZoom,
      },
    });
    app.sim.updateStatus();
  };

  /** Breadcrumbs, the up button, the status line and the tree's marks; then the rest of the shell. */
  const updateChrome = (): void => {
    const d = ws.active;
    if (!d) {
      crumbsEl.replaceChildren();
      if (ws.sessions.length === 0) statusEl.textContent = "";
      renderShell();
      return;
    }
    const { index, sheet } = d;
    crumbsEl.replaceChildren(
      ...sheetPath(index, sheet).flatMap((p: Region, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "crumb";
        b.textContent = sheetLabel(index, p);
        b.disabled = p === sheet;
        b.addEventListener("click", () => app.nav.showSheet(p));
        if (i === 0) return [b];
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "›";
        return [sep, b];
      }),
    );
    upBtn.disabled = sheet === index.doc.machine.root;
    statusEl.textContent = statusText();
    if (app.tools.tool !== "select") statusEl.textContent = toolHint(app.tools);
    if (ws.note) statusEl.textContent = ws.note;
    d.explorer?.tree.reveal(ws.single()?.id);
    d.explorer?.tree.setSheet(sheet.id);
    renderShell();
  };

  /** The status line for the selection: what is selected, or the machine's size. */
  const statusText = (): string => {
    const d = ws.active!;
    const index = d.index;
    const v = ws.single();
    const nSel = d.selection.size;
    if (nSel > 1) {
      let states = 0;
      for (const id of d.selection) if (index.vertices.has(id)) states++;
      const ts = nSel - states;
      return (
        [states ? `${states} state${states > 1 ? "s" : ""}` : "", ts ? `${ts} transition${ts > 1 ? "s" : ""}` : ""]
          .filter(Boolean)
          .join(" · ") + " selected"
      );
    }
    if (nSel === 1 && !v) {
      const t = index.transitions.get(d.selection.values().next().value!);
      const loc = t && locate(index, t.id);
      return t ? `transition · ${t.id}${loc ? ` · ${locationText(loc)}` : ""}` : "";
    }
    if (v) {
      const parts = [v.kind === "state" ? v.name || "(unnamed)" : (v.name ?? v.kind)];
      if (v.kind === "state") {
        const regions = v.regions?.length ?? 0;
        if (regions) parts.push(`${regions} region${regions > 1 ? "s" : ""}`);
        if (v.regions?.some((r) => index.doc.diagram?.regions[r.id]?.offPage))
          parts.push("double-click or Enter to open");
      } else {
        parts.push(v.kind);
      }
      parts.push(v.id);
      const loc = locate(index, v.id);
      if (loc) parts.push(locationText(loc));
      return parts.join(" · ");
    }
    return `${index.vertices.size} states · ${index.transitions.size} transitions · ${index.doc.declarations.events.length} events`;
  };

  /** Another machine is shown (or none): the parts of the window that only exist with a machine, and a clean pointer. */
  const activated = (): void => {
    const d = ws.active;
    app.tools.lasso = undefined;
    app.tools.pressGrip = undefined;
    emptyEl.hidden = d !== undefined;
    breadcrumbsEl.hidden = d === undefined;
    zoomEl.hidden = d === undefined;
    fitBtn.disabled = d === undefined;
    palette.setEnabled(d !== undefined);
    app.canvas.canvas.style.cursor = "";
  };

  const showPanelTab = (tab: PanelTab, render = true): void => {
    panelTab = tab;
    document.body.classList.remove("panel-hidden");
    if (render) ws.changed("shell");
  };

  const toggle = (cls: string) => (): void => {
    document.body.classList.toggle(cls);
    ws.changed("shell");
  };

  const shell: Shell = {
    palette,
    update: (c) => {
      if (c.has("active")) activated();
      if (c.has("document") || c.has("active")) {
        updateTitle();
        updateProblems();
      }
      if (c.has("document") || c.has("selection") || c.has("chrome") || c.has("active")) updateChrome();
      else if (c.has("sim") || c.has("shell")) renderShell();
    },
    setStatus: (text) => void (statusEl.textContent = text),
    status: () => statusEl.textContent ?? "",
    get panelTab() {
      return panelTab;
    },
    showPanelTab,
    focusPanel: (field) => {
      panelFocus = field;
      showPanelTab("properties");
    },
    focusProjectField: (label) => {
      showPanelTab("project");
      const f = panelEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${CSS.escape(label)}"]`);
      if (!f) return;
      f.scrollIntoView({ block: "nearest" });
      f.focus();
      f.select();
    },
    highlightDecl: (id) => {
      panelHighlight = id;
      showPanelTab("project");
      panelHighlight = undefined;
    },
    toggleSidebar: toggle("sidebar-hidden"),
    togglePanel: toggle("panel-hidden"),
    sidebarShown: () => !document.body.classList.contains("sidebar-hidden"),
    panelShown: () => !document.body.classList.contains("panel-hidden"),
    openSearch: (text) => openQuickPick(text),
  };

  // window buttons and frame
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
  fitBtn.addEventListener("click", () => app.canvas.fit());
  upBtn.addEventListener("click", () => app.nav.goUp());
  problemsEl.addEventListener("click", () => showPanelTab("problems"));
  return shell;
}
