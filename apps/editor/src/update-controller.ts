// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Updates in the window: runs the update flow (updates.ts) on the desktop app's updater (platform.ts), shows it in the
 * status bar's update item, and asks about unsaved changes before restarting into a new version. The Help menu and
 * the Settings tab reach it through `app.updates`.
 */
import { el, type App } from "./app";
import { confirmDiscard, updateHost } from "./platform";
import { realClock, statusItem, Updater, type UpdatePhase } from "./updates";

export interface UpdateController {
  readonly phase: UpdatePhase;
  /** The version running, once known. */
  readonly version: string | undefined;
  canCheck(): boolean;
  /** Help › Check for Updates. */
  check(): void;
  /** Restart into the downloaded version (status bar, Help › Restart to Update). */
  install(): void;
  /** The `updates` setting changed. */
  modeChanged(): void;
  /** Draw the status bar's update item (the shell calls it on every redraw). */
  updateStatus(): void;
  /** Ask the updater what this build can do and schedule the first automatic check. */
  start(): void;
}

export function createUpdateController(app: App): UpdateController {
  const ws = app.ws;
  const statusEl = el<HTMLButtonElement>("update-status");
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
  statusEl.addEventListener("click", () => {
    if (updater.phase.kind === "ready") void updater.install();
    else app.shell.showPanelTab("settings");
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
    updateStatus: () => {
      const item = statusItem(updater.phase);
      statusEl.hidden = !item;
      if (!item) return;
      statusEl.textContent = item.text;
      statusEl.title = item.title;
      statusEl.classList.toggle("ready", item.install);
    },
    start: () => void updater.start(),
  };
}
