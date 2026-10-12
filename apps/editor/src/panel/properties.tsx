// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The Properties tab: what the selection is and every property it has (state, pseudo-state, transition, and a
 * state's internal transitions and timers; notes, frames and arrows in annotations.tsx).
 */
import { Field, Section } from "../widgets";
import { useLayoutEffect, useState } from "preact/hooks";
import {
  internalTransitionLabel,
  timerText,
  TIMER_UNITS,
  triggerLabel,
  vertexName,
  type DocIndex,
  type InternalTransition,
  type Region,
  type State,
  type Timer,
  type TimerUnit,
  type Transition,
  type Vertex,
} from "@ufsm/core";
import {
  addInternal,
  addRegion,
  addTimer,
  cannotOffPage,
  deleteElements,
  renameRegion,
  renameVertex,
  setBarOrientation,
  setGuard,
  setOffPage,
  setStateActions,
  setTransitionActions,
  setTimer,
  timerNameProblem,
  timerDurationProblem,
} from "@ufsm/core/edit";
import { annotationKind, annotationTitle, stateLayout } from "@ufsm/core/diagram";
import { ANNOTATION_NAMES, AnnotationProps } from "./annotations";
import { type FocusField, type PanelOps, type PanelDoc } from "./types";
import {
  Link,
  IconButton,
  TextInput,
  ActionList,
  GuardList,
  TriggerField,
  TimerEventField,
  pickTrigger,
  KIND_NAMES,
  regionLabel,
  DocField,
  appendAction,
  appendTerm,
} from "./fields";

function InternalProps({ index, t, ops }: { index: DocIndex; t: InternalTransition; ops: PanelOps }) {
  return (
    <details class="internal">
      <summary>
        <code>{internalTransitionLabel(index, t)}</code>
        <IconButton
          label="×"
          title="Delete this internal transition"
          onClick={() => ops.edit((d) => void deleteElements(d, [t.id]))}
        />
      </summary>
      <div class="ibody">
        <Field label="On">
          <TriggerField
            index={index}
            internal
            current={index.decls.get(t.on)?.decl.name ?? "?"}
            onPick={(p) => pickTrigger(ops, t.id, p)}
          />
        </Field>
        <div class="sublabel">Guard</div>
        <GuardList
          index={index}
          terms={t.guard ?? []}
          onChange={(g) => ops.edit((d) => setGuard(d, t.id, g))}
          use={appendTerm(ops, t.guard ?? [], (d, g) => setGuard(d, t.id, g))}
        />
        <div class="sublabel">Actions</div>
        <ActionList
          index={index}
          actions={t.do ?? []}
          onChange={(a) => ops.edit((d) => setTransitionActions(d, t.id, a))}
          use={appendAction(ops, t.do ?? [], (d, a) => setTransitionActions(d, t.id, a))}
          empty="No actions"
          add="Add action"
        />
        <div class="sublabel">Documentation</div>
        <DocField id={t.id} value={t.doc} ops={ops} />
      </div>
    </details>
  );
}

