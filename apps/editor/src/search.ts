// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The search behind the title bar's search field (Ctrl+P), after VS Code's Quick Open and command palette: one list
 * of everything a name can find — states, regions, transitions, internal transitions, timers and declarations of every open
 * machine, the machines themselves, every command of the menus and the settings — ranked by how well it matches.
 * A prefix narrows it, as in VS Code: `>` commands and settings (Ctrl+Shift+P, F1), `@` elements of the machine in
 * focus, `#` elements of all open machines, `?` lists the prefixes.
 *
 * Ranking: the match's class first (the exact name, a prefix, every word at a word start, anything else), and within a
 * class the machine in focus (with commands and settings) before the other machines, then recently picked items, then
 * the fuzzy score. So "idle" lists the focused machine's Idle before another machine's Idle, but an exact name
 * elsewhere still beats a prefix or a few scattered letters here.
 *
 * No DOM: the title bar renders the matches (quickpick.tsx), main.ts supplies the commands and runs the pick.
 */
import { actionLabel, ancestors, internalTransitionLabel, timerLabel, transitionLabel, vertexName, type DeclKind, type DocIndex } from "@ufsm/core";

export type ItemKind =
  | "command"
  | "setting"
  | "machine"
  | "state"
  | "pseudo"
  | "region"
  | "transition"
  | "internal"
  | "timer"
  | DeclKind
  | "help";

export interface SearchItem {
  /** Unique and stable across openings: recently picked items are remembered by it. */
  key: string;
  kind: ItemKind;
  /** The text shown and matched first: "Add: Transition", a state's name. */
  label: string;
  /** Shown dimmed after the label and matched too, more weakly: a state's parents, a transition's ends. */
  detail?: string;
  /** Matched like `detail` but not shown: other words for the same thing ("dark mode"). */
  keywords?: string;
  /** Shortcut shown at the right ("Ctrl+Z", "A T"). */
  keys?: string;
  /** The machine (Doc key) an element or machine item belongs to; undefined for commands and settings. */
  doc?: number;
  /** That machine's file name, shown at the right of elements of machines not in focus. */
  docName?: string;
  /** The element's id in its machine (picking shows it). */
  id?: string;
  /** A setting's value that is in use now (shown with a check mark). */
  checked?: boolean;
  /** Help rows: picking one puts this prefix in the field. */
  prefix?: string;
  /** Commands and settings: what picking does. */
  run?(): void;
  /** Shown while the row is highlighted (a color theme), undone when the search closes without picking it. */
  preview?(): void;
}

export type Mode = "all" | "commands" | "machine" | "machines" | "help";

export const PREFIXES: readonly { prefix: string; mode: Mode; text: string }[] = [
  { prefix: ">", mode: "commands", text: "Commands and settings" },
  { prefix: "@", mode: "machine", text: "Go to an element of the machine in focus" },
  { prefix: "#", mode: "machines", text: "Go to an element of any open machine" },
  { prefix: "?", mode: "help", text: "Help: what the prefixes do" },
];

/** Split the field's text into the mode its first character selects and the query after it. */
export function parseQuery(text: string): { mode: Mode; query: string; prefix: string } {
  const p = PREFIXES.find((x) => text.startsWith(x.prefix));
  return p ? { mode: p.mode, query: text.slice(p.prefix.length).trim(), prefix: p.prefix } : { mode: "all", query: text.trim(), prefix: "" };
}

/** Placeholder of the field for a mode. */
export function modeHint(mode: Mode, machine: string | undefined): string {
  switch (mode) {
    case "commands":
      return "Type a command or setting";
    case "machine":
      return machine ? `Go to an element of ${machine}` : "No machine open";
    case "machines":
      return "Go to an element of any open machine";
    case "help":
      return "Pick a prefix";
    default:
      return "Search states, transitions, commands, settings (? for more)";
  }
}

