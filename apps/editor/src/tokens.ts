// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Design tokens in the W3C Design Tokens Community Group format, version 2025.10 (https://www.designtokens.org/tr/2025.10/):
 * enough of it to read color themes.
 *
 * - Format module: groups, `$type` inheritance, `$root` tokens, `{group.token}` aliases (resolved after all sources
 *   are deep-merged, with the alias's type when the token states none), `$description`/`$extensions` ignored.
 * - Color module: `{ colorSpace, components, alpha?, hex? }` for the `srgb` and `hsl` color spaces; any other space
 *   falls back to `hex`; a `"none"` component counts as 0.
 * - Resolver module: `sets`, `modifiers` with `contexts` and `default`, `resolutionOrder` (later wins), inputs
 *   (case-insensitive). `$ref` reaches `#/sets/<name>` and `#/modifiers/<name>` in the resolver, and token files the
 *   caller supplies by path relative to the resolver, optionally with a JSON Pointer (`file.json#/a/b`).
 *
 * No DOM: runs in the editor and in tests.
 */

/** An sRGB color: channels 0–255 (integers), alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A token after merging and alias resolution. `value` holds no aliases. */
export interface Token {
  type: string | undefined;
  value: unknown;
}

/** Parsed JSON documents by path ("gruvbox/gruvbox.resolver.json", "ui.tokens.json"). */
export type TokenFiles = Readonly<Record<string, unknown>>;

export interface ResolverModifier {
  name: string;
  description: string | undefined;
  contexts: string[];
  default: string | undefined;
}

export interface ResolverInfo {
  name: string | undefined;
  description: string | undefined;
  modifiers: ResolverModifier[];
}

export class TokenError extends Error {
  override name = "TokenError";
}

type Json = Record<string, unknown>;

const isObject = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

const fail = (msg: string): never => {
  throw new TokenError(msg);
};

// ---------------------------------------------------------------- paths and $ref

/** `base`'s directory joined with `rel`, normalized ("a/b.json" + "../c.json" -> "c.json"). */
export function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const p of rel.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (parts.length === 0) fail(`$ref "${rel}" leaves the theme folder`);
      parts.pop();
    } else parts.push(p);
  }
  return parts.join("/");
}

/** RFC 6901 JSON Pointer ("#/a/b" or "/a/b"). */
function pointer(doc: unknown, ptr: string, where: string): unknown {
  const path = ptr.replace(/^#/, "");
  if (path === "") return doc;
  let cur = doc;
  for (const raw of path.slice(1).split("/")) {
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(cur) || !(key in cur)) return fail(`${where}: nothing at "${ptr}"`);
    cur = cur[key];
  }
  return cur;
}

function fileAt(files: TokenFiles, path: string, from: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(files, path)) fail(`${from}: file "${path}" not found`);
  return files[path];
}

// ---------------------------------------------------------------- merging and flattening token documents

interface RawToken {
  /** `$type` on the token itself. */
  own: string | undefined;
  /** `$type` of the nearest group. */
  group: string | undefined;
  value: unknown;
  where: string;
}

const NAME_RE = /^[^$.{}][^.{}]*$/;

/**
 * Deep-merge a token document into `target`: groups merge (their `$type` and other properties too, later wins),
 * a token replaces whatever was at its path. Source objects are never modified; `origin` remembers each token's file.
 */
function mergeInto(target: Json, src: unknown, where: string, origin: WeakMap<object, string>, prefix = ""): void {
  if (!isObject(src)) return fail(`${where}: a token document must be an object`);
  if ("$extends" in src) fail(`${where}: $extends is not supported`);
  for (const [key, child] of Object.entries(src)) {
    const path = key === "$root" ? prefix : prefix ? `${prefix}.${key}` : key;
    if (key.startsWith("$") && key !== "$root") {
      target[key] = child;
      continue;
    }
    if (key === "$root" ? !prefix : !NAME_RE.test(key)) fail(`${where}: invalid token or group name "${key}"${prefix ? ` in "${prefix}"` : ""}`);
    if (isObject(child) && "$value" in child) {
      if (child.$type !== undefined && typeof child.$type !== "string") fail(`${where}: "${path}" has a non-string $type`);
      origin.set(child, where);
      target[key] = child;
    } else if (key === "$root") fail(`${where}: "${path}.$root" must be a token`);
    else if (isObject(child)) {
      const cur = target[key];
      const group = isObject(cur) && !("$value" in cur) ? cur : (target[key] = {});
      mergeInto(group as Json, child, where, origin, path);
    } else fail(`${where}: "${path}" is neither a token nor a group`);
  }
}

