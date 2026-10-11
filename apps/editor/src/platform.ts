// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Thin seam between the editor and the host. Inside Tauri we use native
 * dialogs and the fs plugin, which only reaches paths the user picked in a
 * dialog during this run; in a plain browser (`npm run dev:web`) we fall back
 * to <input type=file> and downloads, handy for quick UI work.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export interface OpenedFile {
  /** Full path in Tauri, bare file name in the browser. */
  path: string;
  name: string;
  text: string;
}

export const inTauri = "__TAURI_INTERNALS__" in window;

/** macOS keeps its own traffic-light window buttons (title bar style "Overlay"); elsewhere the window is frameless. */
export const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

/** True when the title bar has to draw minimize/maximize/close itself (frameless Tauri window on Windows and Linux). */
export const customWindowControls = inTauri && !isMac;

const FILTERS = [{ name: "uFSM model", extensions: ["ufsm"] }];

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export async function openModelFile(fileInput: HTMLInputElement): Promise<OpenedFile | undefined> {
  if (inTauri) {
    const picked = await open({ multiple: false, directory: false, filters: FILTERS });
    if (typeof picked !== "string") return undefined;
    const text = await readTextFile(picked);
    return { path: picked, name: baseName(picked), text };
  }

  return new Promise((resolve) => {
    fileInput.value = "";
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      resolve(file ? { path: file.name, name: file.name, text: await file.text() } : undefined);
    };
    fileInput.oncancel = () => resolve(undefined);
    fileInput.click();
  });
}

/**
 * The machines opened or saved last, most recent first (File › Open Recent). The desktop app keeps them in recent.json
 * next to settings.json; the browser build cannot reopen a file by name, so it has none.
 */
export async function recentFiles(): Promise<string[]> {
  return inTauri ? invoke<string[]>("recent_files") : [];
}

/** Put a machine opened or saved in a dialog this run first in the recent list. Returns the new list. */
export async function addRecent(path: string): Promise<string[]> {
  return inTauri ? invoke<string[]>("add_recent", { path }) : [];
}

/** Take a machine off the recent list, or clear it (no path). Returns the new list. */
export async function forgetRecent(path?: string): Promise<string[]> {
  return inTauri ? invoke<string[]>("forget_recent", { path: path ?? null }) : [];
}

/** Read a machine from the recent list; it can then be saved as if it had been picked in a dialog. Desktop only. */
export async function openRecentFile(path: string): Promise<OpenedFile> {
  const text = await invoke<string>("open_recent", { path });
  return { path, name: baseName(path), text };
}

/**
 * Write a model. With `path` the file is overwritten directly; without it the
 * user picks a destination (Save As). `make` builds the text once the path is
 * known (a new machine is named after its file); in a browser the file is
 * downloaded and `make` gets the suggested name. Returns the path written, or
 * undefined when the user cancelled.
 */
export async function saveModelFile(
  make: (path: string) => string,
  path: string | undefined,
  suggestedName: string,
): Promise<string | undefined> {
  if (inTauri) {
    const target = path ?? (await save({ defaultPath: suggestedName, filters: FILTERS }));
    if (!target) return undefined;
    await writeTextFile(target, make(target));
    return target;
  }
  // Browser: offer a download.
  download(make(suggestedName), suggestedName, "application/json");
  return suggestedName;
}

/** Browser fallback for writing a file: offer it as a download. */
function download(text: string, name: string, type = "text/plain"): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Save a text file the user places (Save As). `make` builds the text from the chosen path (a trace refers to its
 * model relative to itself); in a browser the file is downloaded and `make` gets the suggested name. Returns the
 * path written, or undefined when the user cancelled.
 */
export async function saveTextFile(
  suggestedName: string,
  filter: { name: string; extensions: string[] },
  make: (path: string) => string,
): Promise<string | undefined> {
  if (inTauri) {
    const target = await save({ defaultPath: suggestedName, filters: [filter] });
    if (!target) return undefined;
    await writeTextFile(target, make(target));
    return target;
  }
  download(make(suggestedName), suggestedName);
  return suggestedName;
}

/** Write several files into a folder the user picks (in a browser: one download each). Returns the folder, or undefined when cancelled. */
export async function saveFilesToFolder(files: readonly { name: string; text: string }[]): Promise<string | undefined> {
  if (inTauri) {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return undefined;
    const sep = dir.includes("\\") ? "\\" : "/";
    const base = dir.endsWith(sep) ? dir : dir + sep;
    for (const f of files) await writeTextFile(base + f.name, f.text);
    return dir;
  }
  for (const f of files) download(f.text, f.name);
  return "Downloads";
}

/** Offer every file as a download (the browser build's Generate). */
export function downloadFiles(files: readonly { name: string; text: string }[]): void {
  for (const f of files) download(f.text, f.name);
}

