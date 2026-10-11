// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Layout of a state's action block: the area below the name with entry and exit actions, timers and internal
 * transitions.
 *
 * Every line starts with an icon that tells its kind (drawn by the editor), followed by text in a fixed-width font.
 * The text is measured in character cells (ACTION_CHAR_W units each), so the layout is the same wherever it is
 * computed: here, in the design rule check and on every platform's canvas.
 *
 *   - entry actions share one line, exit actions the next; a list that is wider than the state wraps, the
 *     continuation lines starting under the first action;
 *   - timers sit side by side while they fit, each with its own icon (one-shot or periodic);
 *   - every internal transition starts a line of its own and wraps at spaces.
 *
 * The block is as tall as its lines unless the diagram stores a smaller height for the state (`actionsHeight`).
 * Then only the first lines are shown and a marker on the block's bottom line counts what is hidden, per kind. At
 * the smallest height (one line) the block shows only the number of items of each kind.
 */
import { declName, type DocIndex } from "../model/doc-index";
import { actionLabel, internalTransitionLabel } from "../model/labels";
import type { Action, Id, State, Timer } from "../format/model";

/** Height of a state's name header (geometry.ts exports it as HEADER_H). */
export const HEADER = 30;
/** Height of one line of the action block. */
export const ACTION_LINE_H = 20;
/** Space above and below the lines together (half of it on each side). */
export const ACTION_PAD = 10;
/** Width of one character cell of the block's fixed-width text. */
export const ACTION_CHAR_W = 7;
/** Space between the state's outline and the block's content, left and right. */
export const ACTION_MARGIN = 10;
/** Size of a kind icon (a square). */
export const ACTION_ICON = 16;
/** Space between an icon and its text. */
export const ACTION_ICON_GAP = 4;
/** Space between two timers on one line. */
export const ACTION_ITEM_GAP = 16;
/** Where text starts, from the state's left edge. */
export const ACTION_TEXT_X = ACTION_MARGIN + ACTION_ICON + ACTION_ICON_GAP;
/** The smallest height of a block with content: one line. */
export const ACTION_MIN_H = ACTION_PAD + ACTION_LINE_H;

/** Height of the marker that counts hidden items, and the cell width of its digits. */
export const HIDDEN_MARKER_H = 16;
export const HIDDEN_MARKER_CHAR_W = 7;
/** Size of the icons inside the marker. */
export const HIDDEN_MARKER_ICON = 12;

/** What a line (or a timer on a line) is; each kind has its own icon. `after` and `every` are the two timer kinds. */
export type ActionKind = "entry" | "exit" | "after" | "every" | "internal";
export const ACTION_KINDS: readonly ActionKind[] = ["entry", "exit", "after", "every", "internal"];

export type ActionCounts = Record<ActionKind, number>;

/** A run of text on a line, with the icon in front of it when it starts an item group. */
export interface ActionSegment {
  /** Icon drawn at `x`; the text then starts ACTION_ICON + ACTION_ICON_GAP further right. Absent on continuation lines. */
  icon?: ActionKind;
  /** Left edge of the icon, or of the text when there is no icon; from the state's left edge. */
  x: number;
  text: string;
}

export interface ActionRow {
  segments: ActionSegment[];
  /** True when the line continues the list or internal transition of the line above. */
  continued: boolean;
}

/** The marker on the block's bottom line that counts hidden items. Coordinates from the state's top-left corner. */
export interface HiddenMarker {
  x: number;
  y: number;
  w: number;
  h: number;
  /** A chevron, then an icon and a count per kind; or, in a narrow state, the chevron and `+total` (no icon). */
  parts: { icon?: ActionKind; x: number; text: string }[];
}