/** Every token of a merged document by path, with its own and its group's `$type`. */
function flatten(doc: Json, origin: WeakMap<object, string>, out: Map<string, RawToken>, prefix = "", inherited?: string): void {
  const groupType = typeof doc.$type === "string" ? doc.$type : inherited;
  for (const [key, child] of Object.entries(doc)) {
    if (key.startsWith("$") && key !== "$root") continue;
    if (!isObject(child)) continue;
    const path = key === "$root" ? prefix : prefix ? `${prefix}.${key}` : key;
    if ("$value" in child) out.set(path, { own: child.$type as string | undefined, group: groupType, value: child.$value, where: origin.get(child) ?? "tokens" });
    else flatten(child, origin, out, path, groupType);
  }
}

// ---------------------------------------------------------------- resolver

interface Modifier {
  contexts: Json;
  default: string | undefined;
  description: string | undefined;
}

function readResolver(files: TokenFiles, path: string): Json {
  const r = fileAt(files, path, "theme");
  if (!isObject(r)) return fail(`${path}: not a resolver document`);
  if (r.version !== "2025.10") fail(`${path}: version must be "2025.10" (got ${JSON.stringify(r.version)})`);
  if (!Array.isArray(r.resolutionOrder)) fail(`${path}: resolutionOrder must be an array`);
  return r;
}

function modifierOf(m: unknown, name: string, where: string): Modifier {
  if (!isObject(m) || !isObject(m.contexts)) return fail(`${where}: modifier "${name}" has no contexts`);
  if (m.default !== undefined && (typeof m.default !== "string" || !(m.default in m.contexts))) fail(`${where}: modifier "${name}" has an invalid default`);
  return { contexts: m.contexts, default: m.default as string | undefined, description: typeof m.description === "string" ? m.description : undefined };
}

/** Every modifier: those under `modifiers` and those written inline in `resolutionOrder`, in that order. */
function modifiersOf(r: Json, where: string): Map<string, Modifier> {
  const out = new Map<string, Modifier>();
  for (const [name, m] of Object.entries(isObject(r.modifiers) ? r.modifiers : {})) out.set(name, modifierOf(m, name, where));
  for (const item of r.resolutionOrder as unknown[]) {
    if (!isObject(item) || item.type !== "modifier") continue;
    if (typeof item.name !== "string") fail(`${where}: an inline modifier needs a name`);
    if (out.has(item.name as string)) fail(`${where}: modifier "${String(item.name)}" is defined twice`);
    out.set(item.name as string, modifierOf(item, item.name as string, where));
  }
  return out;
}

/** Names, descriptions and contexts of a resolver's modifiers (what a settings page offers). */
export function resolverInfo(files: TokenFiles, path: string): ResolverInfo {
  const r = readResolver(files, path);
  return {
    name: typeof r.name === "string" ? r.name : undefined,
    description: typeof r.description === "string" ? r.description : undefined,
    modifiers: [...modifiersOf(r, path)].map(([name, m]) => ({ name, description: m.description, contexts: Object.keys(m.contexts), default: m.default })),
  };
}

/**
 * Resolve a theme: merge the sources the resolution order selects for these inputs (modifier name -> context;
 * case-insensitive, defaults for the rest), then resolve aliases. Throws TokenError on anything malformed.
 */
export function resolveTokens(files: TokenFiles, path: string, inputs: Readonly<Record<string, string>> = {}): Map<string, Token> {
  const r = readResolver(files, path);
  const mods = modifiersOf(r, path);
  const chosen = new Map<string, string>();
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v !== "string") fail(`${path}: input "${k}" must be a string`);
    const name = [...mods.keys()].find((n) => n.toLowerCase() === k.toLowerCase());
    if (name === undefined) return fail(`${path}: no modifier "${k}"`);
    const ctx = Object.keys(mods.get(name)!.contexts).find((c) => c.toLowerCase() === v.toLowerCase());
    if (ctx === undefined) return fail(`${path}: modifier "${name}" has no context "${v}"`);
    chosen.set(name, ctx);
  }

  const merged: Json = {};
  const origin = new WeakMap<object, string>();
  const addSources = (sources: unknown, where: string): void => {
    if (!Array.isArray(sources)) return fail(`${where}: sources must be an array`);
    for (const s of sources) {
      if (isObject(s) && typeof s.$ref === "string") {
        const [file = "", frag] = s.$ref.split("#", 2);
        if (file === "") fail(`${where}: a source cannot point into the resolver ("${s.$ref}")`);
        const target = joinPath(path, file);
        const doc = fileAt(files, target, where);
        mergeInto(merged, frag !== undefined ? pointer(doc, `#${frag}`, target) : doc, target, origin);
      } else mergeInto(merged, s, `${where} (inline)`, origin);
    }
  };
  const addModifier = (name: string): void => {
    const m = mods.get(name);
    if (!m) return fail(`${path}: no modifier "${name}"`);
    const ctx = chosen.get(name) ?? m.default;
    if (ctx === undefined) return fail(`${path}: modifier "${name}" needs an input (it has no default)`);
    addSources(m.contexts[ctx], `${path} modifier ${name}=${ctx}`);
  };

  for (const item of r.resolutionOrder as unknown[]) {
    if (isObject(item) && typeof item.$ref === "string") {
      const set = /^#\/sets\/(.+)$/.exec(item.$ref);
      const mod = /^#\/modifiers\/(.+)$/.exec(item.$ref);
      if (set) {
        const s = isObject(r.sets) ? r.sets[set[1]!] : undefined;
        if (!isObject(s)) fail(`${path}: no set "${set[1]}"`);
        addSources((s as Json).sources, `${path} set ${set[1]}`);
      } else if (mod) addModifier(mod[1]!);
      else fail(`${path}: resolutionOrder entries must point to #/sets/... or #/modifiers/... (got "${item.$ref}")`);
    } else if (isObject(item) && item.type === "set") addSources(item.sources, `${path} set ${String(item.name)}`);
    else if (isObject(item) && item.type === "modifier") addModifier(item.name as string);
    else fail(`${path}: invalid resolutionOrder entry ${JSON.stringify(item)}`);
  }
  const raw = new Map<string, RawToken>();
  flatten(merged, origin, raw);
  return resolveAliases(raw);
}

