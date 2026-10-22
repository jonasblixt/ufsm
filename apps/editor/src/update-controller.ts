// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Updates in the window: runs the update flow (updates.ts) on the desktop app's updater (platform.ts), gives the title
 * bar its update button (right of the search field, as in VS Code), and asks about unsaved changes before restarting
 * into a new version. The Help menu and the Settings tab reach it through `app.updates`.
 */
import { type App } from "./app";
import { confirmDiscard, updateHost } from "./platform";
import type { UpdateButton } from "./titlebar";
import { realClock, updateButton, Updater, type UpdatePhase } from "./updates";

export interface UpdateController {
  readonly phase: UpdatePhase;
  /** The version running, once known. */
  readonly version: string | undefined;
  canCheck(): boolean;
  /** Help › Check for Updates. */
  check(): void;
  /** Restart into the downloaded version (title bar, Help › Restart to Update). */
  install(): void;
  /** The `updates` setting changed. */
  modeChanged(): void;
  /** The title bar's update button now, if the phase has one (the shell asks on every redraw). */
  button(): UpdateButton | undefined;
  /** Ask the updater what this build can do and schedule the first automatic check. */
  start(): void;
}

export function createUpdateController(app: App): UpdateController {
  const ws = app.ws;
  const updater = new Updater({
    host: updateHost,
    clock: realClock,
    mode: () => app.settings.settings.updates,
    changed: () => ws.changed("shell"),
    say: (message) => ws.say(message),
    confirmRestart: async () => {
      const dirty = ws.sessions.filter((d) => d.dirty);
      if (dirty.length === 0) return true;
      return confirmDiscard(
        `Unsaved changes in ${dirty.map((d) => d.fileName).join(", ")}. Restart to update and discard them?`,
      );
    },
  });

  return {
    get phase() {
      return updater.phase;
    },
    get version() {
      return updater.version;
    },
    canCheck: () => updater.canCheck() || updater.phase.kind === "unsupported",
    check: () => void updater.check(true),
    install: () => void updater.install(),
    modeChanged: () => updater.modeChanged(),
    button: () => {
      const item = updateButton(updater.phase);
      if (!item) return undefined;
      return {
        ...item,
        // while downloading or installing, a click shows the Settings tab's Updates section
        onClick: () => (item.install ? void updater.install() : app.shell.showPanelTab("settings")),
      };
    },
    start: () => void updater.start(),
  };
}