/** Let the user pick a folder, starting in `defaultPath`. Desktop only; undefined when cancelled. */
export async function pickFolder(defaultPath?: string): Promise<string | undefined> {
  const dir = await open({ directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
  return typeof dir === "string" ? dir : undefined;
}

/** What writing generated code did: written into `dir`, or nothing written because `dir` is outside the model's folder. */
export type GeneratedWrite = { kind: "written"; dir: string } | { kind: "outside"; dir: string };

/**
 * Write generated files into a model's output folder (desktop only): `out` relative to the folder of `modelPath` (a
 * file opened or saved in a dialog this run) or absolute. The shell refuses to overwrite a file uFSM did not
 * generate, and writes outside the model's folder only with `allowOutside`.
 */
export async function writeGenerated(
  modelPath: string,
  out: string,
  files: readonly { name: string; text: string }[],
  allowOutside: boolean,
): Promise<GeneratedWrite> {
  return invoke<GeneratedWrite>("write_generated", { model: modelPath, out, files, allowOutside });
}

/** Ask the user to confirm an action. Resolves true when they agree. */
export async function confirmAction(message: string, okLabel: string): Promise<boolean> {
  if (inTauri) return ask(message, { title: "uFSM", kind: "warning", okLabel, cancelLabel: "Cancel" });
  return window.confirm(message);
}

/** Put text on the system clipboard. Resolves false when the webview refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (inTauri) await getCurrentWindow().setTitle(title);
}

/** Ask before throwing work away. Resolves true when the user agrees. */
export async function confirmDiscard(message: string): Promise<boolean> {
  if (inTauri) return ask(message, { title: "uFSM", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" });
  return window.confirm(message);
}

/** Minimize, maximize/restore and close for the custom title bar. No-ops in a plain browser. */
export const windowControls = {
  minimize: async (): Promise<void> => {
    if (inTauri) await getCurrentWindow().minimize();
  },
  toggleMaximize: async (): Promise<void> => {
    if (inTauri) await getCurrentWindow().toggleMaximize();
  },
  /** Request a close; the close guard (onCloseRequested) still runs. */
  close: async (): Promise<void> => {
    if (inTauri) await getCurrentWindow().close();
  },
  isMaximized: async (): Promise<boolean> => (inTauri ? getCurrentWindow().isMaximized() : false),
  /** Call `cb` whenever the window is resized (maximized state may have changed). */
  onResized: (cb: () => void): void => {
    if (inTauri) void getCurrentWindow().onResized(cb);
  },
};

/**
 * Run `guard` when the user closes the window (title bar button, Alt+F4, Cmd+Q on the window); the window stays
 * open when it resolves false. In a browser the page's beforeunload prompt is used instead.
 */
export function onCloseRequested(guard: () => Promise<boolean>, dirty: () => boolean): void {
  if (inTauri) {
    void getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await guard())) e.preventDefault();
    });
    return;
  }
  window.addEventListener("beforeunload", (e) => {
    if (dirty()) e.preventDefault();
  });
}

// ---------------------------------------------------------------- settings and system appearance

const SETTINGS_KEY = "ufsm.settings";

/**
 * The settings text last read or written, from browser storage (synchronous, so the theme is right on the first
 * paint). In a browser this is the settings store itself; in the desktop app a copy of settings.json.
 */
export function cachedSettings(): string | undefined {
  try {
    return localStorage.getItem(SETTINGS_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function cacheSettings(text: string | undefined): void {
  try {
    if (text === undefined) localStorage.removeItem(SETTINGS_KEY);
    else localStorage.setItem(SETTINGS_KEY, text);
  } catch {
    // Best effort: without storage the first paint uses the default theme until settings.json is read.
  }
}

export interface SettingsFile {
  /** undefined when there is no settings file yet. */
  text: string | undefined;
  /** Where settings live, for the Settings tab: the file's path, or "browser storage". */
  location: string;
}

/** Read the settings (desktop: settings.json in the app's config folder; browser: browser storage). */
export async function readSettings(): Promise<SettingsFile> {
  if (inTauri) {
    const r = await invoke<{ path: string; contents: string | null }>("read_settings");
    const text = r.contents ?? undefined;
    cacheSettings(text);
    return { text, location: r.path };
  }
  return { text: cachedSettings(), location: "browser storage" };
}

/** Write the settings (the Rust side creates the config folder and replaces the file atomically). */
export async function writeSettings(text: string): Promise<void> {
  cacheSettings(text);
  if (inTauri) await invoke("write_settings", { contents: text });
}

const darkQuery = (): MediaQueryList | undefined =>
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;

/** Whether the OS asks for dark apps (the webview's prefers-color-scheme; dark when unknown). */
export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? true;
}

/** Call `cb` with the OS appearance whenever it changes (and once more in Tauri with the window's own answer). */
export function onSystemAppearance(cb: (dark: boolean) => void): void {
  darkQuery()?.addEventListener("change", (e) => cb(e.matches));
  if (inTauri) {
    // WebKitGTK does not always report prefers-color-scheme; the window's theme comes from the OS.
    const w = getCurrentWindow();
    void w
      .theme()
      .then((t) => t && cb(t === "dark"))
      .catch(() => undefined);
    void w.onThemeChanged(({ payload }) => cb(payload === "dark")).catch(() => undefined);
  }
}
