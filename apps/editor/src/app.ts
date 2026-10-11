// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The parts of the editor and how they reach each other. main.ts creates them in this order and wires the workspace's
 * changes to the shell and the canvas; each part gets this object and looks its neighbours up when it needs them.
 *
 *   ws        the store: open machines, the active one, clipboard, status message (workspace.ts, no DOM)
 *   shell     the window around the canvas: title bar, tabs, explorer, breadcrumbs, panel, status bar (shell.ts)
 *   canvas    drawing, pan/zoom, coordinates (canvas/view.ts); `tools` is what the interaction is doing (canvas/state.ts)
 *   commands  every command once: menus, the command palette and the editor model's key actions use it (commands.ts)
 *   files     open, new, save, close (files.ts)
 *   nav       sheets, entering states, jumping to an element (navigation.ts)
 *   edits     structure edits on the selection: delete, clipboard, regions, bend points (edit-commands.ts)
 *   settings  settings.json, theme, UI zoom (settings-controller.ts)
 *   sim       the simulator and the Code tab (sim-controller.ts)
 *   search    the search field's rows and picks (search-items.ts)
 *   input     the pointer and modifiers of the event being handled (fsm/input.ts); `pickTool` arms a tool through
 *             the editor model (palette clicks, the Add menu)
 */
import type { CanvasState } from "./canvas/state";
import type { CanvasView } from "./canvas/view";
import type { Commands } from "./commands";
import type { EditCommands } from "./edit-commands";
import type { Files } from "./files";
import type { Navigation } from "./navigation";
import type { SearchController } from "./search-items";
import type { SettingsController } from "./settings-controller";
import type { Shell } from "./shell";
import type { SimController } from "./sim-controller";
import type { Workspace } from "./workspace";
import type { InputState } from "./fsm/input";
import type { ToolId } from "./palette";

export interface App {
  ws: Workspace;
  shell: Shell;
  canvas: CanvasView;
  tools: CanvasState;
  commands: Commands;
  files: Files;
  nav: Navigation;
  edits: EditCommands;
  settings: SettingsController;
  sim: SimController;
  search: SearchController;
  input: InputState;
  pickTool(tool: ToolId): void;
}

/** document.getElementById, or a clear error when the page lacks the element. */
export function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}