/** Resolve `{a.b}` aliases in merged tokens (also inside composite values). */
function resolveAliases(raw: ReadonlyMap<string, RawToken>): Map<string, Token> {
  const done = new Map<string, Token>();
  const busy = new Set<string>();
  const ALIAS = /^\{([^{}]+)\}$/;

  const token = (path: string, from: string): Token => {
    const hit = done.get(path);
    if (hit) return hit;
    const t = raw.get(path);
    if (!t) return fail(`${from}: alias to unknown token "${path}"`);
    if (busy.has(path)) return fail(`${t.where}: alias cycle through "${path}"`);
    busy.add(path);
    let aliasType: string | undefined;
    const value = (v: unknown): unknown => {
      if (typeof v === "string") {
        const m = ALIAS.exec(v);
        if (!m) return v;
        const target = token(m[1]!, `${t.where} "${path}"`);
        if (v === t.value) aliasType = target.type;
        return target.value;
      }
      if (Array.isArray(v)) return v.map(value);
      if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)]));
      return v;
    };
    const resolved = value(t.value);
    const type = t.own ?? aliasType ?? t.group;
    if (t.own !== undefined && aliasType !== undefined && aliasType !== t.own) fail(`${t.where}: "${path}" is a ${t.own} but aliases a ${aliasType}`);
    busy.delete(path);
    const out: Token = { type, value: resolved };
    done.set(path, out);
    return out;
  };

  for (const path of raw.keys()) token(path, path);
  // Keep the merged order.
  return new Map([...raw.keys()].map((p) => [p, done.get(p)!]));
}

// ---------------------------------------------------------------- colors

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const byte = (x: number): number => Math.round(clamp01(x) * 255);

/** A DTCG color value as sRGB. Throws TokenError for anything else. */
export function parseColor(value: unknown, what = "color"): Rgba {
  if (!isObject(value)) return fail(`${what}: a color must be an object with colorSpace and components (got ${JSON.stringify(value)})`);
  const { colorSpace, components, alpha, hex } = value;
  const a = alpha === undefined ? 1 : typeof alpha === "number" ? clamp01(alpha) : fail(`${what}: alpha must be a number`);
  const nums = (): number[] => {
    if (!Array.isArray(components) || components.length !== 3) return fail(`${what}: components must have 3 entries`);
    return components.map((c) => (c === "none" ? 0 : typeof c === "number" && Number.isFinite(c) ? c : fail(`${what}: invalid component ${JSON.stringify(c)}`)));
  };
  if (colorSpace === "srgb") {
    const [r, g, b] = nums() as [number, number, number];
    return { r: byte(r), g: byte(g), b: byte(b), a };
  }
  if (colorSpace === "hsl") {
    const [h, s, l] = nums() as [number, number, number];
    const [r, g, b] = hslToRgb(h, s / 100, l / 100);
    return { r: byte(r), g: byte(g), b: byte(b), a };
  }
  if (typeof hex === "string") return { ...parseHex(hex, what), a };
  return fail(`${what}: color space ${JSON.stringify(colorSpace)} is not supported and there is no hex fallback`);
}

function parseHex(hex: string, what: string): Rgba {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return fail(`${what}: hex must be #rrggbb (got "${hex}")`);
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/** CSS text: `#rrggbb` when opaque, else `rgb(r g b / a)`. */
export function cssColor(c: Rgba): string {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgb(${c.r} ${c.g} ${c.b} / ${Math.round(c.a * 1000) / 1000})`;
}

/** The same color with another alpha, as CSS text. */
export function withAlpha(c: Rgba, a: number): string {
  return cssColor({ ...c, a });
}

/** WCAG 2 relative luminance (0 black – 1 white). */
export function luminance(c: Rgba): number {
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2 contrast ratio (1–21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