export interface ActionBlock {
  /** Every line of the full layout, top-down. */
  rows: ActionRow[];
  /** Items per kind: actions, timers, internal transitions. */
  counts: ActionCounts;
  /** Height that shows every line; 0 for a state without actions, timers and internal transitions. */
  auto: number;
  /** Height of the block as drawn: `auto`, or the stored height when that is smaller. */
  height: number;
  /** True when a stored height hides lines. */
  limited: boolean;
  /** Lines drawn: the first `visible` rows; 0 when `summary`. */
  visible: number;
  /** True at the smallest height when there is more than one line: the block shows `summaryRow` only. */
  summary: boolean;
  /** One line with an icon and the number of items for every kind that has any (drawn after a chevron at ACTION_MARGIN). */
  summaryRow: ActionSegment[];
  /** True when the last visible line is cut in the middle of a list or an internal transition: it ends with an ellipsis. */
  cut: boolean;
  /** Items that are not shown completely, per kind (all zero unless `limited`). */
  hidden: ActionCounts;
  /** The marker for hidden items, when lines are hidden and the block is not a summary. */
  hiddenMarker: HiddenMarker | undefined;
}

const noCounts = (): ActionCounts => ({ entry: 0, exit: 0, after: 0, every: 0, internal: 0 });

/** A timer as the block shows it, after its icon: `20 s → eTimeout` (the icon tells one-shot from periodic). */
export function timerBlockLabel(index: DocIndex, t: Timer): string {
  return `${t.every ?? t.after} ${t.unit} → ${declName(index, t.event)}`;
}

const timerKind = (t: Timer): ActionKind => (t.every !== undefined ? "every" : "after");

interface Item {
  kind: ActionKind;
  /** Index of the last row the item has text on. */
  last: number;
}

