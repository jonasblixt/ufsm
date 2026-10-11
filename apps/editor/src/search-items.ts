// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * What the search field (Ctrl+P, Ctrl+Shift+P) can find: elements of every open machine (the focused one first), the
 * machines, every enabled command, the settings and the focused machine's Project settings; and what picking or
 * highlighting a row does. Ranking is search.ts.
 */
import {
  OPTION_DEFAULTS,
  PAPER_SIZES,
  TITLE_BLOCK_FIELDS,
  selectedTarget,
  targetOut,
  type DocIndex,
  type Paper,
} from "@ufsm/core";
import { setPaper } from "@ufsm/core/edit";
import type { App } from "./app";
import { API_OPTION_INFO, MODEL_OPTIONS, TARGETS, TITLE_FIELD_LABELS, TITLE_FIELD_NAMES } from "./panel";
import { elementItems, helpItems, menuCommands, remember, type SearchItem } from "./search";
import type { DocSession } from "./session";
import { ZOOM_STEPS, type AppearanceChoice, type ThemeSetting } from "./settings";
import { FALLBACK_THEME, THEMES, findTheme, modifierHasEffect, themeInfo } from "./theme";

export interface SearchController {
  /** Everything the search field can find now. */
  items(): SearchItem[];
  /** Keys of recently picked rows, most recent first. */
  recent(): readonly string[];
  onPick(it: SearchItem): void;
  onPreview(it: SearchItem | undefined): void;
}

