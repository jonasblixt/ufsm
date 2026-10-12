// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Color themes. A theme is a Design Tokens resolver (`themes/<name>/<name>.resolver.json`, see tokens.ts) whose base
 * set includes `themes/ui.tokens.json`, the editor's token names. A modifier called `appearance` with contexts
 * `dark` and `light` follows the OS when the setting is "system"; other modifiers (gruvbox: contrast) are offered as
 * options. Resolving gives CSS custom properties (applied by main.ts) and the canvas colors in `C` (read by the
 * renderer on every draw). No DOM.
 */
import { effectiveAppearance, type Appearance, type ThemeSetting } from "./settings";
import {
  cssColor,
  luminance,
  parseColor,
  resolveTokens,
  resolverInfo,
  TokenError,
  withAlpha,
  type ResolverInfo,
  type Rgba,
  type Token,
  type TokenFiles,
} from "./tokens";
import uiTokens from "./themes/ui.tokens.json";
import gruvboxResolver from "./themes/gruvbox/gruvbox.resolver.json";
import gruvboxPalette from "./themes/gruvbox/gruvbox.tokens.json";
import gruvboxDark from "./themes/gruvbox/dark.tokens.json";
import gruvboxLight from "./themes/gruvbox/light.tokens.json";
import gruvboxHard from "./themes/gruvbox/hard.tokens.json";
import gruvboxMedium from "./themes/gruvbox/medium.tokens.json";
import gruvboxSoft from "./themes/gruvbox/soft.tokens.json";
import catppuccinResolver from "./themes/catppuccin/catppuccin.resolver.json";
import catppuccinPalette from "./themes/catppuccin/catppuccin.tokens.json";
import catppuccinRoles from "./themes/catppuccin/roles.tokens.json";
import catppuccinDark from "./themes/catppuccin/dark.tokens.json";
import catppuccinLatte from "./themes/catppuccin/latte.tokens.json";
import catppuccinFrappe from "./themes/catppuccin/frappe.tokens.json";
import catppuccinMacchiato from "./themes/catppuccin/macchiato.tokens.json";
import catppuccinMocha from "./themes/catppuccin/mocha.tokens.json";
import everforestResolver from "./themes/everforest/everforest.resolver.json";
import everforestPalette from "./themes/everforest/everforest.tokens.json";
import everforestRoles from "./themes/everforest/roles.tokens.json";
import everforestDark from "./themes/everforest/dark.tokens.json";
import everforestLight from "./themes/everforest/light.tokens.json";
import everforestHard from "./themes/everforest/hard.tokens.json";
import everforestMedium from "./themes/everforest/medium.tokens.json";
import everforestSoft from "./themes/everforest/soft.tokens.json";
import solarizedResolver from "./themes/solarized/solarized.resolver.json";
import solarizedPalette from "./themes/solarized/solarized.tokens.json";
import solarizedRoles from "./themes/solarized/roles.tokens.json";
import solarizedDark from "./themes/solarized/dark.tokens.json";
import solarizedLight from "./themes/solarized/light.tokens.json";

/** The theme files bundled with the editor, by path relative to `themes/`. */
export const THEME_FILES: TokenFiles = {
  "ui.tokens.json": uiTokens,
  "gruvbox/gruvbox.resolver.json": gruvboxResolver,
  "gruvbox/gruvbox.tokens.json": gruvboxPalette,
  "gruvbox/dark.tokens.json": gruvboxDark,
  "gruvbox/light.tokens.json": gruvboxLight,
  "gruvbox/hard.tokens.json": gruvboxHard,
  "gruvbox/medium.tokens.json": gruvboxMedium,
  "gruvbox/soft.tokens.json": gruvboxSoft,
  "catppuccin/catppuccin.resolver.json": catppuccinResolver,
  "catppuccin/catppuccin.tokens.json": catppuccinPalette,
  "catppuccin/roles.tokens.json": catppuccinRoles,
  "catppuccin/dark.tokens.json": catppuccinDark,
  "catppuccin/latte.tokens.json": catppuccinLatte,
  "catppuccin/frappe.tokens.json": catppuccinFrappe,
  "catppuccin/macchiato.tokens.json": catppuccinMacchiato,
  "catppuccin/mocha.tokens.json": catppuccinMocha,
  "everforest/everforest.resolver.json": everforestResolver,
  "everforest/everforest.tokens.json": everforestPalette,
  "everforest/roles.tokens.json": everforestRoles,
  "everforest/dark.tokens.json": everforestDark,
  "everforest/light.tokens.json": everforestLight,
  "everforest/hard.tokens.json": everforestHard,
  "everforest/medium.tokens.json": everforestMedium,
  "everforest/soft.tokens.json": everforestSoft,
  "solarized/solarized.resolver.json": solarizedResolver,
  "solarized/solarized.tokens.json": solarizedPalette,
  "solarized/roles.tokens.json": solarizedRoles,
  "solarized/dark.tokens.json": solarizedDark,
  "solarized/light.tokens.json": solarizedLight,
};

