// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio, cssColor, joinPath, luminance, parseColor, resolveTokens, resolverInfo, TokenError, type TokenFiles } from "../src/tokens";
import { C, CSS_COLORS, FALLBACK_THEME, THEME_FILES, THEMES, canvasAlpha, findTheme, modifierHasEffect, resolveTheme, setCanvasTheme, themeInfo, type ResolvedTheme } from "../src/theme";
import {
  DEFAULT_THEME,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  defaultSettings,
  effectiveAppearance,
  parseSettings,
  serializeSettings,
  zoomStep,
  type ThemeSetting,
} from "../src/settings";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const variant = (appearance: "dark" | "light", contrast: string): ResolvedTheme => {
  const r = resolveTheme({ name: "gruvbox", appearance, inputs: { contrast } }, true);
  assert.deepEqual(r.problems, []);
  return r.theme;
};
const hexOf = (c: unknown): string => cssColor(parseColor(c));

describe("gruvbox theme files", () => {
  it("hold the palette of colors/gruvbox.vim exactly", () => {
    // From gruvbox (morhetz/gruvbox, colors/gruvbox.vim, "Palette" section), the *_256 duplicates left out.
    const expected: Record<string, string> = {
      dark0_hard: "#1d2021", dark0: "#282828", dark0_soft: "#32302f", dark1: "#3c3836", dark2: "#504945", dark3: "#665c54", dark4: "#7c6f64",
      gray_245: "#928374", gray_244: "#928374",
      light0_hard: "#f9f5d7", light0: "#fbf1c7", light0_soft: "#f2e5bc", light1: "#ebdbb2", light2: "#d5c4a1", light3: "#bdae93", light4: "#a89984",
      bright_red: "#fb4934", bright_green: "#b8bb26", bright_yellow: "#fabd2f", bright_blue: "#83a598", bright_purple: "#d3869b", bright_aqua: "#8ec07c", bright_orange: "#fe8019",
      neutral_red: "#cc241d", neutral_green: "#98971a", neutral_yellow: "#d79921", neutral_blue: "#458588", neutral_purple: "#b16286", neutral_aqua: "#689d6a", neutral_orange: "#d65d0e",
      faded_red: "#9d0006", faded_green: "#79740e", faded_yellow: "#b57614", faded_blue: "#076678", faded_purple: "#8f3f71", faded_aqua: "#427b58", faded_orange: "#af3a03",
    };
    const palette = (THEME_FILES["gruvbox/gruvbox.tokens.json"] as { gruvbox: Record<string, { $value: { components: number[]; hex: string } }> }).gruvbox;
    const names = Object.keys(palette).filter((k) => !k.startsWith("$"));
    assert.deepEqual(names.sort(), Object.keys(expected).sort());
    for (const n of names) {
      const v = palette[n]!.$value;
      assert.equal(v.hex, expected[n], n);
      // The components (what a DTCG tool reads first) agree with the hex fallback.
      assert.equal(hexOf({ colorSpace: "srgb", components: v.components }), expected[n], `${n} components`);
    }
  });

  it("the resolver offers appearance (dark/light) and contrast (hard/medium/soft)", () => {
    const info = resolverInfo(THEME_FILES, findTheme("gruvbox")!.resolver);
    assert.equal(info.name, "Gruvbox");
    assert.deepEqual(
      info.modifiers.map((m) => [m.name, m.contexts, m.default]),
      [
        ["appearance", ["dark", "light"], "dark"],
        ["contrast", ["hard", "medium", "soft"], "medium"],
      ],
    );
  });

  it("resolve all six variants to gruvbox's relative colors", () => {
    // [paper (bg0), around the sheet, grid, text (fg1), secondary (fg4), orange, chrome, card edge]
    const table: Record<string, string[]> = {
      "dark hard": ["#1d2021", "#141617", "#282828", "#ebdbb2", "#a89984", "#fe8019", "#141617", "#3c3836"],
      "dark medium": ["#282828", "#1d2021", "#32302f", "#ebdbb2", "#a89984", "#fe8019", "#141617", "#3c3836"],
      "dark soft": ["#32302f", "#282828", "#3c3836", "#ebdbb2", "#a89984", "#fe8019", "#141617", "#3c3836"],
      "light hard": ["#f9f5d7", "#ebdbb2", "#f2e5bc", "#3c3836", "#7c6f64", "#af3a03", "#ebdbb2", "#d5c4a1"],
      "light medium": ["#fbf1c7", "#ebdbb2", "#f2e5bc", "#3c3836", "#7c6f64", "#af3a03", "#ebdbb2", "#d5c4a1"],
      "light soft": ["#f2e5bc", "#ebdbb2", "#ebdbb2", "#3c3836", "#7c6f64", "#af3a03", "#ebdbb2", "#d5c4a1"],
    };
    for (const [key, want] of Object.entries(table)) {
      const [appearance, contrast] = key.split(" ") as ["dark" | "light", string];
      const t = variant(appearance, contrast);
      assert.equal(t.appearance, appearance, key);
      assert.deepEqual(t.inputs, { appearance, contrast }, key);
      const got = [t.canvas.paper, t.canvas.background, t.canvas.grid, t.css["--fg"], t.css["--fg4"], t.css["--orange"], t.css["--chrome"], t.css["--card-edge"]];
      assert.deepEqual(got, want, key);
      assert.equal(t.css["--card"], t.canvas.paper, `${key}: cards and the sheet share bg0`);
      assert.notEqual(t.canvas.background, t.canvas.paper, `${key}: the sheet stands out from its surround`);
      assert.notEqual(t.canvas.grid, t.canvas.paper, `${key}: the grid is visible`);
      for (const k of CSS_COLORS) assert.ok(t.css[`--${k}`], `${key}: --${k}`);
    }
  });

  it("dark medium reproduces the editor's colors before themes", () => {
    const t = variant("dark", "medium");
    assert.deepEqual(
      { ...t.canvas },
      {
        background: "#1d2021", paper: "#282828", grid: "#32302f", stateFill: "#282828", ink: "#a89984", selection: "#fe8019",
        touching: "#83a598", ok: "#b8bb26", refuse: "#fb4934", warning: "#fabd2f", badgeMark: "#1d2021", active: "#b8bb26", would: "#8ec07c",
      },
    );
    assert.equal(t.css["--shadow"], "rgb(0 0 0 / 0.45)");
    assert.equal(t.css["--orange-rgb"], "254 128 25");
  });

  it("keep text readable in every variant (WCAG contrast)", () => {
    for (const appearance of ["dark", "light"] as const) {
      for (const contrast of ["hard", "medium", "soft"]) {
        const t = variant(appearance, contrast);
        const css = (k: string): ReturnType<typeof parseColor> => parseColor({ colorSpace: "srgb", components: t.css[`--${k}-rgb`]!.split(" ").map((x) => Number(x) / 255) });
        const key = `${appearance} ${contrast}`;
        assert.ok(contrastRatio(css("fg"), css("card")) >= 7, `${key}: text on cards`);
        assert.ok(contrastRatio(css("fg4"), css("card")) >= 3.5, `${key}: secondary text on cards`);
        assert.ok(contrastRatio(t.canvasRgba.ink, t.canvasRgba.paper) >= 3.5, `${key}: diagram on the sheet`);
        assert.ok(contrastRatio(t.canvasRgba.selection, t.canvasRgba.paper) >= 4.5, `${key}: selection on the sheet`);
        assert.ok(contrastRatio(css("bg-dark"), css("orange")) >= 3, `${key}: text on orange`);
      }
    }
  });

  it("style.css: every var() is defined, and the fallback colors equal dark medium", () => {
    const css = readFileSync(join(srcDir, "style.css"), "utf8");
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)![1]!;
    const fallback = new Map([...rootBlock.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
    const t = variant("dark", "medium");
    for (const [k, v] of Object.entries(t.css)) {
      if (fallback.has(k)) assert.equal(fallback.get(k), v, `style.css fallback ${k}`);
    }
    for (const k of CSS_COLORS) assert.ok(fallback.has(`--${k}`), `style.css has a fallback for --${k}`);
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!));
    for (const k of used) assert.ok(fallback.has(k) || k in t.css || k === "--mono", `${k} is used but never defined`);
    // No color literals outside :root (the theme owns them).
    const rest = css.replace(rootBlock, "");
    assert.deepEqual(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g), null);
  });
});