const RECENT_KEY = "ufsm.searchRecent";
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function createSearch(app: App): SearchController {
  const ws = app.ws;
  /** Remembered per browser profile, best effort. */
  let recentPicks: readonly string[] = ((): string[] => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  })();

  /** A machine's search rows, built again when an edit gives it a new index (or a save renames it). */
  const elementCache = new WeakMap<DocIndex, { key: number; name: string; items: SearchItem[] }>();
  const docElements = (d: DocSession): SearchItem[] => {
    const c = elementCache.get(d.index);
    if (c && c.key === d.key && c.name === d.fileName) return c.items;
    const items = elementItems(d.index, d.key, d.fileName);
    elementCache.set(d.index, { key: d.key, name: d.fileName, items });
    return items;
  };

  /** Global settings (settings.json) as search rows: color theme, appearance, the theme's other options, UI zoom. */
  const settingItems = (): SearchItem[] => {
    const { settings, theme } = app.settings;
    const t = settings.theme;
    const entry = findTheme(t.name) ?? FALLBACK_THEME;
    const info = themeInfo(entry);
    const themeRow = (
      key: string,
      label: string,
      next: ThemeSetting,
      checked: boolean,
      keywords: string,
    ): SearchItem => ({
      key,
      kind: "setting",
      label,
      checked,
      keywords,
      run: () => app.settings.setTheme(next),
      preview: () => app.settings.previewTheme(next),
    });
    const out: SearchItem[] = THEMES.map((x) =>
      themeRow(
        `set:theme:${x.id}`,
        `Preferences: Color Theme: ${themeInfo(x).name ?? x.id}`,
        { ...t, name: x.id, inputs: {} },
        x.id === entry.id,
        "colour scheme palette",
      ),
    );
    if (info.modifiers.some((m) => m.name === "appearance")) {
      const choices: [AppearanceChoice, string, string][] = [
        ["system", "System", "follow the operating system dark light mode"],
        ["dark", "Dark", "dark mode"],
        ["light", "Light", "light mode"],
      ];
      for (const [a, text, words] of choices)
        out.push(
          themeRow(
            `set:appearance:${a}`,
            `Preferences: Appearance: ${text}`,
            { ...t, appearance: a },
            t.appearance === a,
            words,
          ),
        );
    }
    for (const m of info.modifiers) {
      if (m.name === "appearance" || !modifierHasEffect(entry, theme.inputs, m.name)) continue;
      const now = theme.inputs[m.name] ?? m.default;
      for (const c of m.contexts) {
        out.push(
          themeRow(
            `set:${entry.id}:${m.name}:${c}`,
            `Preferences: ${capital(m.name)}: ${capital(c)}`,
            { ...t, inputs: { ...t.inputs, [m.name]: c } },
            c === now,
            `${info.name ?? entry.id} theme`,
          ),
        );
      }
    }
    for (const z of ZOOM_STEPS) {
      out.push({
        key: `set:zoom:${z}`,
        kind: "setting",
        label: `Preferences: UI Zoom: ${z}%`,
        checked: settings.zoom === z,
        keywords: "interface text size scale",
        run: () => app.settings.setZoom(z),
      });
    }
    out.push({
      key: "set:open",
      kind: "setting",
      label: "Preferences: Open Settings",
      keywords: "settings.json",
      run: () => app.shell.showPanelTab("settings"),
    });
    return out;
  };

  /** The focused machine's file-level settings (the Project tab): paper, name, description, options, generator settings. */
  const projectItems = (d: DocSession): SearchItem[] => {
    const x = d.index.doc;
    const field = (label: string) => (): void => app.shell.focusProjectField(label);
    const paper = x.diagram?.paper ?? "A4";
    const out: SearchItem[] = (Object.keys(PAPER_SIZES) as Paper[]).map((p) => ({
      key: `proj:paper:${p}`,
      kind: "setting",
      label: `Project: Paper Size: ${p}`,
      detail: `${PAPER_SIZES[p].w} × ${PAPER_SIZES[p].h}`,
      checked: p === paper,
      keywords: "sheet",
      run: () => ws.edit((y) => setPaper(y, p)),
    }));
    out.push({
      key: "proj:name",
      kind: "setting",
      label: "Project: Machine Name",
      detail: x.name,
      keywords: "rename",
      run: field("Machine name"),
    });
    out.push({
      key: "proj:description",
      kind: "setting",
      label: "Project: Description",
      detail: x.doc ?? "",
      keywords: "documentation",
      run: field("Description"),
    });
    for (const k of TITLE_BLOCK_FIELDS) {
      out.push({
        key: `proj:title:${k}`,
        kind: "setting",
        label: `Project: Title Block: ${TITLE_FIELD_NAMES[k]}`,
        detail: x.diagram?.titleBlock?.[k] ?? "",
        keywords: "title block sheet frame",
        run: field(TITLE_FIELD_LABELS[k]),
      });
    }
    for (const o of MODEL_OPTIONS) {
      const detail =
        x.options?.[o.key] !== undefined ? String(x.options[o.key]) : `${OPTION_DEFAULTS[o.key]} (default)`;
      out.push({
        key: `proj:options:${o.key}`,
        kind: "setting",
        label: `Project: Behaviour: ${o.label}`,
        detail,
        keywords: "generator simulator option",
        run: field(o.label),
      });
    }
    // The code generator: only the selected language's settings are shown, so only they are found.
    const target = selectedTarget(x);
    const t = TARGETS.find((y) => y.key === target) ?? TARGETS[0]!;
    const set = x.targets?.[target] ?? {};
    out.push({
      key: "proj:generator:language",
      kind: "setting",
      label: "Project: Code Generator: Language",
      detail: t.title,
      keywords: "generator target c python typescript rust go golang c++ cpp",
      run: field("Language"),
    });
    out.push({
      key: "proj:generator:out",
      kind: "setting",
      label: "Project: Code Generator: Output Folder",
      detail: targetOut(x, target) ?? "not set",
      keywords: "generator output directory path",
      run: field("Output folder"),
    });
    for (const o of t.options) {
      out.push({
        key: `proj:${t.key}:${o.key}`,
        kind: "setting",
        label: `Project: Code Generator: ${t.title} ${o.label}`,
        detail: o.key in set ? String(set[o.key]) : `${o.fallback(x.name, set)} (default)`,
        keywords: "generator target option",
        run: field(`${t.title} ${o.label}`),
      });
    }
    for (const o of API_OPTION_INFO) {
      const detail = x.options?.[o.key] === true ? "on" : "off (default)";
      out.push({
        key: `proj:options:${o.key}`,
        kind: "setting",
        label: `Project: Code Generator: ${o.label}`,
        detail,
        keywords: "generator option debug trace",
        run: field(o.label),
      });
    }
    return out;
  };

  return {
    items: () => {
      const active = ws.active;
      const opensSearch = (menu: string, label: string): boolean =>
        (menu === "File" && label === "Settings") || /^(Search|Command Palette|Go to Element)/.test(label);
      return [
        ...(active ? docElements(active) : []),
        ...ws.sessions.filter((d) => d !== active).flatMap(docElements),
        ...ws.sessions.map((d): SearchItem => ({
          key: `machine:${d.fileName}`,
          kind: "machine",
          label: d.fileName,
          detail: d.path ?? (d.untitled ? "not saved yet" : d.index.doc.name),
          doc: d.key,
          docName: d.fileName,
          run: () => ws.activate(d),
        })),
        ...menuCommands(app.commands.menus, opensSearch),
        ...settingItems(),
        ...(active ? projectItems(active) : []),
        ...helpItems(active?.fileName),
      ];
    },
    recent: () => recentPicks,
    onPick: (it) => {
      app.settings.endPreview();
      recentPicks = remember(recentPicks, it.key);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(recentPicks));
      } catch {
        // storage unavailable (private window): remembered for this run only
      }
      if (it.run) it.run();
      else if (it.id !== undefined) {
        const d = ws.byKey(it.doc);
        if (d) {
          ws.activate(d);
          app.nav.revealElement(it.id);
        }
      }
    },
    onPreview: (it) => {
      if (it?.preview) it.preview();
      else app.settings.endPreview();
    },
  };
}