function TimerProps({ index, t, ops }: { index: DocIndex; t: Timer; ops: PanelOps }) {
  const count = t.after ?? t.every ?? 1;
  const kind = t.every !== undefined ? "every" : "after";
  const countProblem = (v: string): string | undefined =>
    /^\s*\d+\s*$/.test(v) ? timerDurationProblem(Number(v), t.unit) : "A whole number from 1 up is needed.";
  const pickUnit = (unit: TimerUnit): void => {
    const problem = timerDurationProblem(count, unit);
    if (problem) ops.say(`${count} ${unit}: ${problem}`);
    else ops.edit((d) => setTimer(d, t.id, { unit }));
  };
  return (
    <details class="internal">
      <summary>
        <code>{timerText(index, t)}</code>
        <IconButton
          label="×"
          title="Delete this timer"
          onClick={() => ops.edit((d) => void deleteElements(d, [t.id]))}
        />
      </summary>
      <div class="ibody">
        <Field label="Name">
          <TextInput
            label="Timer name"
            value={t.name}
            validate={(v) => timerNameProblem(index, v.trim(), t.id)}
            onCommit={(v) => ops.edit((d) => setTimer(d, t.id, { name: v.trim() }))}
          />
        </Field>
        <Field label="Duration">
          <span class="timer-duration">
            <select
              aria-label="One-shot or periodic"
              value={kind}
              onChange={(e) => ops.edit((d) => setTimer(d, t.id, { kind: e.currentTarget.value as "after" | "every" }))}
            >
              <option value="after">after</option>
              <option value="every">every</option>
            </select>
            <TextInput
              cls="text count"
              label="Duration"
              value={String(count)}
              validate={countProblem}
              onCommit={(v) => ops.edit((d) => setTimer(d, t.id, { count: Number(v) }))}
            />
            <select aria-label="Unit" value={t.unit} onChange={(e) => pickUnit(e.currentTarget.value as TimerUnit)}>
              {TIMER_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </span>
        </Field>
        <Field label="Fires">
          <TimerEventField
            index={index}
            current={index.decls.get(t.event)?.decl.name ?? "?"}
            onPick={(c) => ops.use(c, (d, id) => setTimer(d, t.id, { event: id }))}
          />
        </Field>
        <div class="sublabel">Documentation</div>
        <DocField id={t.id} value={t.doc} ops={ops} />
      </div>
    </details>
  );
}

function StateProps({
  index,
  s,
  ops,
  focus,
}: {
  index: DocIndex;
  s: State;
  ops: PanelOps;
  focus: FocusField | undefined;
}) {
  const region = index.vertices.get(s.id)?.region;
  const out = index.outgoing.get(s.id) ?? [];
  const [addingInternal, setAddingInternal] = useState(false);
  const [addingTimer, setAddingTimer] = useState(false);
  useLayoutEffect(() => {
    if (focus === "timer") setAddingTimer(true);
  }, [focus]);
  const offPage = (r: Region): boolean => index.doc.diagram?.regions[r.id]?.offPage === true;
  return (
    <>
      <Section title="General">
        <Field label="Name">
          <TextInput
            label="Name"
            value={s.name}
            focus={focus === "name"}
            onCommit={(v) => ops.edit((d) => renameVertex(d, s.id, v))}
          />
        </Field>
        <Field label="Id">{s.id}</Field>
        {region && <Field label="Region">{regionLabel(index, region)}</Field>}
      </Section>
      <Section title="Entry" count={s.entry?.length}>
        <ActionList
          index={index}
          actions={s.entry ?? []}
          onChange={(a) => ops.edit((d) => setStateActions(d, s.id, "entry", a))}
          use={appendAction(ops, s.entry ?? [], (d, a) => setStateActions(d, s.id, "entry", a))}
          empty="No entry actions"
          add="Add entry action"
          open={focus === "entry"}
        />
      </Section>
      <Section title="Exit" count={s.exit?.length}>
        <ActionList
          index={index}
          actions={s.exit ?? []}
          onChange={(a) => ops.edit((d) => setStateActions(d, s.id, "exit", a))}
          use={appendAction(ops, s.exit ?? [], (d, a) => setStateActions(d, s.id, "exit", a))}
          empty="No exit actions"
          add="Add exit action"
          open={focus === "exit"}
        />
      </Section>
      <Section title="Timers" count={s.timers?.length}>
        {(s.timers ?? []).length === 0 && (
          <div class="none">None (started on entry, stopped on exit; fire an event)</div>
        )}
        {(s.timers ?? []).map((t) => (
          <TimerProps key={t.id} index={index} t={t} ops={ops} />
        ))}
        {addingTimer ? (
          <TimerEventField
            index={index}
            open
            current=""
            onPick={(c) => {
              setAddingTimer(false);
              ops.use(c, (d, id) => void addTimer(d, s.id, id));
            }}
          />
        ) : (
          <button type="button" class="add" onClick={() => setAddingTimer(true)}>
            + Add timer
          </button>
        )}
      </Section>
      <Section title="Internal transitions" count={s.internal?.length}>
        {(s.internal ?? []).length === 0 && <div class="none">None (react to an event without leaving the state)</div>}
        {(s.internal ?? []).map((t) => (
          <InternalProps key={t.id} index={index} t={t} ops={ops} />
        ))}
        {addingInternal ? (
          <TriggerField
            index={index}
            internal
            open
            current=""
            onPick={(p) => {
              setAddingInternal(false);
              if (p && ("id" in p || "create" in p)) ops.use(p, (d, id) => void addInternal(d, s.id, id));
            }}
          />
        ) : (
          <button type="button" class="add" onClick={() => setAddingInternal(true)}>
            + Add internal transition
          </button>
        )}
      </Section>
      <Section title="Regions" count={s.regions?.length}>
        {(s.regions ?? []).length === 0 ? (
          <div class="none">None (a simple state)</div>
        ) : (
          <ul class="plist">
            {(s.regions ?? []).map((r) => (
              <li key={r.id} class="erow region-row">
                <TextInput
                  cls="text rname"
                  label="Region name"
                  placeholder="(region)"
                  value={r.name ?? ""}
                  onCommit={(v) => ops.edit((d) => renameRegion(d, r.id, v.trim()))}
                />
                <label class="check" title="Draw this region's contents on a sheet of their own">
                  <input
                    type="checkbox"
                    checked={offPage(r)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      const why = on ? cannotOffPage(index, r.id) : undefined;
                      if (why) {
                        e.currentTarget.checked = false;
                        ops.say(why);
                      } else ops.edit((d) => setOffPage(d, r.id, on));
                    }}
                  />
                  off-page
                </label>
                <span class="dim" title={`${r.states.length} ${r.states.length === 1 ? "vertex" : "vertices"}`}>
                  {r.states.length}
                </span>
                <IconButton
                  label="×"
                  title={`Delete this region and the ${r.states.length} vertices in it`}
                  onClick={() => ops.edit((d) => void deleteElements(d, [r.id]))}
                />
              </li>
            ))}
          </ul>
        )}
        <button type="button" class="add" onClick={() => ops.edit((d) => void addRegion(d, s.id))}>
          + Add region
        </button>
      </Section>
      <Section title="Outgoing transitions" count={out.length}>
        {out.length === 0 ? (
          <div class="none">None</div>
        ) : (
          <ul class="plist">
            {out.map((t) => (
              <li key={t.id}>
                <Link id={t.id} text={triggerLabel(index, t) || "(no trigger)"} ops={ops} />
                <span class="dim"> → {vertexName(index, t.to)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Documentation">
        <DocField id={s.id} value={s.doc} ops={ops} />
      </Section>
    </>
  );
}

function PseudoProps({
  index,
  v,
  ops,
  focus,
}: {
  index: DocIndex;
  v: Vertex;
  ops: PanelOps;
  focus: FocusField | undefined;
}) {
  const region = index.vertices.get(v.id)?.region;
  const bar = v.kind === "fork" || v.kind === "join";
  const horizontal = stateLayout(index, v.id).orientation === "horizontal";
  return (
    <Section title="General">
      <Field label="Kind">{KIND_NAMES[v.kind]}</Field>
      <Field label="Name">
        <TextInput
          label="Name"
          placeholder="(optional)"
          value={v.name ?? ""}
          focus={focus === "name"}
          onCommit={(n) => ops.edit((d) => renameVertex(d, v.id, n.trim()))}
        />
      </Field>
      {bar && (
        <Field label="Orientation">
          <select
            aria-label="Orientation"
            value={horizontal ? "h" : "v"}
            onChange={(e) => ops.edit((d) => setBarOrientation(d, v.id, e.currentTarget.value === "h"))}
          >
            <option value="v">vertical</option>
            <option value="h">horizontal</option>
          </select>
        </Field>
      )}
      <Field label="Id">{v.id}</Field>
      {region && <Field label="Region">{regionLabel(index, region)}</Field>}
    </Section>
  );
}

function TransitionProps({
  index,
  t,
  ops,
  focus,
}: {
  index: DocIndex;
  t: Transition;
  ops: PanelOps;
  focus: FocusField | undefined;
}) {
  const layout = index.doc.diagram?.transitions[t.id];
  const route = layout && "route" in layout && layout.route === "s" ? "S (orthogonal)" : "Free (bend points)";
  const trigger = t.on ? triggerLabel(index, t) : t.auto ? "auto" : t.completion ? "completion" : "none";
  // design rules: nothing triggers or guards a transition out of an initial/history state or fork; a transition into
  // a join has no trigger (its outgoing transition has). The editors stay when the file has one anyway, to remove it.
  const fromKind = index.vertices.get(t.from)?.vertex.kind;
  const toKind = index.vertices.get(t.to)?.vertex.kind;
  const pseudoSource =
    fromKind === "initial" || fromKind === "shallow-history" || fromKind === "deep-history" || fromKind === "fork";
  const hasTrigger = t.on !== undefined || !!t.auto || !!t.completion;
  const showTrigger = hasTrigger || (!pseudoSource && toKind !== "join");
  const showGuard = (t.guard?.length ?? 0) > 0 || !pseudoSource;
  return (
    <>
      <Section title="General">
        <Field label="From">
          <Link id={t.from} text={vertexName(index, t.from)} ops={ops} />
        </Field>
        <Field label="To">
          <Link id={t.to} text={vertexName(index, t.to)} ops={ops} />
        </Field>
        <Field label="Id">{t.id}</Field>
        <Field label="Route">{route}</Field>
      </Section>
      <Section title="Trigger">
        {showTrigger ? (
          <Field label="On">
            <TriggerField
              index={index}
              current={trigger}
              open={focus === "trigger"}
              onPick={(p) => pickTrigger(ops, t.id, p)}
            />
          </Field>
        ) : (
          <div class="none">
            {pseudoSource
              ? `None: it is taken as soon as the ${KIND_NAMES[fromKind!].toLowerCase()} is reached.`
              : "None: the join's outgoing transition has the trigger."}
          </div>
        )}
      </Section>
      <Section title="Guard" count={t.guard?.length}>
        {showGuard ? (
          <GuardList
            index={index}
            terms={t.guard ?? []}
            open={focus === "guard"}
            onChange={(g) => ops.edit((d) => setGuard(d, t.id, g))}
            use={appendTerm(ops, t.guard ?? [], (d, g) => setGuard(d, t.id, g))}
          />
        ) : (
          <div class="none">None: a transition out of a {KIND_NAMES[fromKind!].toLowerCase()} is always taken.</div>
        )}
      </Section>
      <Section title="Actions" count={t.do?.length}>
        <ActionList
          index={index}
          actions={t.do ?? []}
          onChange={(a) => ops.edit((d) => setTransitionActions(d, t.id, a))}
          use={appendAction(ops, t.do ?? [], (d, a) => setTransitionActions(d, t.id, a))}
          empty="No actions"
          add="Add action"
          open={focus === "action"}
        />
      </Section>
      <Section title="Documentation">
        <DocField id={t.id} value={t.doc} ops={ops} />
      </Section>
    </>
  );
}

export function Properties({
  doc,
  ops,
  focus,
}: {
  doc: PanelDoc | undefined;
  ops: PanelOps;
  focus: FocusField | undefined;
}) {
  if (!doc) return <div class="pempty">No machine open.</div>;
  const { index, selection } = doc;
  if (selection.size === 0) {
    return (
      <div class="pempty">
        Select a state, transition or note to see its properties.
        <div class="dim">
          Machine {index.doc.name}: {index.vertices.size} states, {index.transitions.size} transitions.
        </div>
      </div>
    );
  }
  if (selection.size > 1) return <div class="pempty">{selection.size} items selected.</div>;
  const id = selection.values().next().value!;
  const v = index.vertices.get(id)?.vertex;
  const t = index.transitions.get(id);
  const note = annotationKind(index, id);
  if (note)
    return (
      <div key={id}>
        <div class="pheader">
          <span class="kind">{ANNOTATION_NAMES[note]}</span>
          <span class="name">{annotationTitle(index, id).replace(/^(note|frame) '(.*)'$/, "$2")}</span>
        </div>
        <AnnotationProps index={index} id={id} kind={note} ops={ops} />
      </div>
    );
  return (
    // keyed by the element, so drafts in text fields never carry over to another element
    <div key={id}>
      <div class="pheader">
        <span class="kind">{v ? KIND_NAMES[v.kind] : "Transition"}</span>
        <span class="name">
          {v ? vertexName(index, v.id) : t ? `${vertexName(index, t.from)} → ${vertexName(index, t.to)}` : id}
        </span>
      </div>
      {v?.kind === "state" && <StateProps index={index} s={v} ops={ops} focus={focus} />}
      {v && v.kind !== "state" && <PseudoProps index={index} v={v} ops={ops} focus={focus} />}
      {t && <TransitionProps index={index} t={t} ops={ops} focus={focus} />}
    </div>
  );
}
