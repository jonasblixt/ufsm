// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The editor model's key actions: most run the command of the same name (commands.ts), so a key is followed from
 * fsm/KEYMAP.md to its command with one search; the rest show the hint of a key mode (`z`, `j`, `a`, `e`) or are
 * guards on the selection and the modifiers.
 */
import type { App } from "../app";
import type { EditorFsmHandler } from "../fsm/editor-fsm";
import type { InputState } from "../fsm/input";

/** Editor model actions that are commands of the same name. */
const COMMAND_ACTIONS = [
  "openFile",
  "newModel",
  "save",
  "saveAs",
  "toggleSidebar",
  "togglePanel",
  "nextTab",
  "prevTab",
  "selectAll",
  "enterSelected",
  "goUp",
  "goRoot",
  "clearSelection",
  "fit",
  "zoomNormal",
  "uiZoomIn",
  "uiZoomOut",
  "uiZoomReset",
  "quickOpen",
  "commandPalette",
  "undo",
  "redo",
  "addRegion",
  "addBendPoint",
  "deleteSelection",
  "copy",
  "cut",
  "paste",
  "editName",
  "editTrigger",
  "addEntry",
  "addExit",
  "addGuard",
  "addAction",
  "turnBar",
  "toggleOffPage",
  "simStart",
  "simStop",
] as const satisfies readonly (keyof EditorFsmHandler)[];

const HINTS = {
  zoom: "z: f fit sheet · n 100% · Esc cancel",
  jump: "j: a up one level · r root · Esc cancel",
  edit: "e: n name · t trigger · r turn fork/join · O region on its own sheet · Esc cancel",
  add: "a: s state · t S transition · l straight transition · r region · i initial · f final · h history · H deep history · F fork · j join · T terminate · v bend point · e entry · x exit · g guard · a action · Esc cancel",
};

export function keyActions(app: App, input: InputState) {
  const commands = Object.fromEntries(COMMAND_ACTIONS.map((id) => [id, () => app.commands.run(id)])) as Record<(typeof COMMAND_ACTIONS)[number], () => void>;
  const hint = (text: string) => (): void => app.shell.setStatus(text);
  return {
    ...commands,
    closePanels: () => undefined,
    hintZoom: hint(HINTS.zoom),
    hintJump: hint(HINTS.jump),
    hintAdd: hint(HINTS.add),
    hintEdit: hint(HINTS.edit),
    hintClear: () => app.ws.changed("chrome"),
    ctrl: () => input.ctrl,
    shift: () => input.shift,
    singleState: () => app.ws.single()?.kind === "state",
    singleTransition: () => app.ws.singleTransition() !== undefined,
    singleBar: () => {
      const v = app.ws.single();
      return v?.kind === "fork" || v?.kind === "join";
    },
  } satisfies Partial<EditorFsmHandler>;
}
