// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Global editor settings, kept in `settings.json` (the app's config folder in the desktop app, browser storage in
 * `dev:web`). Reading never fails: anything unreadable becomes a default plus a problem to report, and keys this
 * version does not know are written back unchanged. No DOM.
 *
 * ```json
 * { "theme": { "name": "gruvbox", "appearance": "system", "contrast": "medium" }, "zoom": 125, "updates": "manual" }
 * ```
 *
 * `theme.name` picks a theme (a Design Tokens resolver), `appearance` is `system` (follow the OS), `dark` or
 * `light`, and every other string is an input for one of the theme's modifiers (gruvbox: `contrast`). `zoom` scales
 * the UI around the canvas (text and controls; the diagram keeps its own zoom) in percent, 50 to 300; left out at 100.
 * `updates` is `auto` (check for a new version at start and now and then, download it in the background and offer to
 * restart; left out) or `manual` (only Help › Check for Updates). `exportFrame` says whether File › Export SVG
 * includes the sheet's drawing frame and title block (`true`, left out) or only the diagram (`false`).
 */

export type Appearance = "dark" | "light";
export type AppearanceChoice = Appearance | "system";
/** How the desktop app looks for new versions (settings.json `updates`). */
export type UpdateMode = "auto" | "manual";

export interface ThemeSetting {
  name: string;
  appearance: AppearanceChoice;
  /** Modifier inputs other than appearance, e.g. `{ contrast: "hard" }`. Missing ones take the theme's default. */
  inputs: Readonly<Record<string, string>>;
}

export interface Settings {
  theme: ThemeSetting;
  /** UI zoom in percent (100 = normal size), ZOOM_MIN..ZOOM_MAX. Not the canvas. */
  zoom: number;
  /** Look for new versions by itself (`auto`) or only when asked (`manual`). */
  updates: UpdateMode;
  /** File › Export SVG includes the drawing frame and title block. */
  exportFrame: boolean;
  /** Top-level keys this version does not know, written back as they were. */
  other: Readonly<Record<string, unknown>>;
}

export const DEFAULT_THEME: ThemeSetting = { name: "gruvbox", appearance: "system", inputs: {} };

export function defaultSettings(): Settings {
  return { theme: { ...DEFAULT_THEME, inputs: {} }, zoom: 100, updates: "auto", exportFrame: true, other: {} };
}

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 300;
/** The steps Zoom In and Zoom Out go through (a browser's page zoom levels). */
export const ZOOM_STEPS: readonly number[] = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

/** The next zoom step above (`dir` 1) or below (-1) `zoom`; a value between steps goes to the nearer step that way. */
export function zoomStep(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom) ?? ZOOM_MIN;
}

const APPEARANCES: readonly string[] = ["system", "dark", "light"];
const UPDATE_MODES: readonly string[] = ["auto", "manual"];

export interface ParsedSettings {
  settings: Settings;
  problems: string[];
}

/** Read settings text (undefined: no file yet). */
export function parseSettings(text: string | undefined): ParsedSettings {
  const settings = defaultSettings();
  const problems: string[] = [];
  if (text === undefined || text.trim() === "") return { settings, problems };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    problems.push(`settings.json is not valid JSON (${(e as Error).message}); using defaults`);
    return { settings, problems };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    problems.push("settings.json must hold an object; using defaults");
    return { settings, problems };
  }
  const { theme, zoom, updates, exportFrame, ...other } = json as Record<string, unknown>;
  settings.other = other;
  if (exportFrame !== undefined) {
    if (typeof exportFrame === "boolean") settings.exportFrame = exportFrame;
    else problems.push("settings.json: exportFrame must be true or false; using true");
  }
  if (updates !== undefined) {
    if (typeof updates === "string" && UPDATE_MODES.includes(updates)) settings.updates = updates as UpdateMode;
    else problems.push(`settings.json: updates must be "auto" or "manual"; using "auto"`);
  }
  if (zoom !== undefined) {
    if (typeof zoom !== "number" || !Number.isFinite(zoom))
      problems.push("settings.json: zoom must be a number (percent); using 100");
    else {
      settings.zoom = Math.round(Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX));
      if (zoom < ZOOM_MIN || zoom > ZOOM_MAX)
        problems.push(`settings.json: zoom must be ${ZOOM_MIN} to ${ZOOM_MAX}; using ${settings.zoom}`);
    }
  }
  if (theme === undefined) return { settings, problems };
  if (typeof theme !== "object" || theme === null || Array.isArray(theme)) {
    problems.push("settings.json: theme must be an object; using the default theme");
    return { settings, problems };
  }
  const inputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme)) {
    if (k === "name") {
      if (typeof v === "string" && v !== "") settings.theme.name = v;
      else problems.push("settings.json: theme.name must be a non-empty string");
    } else if (k === "appearance") {
      if (typeof v === "string" && APPEARANCES.includes(v)) settings.theme.appearance = v as AppearanceChoice;
      else problems.push(`settings.json: theme.appearance must be "system", "dark" or "light"`);
    } else if (typeof v === "string") inputs[k] = v;
    else problems.push(`settings.json: theme.${k} must be a string`);
  }
  settings.theme.inputs = inputs;
  return { settings, problems };
}

/**
 * The canonical text: two-space indent, theme first, then zoom unless it is 100, updates unless they are automatic,
 * exportFrame unless it is true, a final newline.
 */
export function serializeSettings(s: Settings): string {
  const theme = { name: s.theme.name, appearance: s.theme.appearance, ...s.theme.inputs };
  const zoom = s.zoom === 100 ? {} : { zoom: s.zoom };
  const updates = s.updates === "auto" ? {} : { updates: s.updates };
  const exportFrame = s.exportFrame ? {} : { exportFrame: false };
  return `${JSON.stringify({ theme, ...zoom, ...updates, ...exportFrame, ...s.other }, null, 2)}\n`;
}

/** The appearance to use now. */
export function effectiveAppearance(choice: AppearanceChoice, systemDark: boolean): Appearance {
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}