/** The `?` rows: one per prefix (plain search first). */
export function helpItems(machine: string | undefined): SearchItem[] {
  return [
    { key: "help:", kind: "help", label: "…", detail: "Search everything: elements of every open machine, commands, settings", prefix: "" },
    ...PREFIXES.filter((p) => p.mode !== "help").map((p) => ({
      key: `help:${p.prefix}`,
      kind: "help" as const,
      label: `${p.prefix} …`,
      detail: p.mode === "machine" && machine ? `Go to an element of ${machine}` : p.text,
      prefix: p.prefix,
      ...(p.mode === "commands" ? { keys: "Ctrl+Shift+P" } : {}),
    })),
  ];
}

const ELEMENT_KINDS: ReadonlySet<ItemKind> = new Set(["state", "pseudo", "region", "transition", "internal", "timer", "event", "signal", "action", "guard"]);
export const isElement = (it: SearchItem): boolean => ELEMENT_KINDS.has(it.kind);
const isCommand = (it: SearchItem): boolean => it.kind === "command" || it.kind === "setting";

// ---------------------------------------------------------------- elements of a machine

const PSEUDO_NAMES: Readonly<Record<string, string>> = {
  initial: "initial state",
  final: "final state",
  "shallow-history": "history",
  "deep-history": "deep history",
  fork: "fork",
  join: "join",
  terminate: "terminate",
};

/**
 * Everything of one machine a search can find, in document order: states (and named pseudo-states), off-page regions
 * and named regions of states with several, transitions, internal transitions, timers, then declarations (events, signals,
 * actions, guards).
 */
export function elementItems(index: DocIndex, doc: number, docName: string): SearchItem[] {
  const out: SearchItem[] = [];
  const base = { doc, docName };
  const path = (id: string): string => ancestors(index, id).map((s) => s.name).join(" › ");
  const key = (id: string): string => `el:${docName}:${id}`;
  const offPage = (id: string): boolean => index.doc.diagram?.regions[id]?.offPage === true;

  for (const { vertex: v } of index.vertices.values()) {
    if (v.kind === "state") {
      // entry/exit actions as hidden words: searching an action also finds the states that call it
      const calls = [...(v.entry ?? []), ...(v.exit ?? [])].map((a) => actionLabel(index, a)).join(" ");
      out.push({ ...base, key: key(v.id), kind: "state", id: v.id, label: v.name || "(unnamed)", detail: path(v.id), ...(calls ? { keywords: calls } : {}) });
    } else if (v.name) {
      const where = path(v.id);
      out.push({ ...base, key: key(v.id), kind: "pseudo", id: v.id, label: v.name, detail: where ? `${PSEUDO_NAMES[v.kind]} in ${where}` : PSEUDO_NAMES[v.kind] });
    }
  }
  for (const { region: r, owner } of index.regions.values()) {
    // a state's only region is just its body (the state is found already); converted files call them all "New region"
    if (!owner || !(offPage(r.id) || (r.name && (owner.regions?.length ?? 0) > 1))) continue;
    const where = [path(owner.id), owner.name].filter(Boolean).join(" › ");
    out.push({ ...base, key: key(r.id), kind: "region", id: r.id, label: r.name || owner.name, detail: `${offPage(r.id) ? "sheet" : "region"} of ${where}` });
  }
  for (const t of index.transitions.values()) {
    const ends = `${vertexName(index, t.from)} → ${vertexName(index, t.to)}`;
    const text = transitionLabel(index, t);
    out.push({ ...base, key: key(t.id), kind: "transition", id: t.id, label: text || ends, detail: text ? ends : "", keywords: t.id });
  }
  for (const { transition: t, state } of index.internals.values()) {
    out.push({ ...base, key: key(t.id), kind: "internal", id: t.id, label: internalTransitionLabel(index, t), detail: `internal, in ${state.name}` });
  }
  for (const { timer: t, state } of index.timers.values()) {
    // the label `t/name(20 s, eEvent)` is searched by the timer's name; the rest are hidden words
    out.push({ ...base, key: key(t.id), kind: "timer", id: t.id, label: t.name, detail: `${timerLabel(index, t)} in ${state.name}`, keywords: timerLabel(index, t) });
  }
  for (const { kind, decl } of index.decls.values()) {
    out.push({ ...base, key: key(decl.id), kind, id: decl.id, label: decl.name, detail: decl.doc ? `${kind} · ${decl.doc}` : kind });
  }
  return out;
}

