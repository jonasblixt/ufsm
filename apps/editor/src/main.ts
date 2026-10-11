// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The editor's entry point: creates the parts (app.ts lists them), connects the workspace's changes to the shell and
 * the canvas, and feeds the canvas's and the window's input to the editor's interaction model (fsm/editor.ufsm), whose
 * actions and guards are the canvas handler parts (canvas/keys.ts, pointer.ts, tools.ts).
 */
import { el, type App } from "./app";
import { installAutomation } from "./automation";
import { keyActions } from "./canvas/keys";
import { pointerActions } from "./canvas/pointer";
import { canvasState } from "./canvas/state";
import { toolActions } from "./canvas/tools";
import { createCanvasView } from "./canvas/view";
import { createCommands } from "./commands";
import { createEditCommands } from "./edit-commands";
import { createFiles } from "./files";
import type { EditorFsmHandler } from "./fsm/editor-fsm";
import { attachInput } from "./fsm/input";
import { createNavigation } from "./navigation";
import { confirmDiscard, onCloseRequested, onSystemAppearance } from "./platform";
import { attachSash } from "./sash";
import { autoHideScrollbars, wheelScrollsHorizontally } from "./scrollbars";
import { createSearch } from "./search-items";
import { createSettingsController } from "./settings-controller";
import { createShell } from "./shell";
import { createSimController } from "./sim-controller";
import { Workspace } from "./workspace";

const app = { ws: new Workspace(), tools: canvasState(), pickTool: () => undefined } as Partial<App> as App;
// Settings first: the theme applies before the first paint.
app.settings = createSettingsController(app);
app.canvas = createCanvasView(app);
app.commands = createCommands(app);
app.nav = createNavigation(app);
app.edits = createEditCommands(app);
app.files = createFiles(app);
app.sim = createSimController(app);
app.search = createSearch(app);
app.shell = createShell(app);

// What a change touches is redrawn at once (the canvas on the next frame).
app.ws.onChange((c) => {
  app.shell.update(c);
  if (!c.has("chrome") || c.size > 1) app.canvas.requestDraw();
});

const input = attachInput(
  app.canvas.canvas,
  (state): EditorFsmHandler => {
    app.input = state;
    return { ...keyActions(app, state), ...pointerActions(app, state), ...toolActions(app, state) };
  },
  () => app.ws.active !== undefined,
  () => app.ws.clearNote(),
);
app.pickTool = (t) => input.pickTool(t);

el<HTMLButtonElement>("explorer-new").addEventListener("click", () => app.files.newModel());
el<HTMLButtonElement>("explorer-open").addEventListener("click", () => void app.files.openModel());
attachSash(el("sash-left"), { property: "--sidebar-w", side: "left", initial: 260, min: 160, max: 600, storageKey: "ufsm.sidebarWidth", scale: app.settings.uiZoom });
attachSash(el("sash-right"), { property: "--panel-w", side: "right", initial: 300, min: 200, max: 700, storageKey: "ufsm.panelWidth", scale: app.settings.uiZoom });
autoHideScrollbars();
wheelScrollsHorizontally(el("tabs"));
onCloseRequested(
  async () => {
    const dirty = app.ws.sessions.filter((d) => d.dirty);
    if (dirty.length === 0) return true;
    return confirmDiscard(`Unsaved changes in ${dirty.map((d) => d.fileName).join(", ")}. Quit and discard them?`);
  },
  () => app.ws.sessions.some((d) => d.dirty),
);
app.ws.activate(undefined, true);
onSystemAppearance(app.settings.onSystemDark);
void app.settings.load();
// The panel's tab strip exists once the panel has rendered (Preact keeps the element).
const panelTabsEl = el("panel").querySelector<HTMLElement>(".panel-tabs");
if (panelTabsEl) wheelScrollsHorizontally(panelTabsEl);
installAutomation(app);