export interface ThemeEntry {
  /** What `theme.name` in settings.json says. */
  id: string;
  resolver: string;
}

/** Bundled themes, in the order the Settings tab lists them. */
export const THEMES: readonly ThemeEntry[] = ["catppuccin", "everforest", "gruvbox", "solarized"].map((id) => ({
  id,
  resolver: `${id}/${id}.resolver.json`,
}));

/** The theme used when settings.json names one that does not exist (and the default, see settings.ts). */
export const FALLBACK_THEME: ThemeEntry = THEMES.find((t) => t.id === "gruvbox")!;

const APPEARANCE = "appearance";

/** Diagram colors as CSS text (`canvas.*` tokens, kebab-case names camel-cased). */
export interface CanvasColors {
  background: string;
  paper: string;
  grid: string;
  stateFill: string;
  ink: string;
  selection: string;
  touching: string;
  ok: string;
  refuse: string;
  warning: string;
  badgeMark: string;
  active: string;
  would: string;
  note: string;
  todo: string;
}

export type CanvasColor = keyof CanvasColors;

const CANVAS_KEYS: readonly CanvasColor[] = [
  "background",
  "paper",
  "grid",
  "stateFill",
  "ink",
  "selection",
  "touching",
  "ok",
  "refuse",
  "warning",
  "badgeMark",
  "active",
  "would",
  "note",
  "todo",
];

/** CSS custom properties every theme must produce (style.css uses them). */
export const CSS_COLORS: readonly string[] = [
  "bg",
  "bg0",
  "bg1",
  "bg2",
  "bg-dark",
  "fg",
  "fg4",
  "gray",
  "red",
  "green",
  "yellow",
  "blue",
  "purple",
  "aqua",
  "orange",
  "chrome",
  "card",
  "card-edge",
  "shadow",
  "close-hover",
  "close-hover-fg",
];

/** Colors shown as a strip in the Settings tab. */
const SWATCHES: readonly string[] = [
  "ui.chrome",
  "ui.card",
  "ui.bg-dark",
  "ui.fg",
  "ui.red",
  "ui.green",
  "ui.yellow",
  "ui.blue",
  "ui.purple",
  "ui.aqua",
  "ui.orange",
];

export interface ResolvedTheme {
  id: string;
  name: string;
  appearance: Appearance;
  /** Every modifier's context, as resolved (appearance included). */
  inputs: Readonly<Record<string, string>>;
  /** `--name` -> CSS color, plus `--name-rgb` -> "r g b" for `ui.*`. */
  css: Readonly<Record<string, string>>;
  canvas: CanvasColors;
  canvasRgba: Readonly<Record<CanvasColor, Rgba>>;
  swatches: readonly { token: string; color: string }[];
}

const camel = (s: string): string => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Turn resolved tokens into what the editor applies. Throws TokenError when a required color is missing. */
export function buildTheme(
  tokens: ReadonlyMap<string, Token>,
  meta: { id: string; name: string; inputs: Readonly<Record<string, string>> },
): ResolvedTheme {
  const css: Record<string, string> = {};
  const canvas: Partial<Record<CanvasColor, Rgba>> = {};
  const colors = new Map<string, Rgba>();
  for (const [path, t] of tokens) {
    const [group, ...rest] = path.split(".");
    const name = rest.join(".");
    if (group !== "ui" && group !== "syntax" && group !== "canvas") continue;
    if (t.type !== "color") throw new TokenError(`${meta.name}: "${path}" must be a color`);
    const c = parseColor(t.value, `${meta.name} "${path}"`);
    colors.set(path, c);
    if (group === "ui") {
      css[`--${name}`] = cssColor(c);
      css[`--${name}-rgb`] = `${c.r} ${c.g} ${c.b}`;
    } else if (group === "syntax") css[`--syntax-${name}`] = cssColor(c);
    else if ((CANVAS_KEYS as readonly string[]).includes(camel(name))) canvas[camel(name) as CanvasColor] = c;
  }
  for (const k of CSS_COLORS) if (!(`--${k}` in css)) throw new TokenError(`${meta.name}: token "ui.${k}" is missing`);
  for (const k of CANVAS_KEYS)
    if (!canvas[k])
      throw new TokenError(
        `${meta.name}: token "canvas.${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}" is missing`,
      );
  const canvasRgba = canvas as Record<CanvasColor, Rgba>;
  const appearance: Appearance =
    meta.inputs[APPEARANCE] === "light"
      ? "light"
      : meta.inputs[APPEARANCE] === "dark"
        ? "dark"
        : luminance(canvasRgba.paper) > 0.4
          ? "light"
          : "dark";
  return {
    id: meta.id,
    name: meta.name,
    appearance,
    inputs: meta.inputs,
    css,
    canvas: Object.fromEntries(CANVAS_KEYS.map((k) => [k, cssColor(canvasRgba[k])])) as unknown as CanvasColors,
    canvasRgba,
    swatches: SWATCHES.filter((s) => colors.has(s)).map((token) => ({ token, color: cssColor(colors.get(token)!) })),
  };
}

