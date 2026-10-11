// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The design rule check (`ufsm check`, the editor's Problems): the semantic rules, then the diagram rules. Where a new
 * rule goes: semantic.ts when it is about what the machine does (an error there must make a later stage fail without
 * it), diagram.ts when it is about how it is drawn (warnings only).
 */
import { indexV1, type DocIndex } from "../model/doc-index";
import type { UfsmDocument } from "../format/model";
import type { Diagnostic } from "./diagnostic";
import { checkSemantics } from "./semantic";
import { checkDiagram } from "./diagram";

export type { Diagnostic, Severity } from "./diagnostic";
export { checkSemantics } from "./semantic";
export { checkDiagram } from "./diagram";

export function checkV1(doc: UfsmDocument, prebuilt?: DocIndex): Diagnostic[] {
  const index = prebuilt ?? indexV1(doc);
  const semantic = checkSemantics(doc, index);
  return [...semantic, ...checkDiagram(doc, index, semantic.some((d) => d.code === "duplicate-id"))];
}
