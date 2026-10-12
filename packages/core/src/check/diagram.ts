// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Diagram design rules: layout hygiene that never affects behaviour, so only warnings. Layout for unknown or missing
 * elements, drawings that do not fit their sheet, action blocks that do not fit their state or cover its contents,
 * notes, frames and arrows that refer to what does not exist; notes marked TODO are listed as info.
 */
import { ACTION_CHAR_W, ACTION_ICON, ACTION_ICON_GAP, actionBlock } from "../diagram/action-block";
import { HEADER_H, isOffPage, vertexBox } from "../diagram/geometry";
import { annotationTitle, sheetFit, sheetFitMessage } from "../diagram/sheet";
import { elementSheet, noteRefs, referenceName } from "../diagram/annotations";
import { documentIds } from "../format/ids";
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
    checkAnnotations(doc, index, warn, out);
    for (const id of Object.keys(dia.states))
      if (!index.vertices.has(id)) warn("stale-layout", `diagram has layout for unknown state '${id}'`, id);
    for (const id of Object.keys(dia.regions))
      if (!index.regions.has(id)) warn("stale-layout", `diagram has layout for unknown region '${id}'`, id);
    for (const id of Object.keys(dia.transitions))
      if (!index.transitions.has(id)) warn("stale-layout", `diagram has layout for unknown transition '${id}'`, id);
    for (const id of index.vertices.keys())
      if (!dia.states[id]) warn("missing-layout", `state '${vertexName(index, id)}' has no diagram position`, id);
    // ---- fit on the sheet (needs every position and both ends of every transition)
    const geometry =
      !duplicateIds &&
      !out.some((d) => d.code === "missing-layout") &&
      doc.machine.transitions.every((t) => index.vertices.has(t.from) && index.vertices.has(t.to));
    if (geometry) {
      for (const p of sheetFit(index))
        warn(p.problem === "outside" ? "outside-frame" : "title-block", sheetFitMessage(index, p), p.id);
      // ---- action blocks fit their states. Lines hidden by a height the user set are not reported: the block marks them.
      for (const { vertex } of index.vertices.values()) {
        if (vertex.kind !== "state") continue;
        const block = actionBlock(index, vertex);
        if (block.auto === 0) continue;
        const b = vertexBox(index, vertex.id);
        const shown = block.summary ? [block.summaryRow] : block.rows.slice(0, block.visible).map((r) => r.segments);
        const right = Math.max(
          ...shown
            .flat()
            .map((g) => g.x + (g.icon ? ACTION_ICON + ACTION_ICON_GAP : 0) + g.text.length * ACTION_CHAR_W),
        );
        if (HEADER_H + block.height > b.h || right > b.w) {
          warn(
            "actions-clipped",
            `state '${vertexName(index, vertex.id)}' is too small to show its actions, timers and internal transitions`,
            vertex.id,
          );
        }
        const first = vertex.regions?.[0];
        if (!first || isOffPage(index, first.id)) continue;
        const covered = first.states.find((c) => vertexBox(index, c.id).y < b.y + HEADER_H + block.height);
        if (covered) {
          warn(
            "actions-overlap",
            `the actions of state '${vertexName(index, vertex.id)}' are drawn over '${vertexName(index, covered.id)}'`,
            vertex.id,
          );
        }
      }
    }
  }

  return out;
}

/** Notes, frames and arrows: their regions and references exist, arrows stay on one sheet; TODO notes as info. */
function checkAnnotations(
  doc: UfsmDocument,
  index: DocIndex,
  warn: (code: string, message: string, id?: Id) => void,
  out: Diagnostic[],
): void {
  const dia = doc.diagram!;
  // ids: unique across the document like every id
  const machineIds = documentIds({ ...doc, diagram: { ...dia, notes: {}, frames: {}, arrows: {} } });
  const seen = new Set<Id>();
  for (const m of [dia.frames, dia.notes, dia.arrows]) {
    for (const id of Object.keys(m ?? {})) {
      if (machineIds.has(id) || seen.has(id))
        warn("annotation-id", `${annotationTitle(index, id)} has the id '${id}' of another element`, id);
      seen.add(id);
    }
  }
  for (const [id, l] of [
    ...Object.entries(dia.frames ?? {}),
    ...Object.entries(dia.notes ?? {}),
    ...Object.entries(dia.arrows ?? {}),
  ]) {
    if (!index.regions.has(l.region))
      warn("annotation-region", `${annotationTitle(index, id)} belongs to unknown region '${l.region}'`, id);
  }
  for (const [id, n] of Object.entries(dia.notes ?? {})) {
    for (const r of noteRefs(n.text))
      if (referenceName(index, r.id) === undefined)
        warn("note-ref", `${annotationTitle(index, id)} refers to unknown element '${r.id}'`, id);
    if (n.todo) out.push({ severity: "info", code: "todo", message: `TODO: ${n.text.split("\n")[0]!.trim()}`, id });
  }
  for (const [id, a] of Object.entries(dia.arrows ?? {})) {
    const region = index.regions.get(a.region)?.region;
    for (const end of [a.from, a.to]) {
      if (!("ref" in end)) continue;
      const kind = "at" in end ? "transition" : "vertex, note or frame";
      const exists =
        "at" in end
          ? index.transitions.has(end.ref)
          : index.vertices.has(end.ref) || !!dia.notes?.[end.ref] || !!dia.frames?.[end.ref];
      if (!exists) {
        warn("arrow-ref", `an arrow is attached to unknown ${kind} '${end.ref}'`, id);
        continue;
      }
      if (region && elementSheet(index, end.ref) !== elementSheet(index, id))
        warn(
          "arrow-sheet",
          `an arrow is attached to '${referenceName(index, end.ref) ?? end.ref}' on another sheet`,
          id,
        );
    }
  }
}
