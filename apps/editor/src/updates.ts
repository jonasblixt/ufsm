// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Updates of the desktop app, after VS Code: with `updates: "auto"` (the default) the app looks for a newer release a
 * little after it starts and then every few hours, downloads it in the background and offers "Restart to Update" in
 * the status bar and the Help menu; with `"manual"` it only looks when asked (Help › Check for Updates). Installing
 * asks about unsaved changes first, like quitting.
 *
 * No DOM: the host (platform.ts through update-controller.ts, or a fake in the tests) does the work, a clock schedules
 * the checks, and every change of the phase is announced through `changed`.
 */
import type { UpdateMode } from "./settings";

/** What the running app can do about updates (the Rust shell's `update_support`). */
export interface UpdateSupport {
  /** The build carries the key update packages are signed with (release builds from CI do). */
  configured: boolean;
  /** A debug build (`npm run dev`): no checks by itself, only when asked. */
  development: boolean;
  /** The version running. */
  version: string;
}

/** A newer release. */
export interface UpdateInfo {
  version: string;
  notes?: string | null;
}

/** What the updater needs from the app's host. */
export interface UpdateHost {
  /** undefined: this build cannot update itself at all (the browser build). */
  support(): Promise<UpdateSupport | undefined>;
  /** A newer release, or undefined when this one is the newest. */
  check(): Promise<UpdateInfo | undefined>;
  /** Download and verify the release the last check found. */
  download(progress: (downloaded: number, total: number | undefined) => void): Promise<void>;
  /** Install the downloaded release and restart (on success the app goes away). */
  install(): Promise<void>;
}

export type UpdatePhase =
  /** This build cannot update itself: `reason` says why. */
  | { kind: "unsupported"; reason: string }
  /** Not looked yet in this run. */
  | { kind: "idle" }
  | { kind: "checking"; manual: boolean }
  /** The newest release is running (as of `checked`). */
  | { kind: "current"; checked: Date }
  | { kind: "downloading"; version: string; notes?: string; downloaded: number; total?: number }
  /** Downloaded and verified: restart to install it. */
  | { kind: "ready"; version: string; notes?: string }
  | { kind: "installing"; version: string }
  /** The last check, download or install failed (`checked`: when). */
  | { kind: "failed"; message: string; checked: Date };

/** The first automatic check, this long after the app started (the window is up and settings are read by then). */
export const FIRST_CHECK_DELAY_MS = 10_000;
/** Then every this often while the app runs. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface Clock {
  now(): Date;
  /** Run `fn` after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => new Date(),
  after: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export interface UpdaterDeps {
  host: UpdateHost;
  clock: Clock;
  /** The `updates` setting now (it can change while the app runs). */
  mode(): UpdateMode;
  /** The phase changed (redraw the status bar, the Help menu and the Settings tab). */
  changed(): void;
  /** Tell the user something (the status line): only for what they asked for, never for a background check. */
  say(message: string): void;
  /** Before installing: unsaved changes are lost on restart. Resolves false to keep the app running. */
  confirmRestart(): Promise<boolean>;
}

/** The version as shown: `0.9.0`, never `v0.9.0`. */
export const plainVersion = (v: string): string => v.replace(/^v/, "");

export function percent(downloaded: number, total: number | undefined): number | undefined {
  if (total === undefined || total <= 0) return undefined;
  return Math.min(100, Math.floor((downloaded / total) * 100));
}

/** `1.2 MB`, `640 kB`. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** An error from the host as one line ("Error: x" -> "x"). */
export function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return (
    text
      .replace(/^Error:\s*/, "")
      .split("\n")[0]!
      .trim() || "unknown error"
  );
}

const time = (d: Date): string => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** One line for the Settings tab. */
export function phaseText(p: UpdatePhase): string {
  switch (p.kind) {
    case "unsupported":
      return p.reason;
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking for updates…";
    case "current":
      return `Up to date (checked ${time(p.checked)}).`;
    case "downloading": {
      const pc = percent(p.downloaded, p.total);
      return `Downloading uFSM ${p.version}… ${pc === undefined ? sizeText(p.downloaded) : `${pc}%`}`;
    }
    case "ready":
      return `uFSM ${p.version} is ready. Restart to update.`;
    case "installing":
      return `Installing uFSM ${p.version}…`;
    case "failed":
      return `Update failed at ${time(p.checked)}: ${p.message}`;
  }
}

/** The status bar's update item, when there is something to show: what it says and whether a click installs. */
export function statusItem(p: UpdatePhase): { text: string; title: string; install: boolean } | undefined {
  switch (p.kind) {
    case "downloading": {
      const pc = percent(p.downloaded, p.total);
      return {
        text: `Downloading update${pc === undefined ? "" : ` ${pc}%`}`,
        title: `Downloading uFSM ${p.version} in the background`,
        install: false,
      };
    }
    case "ready":
      return {
        text: "Restart to Update",
        title: `uFSM ${p.version} is downloaded. Click to restart into it.${p.notes ? `\n\n${p.notes}` : ""}`,
        install: true,
      };
    case "installing":
      return { text: `Installing ${p.version}…`, title: `Installing uFSM ${p.version}`, install: false };
    default:
      return undefined;
  }
}

