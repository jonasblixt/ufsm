// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Layout of a transition's label: its text items (trigger, guards, actions, with the old editor's bracket and comma
 * rules) wrapped at the label's width, 20 units per line. The label's position (`edgeGeometry(...).label`, x/y/w) is
 * the top-left of an area whose first text line is drawn LABEL_FIRST_LINE below it; the text box starts LABEL_TOP below.
 *
 * Labels use a proportional font, so the width of a text is measured by the caller: the editor passes its canvas's
 * measureText (what it draws), everything without a canvas (the design rule check) takes `estimateLabelWidth`, a
 * fixed cell per character close to the editor's 14 px sans-serif.
 */
import type { DocIndex } from "../model/doc-index";
import { transitionLabelParts } from "../model/labels";
import type { Transition } from "../format/model";
import { edgeGeometry, type Box } from "./geometry";

/** Font size of label text, in diagram units. */
export const LABEL_FONT_SIZE = 14;
/** From the label position down to the baseline of the first line. */
export const LABEL_FIRST_LINE = 40;
/** From the label position down to the top of the text box. */
export const LABEL_TOP = 26;
/** Line pitch. */
export const LABEL_LINE_H = 20;
/** Space between items on a line; also the least room a line must have left for another item. */
export const LABEL_GAP = 10;
/** The cell estimateLabelWidth gives one character. */
export const LABEL_CHAR_W = 7;

/** Width of a text in diagram units, at LABEL_FONT_SIZE. */
export type MeasureText = (text: string) => number;

/** A width without a canvas: LABEL_CHAR_W per character. */
export const estimateLabelWidth: MeasureText = (text) => text.length * LABEL_CHAR_W;

export interface TransitionLabelLayout {
  /** Text items and where their baselines start. */
  items: { text: string; x: number; y: number }[];
  /** Where the text is drawn (from the top of the first line to the bottom of the last). */
  box: Box;
}

/** The label's items: trigger, then guards in brackets, then ` / ` and the actions, commas between. */
export function transitionLabelItems(index: DocIndex, t: Transition): string[] {
  const p = transitionLabelParts(index, t);
  const items = [p.trigger];
  p.guards.forEach((txt, i) => items.push(`${i === 0 ? "[" : ""}${txt}${i === p.guards.length - 1 ? "]" : ", "}`));
  p.actions.forEach((txt, i) => items.push(`${i === 0 ? " / " : ""}${txt}${i === p.actions.length - 1 ? "" : ", "}`));
  return items;
}

/** Lay out a label at `at` (absolute position and wrap width): items wrap when less than LABEL_GAP would be left. */
export function layoutTransitionLabel(
  index: DocIndex,
  t: Transition,
  at: { x: number; y: number; w: number },
  measure: MeasureText = estimateLabelWidth,
): TransitionLabelLayout {
  let x = at.x;
  let line = 0;
  let space = at.w;
  let right = at.x;
  const items = transitionLabelItems(index, t).map((text, i) => {
    const w = measure(text);
    if (i > 0) {
      space -= w + LABEL_GAP;
      if (space < LABEL_GAP) {
        line++;
        space = at.w;
        x = at.x;
      }
    } else {
      space -= w;
    }
    const item = { text, x, y: at.y + LABEL_FIRST_LINE + LABEL_LINE_H * line };
    right = Math.max(right, x + w);
    x += w + LABEL_GAP;
    return item;
  });
  return { items, box: { x: at.x, y: at.y + LABEL_TOP, w: Math.max(right - at.x, LABEL_GAP), h: LABEL_LINE_H * line + LABEL_LINE_H } };
}

/** The text box of a transition's label (undefined when it has none). */
export function transitionLabelBox(index: DocIndex, t: Transition, measure: MeasureText = estimateLabelWidth): Box | undefined {
  const label = edgeGeometry(index, t.id)?.label;
  return label && layoutTransitionLabel(index, t, label, measure).box;
}
