// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The Problems tab: the design rule check's findings, live, each with where it is drawn and a jump to it; notes
 * marked TODO are listed last.
 */
import { type DocIndex, type Id } from "@ufsm/core";
import { locate, locationText } from "@ufsm/core/diagram";
import { type PanelOps, type PanelDoc } from "./types";

/** " · sheet 2, B4": where the element is drawn (nothing for declarations, or when the diagram cannot say). */
function ProblemPlace({ index, id }: { index: DocIndex; id: Id }) {
  const loc = locate(index, id);
  return loc ? <span class="dim loc"> · {locationText(loc)}</span> : null;
}

export function Problems({ doc, ops }: { doc: PanelDoc | undefined; ops: PanelOps }) {
  if (!doc) return <div class="pempty">No machine open.</div>;
  const rows = [
    ...doc.diagnostics.filter((x) => x.severity === "error"),
    ...doc.diagnostics.filter((x) => x.severity === "warning"),
    ...doc.diagnostics.filter((x) => x.severity === "info"),
  ];
  if (rows.length === 0 && doc.notes.length === 0) return <div class="pempty">No problems found.</div>;
  return (
    <ul class="problems-list">
      {rows.map((r, i) => (
        <li key={`${r.code}-${r.id ?? ""}-${i}`}>
          <button
            type="button"
            class="problem"
            disabled={!r.id}
            onClick={() => r.id && ops.jump(r.id)}
            title={r.id ? "Show it" : undefined}
          >
            <span class={`sev ${r.severity}`}>{r.severity}</span>
            <span class="msg">
              {r.message}
              {r.id && <ProblemPlace index={doc.index} id={r.id} />}
            </span>
            <span class="dim code">{r.code}</span>
          </button>
        </li>
      ))}
      {doc.notes.map((n, i) => (
        <li key={`note-${i}`}>
          <div class="problem">
            <span class="sev converted">converted</span>
            <span class="msg">{n.message}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