/** The update flow of one run of the app. */
export class Updater {
  private current: UpdatePhase = { kind: "idle" };
  private support: UpdateSupport | undefined;
  private cancelTimer: (() => void) | undefined;

  constructor(private readonly deps: UpdaterDeps) {}

  get phase(): UpdatePhase {
    return this.current;
  }

  /** The version running (undefined until `start` has asked the host). */
  get version(): string | undefined {
    return this.support?.version;
  }

  /** Whether Check for Updates can run now. */
  canCheck(): boolean {
    const k = this.current.kind;
    return k === "idle" || k === "current" || k === "failed";
  }

  /** Ask the host what this build can do and schedule the first automatic check. */
  async start(): Promise<void> {
    try {
      this.support = await this.deps.host.support();
    } catch (e) {
      this.set({ kind: "unsupported", reason: `Updates are not available: ${errorText(e)}` });
      return;
    }
    if (!this.support) {
      this.set({ kind: "unsupported", reason: "The browser build does not update itself." });
      return;
    }
    if (!this.support.configured) {
      this.set({
        kind: "unsupported",
        reason: "This build cannot update itself (it was built without the update key).",
      });
      return;
    }
    this.schedule(FIRST_CHECK_DELAY_MS);
  }

  /** The `updates` setting changed: automatic checks start or stop. */
  modeChanged(): void {
    if (this.deps.mode() === "auto" && this.canCheck()) this.schedule(FIRST_CHECK_DELAY_MS);
    else this.unschedule();
  }

  /** Look for a newer release now; found, it is downloaded. `manual` (Help › Check for Updates) reports the outcome. */
  async check(manual: boolean): Promise<void> {
    const p = this.current;
    if (p.kind === "unsupported") {
      if (manual) this.deps.say(p.reason);
      return;
    }
    if (p.kind === "ready") {
      if (manual) this.deps.say(`uFSM ${p.version} is ready: Help › Restart to Update.`);
      return;
    }
    // Not started yet (the host has not said what this build can do), or a check or download is running.
    if (!this.support || !this.canCheck()) return;
    this.unschedule();
    this.set({ kind: "checking", manual });
    let found: UpdateInfo | undefined;
    try {
      found = await this.deps.host.check();
    } catch (e) {
      this.fail(`could not check for updates: ${errorText(e)}`, manual);
      return;
    }
    if (!found) {
      this.set({ kind: "current", checked: this.deps.clock.now() });
      if (manual) this.deps.say(`uFSM ${this.support.version} is the newest version.`);
      this.scheduleNext();
      return;
    }
    await this.download(found, manual);
  }

  private async download(found: UpdateInfo, manual: boolean): Promise<void> {
    const version = plainVersion(found.version);
    const notes = found.notes?.trim() || undefined;
    const base = { kind: "downloading" as const, version, ...(notes ? { notes } : {}) };
    this.set({ ...base, downloaded: 0 });
    if (manual) this.deps.say(`Downloading uFSM ${version}…`);
    try {
      await this.deps.host.download((downloaded, total) => {
        this.set({ ...base, downloaded, ...(total === undefined ? {} : { total }) });
      });
    } catch (e) {
      this.fail(`could not download uFSM ${version}: ${errorText(e)}`, manual);
      return;
    }
    this.set({ kind: "ready", version, ...(notes ? { notes } : {}) });
    if (manual) this.deps.say(`uFSM ${version} is ready: restart to update (status bar or Help menu).`);
  }

  /** Restart into the downloaded release (asks about unsaved changes first). */
  async install(): Promise<void> {
    const p = this.current;
    if (p.kind !== "ready") return;
    if (!(await this.deps.confirmRestart())) return;
    this.set({ kind: "installing", version: p.version });
    try {
      await this.deps.host.install();
    } catch (e) {
      // The app keeps running; checking again finds the release again.
      this.fail(`could not install uFSM ${p.version}: ${errorText(e)}`, true);
    }
  }

  private fail(message: string, manual: boolean): void {
    this.set({ kind: "failed", message, checked: this.deps.clock.now() });
    if (manual) this.deps.say(`Update ${message}`);
    this.scheduleNext();
  }

  private set(p: UpdatePhase): void {
    this.current = p;
    this.deps.changed();
  }

  private scheduleNext(): void {
    this.schedule(CHECK_INTERVAL_MS);
  }

  /** An automatic check after `ms`, when the setting asks for them and this is not a development build. */
  private schedule(ms: number): void {
    this.unschedule();
    if (this.deps.mode() !== "auto" || !this.support?.configured || this.support.development) return;
    this.cancelTimer = this.deps.clock.after(ms, () => {
      this.cancelTimer = undefined;
      if (this.deps.mode() === "auto") void this.check(false);
    });
  }

  private unschedule(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
}