/** Every combination of a theme's modifier contexts, as resolved themes. */
const allVariants = (id: string): ResolvedTheme[] => {
  const info = themeInfo(findTheme(id)!);
  let combos: Record<string, string>[] = [{}];
  for (const m of info.modifiers) combos = combos.flatMap((c) => m.contexts.map((x) => ({ ...c, [m.name]: x })));
  return combos.map((inputs) => {
    const { appearance, ...rest } = inputs;
    const r = resolveTheme({ name: id, appearance: appearance === "light" ? "light" : "dark", inputs: rest }, true);
    assert.deepEqual(r.problems, [], `${id} ${JSON.stringify(inputs)}`);
    assert.deepEqual(r.theme.inputs, inputs, `${id} ${JSON.stringify(inputs)}`);
    return r.theme;
  });
};
const ladder = (s: string): string[] => s.split(" ");

describe("everforest, solarized and catppuccin theme files", () => {
  it("hold the upstream palettes exactly", () => {
    // Everforest: autoload/everforest.vim, everforest#get_palette (sainnhe/everforest 85a86eb, 2026-06-08).
    const bgKeys = ["bg_dim", "bg0", "bg1", "bg2", "bg3", "bg4", "bg5"];
    const fgKeys = ["fg", "red", "orange", "yellow", "green", "aqua", "blue", "purple", "grey0", "grey1", "grey2"];
    const everforest: Record<string, string> = {
      "dark.hard": "#1e2326 #272e33 #2e383c #374145 #414b50 #495156 #4f5b58",
      "dark.medium": "#232a2e #2d353b #343f44 #3d484d #475258 #4f585e #56635f",
      "dark.soft": "#293136 #333c43 #3a464c #434f55 #4d5960 #555f66 #5d6b66",
      "light.hard": "#f2efdf #fffbef #f8f5e4 #f2efdf #edeada #e8e5d5 #bec5b2",
      "light.medium": "#efebd4 #fdf6e3 #f4f0d9 #efebd4 #e6e2cc #e0dcc7 #bdc3af",
      "light.soft": "#e5dfc5 #f3ead3 #eae4ca #e5dfc5 #ddd8be #d8d3ba #b9c0ab",
      dark: "#d3c6aa #e67e80 #e69875 #dbbc7f #a7c080 #83c092 #7fbbb3 #d699b6 #7a8478 #859289 #9da9a0",
      light: "#5c6a72 #f85552 #f57d26 #dfa000 #8da101 #35a77c #3a94c5 #df69ba #a6b0a0 #939f91 #829181",
    };
    const want: Record<string, string> = {};
    for (const [k, v] of Object.entries(everforest)) {
      const keys = k.includes(".") ? bgKeys : fgKeys;
      ladder(v).forEach((hex, i) => (want[`everforest.${k}.${keys[i]}`] = hex));
    }
    // Solarized: the README's table (altercation/solarized).
    const sol = "base03 #002b36 base02 #073642 base01 #586e75 base00 #657b83 base0 #839496 base1 #93a1a1 base2 #eee8d5 base3 #fdf6e3 yellow #b58900 orange #cb4b16 red #dc322f magenta #d33682 violet #6c71c4 blue #268bd2 cyan #2aa198 green #859900".split(" ");
    for (let i = 0; i < sol.length; i += 2) want[`solarized.${sol[i]}`] = sol[i + 1]!;
    // Catppuccin: palette.json v1.8.0 (catppuccin/palette), colors in its order.
    const ctpKeys = "rosewater flamingo pink mauve red maroon peach yellow green teal sky sapphire blue lavender text subtext1 subtext0 overlay2 overlay1 overlay0 surface2 surface1 surface0 base mantle crust".split(" ");
    const ctp: Record<string, string> = {
      latte: "#dc8a78 #dd7878 #ea76cb #8839ef #d20f39 #e64553 #fe640b #df8e1d #40a02b #179299 #04a5e5 #209fb5 #1e66f5 #7287fd #4c4f69 #5c5f77 #6c6f85 #7c7f93 #8c8fa1 #9ca0b0 #acb0be #bcc0cc #ccd0da #eff1f5 #e6e9ef #dce0e8",
      frappe: "#f2d5cf #eebebe #f4b8e4 #ca9ee6 #e78284 #ea999c #ef9f76 #e5c890 #a6d189 #81c8be #99d1db #85c1dc #8caaee #babbf1 #c6d0f5 #b5bfe2 #a5adce #949cbb #838ba7 #737994 #626880 #51576d #414559 #303446 #292c3c #232634",
      macchiato: "#f4dbd6 #f0c6c6 #f5bde6 #c6a0f6 #ed8796 #ee99a0 #f5a97f #eed49f #a6da95 #8bd5ca #91d7e3 #7dc4e4 #8aadf4 #b7bdf8 #cad3f5 #b8c0e0 #a5adcb #939ab7 #8087a2 #6e738d #5b6078 #494d64 #363a4f #24273a #1e2030 #181926",
      mocha: "#f5e0dc #f2cdcd #f5c2e7 #cba6f7 #f38ba8 #eba0ac #fab387 #f9e2af #a6e3a1 #94e2d5 #89dceb #74c7ec #89b4fa #b4befe #cdd6f4 #bac2de #a6adc8 #9399b2 #7f849c #6c7086 #585b70 #45475a #313244 #1e1e2e #181825 #11111b",
    };
    for (const [f, v] of Object.entries(ctp)) ladder(v).forEach((hex, i) => (want[`catppuccin.${f}.${ctpKeys[i]}`] = hex));
    // Every absolute color of the three palette files, path -> { components, hex }.
    const got: Record<string, { components: number[]; hex: string }> = {};
    const walk = (node: Record<string, unknown>, path: string): void => {
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith("$")) continue;
        const child = v as Record<string, unknown>;
        if ("$value" in child) got[`${path}.${k}`] = child.$value as { components: number[]; hex: string };
        else walk(child, `${path}.${k}`);
      }
    };
    for (const id of ["everforest", "solarized", "catppuccin"]) walk((THEME_FILES[`${id}/${id}.tokens.json`] as Record<string, Record<string, unknown>>)[id]!, id);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
    for (const [path, v] of Object.entries(got)) {
      assert.equal(v.hex, want[path], path);
      assert.equal(hexOf({ colorSpace: "srgb", components: v.components }), want[path], `${path} components`);
    }
  });

  it("the resolvers offer their upstream variants", () => {
    const mods = (id: string) => themeInfo(findTheme(id)!).modifiers.map((m) => [m.name, m.contexts, m.default]);
    assert.deepEqual(THEMES.map((t) => [t.id, themeInfo(t).name]), [["catppuccin", "Catppuccin"], ["everforest", "Everforest"], ["gruvbox", "Gruvbox"], ["solarized", "Solarized"]]);
    assert.equal(FALLBACK_THEME.id, "gruvbox");
    assert.deepEqual(mods("everforest"), [["appearance", ["dark", "light"], "dark"], ["contrast", ["hard", "medium", "soft"], "medium"]]);
    assert.deepEqual(mods("solarized"), [["appearance", ["dark", "light"], "dark"]]);
    assert.deepEqual(mods("catppuccin"), [["appearance", ["dark", "light"], "dark"], ["flavor", ["frappe", "macchiato", "mocha"], "mocha"]]);
  });

  it("resolve every variant to the roles chosen for it", () => {
    // [paper (bg0), around the sheet, grid, text (fg1), secondary (fg4), orange, chrome, card edge, diagram ink]
    const table: Record<string, string> = {
      "everforest dark hard": "#272e33 #1e2326 #2e383c #d3c6aa #9da9a0 #e69875 #1e2326 #374145 #9da9a0",
      "everforest dark medium": "#2d353b #232a2e #343f44 #d3c6aa #9da9a0 #e69875 #232a2e #3d484d #9da9a0",
      "everforest dark soft": "#333c43 #293136 #3a464c #d3c6aa #9da9a0 #e69875 #293136 #434f55 #9da9a0",
      "everforest light hard": "#fffbef #f2efdf #f8f5e4 #5c6a72 #829181 #f57d26 #f2efdf #e8e5d5 #5c6a72",
      "everforest light medium": "#fdf6e3 #efebd4 #f4f0d9 #5c6a72 #829181 #f57d26 #efebd4 #e0dcc7 #5c6a72",
      "everforest light soft": "#f3ead3 #e5dfc5 #eae4ca #5c6a72 #829181 #f57d26 #e5dfc5 #d8d3ba #5c6a72",
      "solarized dark": "#002b36 #00202b #073642 #839496 #586e75 #cb4b16 #00202b #073642 #839496",
      "solarized light": "#fdf6e3 #eee8d5 #eee8d5 #657b83 #93a1a1 #cb4b16 #eee8d5 #e0d9c7 #657b83",
      "catppuccin dark frappe": "#303446 #292c3c #414559 #c6d0f5 #a5adce #ef9f76 #232634 #414559 #a5adce",
      "catppuccin dark macchiato": "#24273a #1e2030 #363a4f #cad3f5 #a5adcb #f5a97f #181926 #363a4f #a5adcb",
      "catppuccin dark mocha": "#1e1e2e #181825 #313244 #cdd6f4 #a6adc8 #fab387 #11111b #313244 #a6adc8",
      "catppuccin light frappe": "#eff1f5 #e6e9ef #ccd0da #4c4f69 #6c6f85 #fe640b #dce0e8 #ccd0da #6c6f85",
      "catppuccin light macchiato": "#eff1f5 #e6e9ef #ccd0da #4c4f69 #6c6f85 #fe640b #dce0e8 #ccd0da #6c6f85",
      "catppuccin light mocha": "#eff1f5 #e6e9ef #ccd0da #4c4f69 #6c6f85 #fe640b #dce0e8 #ccd0da #6c6f85",
    };
    const seen: string[] = [];
    for (const id of ["everforest", "solarized", "catppuccin"]) {
      for (const t of allVariants(id)) {
        const key = [id, ...Object.values(t.inputs)].join(" ");
        seen.push(key);
        const got = [t.canvas.paper, t.canvas.background, t.canvas.grid, t.css["--fg"], t.css["--fg4"], t.css["--orange"], t.css["--chrome"], t.css["--card-edge"], t.canvas.ink];
        assert.deepEqual(got, ladder(table[key] ?? ""), key);
        assert.equal(t.css["--card"], t.canvas.paper, `${key}: cards and the sheet share bg0`);
      }
    }
    assert.deepEqual(seen.sort(), Object.keys(table).sort());
  });

  it("code colors follow each scheme's own syntax rules", () => {
    const syn = (t: ResolvedTheme) => ["comment", "string", "number", "keyword", "preprocessor"].map((k) => t.css[`--syntax-${k}`]).join(" ");
    const pick = (id: string, appearance: "dark" | "light", inputs = {}) => resolveTheme({ name: id, appearance, inputs }, true).theme;
    // everforest.vim: Comment grey1, String green, Number purple, Keyword red, PreProc purple.
    assert.equal(syn(pick("everforest", "dark")), "#859289 #a7c080 #d699b6 #e67e80 #d699b6");
    // vim-colors-solarized: Comment base01 (base1 when light), Constant cyan, Statement green, PreProc orange.
    assert.equal(syn(pick("solarized", "dark")), "#586e75 #2aa198 #2aa198 #859900 #cb4b16");
    assert.equal(syn(pick("solarized", "light")), "#93a1a1 #2aa198 #2aa198 #859900 #cb4b16");
    // Catppuccin style guide: comments overlay2, strings green, numbers peach, keywords mauve, macros rosewater.
    assert.equal(syn(pick("catppuccin", "dark", { flavor: "mocha" })), "#9399b2 #a6e3a1 #fab387 #cba6f7 #f5e0dc");
    assert.equal(syn(pick("catppuccin", "light", { flavor: "mocha" })), "#7c7f93 #40a02b #fe640b #8839ef #dc8a78");
  });
});

