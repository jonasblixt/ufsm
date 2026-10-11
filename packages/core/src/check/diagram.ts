// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Diagram design rules: layout hygiene that never affects behaviour, so only warnings. Layout for unknown or missing
 * elements, drawings that do not fit their sheet, action blocks that do not fit their state or cover its contents.
 */
import { ACTION_CHAR_W, ACTION_ICON, ACTION_ICON_GAP, actionBlock } from "../diagram/action-block";
import { HEADER_H, isOffPage, vertexBox } from "../diagram/geometry";
import { sheetFit, sheetFitMessage } from "../diagram/sheet";
import { vertexName, type DocIndex } from "../model/doc-index";
import type { Id, UfsmDocument } from "../format/model";
import type { Diagnostic } from "./diagnostic";

/** `duplicateIds`: the semantic rules found duplicate ids, so geometry cannot be derived reliably. */
export function checkDiagram(doc: UfsmDocument, index: DocIndex, duplicateIds: boolean): Diagnostic[] {
  const out: Diagnostic[] = [];
  const warn = (code: string, message: string, id?: Id): void => {
    out.push(id === undefined ? { severity: "warning", code, message } : { severity: "warning", code, message, id });
  };

  // ---- diagram consistency
  const dia = doc.diagram;
  if (dia) {
    for (const id of Object.keys(dia.states)) if (!index.vertices.has(id)) warn("stale-layout", `diagram has layout for unknown state '${id}'`, id);
    for (const id of Object.keys(dia.regions)) if (!index.regions.has(id)) warn("stale-layout", `diagram has layout for unknown region '${id}'`, id);
    for (const id of Object.keys(dia.transitions)) if (!index.transitions.has(id)) warn("stale-layout", `diagram has layout for unknown transition '${id}'`, id);
    for (const id of index.vertices.keys()) if (!dia.states[id]) warn("missing-layout", `state '${vertexName(index, id)}' has no diagram position`, id);
    // ---- fit on the sheet (needs every position and both ends of every transition)
    const geometry =
      !duplicateIds && !out.some((d) => d.code === "missing-layout") &&
      doc.machine.transitions.every((t) => index.vertices.has(t.from) && index.vertices.has(t.to));
    if (geometry) {
      for (const p of sheetFit(index)) warn(p.problem === "outside" ? "outside-frame" : "title-block", sheetFitMessage(index, p), p.id);
      // ---- action blocks fit their states. Lines hidden by a height the user set are not reported: the block marks them.
      for (const { vertex } of index.vertices.values()) {
        if (vertex.kind !== "state") continue;
        const block = actionBlock(index, vertex);
        if (block.auto === 0) continue;
        const b = vertexBox(index, vertex.id);
        const shown = block.summary ? [block.summaryRow] : block.rows.slice(0, block.visible).map((r) => r.segments);
        const right = Math.max(...shown.flat().map((g) => g.x + (g.icon ? ACTION_ICON + ACTION_ICON_GAP : 0) + g.text.length * ACTION_CHAR_W));
        if (HEADER_H + block.height > b.h || right > b.w) {
          warn("actions-clipped", `state '${vertexName(index, vertex.id)}' is too small to show its actions, timers and internal transitions`, vertex.id);
        }
        const first = vertex.regions?.[0];
        if (!first || isOffPage(index, first.id)) continue;
        const covered = first.states.find((c) => vertexBox(index, c.id).y < b.y + HEADER_H + block.height);
        if (covered) {
          warn("actions-overlap", `the actions of state '${vertexName(index, vertex.id)}' are drawn over '${vertexName(index, covered.id)}'`, vertex.id);
        }
      }
    }
  }

  return out;
}
