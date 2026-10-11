// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { declName, vertexName, type DocIndex } from "./doc-index";
import type { Action, GuardTerm, InternalTransition, Timer, Transition } from "../format/model";

/** `lamp_off()` or `^sDone`. */
export function actionLabel(index: DocIndex, a: Action): string {
  return "call" in a ? `${declName(index, a.call)}()` : `^${declName(index, a.emit)}`;
}

/** `ready()`, `!ready()`, `<Idle>`, `!<Idle>`. */
export function guardLabel(index: DocIndex, g: GuardTerm): string {
  if ("in" in g) return `${g.not ? "!" : ""}<${vertexName(index, g.in)}>`;
  const fn = `${declName(index, g.call)}()`;
  return g.not ? `!${fn}` : fn;
}

/** Trigger text: event/signal name, `auto`, `completion`, "" for pseudo-state edges, `?` when missing. */
export function triggerLabel(index: DocIndex, t: Transition): string {
  if (t.on) return declName(index, t.on);
  if (t.auto) return "auto";
  if (t.completion) return "completion";
  const from = index.vertices.get(t.from)?.vertex.kind;
  const to = index.vertices.get(t.to)?.vertex.kind;
  return from === "state" && to !== "join" ? "?" : "";
}

export interface TransitionLabelParts {
  trigger: string;
  guards: string[];
  actions: string[];
}

export function transitionLabelParts(index: DocIndex, t: Transition): TransitionLabelParts {
  return {
    trigger: triggerLabel(index, t),
    guards: (t.guard ?? []).map((g) => guardLabel(index, g)),
    actions: (t.do ?? []).map((a) => actionLabel(index, a)),
  };
}

/** An internal transition as it is listed in its state: `eTick [running()] / count()`. */
export function internalTransitionLabel(index: DocIndex, t: InternalTransition): string {
  let s = declName(index, t.on);
  const guards = (t.guard ?? []).map((g) => guardLabel(index, g));
  const actions = (t.do ?? []).map((a) => actionLabel(index, a));
  if (guards.length > 0) s += ` [${guards.join(", ")}]`;
  if (actions.length > 0) s += ` / ${actions.join(", ")}`;
  return s;
}

/** A timer's duration as written: `20 s`, `every 500 ms`. */
export function timerDurationLabel(t: Timer): string {
  return t.every !== undefined ? `every ${t.every} ${t.unit}` : `${t.after} ${t.unit}`;
}

/** A timer where the context already says it is one (the Properties panel's Timers list): `travel(20 s, eTravelTimeout)`. */
export function timerText(index: DocIndex, t: Timer): string {
  return `${t.name}(${timerDurationLabel(t)}, ${declName(index, t.event)})`;
}

/** A timer in a list of mixed things (the CLI, the search): `t/travel(20 s, eTravelTimeout)`, `t/poll(every 500 ms, ePoll)`. */
export function timerLabel(index: DocIndex, t: Timer): string {
  return `t/${timerText(index, t)}`;
}

/** `eButton [ready()] / lamp_on(), ^sDone` */
export function transitionLabel(index: DocIndex, t: Transition): string {
  const p = transitionLabelParts(index, t);
  let s = p.trigger;
  if (p.guards.length > 0) s += ` [${p.guards.join(", ")}]`;
  if (p.actions.length > 0) s += ` / ${p.actions.join(", ")}`;
  return s.trim();
}