describe("every bundled theme", () => {
  it("is laid out like the others in every variant", () => {
    const L = (t: ResolvedTheme, k: string) => luminance(parseColor({ colorSpace: "srgb", components: t.css[`--${k}-rgb`]!.split(" ").map((x) => Number(x) / 255) }));
    for (const entry of THEMES) {
      for (const t of allVariants(entry.id)) {
        const key = [entry.id, ...Object.values(t.inputs)].join(" ");
        assert.equal(t.appearance, t.inputs.appearance, key);
        for (const k of CSS_COLORS) assert.ok(t.css[`--${k}`], `${key}: --${k}`);
        const dark = t.appearance === "dark";
        assert.equal(L(t, "fg") > L(t, "card"), dark, `${key}: text against the cards`);
        assert.equal(luminance(t.canvasRgba.background) < luminance(t.canvasRgba.paper), true, `${key}: the sheet lies on something darker`);
        assert.notEqual(t.canvas.grid, t.canvas.paper, `${key}: the grid is visible`);
        assert.ok(L(t, "chrome") < L(t, "card"), `${key}: the window background is darker than the cards`);
        assert.notEqual(t.css["--card-edge"], t.css["--card"], `${key}: card edge`);
        assert.notEqual(t.css["--card-edge"], t.css["--chrome"], `${key}: card edge against the window`);
        assert.equal(L(t, "card-edge") > L(t, "card"), dark, `${key}: card edges lighter when dark, darker when light`);
        assert.ok(t.swatches.length === 11, `${key}: swatches`);
      }
    }
  });

  it("keeps the upstream palettes' contrast (the weakest pairs are Solarized light and Everforest light soft)", () => {
    const ratio = (t: ResolvedTheme, a: string, b: string) => {
      const c = (k: string) => parseColor({ colorSpace: "srgb", components: t.css[`--${k}-rgb`]!.split(" ").map((x) => Number(x) / 255) });
      return contrastRatio(c(a), c(b));
    };
    const weakest: Record<string, number> = {};
    const note = (what: string, v: number) => (weakest[what] = Math.min(weakest[what] ?? Infinity, v));
    for (const entry of THEMES) {
      for (const t of allVariants(entry.id)) {
        const key = [entry.id, ...Object.values(t.inputs)].join(" ");
        const text = ratio(t, "fg", "card"), secondary = ratio(t, "fg4", "card"), onOrange = ratio(t, "bg-dark", "orange");
        const ink = contrastRatio(t.canvasRgba.ink, t.canvasRgba.paper), selection = contrastRatio(t.canvasRgba.selection, t.canvasRgba.paper);
        // A role mapped to the wrong palette color (a background as text, say) falls far below these.
        assert.ok(text >= 4, `${key}: text on cards ${text.toFixed(2)}`);
        assert.ok(ink >= 3.75, `${key}: diagram on the sheet ${ink.toFixed(2)}`);
        assert.ok(secondary >= 2.4, `${key}: secondary text ${secondary.toFixed(2)}`);
        assert.ok(selection >= 2.2, `${key}: selection on the sheet ${selection.toFixed(2)}`);
        assert.ok(onOrange >= 1.95, `${key}: text on orange ${onOrange.toFixed(2)}`);
        note("text", text), note("ink", ink), note("secondary", secondary), note("selection", selection), note("onOrange", onOrange);
      }
    }
    // The floors are tight: each is within 0.25 of the weakest variant, so a theme that gets worse is noticed.
    for (const [what, floor] of Object.entries({ text: 4, ink: 3.75, secondary: 2.4, selection: 2.2, onOrange: 1.95 })) {
      assert.ok(weakest[what]! - floor < 0.25, `${what}: weakest ${weakest[what]!.toFixed(2)}, floor ${floor}`);
    }
  });

  it("the Settings tab knows which options make no difference", () => {
    const ctp = findTheme("catppuccin")!;
    assert.equal(modifierHasEffect(ctp, { appearance: "dark", flavor: "mocha" }, "flavor"), true);
    assert.equal(modifierHasEffect(ctp, { appearance: "light", flavor: "mocha" }, "flavor"), false, "light is always Latte");
    assert.equal(modifierHasEffect(ctp, { appearance: "light", flavor: "frappe" }, "appearance"), true);
    for (const id of ["gruvbox", "everforest"]) {
      for (const appearance of ["dark", "light"]) assert.equal(modifierHasEffect(findTheme(id)!, { appearance, contrast: "soft" }, "contrast"), true, `${id} ${appearance}`);
    }
  });
});