export function findTheme(name: string): ThemeEntry | undefined {
  return THEMES.find((t) => t.id.toLowerCase() === name.toLowerCase());
}

/** A bundled theme's modifiers (for the Settings tab). */
export function themeInfo(entry: ThemeEntry): ResolverInfo {
  return resolverInfo(THEME_FILES, entry.resolver);
}

export interface ThemeResult {
  theme: ResolvedTheme;
  /** Settings that could not be honoured (unknown theme, invalid option); the theme falls back for those. */
  problems: string[];
}

/** Resolve the theme a setting asks for, given whether the OS prefers dark. Never throws for bundled themes. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): ThemeResult {
  const problems: string[] = [];
  let entry = findTheme(setting.name);
  if (!entry) {
    problems.push(`unknown theme "${setting.name}"; using ${FALLBACK_THEME.id}`);
    entry = FALLBACK_THEME;
  }
  const info = themeInfo(entry);
  const inputs: Record<string, string> = {};
  for (const m of info.modifiers) {
    if (m.name === APPEARANCE && m.contexts.includes("dark") && m.contexts.includes("light")) {
      inputs[m.name] = effectiveAppearance(setting.appearance, systemDark);
      continue;
    }
    const want = Object.entries(setting.inputs).find(([k]) => k.toLowerCase() === m.name.toLowerCase())?.[1];
    const ctx = want === undefined ? undefined : m.contexts.find((c) => c.toLowerCase() === want.toLowerCase());
    if (want !== undefined && !ctx)
      problems.push(`theme option ${m.name} has no value "${want}"; using ${m.default ?? m.contexts[0]}`);
    const pick = ctx ?? m.default ?? m.contexts[0];
    if (pick !== undefined) inputs[m.name] = pick;
  }
  for (const k of Object.keys(setting.inputs)) {
    if (!info.modifiers.some((m) => m.name.toLowerCase() === k.toLowerCase()))
      problems.push(`theme ${entry.id} has no option "${k}"`);
  }
  const name = info.name ?? entry.id;
  try {
    return {
      theme: buildTheme(resolveTokens(THEME_FILES, entry.resolver, inputs), { id: entry.id, name, inputs }),
      problems,
    };
  } catch (e) {
    if (!(e instanceof TokenError) || entry === FALLBACK_THEME) throw e;
    problems.push(e.message);
    return {
      theme: resolveTheme({ name: FALLBACK_THEME.id, appearance: setting.appearance, inputs: {} }, systemDark).theme,
      problems,
    };
  }
}

const effectCache = new Map<string, boolean>();

/**
 * Whether choosing another context of modifier `name` would change any color, with the other modifiers at `inputs`
 * (a resolved theme's inputs). Catppuccin's flavor picks the dark flavor, so it makes no difference while light.
 */
export function modifierHasEffect(entry: ThemeEntry, inputs: Readonly<Record<string, string>>, name: string): boolean {
  const key = JSON.stringify([
    entry.resolver,
    name,
    Object.entries(inputs)
      .filter(([k]) => k !== name)
      .sort(),
  ]);
  const known = effectCache.get(key);
  if (known !== undefined) return known;
  const m = themeInfo(entry).modifiers.find((x) => x.name === name);
  const looks = new Set<string>();
  for (const ctx of m?.contexts ?? []) {
    const tokens = resolveTokens(THEME_FILES, entry.resolver, { ...inputs, [name]: ctx });
    const shown = [...tokens]
      .filter(([path]) => /^(ui|syntax|canvas)\./.test(path))
      .map(([path, t]) => [path, cssColor(parseColor(t.value))]);
    looks.add(JSON.stringify(shown));
  }
  const effect = looks.size > 1;
  effectCache.set(key, effect);
  return effect;
}

/** The diagram colors the renderer draws with; `setCanvasTheme` replaces them. Starts as gruvbox dark medium. */
const initial = resolveTheme({ name: "gruvbox", appearance: "dark", inputs: {} }, true).theme;
export const C: CanvasColors = { ...initial.canvas };
const rgba: Record<CanvasColor, Rgba> = { ...initial.canvasRgba };

export function setCanvasTheme(t: ResolvedTheme): void {
  Object.assign(C, t.canvas);
  Object.assign(rgba, t.canvasRgba);
}

/** A canvas color with another alpha, as CSS text (rubber band fill, simulator fill). */
export function canvasAlpha(key: CanvasColor, a: number): string {
  return withAlpha(rgba[key], a);
}
