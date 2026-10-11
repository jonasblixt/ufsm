// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Every command of the editor, once: its label, its keys as shown, when it is enabled and what it runs. The title bar's
 * menus, the command palette (`>` in the search) and the editor model's key actions all use these entries. A command
 * that a key runs has the id of that action in fsm/editor.ufsm (`save`, `deleteSelection`, ...), so a key can be
 * followed from fsm/KEYMAP.md to here with one search.
 */
import { UFSM_VERSION } from "@ufsm/core";
import type { App } from "./app";
import { TOOL_KEYS, TOOL_NAMES, type ToolId } from "./palette";
import { inTauri, windowControls } from "./platform";
import { ZOOM_MAX, ZOOM_MIN } from "./settings";
import type { Menu, MenuEntry, MenuItem } from "./titlebar";

export interface Command extends MenuItem {
  id: string;
}

export interface Commands {
  get(id: string): Command;
  /** Run a command (whether or not it is enabled: the command itself checks what it needs). */
  run(id: string): void;
  /** The title bar's menus, built from the commands. */
  readonly menus: Menu[];
}

export function createCommands(app: App): Commands {
  const ws = app.ws;
  const hasDoc = (): boolean => ws.active !== undefined;
  const hasSelection = (): boolean => (ws.active?.selection.size ?? 0) > 0;
  const singleState = (): boolean => ws.single()?.kind === "state";
  const singleTransition = (): boolean => ws.singleTransition() !== undefined;
  const notRoot = (): boolean => !!ws.active && ws.active.sheet !== ws.active.index.doc.machine.root;
  const hasSteps = (): boolean => (ws.active?.sim?.steps.length ?? 0) > 0;

  const list: Command[] = [
    // File
    { id: "newModel", label: "New", keys: "Ctrl+N", run: () => app.files.newModel() },
    { id: "openFile", label: "Open…", keys: "O", run: () => void app.files.openModel() },
    { id: "save", label: "Save", keys: "S", run: () => void app.files.saveModel(), enabled: hasDoc },
    { id: "saveAs", label: "Save As…", keys: "Shift+S", run: () => void app.files.saveModel(true), enabled: hasDoc },
    {
      id: "generate",
      label: "Generate Code",
      keys: "Ctrl+Shift+B",
      run: () => void app.sim.generate(),
      enabled: hasDoc,
    },
    { id: "generateTo", label: "Generate Code To…", run: () => void app.sim.generateTo(), enabled: hasDoc },
    { id: "closeMachine", label: "Close Machine", run: () => void app.files.closeDoc(ws.active), enabled: hasDoc },
    { id: "openSettings", label: "Settings", run: () => app.shell.showPanelTab("settings") },
    { id: "exit", label: "Exit", run: () => void windowControls.close(), enabled: () => inTauri },
    // Edit
    {
      id: "undo",
      label: "Undo",
      keys: "Ctrl+Z",
      run: () => ws.undo(),
      enabled: () => ws.active?.history.canUndo ?? false,
    },
    {
      id: "redo",
      label: "Redo",
      keys: "Ctrl+R",
      run: () => ws.redo(),
      enabled: () => ws.active?.history.canRedo ?? false,
    },
    { id: "cut", label: "Cut", keys: "Ctrl+X", run: () => app.edits.cutSelection(), enabled: hasSelection },
    { id: "copy", label: "Copy", keys: "Ctrl+C", run: () => void app.edits.copySelection(), enabled: hasSelection },
    {
      id: "paste",
      label: "Paste",
      keys: "Ctrl+V",
      run: () => app.edits.pasteClipboard(),
      enabled: () => hasDoc() && ws.clipboard !== undefined,
    },
    {
      id: "deleteSelection",
      label: "Delete",
      keys: "Del",
      run: () => app.edits.deleteSelection(),
      enabled: hasSelection,
    },
    {
      id: "editName",
      label: "Rename",
      keys: "E N",
      run: () => app.shell.focusPanel("name"),
      enabled: () => ws.single() !== undefined,
    },
    {
      id: "editTrigger",
      label: "Trigger",
      keys: "E T",
      run: () => app.shell.focusPanel("trigger"),
      enabled: singleTransition,
    },
    {
      id: "addEntry",
      label: "Add Entry Action",
      keys: "A E",
      run: () => app.shell.focusPanel("entry"),
      enabled: singleState,
    },
    {
      id: "addExit",
      label: "Add Exit Action",
      keys: "A X",
      run: () => app.shell.focusPanel("exit"),
      enabled: singleState,
    },
    { id: "addTimer", label: "Add Timer", run: () => app.shell.focusPanel("timer"), enabled: singleState },
    {
      id: "addGuard",
      label: "Add Guard Term",
      keys: "A G",
      run: () => app.shell.focusPanel("guard"),
      enabled: singleTransition,
    },
    {
      id: "addAction",
      label: "Add Action",
      keys: "A A",
      run: () => app.shell.focusPanel("action"),
      enabled: singleTransition,
    },
    { id: "selectAll", label: "Select All", keys: "Ctrl+A", run: () => app.nav.selectAll(), enabled: hasDoc },
    { id: "clearSelection", label: "Clear Selection", keys: "Esc", run: () => ws.select([]), enabled: hasSelection },
    {
      id: "turnBar",
      label: "Turn Fork/Join",
      keys: "E R",
      run: () => app.edits.turnBar(),
      enabled: () => ["fork", "join"].includes(ws.single()?.kind ?? ""),
    },
    {
      id: "toggleOffPage",
      label: "Region on Its Own Sheet",
      keys: "E Shift+O",
      run: () => app.edits.toggleOffPage(),
      enabled: singleState,
    },
    // Add
    ...(
      [
        "state",
        "transition",
        "straight",
        "initial",
        "final",
        "shallow-history",
        "deep-history",
        "fork",
        "join",
        "terminate",
      ] as const
    ).map((t): Command => ({
      id: `tool:${t}`,
      label: TOOL_NAMES[t],
      keys: TOOL_KEYS[t],
      run: () => app.pickTool(t as ToolId),
      enabled: hasDoc,
    })),
    { id: "addRegion", label: "Region", keys: "A R", run: () => app.edits.addRegionOrTool(), enabled: hasDoc },
    {
      id: "addBendPoint",
      label: "Bend Point",
      keys: "A V",
      run: () => app.edits.addBendPointToSelected(),
      enabled: singleTransition,
    },
    {
      id: "convertToS",
      label: "Convert to S Route",
      run: () => app.edits.convertToS(),
      enabled: () => app.edits.freeRoutesSelected().length > 0,
    },
    // View
    { id: "commandPalette", label: "Command Palette…", keys: "Ctrl+Shift+P", run: () => app.shell.openSearch(">") },
    {
      id: "toggleSidebar",
      label: "Explorer",
      keys: "N",
      run: () => app.shell.toggleSidebar(),
      checked: () => app.shell.sidebarShown(),
    },
    {
      id: "togglePanel",
      label: "Properties Panel",
      keys: "P",
      run: () => app.shell.togglePanel(),
      checked: () => app.shell.panelShown(),
    },
    { id: "panel:properties", label: "Properties", run: () => app.shell.showPanelTab("properties") },
    { id: "panel:project", label: "Project", run: () => app.shell.showPanelTab("project") },
    { id: "panel:simulator", label: "Simulator", run: () => app.shell.showPanelTab("simulator") },
    { id: "panel:code", label: "Code", run: () => app.shell.showPanelTab("code") },
    { id: "panel:settings", label: "Settings", run: () => app.shell.showPanelTab("settings") },
    { id: "fit", label: "Fit Sheet", keys: "Z F", run: () => app.canvas.fit(), enabled: hasDoc },
    { id: "zoomNormal", label: "Actual Size", keys: "Z N", run: () => app.canvas.zoomNormal(), enabled: hasDoc },
    {
      id: "uiZoomIn",
      label: "Zoom In",
      keys: "Ctrl++",
      run: () => app.settings.zoomIn(),
      enabled: () => app.settings.settings.zoom < ZOOM_MAX,
    },
    {
      id: "uiZoomOut",
      label: "Zoom Out",
      keys: "Ctrl+-",
      run: () => app.settings.zoomOut(),
      enabled: () => app.settings.settings.zoom > ZOOM_MIN,
    },
    {
      id: "uiZoomReset",
      label: "Reset Zoom",
      keys: "Ctrl+0",
      run: () => app.settings.zoomReset(),
      enabled: () => app.settings.settings.zoom !== 100,
    },
    { id: "panel:problems", label: "Problems", run: () => app.shell.showPanelTab("problems") },
    // Go
    {
      id: "enterSelected",
      label: "Open State",
      keys: "Enter",
      run: () => app.nav.enterSelected(),
      enabled: singleState,
    },
    { id: "goUp", label: "Up One Level", keys: "J A", run: () => app.nav.goUp(), enabled: notRoot },
    { id: "goRoot", label: "Root", keys: "J R", run: () => app.nav.goRoot(), enabled: notRoot },
    { id: "quickOpen", label: "Search…", keys: "Ctrl+P", run: () => app.shell.openSearch("") },
    { id: "gotoElement", label: "Go to Element in Machine…", run: () => app.shell.openSearch("@"), enabled: hasDoc },
    {
      id: "gotoElementAll",
      label: "Go to Element in All Machines…",
      run: () => app.shell.openSearch("#"),
      enabled: hasDoc,
    },
    {
      id: "nextTab",
      label: "Next Machine",
      keys: "Ctrl+Tab",
      run: () => ws.cycle(1),
      enabled: () => ws.sessions.length > 1,
    },
    {
      id: "prevTab",
      label: "Previous Machine",
      keys: "Ctrl+Shift+Tab",
      run: () => ws.cycle(-1),
      enabled: () => ws.sessions.length > 1,
    },
    // Run
    {
      id: "simStart",
      label: () => (ws.active?.sim ? "Restart Simulation" : "Start Simulation"),
      keys: "F5",
      run: () => app.sim.start(),
      enabled: hasDoc,
    },
    {
      id: "simStop",
      label: "Stop Simulation",
      keys: "Shift+F5",
      run: () => app.sim.stop(),
      enabled: () => ws.active?.sim !== undefined,
    },
    { id: "saveTrace", label: "Save Trace…", run: () => void app.sim.saveTrace(), enabled: hasSteps },
    { id: "copyTrace", label: "Copy Trace", run: () => void app.sim.copyTrace(), enabled: hasSteps },
    // Help
    {
      id: "about",
      label: `About uFSM ${UFSM_VERSION}`,
      run: () => app.shell.setStatus(`uFSM ${UFSM_VERSION} · GPL-3.0-or-later · github.com/jonasblixt/ufsm`),
    },
  ];
  const byId = new Map(list.map((c) => [c.id, c]));
  const get = (id: string): Command => {
    const c = byId.get(id);
    if (!c) throw new Error(`no command '${id}'`);
    return c;
  };
  const menu = (label: string, ids: string[]): Menu => ({
    label,
    items: ids.map((id): MenuEntry => (id === "-" ? "-" : get(id))),
  });
  const tools = (ts: string[]): string[] => ts.map((t) => `tool:${t}`);

  const menus: Menu[] = [
    menu("File", [
      "newModel",
      "openFile",
      "-",
      "save",
      "saveAs",
      "-",
      "generate",
      "generateTo",
      "-",
      "closeMachine",
      "-",
      "openSettings",
      "-",
      "exit",
    ]),
    menu("Edit", [
      ...["undo", "redo", "-", "cut", "copy", "paste", "deleteSelection", "-"],
      ...[
        "editName",
        "editTrigger",
        "addEntry",
        "addExit",
        "addTimer",
        "addGuard",
        "addAction",
        "-",
        "selectAll",
        "clearSelection",
      ],
    ]),
    menu("Add", [
      ...tools(["state", "transition", "straight"]),
      "addRegion",
      "-",
      ...tools(["initial", "final", "shallow-history", "deep-history", "fork", "join", "terminate"]),
      "-",
      "addBendPoint",
      "convertToS",
    ]),
    menu("View", [
      ...[
        "commandPalette",
        "-",
        "toggleSidebar",
        "togglePanel",
        "-",
        "panel:properties",
        "panel:project",
        "panel:simulator",
        "panel:code",
      ],
      ...[
        "panel:settings",
        "-",
        "fit",
        "zoomNormal",
        "-",
        "uiZoomIn",
        "uiZoomOut",
        "uiZoomReset",
        "-",
        "panel:problems",
      ],
    ]),
    menu("Go", [
      "enterSelected",
      "goUp",
      "goRoot",
      "-",
      "quickOpen",
      "gotoElement",
      "gotoElementAll",
      "-",
      "nextTab",
      "prevTab",
    ]),
    menu("Run", ["simStart", "simStop", "-", "saveTrace", "copyTrace"]),
    menu("Help", ["about"]),
  ];

  return { get, run: (id) => get(id).run(), menus };
}