describe("resolveTheme", () => {
  it("follows the OS when the appearance is system", () => {
    const s: ThemeSetting = { name: "gruvbox", appearance: "system", inputs: { contrast: "soft" } };
    assert.equal(resolveTheme(s, true).theme.appearance, "dark");
    assert.equal(resolveTheme(s, false).theme.appearance, "light");
    assert.equal(resolveTheme(s, false).theme.canvas.paper, "#f2e5bc");
    assert.equal(resolveTheme({ ...s, appearance: "dark" }, false).theme.appearance, "dark");
    assert.equal(effectiveAppearance("system", false), "light");
  });

  it("defaults, case-insensitive names and problems instead of failures", () => {
    assert.deepEqual(resolveTheme(DEFAULT_THEME, true).theme.inputs, { appearance: "dark", contrast: "medium" });
    const upper = resolveTheme({ name: "GRUVBOX", appearance: "light", inputs: { Contrast: "HARD" } }, true);
    assert.deepEqual(upper.problems, []);
    assert.deepEqual(upper.theme.inputs, { appearance: "light", contrast: "hard" });
    const bad = resolveTheme({ name: "nord", appearance: "dark", inputs: { contrast: "extreme", font: "big" } }, true);
    assert.equal(bad.theme.id, "gruvbox");
    assert.equal(bad.theme.inputs.contrast, "medium");
    assert.equal(bad.problems.length, 3, bad.problems.join("\n"));
  });

  it("canvas colors are shared with the renderer and switch with setCanvasTheme", () => {
    const light = variant("light", "medium");
    const dark = variant("dark", "medium");
    try {
      setCanvasTheme(light);
      assert.equal(C.paper, "#fbf1c7");
      assert.equal(canvasAlpha("selection", 0.08), "rgb(175 58 3 / 0.08)");
    } finally {
      setCanvasTheme(dark);
    }
    assert.equal(C.paper, "#282828");
  });
});