// ---------------------------------------------------------------- matching

/** Where a word starts: the first character, after a separator, a lower-to-upper case change, letter/digit change. */
function wordStarts(text: string): boolean[] {
  const starts: boolean[] = [];
  const alnum = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);
  const upper = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase();
  const lower = (c: string): boolean => c !== c.toUpperCase() && c === c.toLowerCase();
  const digit = (c: string): boolean => c >= "0" && c <= "9";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const p = text[i - 1];
    starts.push(
      p === undefined ||
        (alnum(c) && !alnum(p)) ||
        (upper(c) && lower(p)) ||
        (digit(c) !== digit(p) && alnum(c) && alnum(p)),
    );
  }
  return starts;
}

export interface Fuzzy {
  score: number;
  /** Indexes into the text of the matched characters. */
  positions: number[];
}

const NEG = -1e9;

/**
 * Best alignment of `term`'s characters, in order, in `text` (case-insensitive), or undefined when they are not all
 * there. Characters at word starts, runs of consecutive characters and the very start of the text score more; a
 * gap costs a little, so "st" in "Add: State" picks the St of State, not the s of "Add" and a later t. As in VS Code,
 * scattered letters must start at a word start ("rqst" finds Requesting, "equst" does not); the whole term as one run
 * may start anywhere ("quest" does).
 */
export function fuzzyMatch(term: string, text: string): Fuzzy | undefined {
  const q = term.toLowerCase();
  const t = text.toLowerCase();
  const m = q.length;
  const n = t.length;
  if (m === 0) return { score: 0, positions: [] };
  if (m > n) return undefined;
  // cheap subsequence test first
  for (let i = 0, j = 0; i < m; i++, j++) {
    j = t.indexOf(q[i]!, j);
    if (j < 0) return undefined;
  }
  const starts = wordStarts(text);
  const score = new Float64Array(m * n).fill(NEG);
  const from = new Int32Array(m * n).fill(-1);
  for (let i = 0; i < m; i++) {
    let gapBest = NEG;
    let gapFrom = -1;
    for (let j = i; j < n; j++) {
      // predecessors at least two characters back are a gap (the one just before is a run)
      if (i > 0 && j >= 2) {
        const k = j - 2;
        const s = score[(i - 1) * n + k]!;
        if (s > gapBest) {
          gapBest = s;
          gapFrom = k;
        }
      }
      if (t[j] !== q[i]) continue;
      let cs = 1;
      if (starts[j]) cs += 8;
      if (j === 0) cs += 4;
      if (text[j] === term[i]) cs += 0.5;
      if (i === 0) {
        if (starts[j] || t.startsWith(q, j)) score[j] = cs - j * 0.05;
        continue;
      }
      const run = j >= 1 ? score[(i - 1) * n + j - 1]! + 6 : NEG;
      const gap = gapBest - 1;
      if (run <= NEG / 2 && gapBest <= NEG / 2) continue;
      if (run >= gap) {
        score[i * n + j] = run + cs;
        from[i * n + j] = j - 1;
      } else {
        score[i * n + j] = gap + cs;
        from[i * n + j] = gapFrom;
      }
    }
  }
  let best = NEG;
  let at = -1;
  for (let j = 0; j < n; j++) {
    const s = score[(m - 1) * n + j]!;
    if (s > best) {
      best = s;
      at = j;
    }
  }
  if (at < 0 || best <= NEG / 2) return undefined;
  const positions: number[] = [];
  for (let i = m - 1, j = at; i >= 0; i--) {
    positions.unshift(j);
    j = from[i * n + j]!;
  }
  return { score: best, positions };
}

/** The part of a command's label after its category: "Transition" of "Add: Transition". */
const nameOf = (label: string): string => label.slice(label.lastIndexOf(": ") + 1).trim();

