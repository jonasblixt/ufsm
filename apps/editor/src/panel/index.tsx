// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Right-hand panel with tabs. "Properties" edits the selection: a state's name, entry and exit actions, timers,
 * internal transitions, regions and documentation; a transition's trigger, guard, actions and documentation; a pseudo state's
 * name (a fork/join's orientation). "Project" holds the settings of the whole project; until a project format exists
 * it edits the active machine's name, declarations and code generator options. "Problems" lists the design rule
 * check's findings, live, and jumps to them.
 *
 * Every change is one edit through `ops.edit` (one undo step) running core functions (edit/props.ts, edit/create.ts) on
 * the document. Pickers offer the declarations that fit and can create a new one in the same step (`ops.use`).
 */
import { render, type ComponentChildren } from "preact";
import { SimulatorTab, type SimProps } from "../simpanel";
import { CodeTab, type CodeProps } from "../codepanel";
import { SettingsTab, type SettingsProps } from "../settingspanel";
import { useLayoutEffect } from "preact/hooks";
import { type Id } from "@ufsm/core";
import { type PanelTab, type FocusField, type PanelOps, type PanelDoc } from "./types";
import { Properties } from "./properties";
import { Project } from "./project";
import { Problems } from "./problems";

export type { PanelTab, FocusField, Choice, PanelOps, PanelDoc } from "./types";
export { API_OPTION_INFO, MODEL_OPTIONS, TARGETS, TITLE_FIELD_LABELS, TITLE_FIELD_NAMES, type TargetOption } from "./project";

export interface PanelProps {
  tab: PanelTab;
  onTab(tab: PanelTab): void;
  doc: PanelDoc | undefined;
  ops: PanelOps;
  focus?: FocusField;
  /** A declaration to show in the Project tab (a problem's target). */
  highlight?: Id;
  /** The Simulator tab (when a machine is open). */
  sim?: SimProps;
  /** The Code tab (when a machine is open). */
  code?: CodeProps;
  /** The Settings tab (global, with or without a machine). */
  settings: SettingsProps;
}

function Panel(p: PanelProps) {
  const errors = p.doc?.diagnostics.filter((d) => d.severity === "error").length ?? 0;
  const count = p.doc?.diagnostics.length ?? 0;
  const tabs: { id: PanelTab; label: ComponentChildren }[] = [
    { id: "properties", label: "Properties" },
    { id: "project", label: "Project" },
    { id: "problems", label: <>Problems{count > 0 && <span class={`badge${errors ? " errors" : ""}`}>{count}</span>}</> },
    { id: "simulator", label: <>Simulator{p.sim?.sim && !p.sim.stale && <span class="badge running" title="Running" />}</> },
    { id: "code", label: "Code" },
    { id: "settings", label: "Settings" },
  ];
  // The tab strip scrolls sideways when the panel is narrow: keep the active tab in view.
  useLayoutEffect(() => document.getElementById(`panel-tab-${p.tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest" }), [p.tab]);
  return (
    <>
      <div class="panel-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            id={`panel-tab-${t.id}`}
            class={`panel-tab${p.tab === t.id ? " active" : ""}`}
            aria-selected={p.tab === t.id}
            onClick={() => p.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div class={`panel-body tab-${p.tab}`} role="tabpanel" aria-labelledby={`panel-tab-${p.tab}`}>
        {p.tab === "properties" && <Properties doc={p.doc} ops={p.ops} focus={p.focus} />}
        {p.tab === "project" && <Project doc={p.doc} ops={p.ops} highlight={p.highlight} />}
        {p.tab === "problems" && <Problems doc={p.doc} ops={p.ops} />}
        {p.tab === "simulator" && (p.sim ? <SimulatorTab {...p.sim} /> : <div class="pempty">No machine open.</div>)}
        {p.tab === "code" && (p.code ? <CodeTab {...p.code} /> : <div class="pempty">No machine open.</div>)}
        {p.tab === "settings" && <SettingsTab {...p.settings} />}
      </div>
    </>
  );
}

export function renderPanel(container: HTMLElement, props: PanelProps): void {
  render(<Panel {...props} />, container);
}