describe("design tokens (DTCG 2025.10)", () => {
  const resolver = (order: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ version: "2025.10", resolutionOrder: order, ...extra });
  const tokens = (files: TokenFiles, inputs?: Record<string, string>) => resolveTokens(files, "t/r.resolver.json", inputs);
  const inline = (doc: unknown) => ({ type: "set", name: "inline", sources: [doc] });
  const color = (hex: string) => ({ colorSpace: "srgb", components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), hex });

  it("aliases, chains, group types and later sources winning", () => {
    const files = {
      "t/r.resolver.json": resolver([
        inline({ base: { $type: "color", a: { $value: color("#112233") }, b: { $value: "{base.a}" } } }),
        inline({ base: { a: { $value: color("#445566") } }, sem: { c: { $value: "{base.b}" }, n: { $type: "number", $value: 3 } } }),
        inline({ sizes: { $type: "number", ref: { $value: "{base.a}" } } }),
      ]),
    };
    const t = tokens(files);
    assert.equal(hexOf(t.get("base.b")!.value), "#445566");
    assert.equal(t.get("sem.c")!.type, "color", "an untyped alias takes its target's type");
    assert.equal(hexOf(t.get("sem.c")!.value), "#445566");
    assert.equal(t.get("sem.n")!.type, "number");
    assert.equal(t.get("sizes.ref")!.type, "color", "an alias's type comes before its group's $type");
  });

  it("$root tokens, JSON pointers into files and inline modifiers", () => {
    const files = {
      "t/r.resolver.json": resolver([{ $ref: "#/sets/base" }, { type: "modifier", name: "mode", contexts: { a: [{ $ref: "m.json#/modes/a" }], b: [{ $ref: "m.json#/modes/b" }] }, default: "a" }], {
        sets: { base: { sources: [{ $ref: "../shared/base.json" }] } },
      }),
      "shared/base.json": { accent: { $type: "color", $root: { $value: color("#000000") }, light: { $value: color("#ffffff") } } },
      "t/m.json": { modes: { a: { accent: { $root: { $value: "{accent.light}" } } }, b: {} } },
    };
    assert.equal(hexOf(tokens(files).get("accent")!.value), "#ffffff");
    assert.equal(hexOf(tokens(files, { MODE: "B" }).get("accent")!.value), "#000000");
  });

  it("rejects what it cannot resolve", () => {
    const one = (doc: unknown, inputs?: Record<string, string>) => tokens({ "t/r.resolver.json": resolver([inline(doc)]) }, inputs);
    assert.throws(() => one({ a: { $value: "{b}" } }), /unknown token "b"/);
    assert.throws(() => one({ a: { $value: "{b}" }, b: { $value: "{a}" } }), /cycle/);
    assert.throws(() => one({ a: { $type: "color", $value: color("#000000") }, b: { $type: "number", $value: "{a}" } }), /is a number but aliases a color/);
    assert.throws(() => one({ "a.b": { $value: 1 } }), /invalid token or group name/);
    assert.throws(() => one({ a: 1 }), /neither a token nor a group/);
    assert.throws(() => one({ g: { $extends: "{x}" } }), /\$extends/);
    assert.throws(() => one({}, { mode: "x" }), /no modifier "mode"/);
    assert.throws(() => tokens({ "t/r.resolver.json": { version: "1.0", resolutionOrder: [] } }), /version/);
    assert.throws(() => tokens({ "t/r.resolver.json": resolver([{ $ref: "#/sets/nope" }]) }), /no set "nope"/);
    assert.throws(() => tokens({ "t/r.resolver.json": resolver([{ $ref: "#/modifiers/m" }], { modifiers: { m: { contexts: { a: [], b: [] } } } }) }), /needs an input/);
    assert.throws(() => tokens({ "t/r.resolver.json": resolver([{ $ref: "#/modifiers/m" }], { modifiers: { m: { contexts: { a: [], b: [] } } } }) }, { m: "c" }), /no context "c"/);
    assert.throws(() => tokens({ "t/r.resolver.json": resolver([{ type: "set", sources: [{ $ref: "missing.json" }] }]) }), /file "t\/missing.json" not found/);
    assert.throws(() => joinPath("r.json", "../x.json"), /leaves the theme folder/);
    assert.equal(joinPath("a/b/r.json", "../c/./d.json"), "a/c/d.json");
  });

  it("colors: srgb, hsl, alpha, none, hex fallback", () => {
    assert.deepEqual(parseColor({ colorSpace: "srgb", components: [1, 0.5, "none"], alpha: 0.25 }), { r: 255, g: 128, b: 0, a: 0.25 });
    assert.equal(hexOf({ colorSpace: "hsl", components: [120, 100, 25] }), "#008000");
    assert.equal(hexOf({ colorSpace: "oklch", components: [0.5, 0.1, 30], hex: "#abcdef" }), "#abcdef");
    assert.throws(() => parseColor({ colorSpace: "oklch", components: [0.5, 0.1, 30] }), TokenError);
    assert.throws(() => parseColor("#ffffff"), /must be an object/);
    assert.throws(() => parseColor({ colorSpace: "srgb", components: [1, 1] }), /3 entries/);
    assert.equal(cssColor({ r: 1, g: 2, b: 3, a: 0.5 }), "rgb(1 2 3 / 0.5)");
  });
});

