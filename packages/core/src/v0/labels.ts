// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import {
  V0ActionRefKind,
  V0GuardKind,
  V0TriggerKind,
  type V0ActionRef,
  type V0GuardRef,
  type V0Transition,
} from "./format";
import type { V0Index } from "./index-model";

/** Text for an action reference, e.g. `lamp_off()` or `^sDone`. */
export function actionRefLabel(index: V0Index, ref: V0ActionRef): string {
  if (ref.kind === V0ActionRefKind.Signal) {
    return `^${index.signals.get(ref["signal-id"] ?? "")?.name ?? "?"}`;
  }
  return `${index.actions.get(ref["action-id"] ?? "")?.name ?? "?"}()`;
}

const COMPARE: Readonly<Record<number, string>> = {
  [V0GuardKind.Eq]: "==",
  [V0GuardKind.Gt]: ">",
  [V0GuardKind.Gte]: ">=",
  [V0GuardKind.Lt]: "<",
  [V0GuardKind.Lte]: "<=",
};

/** Text for a guard reference, e.g. `is_ready()`, `!is_ready()`, `count() > 3` or `<StateName>`. */
export function guardRefLabel(index: V0Index, ref: V0GuardRef): string {
  if (ref.kind === V0GuardKind.PState || ref.kind === V0GuardKind.NState) {
    const name = index.states.get(ref["state-id"] ?? "")?.state.name ?? "?";
    return `${ref.kind === V0GuardKind.NState ? "!" : ""}<${name}>`;
  }
  const fn = `${index.guards.get(ref["action-id"] ?? "")?.name ?? "?"}()`;
  if (ref.kind === V0GuardKind.True) return fn;
  if (ref.kind === V0GuardKind.False) return `!${fn}`;
  const op = COMPARE[ref.kind];
  return op ? `${fn} ${op} ${ref.value ?? 0}` : "????";
}

/** Trigger text as the old editor showed it ("" for init/fork/join edges, "?" when missing). */
export function triggerLabel(index: V0Index, t: V0Transition): string {
  const kind = t["trigger-kind"];
  if (t.trigger !== undefined && kind === V0TriggerKind.Event) {
    return index.triggers.get(t.trigger)?.name ?? "?";
  }
  if (t.trigger !== undefined && kind === V0TriggerKind.Signal) {
    return index.signals.get(t.trigger)?.name ?? "?";
  }
  if (kind === V0TriggerKind.Auto) return "auto-transition";
  if (kind === V0TriggerKind.Completion) return "completion";

  const src = index.states.get(t.source.state)?.state.kind;
  const dst = index.states.get(t.dest.state)?.state.kind;
  const silent =
    src === "init" || src === "shallow-history" || src === "deep-history" || src === "fork" || dst === "join";
  return silent ? "" : "?";
}

export interface TransitionLabelParts {
  trigger: string;
  guards: string[];
  actions: string[];
}

export function transitionLabelParts(index: V0Index, t: V0Transition): TransitionLabelParts {
  return {
    trigger: triggerLabel(index, t),
    guards: t.guards.map((g) => guardRefLabel(index, g)),
    actions: t.actions.map((a) => actionRefLabel(index, a)),
  };
}

/** Single-line label, e.g. `eButton [ready()] / lamp_on(), ^sDone`. */
export function transitionLabel(index: V0Index, t: V0Transition): string {
  const p = transitionLabelParts(index, t);
  let s = p.trigger;
  if (p.guards.length > 0) s += ` [${p.guards.join(", ")}]`;
  if (p.actions.length > 0) s += ` / ${p.actions.join(", ")}`;
  return s.trim();
}