/** `term` as one run in `text` (case-insensitive), preferring an occurrence at a word start; scored like a fuzzy run. */
export function substringMatch(term: string, text: string): Fuzzy | undefined {
  const q = term.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return { score: 0, positions: [] };
  const starts = wordStarts(text);
  let at = -1;
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
    if (at < 0) at = i;
    if (starts[i]) {
      at = i;
      break;
    }
  }
  if (at < 0) return undefined;
  const score = q.length + 6 * (q.length - 1) + (starts[at] ? 8 : 0) + (at === 0 ? 4 : 0);
  return { score, positions: Array.from({ length: q.length }, (_, k) => at + k) };
}

/** True when `word` occurs in `text` at a word start (case-insensitive). */
function atWordStart(word: string, text: string, starts: boolean[]): boolean {
  const t = text.toLowerCase();
  for (let i = t.indexOf(word); i >= 0; i = t.indexOf(word, i + 1)) if (starts[i]) return true;
  return false;
}

export interface Match {
  item: SearchItem;
  /** 3: exact, 2: prefix, 1: every word at a word start, 0: anything else that matches. */
  tier: number;
  score: number;
  /** Matched characters of the label and of the detail, for highlighting. */
  labelHits: number[];
  detailHits: number[];
  /** Label of a group that starts at this row (empty queries only: "recently used"). */
  group?: string;
}

/** How `item` matches the words of `query` (all of them must match), or undefined. */
export function matchItem(item: SearchItem, query: string): Omit<Match, "item"> | undefined {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { tier: 0, score: 0, labelHits: [], detailHits: [] };
  const label = item.label;
  const detail = item.detail ?? "";
  const hidden = item.keywords ?? "";
  const labelHits = new Set<number>();
  const detailHits = new Set<number>();
  let score = 0;
  let inLabel = true;
  for (const w of words) {
    const a = fuzzyMatch(w, label);
    // the detail and the hidden words only match whole runs: scattered letters there find too much
    const b = detail ? substringMatch(w, detail) : undefined;
    const c = hidden ? substringMatch(w, hidden) : undefined;
    const sa = a ? a.score : NEG;
    const sb = b ? b.score * 0.5 : NEG;
    const sc = c ? c.score * 0.4 : NEG;
    if (sa <= NEG / 2 && sb <= NEG / 2 && sc <= NEG / 2) return undefined;
    if (sa >= sb && sa >= sc) {
      score += sa;
      a!.positions.forEach((p) => labelHits.add(p));
    } else {
      inLabel = false;
      if (sb >= sc) {
        score += sb;
        b!.positions.forEach((p) => detailHits.add(p));
      } else score += sc;
    }
  }
  const q = words.join(" ");
  const l = label.toLowerCase();
  const name = nameOf(l);
  const starts = wordStarts(label);
  let tier = 0;
  if (l === q || name === q) tier = 3;
  // the category alone ("a" of "Add: State") is no prefix match: every command of that menu would be one
  else if (name.startsWith(q) || (l.startsWith(q) && (q.includes(":") || l === name))) tier = 2;
  else if (inLabel && words.every((w) => atWordStart(w, label, starts))) tier = 1;
  return { tier, score, labelHits: [...labelHits].sort((x, y) => x - y), detailHits: [...detailHits].sort((x, y) => x - y) };
}

// ---------------------------------------------------------------- ranking

export interface SearchContext {
  /** The machine in focus (its elements come first); undefined when none is open. */
  activeDoc: number | undefined;
  /** Keys of recently picked items, most recent first. */
  recent: readonly string[];
  /** At most this many rows (default 200). */
  limit?: number;
}

const KIND_ORDER: readonly ItemKind[] = ["state", "machine", "command", "setting", "region", "pseudo", "transition", "internal", "timer", "event", "signal", "action", "guard", "help"];

/** Items `mode` looks at. */
function inMode(it: SearchItem, mode: Mode, activeDoc: number | undefined): boolean {
  switch (mode) {
    case "commands":
      return isCommand(it);
    case "machine":
      return isElement(it) && it.doc === activeDoc;
    case "machines":
      return isElement(it) || it.kind === "machine";
    case "help":
      return it.kind === "help";
    default:
      return it.kind !== "help";
  }
}