describe("settings.json", () => {
  it("defaults when missing, empty or broken", () => {
    assert.deepEqual(parseSettings(undefined), { settings: defaultSettings(), problems: [] });
    assert.deepEqual(parseSettings("  ").settings, defaultSettings());
    const broken = parseSettings("{ theme: ");
    assert.deepEqual(broken.settings, defaultSettings());
    assert.match(broken.problems[0]!, /not valid JSON/);
    assert.equal(parseSettings("[]").problems.length, 1);
    assert.equal(parseSettings('{"theme": 3}').problems.length, 1);
  });

  it("reads the theme, keeps unknown keys and writes canonical text", () => {
    const text = '{"later": {"x": 1}, "theme": {"contrast": "hard", "appearance": "light", "name": "gruvbox"}}';
    const { settings, problems } = parseSettings(text);
    assert.deepEqual(problems, []);
    assert.deepEqual(settings.theme, { name: "gruvbox", appearance: "light", inputs: { contrast: "hard" } });
    const out = serializeSettings(settings);
    assert.equal(out, '{\n  "theme": {\n    "name": "gruvbox",\n    "appearance": "light",\n    "contrast": "hard"\n  },\n  "later": {\n    "x": 1\n  }\n}\n');
    assert.deepEqual(parseSettings(out).settings, settings);
  });

  it("reports values of the wrong kind and keeps the rest", () => {
    const { settings, problems } = parseSettings('{"theme": {"name": "", "appearance": "dim", "contrast": 2, "accent": "x"}}');
    assert.deepEqual(settings.theme, { name: "gruvbox", appearance: "system", inputs: { accent: "x" } });
    assert.equal(problems.length, 3);
  });

  it("reads the window zoom, writes it only when it is not 100, keeps it in range", () => {
    assert.equal(defaultSettings().zoom, 100);
    const { settings, problems } = parseSettings('{"zoom": 125, "theme": {"name": "gruvbox", "appearance": "dark"}, "later": 1}');
    assert.deepEqual(problems, []);
    assert.equal(settings.zoom, 125);
    assert.deepEqual(settings.other, { later: 1 }, "zoom is a known key, not kept as unknown");
    const out = serializeSettings(settings);
    assert.equal(out, '{\n  "theme": {\n    "name": "gruvbox",\n    "appearance": "dark"\n  },\n  "zoom": 125,\n  "later": 1\n}\n');
    assert.deepEqual(parseSettings(out).settings, settings);
    assert.doesNotMatch(serializeSettings({ ...settings, zoom: 100 }), /zoom/);
    assert.equal(parseSettings('{"zoom": 112.6}').settings.zoom, 113, "whole percents");
    for (const [text, zoom] of [['{"zoom": 20}', ZOOM_MIN], ['{"zoom": 1000}', ZOOM_MAX], ['{"zoom": "125"}', 100], ['{"zoom": null}', 100]] as const) {
      const r = parseSettings(text);
      assert.equal(r.settings.zoom, zoom, text);
      assert.equal(r.problems.length, 1, text);
      assert.match(r.problems[0]!, /zoom/);
    }
    assert.equal(parseSettings('{"zoom": 1000, "theme": 3}').settings.zoom, ZOOM_MAX, "zoom survives a broken theme");
  });

  it("steps the zoom through the browser levels", () => {
    assert.equal(ZOOM_STEPS[0], ZOOM_MIN);
    assert.equal(ZOOM_STEPS[ZOOM_STEPS.length - 1], ZOOM_MAX);
    assert.ok(ZOOM_STEPS.includes(100));
    assert.ok(ZOOM_STEPS.every((z, i) => i === 0 || z > ZOOM_STEPS[i - 1]!), "ascending");
    assert.equal(zoomStep(100, 1), 110);
    assert.equal(zoomStep(100, -1), 90);
    assert.equal(zoomStep(110, 1), 125);
    assert.equal(zoomStep(105, 1), 110, "between steps: the next one up");
    assert.equal(zoomStep(105, -1), 100, "between steps: the next one down");
    assert.equal(zoomStep(ZOOM_MAX, 1), ZOOM_MAX);
    assert.equal(zoomStep(ZOOM_MIN, -1), ZOOM_MIN);
    // Up from the smallest and back down from the largest visit every step.
    const up = [ZOOM_MIN];
    while (up[up.length - 1]! < ZOOM_MAX) up.push(zoomStep(up[up.length - 1]!, 1));
    assert.deepEqual(up, ZOOM_STEPS);
    const down = [ZOOM_MAX];
    while (down[down.length - 1]! > ZOOM_MIN) down.push(zoomStep(down[down.length - 1]!, -1));
    assert.deepEqual(down, [...ZOOM_STEPS].reverse());
  });
});
