// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * KEYMAP.md from the editor's interaction model (editor.ufsm): one row per transition and internal transition, by
 * region, with the key or pointer event, the guards, the actions and where it goes. The model is the truth and is only
 * readable in the editor; this table makes it greppable. Action names are command ids (commands.ts) or the handler
 * parts' actions (canvas/keys.ts, pointer.ts, tools.ts). No DOM; `npm run gen:editor-fsm` writes it, a test keeps it
 * fresh.
 */
import {
  actionLabel,
  guardLabel,
  indexV1,
  regionChain,
  type DocIndex,
  type GuardTerm,
  type Action,
  type Id,
  type UfsmDocument,
} from "@ufsm/core";

const EVENT_TEXT: Record<string, string> = {
  eKey_esc: "Esc",
  eKey_enter: "Enter",
  eKey_delete: "Delete",
  eKey_backspace: "Backspace",
  eKey_tab: "Tab",
  eKey_f1: "F1",
  eKey_f5: "F5",
  eKey_plus: "+",
  eKey_minus: "-",
  eLMBDown: "left button down",
  eLMBUp: "left button up",
  eRMBDown: "right/middle button down",
  eRMBUp: "right/middle button up",
  eMotion: "pointer moves",
  eWheel: "wheel",
  eDoubleClick: "double-click",
  eCancel: "pointer lost (cancel)",
  eMouseBack: "mouse back button",
  ePalette: "palette click / Add menu",
};

/** How a trigger reads in the table: `eKey_s` -> `s`, a mouse event in words, a signal as `signal sDone`. */
function eventText(index: DocIndex, on: Id | undefined): string {
  if (on === undefined) return "";
  const info = index.decls.get(on);
  if (!info) return on;
  const name = info.decl.name;
  if (info.kind === "signal") return `signal ${name}`;
  return EVENT_TEXT[name] ?? (name.startsWith("eKey_") ? name.slice(5) : name);
}

const cell = (s: string): string => s.replace(/\|/g, "\\|");
const guards = (index: DocIndex, g: GuardTerm[] | undefined): string =>
  (g ?? []).map((x) => `\`${guardLabel(index, x)}\``).join(" ");
const actions = (index: DocIndex, a: Action[] | undefined): string =>
  (a ?? []).map((x) => `\`${actionLabel(index, x)}\``).join(" ");

export function keymapMarkdown(doc: UfsmDocument): string {
  const index = indexV1(doc);
  const out: string[] = [
    "<!-- Generated from editor.ufsm by keymap.ts (npm run gen:editor-fsm). Do not edit. -->",
    "",
    "# Editor key map",
    "",
    "What every key and pointer event does, as the editor's interaction model (`editor.ufsm`) decides it: one row per",
    "transition, by region. *When* lists the guards (`<State>` means the state is active), *Does* the actions in order;",
    "an action with the name of a command runs that command (`commands.ts`), the others are in `canvas/keys.ts`,",
    "`canvas/pointer.ts` and `canvas/tools.ts`. Internal transitions stay in their state.",
  ];
  let group = "";
  const visit = (stateId: Id): void => {
    const v = index.vertices.get(stateId)?.vertex;
    if (v?.kind !== "state") return;
    const chain = regionChain(index, stateId);
    // the region under the top state names the group (Keys, Pointer, Tool); deeper regions show in the state's path
    const top = chain[1];
    const g = top ? (top.name ?? top.id) : "Editor";
    const rows: string[] = [];
    for (const t of index.outgoing.get(stateId) ?? []) {
      const to = index.vertices.get(t.to)?.vertex;
      const target = to?.kind === "state" ? to.name : (to?.name ?? to?.kind ?? t.to);
      rows.push(
        `| ${cell(v.name)} | ${cell(eventText(index, t.on) || (t.auto ? "(auto)" : t.completion ? "(completion)" : ""))} | ${cell(guards(index, t.guard))} | ${cell(actions(index, t.do))} | ${cell(target)} |`,
      );
    }
    for (const t of v.internal ?? []) {
      rows.push(
        `| ${cell(v.name)} | ${cell(eventText(index, t.on))} | ${cell(guards(index, t.guard))} | ${cell(actions(index, t.do))} | (stays) |`,
      );
    }
    if (rows.length) {
      if (g !== group) {
        group = g;
        out.push("", `## ${g}`, "", "| State | Event | When | Does | Then |", "|---|---|---|---|---|");
      }
      out.push(...rows);
    }
    for (const r of v.regions ?? []) for (const c of r.states) visit(c.id);
  };
  for (const v of doc.machine.root.states) visit(v.id);
  return `${out.join("\n")}\n`;
}