/** The ranked rows for the field's text (prefix included). */
export function search(items: readonly SearchItem[], text: string, ctx: SearchContext): Match[] {
  const { mode, query } = parseQuery(text);
  const limit = ctx.limit ?? 200;
  const pool = items.filter((it) => inMode(it, mode, ctx.activeDoc));
  const recentRank = new Map(ctx.recent.map((k, i) => [k, i]));
  const plain = (item: SearchItem): Match => ({ item, tier: 0, score: 0, labelHits: [], detailHits: [] });

  if (query === "") {
    if (mode === "help") return pool.map(plain);
    const recent = pool.filter((it) => recentRank.has(it.key)).sort((a, b) => recentRank.get(a.key)! - recentRank.get(b.key)!);
    let rest: SearchItem[];
    if (mode === "all") {
      // like VS Code's Quick Open: what was picked lately, then how to narrow the search
      rest = items.filter((it) => it.kind === "help");
      recent.splice(12);
    } else if (mode === "commands") {
      rest = pool.filter((it) => !recentRank.has(it.key)).sort((a, b) => a.label.localeCompare(b.label));
    } else {
      // elements in document order, the focused machine first
      rest = pool.filter((it) => !recentRank.has(it.key)).sort((a, b) => Number(b.doc === ctx.activeDoc) - Number(a.doc === ctx.activeDoc));
    }
    const rows = [...recent, ...rest].slice(0, limit).map(plain);
    if (recent.length > 0 && rows[0]) rows[0].group = "recently used";
    const firstRest = rows[recent.length];
    if (firstRest && recent.length > 0) firstRest.group = mode === "all" ? "search modes" : mode === "commands" ? "other commands" : "elements";
    return rows;
  }

  const priority = (it: SearchItem): number => (it.doc === undefined || it.doc === ctx.activeDoc ? 1 : 0);
  const rows: Match[] = [];
  for (const item of pool) {
    const m = matchItem(item, query);
    if (m) rows.push({ item, ...m });
  }
  rows.sort(
    (a, b) =>
      b.tier - a.tier ||
      priority(b.item) - priority(a.item) ||
      (recentRank.get(a.item.key) ?? Infinity) - (recentRank.get(b.item.key) ?? Infinity) ||
      b.score - a.score ||
      KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) ||
      a.item.label.length - b.item.label.length ||
      a.item.label.localeCompare(b.item.label),
  );
  return rows.slice(0, limit);
}

/** The recent list after picking `key`: it moves to the front; at most `max` are kept. */
export function remember(recent: readonly string[], key: string, max = 30): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, max);
}

// ---------------------------------------------------------------- commands from the menus

export interface MenuLike {
  label: string;
  items: ("-" | { label: string | (() => string); keys?: string; run(): void; enabled?(): boolean; checked?(): boolean })[];
}

/**
 * Every enabled menu item as a command, labelled VS Code style with its menu as the category ("Edit: Undo"). Items
 * whose label changes ("Start Simulation" / "Restart Simulation") are keyed by the menu and position, so recency survives.
 */
export function menuCommands(menus: readonly MenuLike[], skip: (menu: string, label: string) => boolean = () => false): SearchItem[] {
  const out: SearchItem[] = [];
  for (const menu of menus) {
    menu.items.forEach((it, i) => {
      if (it === "-" || (it.enabled && !it.enabled())) return;
      const text = typeof it.label === "function" ? it.label() : it.label;
      if (skip(menu.label, text)) return;
      const label = `${menu.label}: ${text.replace(/…$/, "")}`;
      const key = typeof it.label === "function" ? `cmd:${menu.label}#${i}` : `cmd:${label}`;
      out.push({
        key,
        kind: "command",
        label,
        run: it.run,
        ...(it.keys ? { keys: it.keys } : {}),
        ...(it.checked ? { checked: it.checked() } : {}),
      });
    });
  }
  return out;
}