/** Greedy wrap of words into lines of at most `cols` characters; a word longer than that gets a line of its own. */
function wrap(words: string[], cols: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  let len = 0;
  for (const w of words) {
    if (line.length > 0 && len + 1 + w.length > cols) {
      lines.push(line);
      line = [];
      len = 0;
    }
    len += (line.length > 0 ? 1 : 0) + w.length;
    line.push(w);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function layout(index: DocIndex, s: State, width: number, stored: number | undefined): ActionBlock {
  const rows: ActionRow[] = [];
  const items: Item[] = [];
  const counts = noCounts();
  const cols = Math.max(1, Math.floor((width - ACTION_TEXT_X - ACTION_MARGIN) / ACTION_CHAR_W));

  const list = (kind: ActionKind, actions: Action[] | undefined): void => {
    if (!actions?.length) return;
    counts[kind] += actions.length;
    const words = actions.map((a, i) => actionLabel(index, a) + (i < actions.length - 1 ? "," : ""));
    wrap(words, cols).forEach((line, k) => {
      for (let i = 0; i < line.length; i++) items.push({ kind, last: rows.length });
      rows.push({
        segments: [k === 0 ? { icon: kind, x: ACTION_MARGIN, text: line.join(" ") } : { x: ACTION_TEXT_X, text: line.join(" ") }],
        continued: k > 0,
      });
    });
  };
  list("entry", s.entry);
  list("exit", s.exit);

  // timers side by side while they fit
  let row: ActionRow | undefined;
  let x = ACTION_MARGIN;
  for (const t of s.timers ?? []) {
    const kind = timerKind(t);
    counts[kind]++;
    const text = timerBlockLabel(index, t);
    const w = ACTION_ICON + ACTION_ICON_GAP + text.length * ACTION_CHAR_W;
    if (!row || x + w > width - ACTION_MARGIN) {
      row = { segments: [], continued: false };
      rows.push(row);
      x = ACTION_MARGIN;
    }
    row.segments.push({ icon: kind, x, text });
    items.push({ kind, last: rows.length - 1 });
    x += w + ACTION_ITEM_GAP;
  }

  for (const t of s.internal ?? []) {
    counts.internal++;
    const lines = wrap(internalTransitionLabel(index, t).split(" "), cols);
    lines.forEach((line, k) => {
      rows.push({
        segments: [k === 0 ? { icon: "internal", x: ACTION_MARGIN, text: line.join(" ") } : { x: ACTION_TEXT_X, text: line.join(" ") }],
        continued: k > 0,
      });
    });
    items.push({ kind: "internal", last: rows.length - 1 });
  }

  const auto = rows.length > 0 ? ACTION_PAD + ACTION_LINE_H * rows.length : 0;
  const limited = stored !== undefined && rows.length > 0 && stored < auto;
  const height = limited ? Math.max(stored, ACTION_MIN_H) : auto;
  const lines = limited ? Math.max(1, Math.floor((height - ACTION_PAD) / ACTION_LINE_H)) : rows.length;
  const summary = limited && lines === 1 && rows.length > 1;
  const visible = summary ? 0 : Math.min(lines, rows.length);
  const hidden = noCounts();
  for (const it of items) if (it.last >= visible && visible < rows.length) hidden[it.kind]++;

  const summaryRow: ActionSegment[] = [];
  let sx = ACTION_MARGIN + ACTION_ICON + ACTION_ICON_GAP;
  for (const kind of ACTION_KINDS) {
    if (counts[kind] === 0) continue;
    const text = String(counts[kind]);
    summaryRow.push({ icon: kind, x: sx, text });
    sx += ACTION_ICON + ACTION_ICON_GAP + text.length * ACTION_CHAR_W + ACTION_CHAR_W;
  }

  return {
    rows,
    counts,
    auto,
    height,
    limited: limited && visible < rows.length,
    visible,
    summary,
    summaryRow,
    cut: !summary && visible < rows.length && rows[visible]!.continued,
    hidden,
    hiddenMarker: !summary && visible < rows.length ? hiddenMarkerOf(hidden, width, height) : undefined,
  };
}

/** The hidden-items marker: right-aligned, centred on the block's bottom line. */
function hiddenMarkerOf(hidden: ActionCounts, width: number, blockHeight: number): HiddenMarker {
  const pad = 5, gap = 4;
  const build = (entries: { icon?: ActionKind; text: string }[]): { w: number; parts: HiddenMarker["parts"] } => {
    // the chevron comes first (drawn by the editor in the first HIDDEN_MARKER_ICON units)
    let x = pad + HIDDEN_MARKER_ICON;
    const parts: HiddenMarker["parts"] = [];
    for (const e of entries) {
      x += gap;
      parts.push(e.icon ? { icon: e.icon, x, text: e.text } : { x, text: e.text });
      x += (e.icon ? HIDDEN_MARKER_ICON + 1 : 0) + e.text.length * HIDDEN_MARKER_CHAR_W;
    }
    return { w: x + pad, parts };
  };
  const kinds = ACTION_KINDS.filter((k) => hidden[k] > 0);
  let p = build(kinds.map((k) => ({ icon: k, text: String(hidden[k]) })));
  if (p.w > width - 2 * ACTION_MARGIN) p = build([{ text: `+${kinds.reduce((n, k) => n + hidden[k], 0)}` }]);
  return {
    x: Math.max(width - ACTION_MARGIN - p.w, 0),
    y: HEADER + blockHeight - HIDDEN_MARKER_H / 2,
    w: p.w,
    h: HIDDEN_MARKER_H,
    parts: p.parts,
  };
}

const NO_WIDTH = 100;
const cache = new WeakMap<DocIndex, Map<Id, ActionBlock>>();

/** The action block of a state as it is drawn: its lines for the state's width, its height and what is hidden. */
export function actionBlock(index: DocIndex, s: State): ActionBlock {
  let byId = cache.get(index);
  if (!byId) cache.set(index, (byId = new Map()));
  let b = byId.get(s.id);
  if (!b) {
    const l = index.doc.diagram?.states[s.id];
    b = layout(index, s, l?.w ?? NO_WIDTH, l?.actionsHeight);
    byId.set(s.id, b);
  }
  return b;
}

/** Number of items the block of a state would list: actions, timers and internal transitions. */
export function actionItemCount(s: State): number {
  return (s.entry?.length ?? 0) + (s.exit?.length ?? 0) + (s.timers?.length ?? 0) + (s.internal?.length ?? 0);
}
