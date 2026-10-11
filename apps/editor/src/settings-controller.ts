// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Global settings (settings.json): the color theme (following the OS appearance when asked) and the UI zoom. Settings are read from the browser-storage copy at once, so the first paint has the
 * right colors, then from settings.json; every change is applied at once and saved.
 */
import type { App } from "./app";
import { cachedSettings, readSettings, systemPrefersDark, writeSettings } from "./platform";
import {
  parseSettings,
  serializeSettings,
  zoomStep,
  ZOOM_MAX,
  ZOOM_MIN,
  type Settings,
  type ThemeSetting,
} from "./settings";
import { resolveTheme, setCanvasTheme, type ResolvedTheme } from "./theme";

export interface SettingsController {
  readonly settings: Settings;
  readonly theme: ResolvedTheme;
  readonly systemDark: boolean;
  /** Where settings live (shown in the Settings tab); undefined until read. */
  readonly location: string | undefined;
  /** Problems reading settings.json and resolving the theme. */
  problems(): string[];
  load(): Promise<void>;
  /** A change in the Settings tab or the search: apply it at once and save. */
  setTheme(t: ThemeSetting): void;
  /** Zoom the UI to `percent` (View › Zoom In/Out, Ctrl++/-/0, the Settings tab) and save it; the canvas keeps its own zoom. */
  setZoom(percent: number): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  /** The UI zoom as a factor (the sashes scale their drags by it). */
  uiZoom(): number;
  /** The OS switched between dark and light. */
  onSystemDark(dark: boolean): void;
}

export function createSettingsController(app: App): SettingsController {
  let { settings, problems: settingsProblems } = parseSettings(cachedSettings());
  let location: string | undefined;
  let systemDark = systemPrefersDark();
  let theme!: ResolvedTheme;
  let themeProblems: string[] = [];

  /** Resolve the theme for the current settings and OS appearance, and apply it to the CSS and the canvas. */
  const applyTheme = (): void => {
    const r = resolveTheme(settings.theme, systemDark);
    theme = r.theme;
    themeProblems = r.problems;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.css)) root.style.setProperty(k, v);
    root.style.colorScheme = theme.appearance;
    root.dataset.theme = [theme.id, ...Object.values(theme.inputs)].join("-");
    setCanvasTheme(theme);
  };
  /** UI zoom: scale the title bar, explorer, tabs, breadcrumbs, panel and status bar (CSS `zoom: var(--ui-zoom)`). The
   * canvas is not inside any of them, so the diagram, its own zoom and pointer coordinates on it are unaffected. */
  const applyZoom = (): void => document.documentElement.style.setProperty("--ui-zoom", String(settings.zoom / 100));
  const save = (): void =>
    void writeSettings(serializeSettings(settings)).catch((e: unknown) =>
      app.ws.say(`Settings not saved: ${String(e)}`),
    );

  const setZoom = (percent: number): void => {
    const zoom = Math.min(Math.max(Math.round(percent), ZOOM_MIN), ZOOM_MAX);
    if (zoom === settings.zoom) {
      app.ws.say(`UI zoom ${zoom}%${zoom === ZOOM_MAX ? " (largest)" : zoom === ZOOM_MIN ? " (smallest)" : ""}`);
      return;
    }
    settings = { ...settings, zoom };
    applyZoom();
    app.ws.say(`UI zoom ${zoom}%`);
    app.ws.changed("shell");
    save();
  };

  applyTheme();
  applyZoom();

  return {
    get settings() {
      return settings;
    },
    get theme() {
      return theme;
    },
    get systemDark() {
      return systemDark;
    },
    get location() {
      return location;
    },
    problems: () => [...settingsProblems, ...themeProblems],
    load: async () => {
      try {
        const f = await readSettings();
        location = f.location;
        ({ settings, problems: settingsProblems } = parseSettings(f.text));
      } catch (e) {
        location = "settings.json could not be read";
        settingsProblems = [String(e)];
      }
      applyTheme();
      applyZoom();
      app.ws.changed("shell");
    },
    setTheme: (t) => {
      settings = { ...settings, theme: t };
      settingsProblems = [];
      applyTheme();
      app.ws.changed("shell");
      save();
    },
    setZoom,
    zoomIn: () => setZoom(zoomStep(settings.zoom, 1)),
    zoomOut: () => setZoom(zoomStep(settings.zoom, -1)),
    zoomReset: () => setZoom(100),
    uiZoom: () => settings.zoom / 100,
    onSystemDark: (dark) => {
      if (dark === systemDark) return;
      systemDark = dark;
      if (settings.theme.appearance !== "system") return;
      applyTheme();
      app.ws.changed("shell");
    },
  };
}
