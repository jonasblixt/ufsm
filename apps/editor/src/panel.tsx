// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Right-hand panel with tabs. "Properties" edits the selection: a state's name, entry and exit actions, timers,
 * internal transitions, regions and documentation; a transition's trigger, guard, actions and documentation; a pseudo state's
 * name (a fork/join's orientation). "Project" holds the settings of the whole project; until a project format exists
 * it edits the active machine's name, declarations and code generator options. "Problems" lists the design rule
 * check's findings, live, and jumps to them.
 *
 * Every change is one edit through `ops.edit` (one undo step) running core functions (v1/props.ts, v1/create.ts) on
 * the document. Pickers offer the declarations that fit and can create a new one in the same step (`ops.use`).
 */
import { Fragment, render, type ComponentChildren } from "preact";
import { Field, Section } from "./widgets";
import { SimulatorTab, type SimProps } from "./simpanel";
import { CodeTab, type CodeProps } from "./codepanel";
import { SettingsTab, type SettingsProps } from "./settingspanel";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  OPTION_DEFAULTS,
  IDENTIFIER,
  actionLabel,
  addDecl,
  addInternal,
  addRegion,
  addTimer,
  identifier,
  cannotOffPage,
  declNameProblem,
  declUses,
  deleteDecl,
  deleteElements,
  guardLabel,
  internalTransitionLabel,
  pascalCase,
  renameDecl,
  renameRegion,
  renameVertex,
  rustModuleName,
  setBarOrientation,
  setDocText,
  setGuard,
  setMachineDoc,
  setMachineName,
  setOffPage,
  setPaper,
  setTitleField,
  locate,
  locationText,
  TITLE_BLOCK_FIELDS,
  setStateActions,
  setModelOption,
  setTargetOption,
  setTransitionActions,
  setTrigger,
  setTimer,
  stateLayout,
  timerText,
  timerNameProblem,
  timerDurationProblem,
  TIMER_UNITS,
  triggerLabel,
  vertexName,
  PAPER_SIZES,
  type Action,
  type DeclKind,
  type Diagnostic,
  type DocIndex,
  type ApiOption,
  type BehaviourOption,
  type GuardTerm,
  type Id,
  type InternalTransition,
  type Paper,
  type TitleBlock,
  type Region,
  type State,
  type Timer,
  type TimerUnit,
  type Transition,
  type TriggerSpec,
  type UfsmDocument,
  type Vertex,
} from "@ufsm/core";

export type PanelTab = "properties" | "project" | "problems" | "simulator" | "code" | "settings";

/** What a key of the `e`/`a` maps asks the panel to open (passed for one render only). */
export type FocusField = "name" | "trigger" | "entry" | "exit" | "guard" | "action" | "timer";

/** A declaration picked in a picker, or one to create first. */
export type Choice = { id: Id } | { create: { kind: DeclKind; name: string } };

export interface PanelOps {
  /** Select a vertex or transition (links in the panel). */
  select(id: Id): void;
  /** Go to an element a problem names (vertex, transition, region, internal transition or declaration). */
  jump(id: Id): void;
  /** Apply one change as one undo step. */
  edit(recipe: (d: UfsmDocument) => void): void;
  /** One undo step that first creates the chosen declaration when needed, then uses its id. */
  use(choice: Choice, recipe: (d: UfsmDocument, id: Id) => void): void;
  /** A message in the status line. */
  say(msg: string): void;
}

/** What the panel shows about the active machine. */
export interface PanelDoc {
  index: DocIndex;
  selection: ReadonlySet<string>;
  fileName: string;
  /** Full path when the machine has been saved (desktop); undefined for a converted or browser file. */
  path: string | undefined;
  /** True when the machine was converted from v0 and not saved yet. */
  converted: boolean;
  dirty: boolean;
  diagnostics: readonly Diagnostic[];
  notes: readonly { message: string }[];
}

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

/** Give the keyboard back to the canvas (the editor's keys are ignored while a text field has focus). */
const release = (): void => (document.activeElement as HTMLElement | null)?.blur();

// ---------------------------------------------------------------- building blocks

function Link({ id, text, ops }: { id: string; text: string; ops: PanelOps }) {
  return (
    <button type="button" class="link" onClick={() => ops.select(id)}>
      {text}
    </button>
  );
}

function IconButton({ label, title, onClick, cls = "remove" }: { label: string; title: string; onClick(): void; cls?: string }) {
  return (
    <button type="button" class={cls} title={title} aria-label={title} onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * A text field that commits on Enter or when it loses focus (if `validate` finds nothing wrong) and reverts on Esc.
 * Multi-line fields commit on Ctrl+Enter and on blur.
 */
function TextInput(p: {
  value: string;
  onCommit(v: string): void;
  validate?(v: string): string | undefined;
  placeholder?: string;
  multiline?: boolean;
  focus?: boolean;
  label?: string;
  cls?: string;
}) {
  const [draft, setDraftState] = useState(p.value);
  const [error, setError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // the latest draft for event handlers that run before a re-render (Esc and Enter blur the field at once)
  const live = useRef(p.value);
  /** Set when Enter or Esc already decided; the blur that follows does nothing. */
  const settled = useRef(false);
  const setDraft = (v: string): void => {
    live.current = v;
    setDraftState(v);
  };
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(p.value);
  }, [p.value]);
  useLayoutEffect(() => {
    if (!p.focus || !ref.current) return;
    ref.current.focus();
    ref.current.select();
  }, [p.focus]);
  const commit = (): boolean => {
    const v = live.current;
    const e = p.validate?.(v);
    setError(e);
    if (e) return false;
    if (v !== p.value) p.onCommit(v);
    return true;
  };
  const props = {
    ref,
    class: `${p.cls ?? "text"}${error ? " invalid" : ""}`,
    value: draft,
    placeholder: p.placeholder,
    "aria-label": p.label,
    "aria-invalid": error ? true : undefined,
    spellcheck: false,
    onInput: (e: Event) => {
      setDraft((e.currentTarget as HTMLInputElement).value);
      setError(undefined);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDraft(p.value);
        setError(undefined);
        settled.current = true;
        release();
      } else if (e.key === "Enter" && (!p.multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (commit()) {
          settled.current = true;
          release();
        }
      }
    },
    onFocus: () => {
      settled.current = false;
    },
    onBlur: () => {
      if (settled.current) return;
      if (!commit()) {
        setDraft(p.value);
        setError(undefined);
      }
    },
  };
  return (
    <span class="tinput">
      {p.multiline ? <textarea {...props} rows={3} /> : <input type="text" {...props} />}
      {error && <span class="perror">{error}</span>}
    </span>
  );
}

interface Option {
  key: string;
  label: string;
  detail?: string;
  pick(): void;
}

/**
 * Type to filter, arrows to move, Enter or a click to pick, Esc to close. `extra` adds options for the typed text
 * (creating a declaration).
 */
function Picker({ options, extra, placeholder, onClose }: { options: Option[]; extra?(text: string): Option[]; placeholder: string; onClose(): void }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => ref.current?.focus(), []);
  const q = text.trim().toLowerCase();
  const shown = [...options.filter((o) => o.label.toLowerCase().includes(q)), ...(extra?.(text.trim()) ?? [])].slice(0, 50);
  const i = Math.min(at, shown.length - 1);
  const pick = (o: Option | undefined): void => {
    if (!o) return;
    onClose();
    o.pick();
    release();
  };
  return (
    <div class="picker">
      <input
        ref={ref}
        class="text"
        type="text"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        spellcheck={false}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt(Math.min(i + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt(Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(shown[i]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            release();
          }
        }}
        onBlur={() => onClose()}
      />
      <ul class="picker-list" role="listbox">
        {shown.length === 0 && <li class="none">Nothing matches</li>}
        {shown.map((o, k) => (
          <li
            key={o.key}
            role="option"
            aria-selected={k === i}
            class={k === i ? "active" : ""}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input focused until the pick is done
              pick(o);
            }}
            onMouseEnter={() => setAt(k)}
          >
            <span class="olabel">{o.label}</span>
            {o.detail && <span class="dim"> {o.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Options to create a declaration of one of `kinds` named after the typed text (when it is a free identifier). */
function creating(index: DocIndex, kinds: { kind: DeclKind; label(n: string): string; detail: string }[], use: (c: Choice) => void) {
  return (text: string): Option[] => {
    const name = text.replace(/^\^/, "");
    if (!IDENTIFIER.test(name) || declNameProblem(index, name)) return [];
    // "^name" means a signal
    if (text.startsWith("^")) kinds = kinds.filter((k) => k.kind === "signal");
    return kinds.map((k) => ({ key: `new-${k.kind}`, label: k.label(name), detail: k.detail, pick: () => use({ create: { kind: k.kind, name } }) }));
  };
}

const declsOf = (index: DocIndex, kind: DeclKind) => [...index.decls.values()].filter((d) => d.kind === kind).map((d) => d.decl);

/** A list with move up/down and remove buttons per row, and an add button that opens a picker. */
function EditList<T>(p: {
  items: readonly T[];
  label(item: T): ComponentChildren;
  onChange(items: T[]): void;
  empty: string;
  add: string;
  picker(close: () => void): ComponentChildren;
  open?: boolean;
  extra?(item: T, i: number): ComponentChildren;
}) {
  const [adding, setAdding] = useState(false);
  useLayoutEffect(() => {
    if (p.open) setAdding(true);
  }, [p.open]);
  const move = (i: number, d: number): void => {
    const next = [...p.items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    p.onChange(next);
  };
  return (
    <>
      {p.items.length === 0 ? (
        <div class="none">{p.empty}</div>
      ) : (
        <ul class="plist">
          {p.items.map((it, i) => (
            <li key={i} class="erow">
              <span class="elabel">{p.label(it)}</span>
              {p.extra?.(it, i)}
              <span class="ebuttons">
                {i > 0 && <IconButton label="↑" title="Move up" cls="mini" onClick={() => move(i, -1)} />}
                {i < p.items.length - 1 && <IconButton label="↓" title="Move down" cls="mini" onClick={() => move(i, 1)} />}
                <IconButton label="×" title="Remove" onClick={() => p.onChange(p.items.filter((_, k) => k !== i))} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        p.picker(() => setAdding(false))
      ) : (
        <button type="button" class="add" onClick={() => setAdding(true)}>
          + {p.add}
        </button>
      )}
    </>
  );
}

/** Actions (calls and emits) of an entry/exit list or a transition. */
function ActionList({ index, actions, onChange, use, empty, add, open }: {
  index: DocIndex;
  actions: readonly Action[];
  onChange(a: Action[]): void;
  /** Append an action with the picked (or created) declaration. */
  use(choice: Choice, kind: "call" | "emit"): void;
  empty: string;
  add: string;
  open?: boolean;
}) {
  return (
    <EditList
      items={actions}
      label={(a) => <code>{actionLabel(index, a)}</code>}
      onChange={onChange}
      empty={empty}
      add={add}
      open={open}
      picker={(close) => (
        <Picker
          placeholder="Action or ^signal to emit"
          onClose={close}
          options={[
            ...declsOf(index, "action").map((d) => ({ key: d.id, label: `${d.name}()`, detail: "call", pick: () => use({ id: d.id }, "call") })),
            ...declsOf(index, "signal").map((d) => ({ key: d.id, label: `^${d.name}`, detail: "emit signal", pick: () => use({ id: d.id }, "emit") })),
          ]}
          extra={creating(
            index,
            [
              { kind: "action", label: (n) => `${n}()`, detail: "new action" },
              { kind: "signal", label: (n) => `^${n}`, detail: "new signal, emitted" },
            ],
            (c) => use(c, "create" in c && c.create.kind === "signal" ? "emit" : "call"),
          )}
        />
      )}
    />
  );
}

/** Guard terms: a guard function (true or false; guards return a boolean) or a state (in, not in). */
function GuardList({ index, terms, onChange, use, open }: {
  index: DocIndex;
  terms: readonly GuardTerm[];
  onChange(t: GuardTerm[]): void;
  use(choice: Choice | { in: Id }): void;
  open?: boolean;
}) {
  const replace = (i: number, t: GuardTerm): void => onChange(terms.map((x, k) => (k === i ? t : x)));
  const states = [...index.vertices.values()].filter((v) => v.vertex.kind === "state" || v.vertex.kind === "final").map((v) => v.vertex);
  return (
    <EditList
      items={terms}
      label={(g) => <code>{"in" in g ? `<${vertexName(index, g.in)}>` : `${index.decls.get(g.call)?.decl.name ?? "?"}()`}</code>}
      extra={(g, i) =>
        "in" in g ? (
          <select class="mode" aria-label="Condition" value={g.not ? "not" : "in"} onChange={(e) => replace(i, e.currentTarget.value === "not" ? { in: g.in, not: true } : { in: g.in })}>
            <option value="in">active</option>
            <option value="not">not active</option>
          </select>
        ) : (
          <select
            class="mode"
            aria-label="Condition"
            value={g.not ? "false" : "true"}
            onChange={(e) => replace(i, e.currentTarget.value === "false" ? { call: g.call, not: true } : { call: g.call })}
          >
            <option value="true">is true</option>
            <option value="false">is false</option>
          </select>
        )
      }
      onChange={onChange}
      empty="No guard (always enabled)"
      add="Add guard term"
      open={open}
      picker={(close) => (
        <Picker
          placeholder="Guard function or state"
          onClose={close}
          options={[
            ...declsOf(index, "guard").map((d) => ({ key: d.id, label: `${d.name}()`, detail: "guard", pick: () => use({ id: d.id }) })),
            ...states.map((v) => ({ key: v.id, label: `<${vertexName(index, v.id)}>`, detail: "state is active", pick: () => use({ in: v.id }) })),
          ]}
          extra={creating(index, [{ kind: "guard", label: (n) => `${n}()`, detail: "new guard" }], (c) => use(c))}
        />
      )}
    />
  );
}

/** Trigger of a transition (events, signals, auto, completion, none) or of an internal transition (events, signals). */
function TriggerField({ index, current, onPick, internal, open }: {
  index: DocIndex;
  current: string;
  onPick(t: TriggerSpec | Choice): void;
  internal?: boolean;
  open?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  useLayoutEffect(() => {
    if (open) setPicking(true);
  }, [open]);
  if (!picking) {
    return (
      <button type="button" class="trigger" title="Change the trigger" onClick={() => setPicking(true)}>
        <code>{current}</code>
      </button>
    );
  }
  const special: Option[] = internal
    ? []
    : [
        { key: "auto", label: "auto", detail: "no event: whenever the guard holds", pick: () => onPick({ auto: true }) },
        { key: "completion", label: "completion", detail: "when every region is final", pick: () => onPick({ completion: true }) },
        { key: "none", label: "none", detail: "no trigger", pick: () => onPick(undefined) },
      ];
  return (
    <Picker
      placeholder="Event or signal"
      onClose={() => setPicking(false)}
      options={[
        ...declsOf(index, "event").map((d) => ({ key: d.id, label: d.name, detail: "event", pick: () => onPick({ id: d.id }) })),
        ...declsOf(index, "signal").map((d) => ({ key: d.id, label: d.name, detail: "signal", pick: () => onPick({ id: d.id }) })),
        ...special,
      ]}
      extra={creating(
        index,
        [
          { kind: "event", label: (n) => n, detail: "new event" },
          { kind: "signal", label: (n) => n, detail: "new signal" },
        ],
        (c) => onPick(c),
      )}
    />
  );
}

/** The event a timer fires: declared events only (signals are internal), or a new event. */
function TimerEventField({ index, current, onPick, open }: { index: DocIndex; current: string; onPick(c: Choice): void; open?: boolean }) {
  const [picking, setPicking] = useState(false);
  useLayoutEffect(() => {
    if (open) setPicking(true);
  }, [open]);
  if (!picking) {
    return (
      <button type="button" class="trigger" title="Change the event the timer fires" onClick={() => setPicking(true)}>
        <code>{current}</code>
      </button>
    );
  }
  return (
    <Picker
      placeholder="Event to fire on expiry"
      onClose={() => setPicking(false)}
      options={declsOf(index, "event").map((d) => ({ key: d.id, label: d.name, detail: "event", pick: () => onPick({ id: d.id }) }))}
      extra={creating(index, [{ kind: "event", label: (n) => n, detail: "new event" }], onPick)}
    />
  );
}

/** Apply a trigger pick: a special trigger directly, a declaration (maybe created first) as `on`. */
function pickTrigger(ops: PanelOps, transitionId: Id, t: TriggerSpec | Choice): void {
  if (t && ("id" in t || "create" in t)) ops.use(t, (d, id) => setTrigger(d, transitionId, { on: id }));
  else ops.edit((d) => setTrigger(d, transitionId, t));
}

const KIND_NAMES: Record<Vertex["kind"], string> = {
  state: "State",
  initial: "Initial state",
  final: "Final state",
  "shallow-history": "Shallow history",
  "deep-history": "Deep history",
  fork: "Fork",
  join: "Join",
  terminate: "Terminate",
};

function regionLabel(index: DocIndex, r: Region): string {
  const owner = index.regions.get(r.id)?.owner;
  const name = r.name || "(region)";
  return owner ? `${owner.name || "(unnamed)"} › ${name}` : `${index.doc.name} (root)`;
}

function DocField({ id, value, ops }: { id: Id; value: string | undefined; ops: PanelOps }) {
  return (
    <TextInput multiline label="Documentation" placeholder="What this is for (Ctrl+Enter to save)" value={value ?? ""} onCommit={(v) => ops.edit((d) => setDocText(d, id, v.trim()))} />
  );
}

/** Actions use: append {call} or {emit} with the chosen declaration to a list via `set`. */
const appendAction =
  (ops: PanelOps, list: readonly Action[], set: (d: UfsmDocument, a: Action[]) => void) =>
  (c: Choice, kind: "call" | "emit"): void =>
    ops.use(c, (d, id) => set(d, [...list, kind === "call" ? { call: id } : { emit: id }]));

const appendTerm =
  (ops: PanelOps, terms: readonly GuardTerm[], set: (d: UfsmDocument, g: GuardTerm[]) => void) =>
  (c: Choice | { in: Id }): void => {
    if ("in" in c) ops.edit((d) => set(d, [...terms, { in: c.in }]));
    else ops.use(c, (d, id) => set(d, [...terms, { call: id }]));
  };

// ---------------------------------------------------------------- properties

function InternalProps({ index, t, ops }: { index: DocIndex; t: InternalTransition; ops: PanelOps }) {
  return (
    <details class="internal">
      <summary>
        <code>{internalTransitionLabel(index, t)}</code>
        <IconButton label="×" title="Delete this internal transition" onClick={() => ops.edit((d) => void deleteElements(d, [t.id]))} />
      </summary>
      <div class="ibody">
        <Field label="On">
          <TriggerField index={index} internal current={index.decls.get(t.on)?.decl.name ?? "?"} onPick={(p) => pickTrigger(ops, t.id, p)} />
        </Field>
        <div class="sublabel">Guard</div>
        <GuardList index={index} terms={t.guard ?? []} onChange={(g) => ops.edit((d) => setGuard(d, t.id, g))} use={appendTerm(ops, t.guard ?? [], (d, g) => setGuard(d, t.id, g))} />
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
  const countProblem = (v: string): string | undefined => (/^\s*\d+\s*$/.test(v) ? timerDurationProblem(Number(v), t.unit) : "A whole number from 1 up is needed.");
  const pickUnit = (unit: TimerUnit): void => {
    const problem = timerDurationProblem(count, unit);
    if (problem) ops.say(`${count} ${unit}: ${problem}`);
    else ops.edit((d) => setTimer(d, t.id, { unit }));
  };
  return (
    <details class="internal">
      <summary>
        <code>{timerText(index, t)}</code>
        <IconButton label="×" title="Delete this timer" onClick={() => ops.edit((d) => void deleteElements(d, [t.id]))} />
      </summary>
      <div class="ibody">
        <Field label="Name">
          <TextInput label="Timer name" value={t.name} validate={(v) => timerNameProblem(index, v.trim(), t.id)} onCommit={(v) => ops.edit((d) => setTimer(d, t.id, { name: v.trim() }))} />
        </Field>
        <Field label="Duration">
          <span class="timer-duration">
            <select aria-label="One-shot or periodic" value={kind} onChange={(e) => ops.edit((d) => setTimer(d, t.id, { kind: e.currentTarget.value as "after" | "every" }))}>
              <option value="after">after</option>
              <option value="every">every</option>
            </select>
            <TextInput cls="text count" label="Duration" value={String(count)} validate={countProblem} onCommit={(v) => ops.edit((d) => setTimer(d, t.id, { count: Number(v) }))} />
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
          <TimerEventField index={index} current={index.decls.get(t.event)?.decl.name ?? "?"} onPick={(c) => ops.use(c, (d, id) => setTimer(d, t.id, { event: id }))} />
        </Field>
        <div class="sublabel">Documentation</div>
        <DocField id={t.id} value={t.doc} ops={ops} />
      </div>
    </details>
  );
}

function StateProps({ index, s, ops, focus }: { index: DocIndex; s: State; ops: PanelOps; focus: FocusField | undefined }) {
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
          <TextInput label="Name" value={s.name} focus={focus === "name"} onCommit={(v) => ops.edit((d) => renameVertex(d, s.id, v))} />
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
        {(s.timers ?? []).length === 0 && <div class="none">None (started on entry, stopped on exit; fire an event)</div>}
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
                <TextInput cls="text rname" label="Region name" placeholder="(region)" value={r.name ?? ""} onCommit={(v) => ops.edit((d) => renameRegion(d, r.id, v.trim()))} />
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
                <span class="dim" title={`${r.states.length} ${r.states.length === 1 ? "vertex" : "vertices"}`}>{r.states.length}</span>
                <IconButton label="×" title={`Delete this region and the ${r.states.length} vertices in it`} onClick={() => ops.edit((d) => void deleteElements(d, [r.id]))} />
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

function PseudoProps({ index, v, ops, focus }: { index: DocIndex; v: Vertex; ops: PanelOps; focus: FocusField | undefined }) {
  const region = index.vertices.get(v.id)?.region;
  const bar = v.kind === "fork" || v.kind === "join";
  const horizontal = stateLayout(index, v.id).orientation === "horizontal";
  return (
    <Section title="General">
      <Field label="Kind">{KIND_NAMES[v.kind]}</Field>
      <Field label="Name">
        <TextInput label="Name" placeholder="(optional)" value={v.name ?? ""} focus={focus === "name"} onCommit={(n) => ops.edit((d) => renameVertex(d, v.id, n.trim()))} />
      </Field>
      {bar && (
        <Field label="Orientation">
          <select aria-label="Orientation" value={horizontal ? "h" : "v"} onChange={(e) => ops.edit((d) => setBarOrientation(d, v.id, e.currentTarget.value === "h"))}>
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

function TransitionProps({ index, t, ops, focus }: { index: DocIndex; t: Transition; ops: PanelOps; focus: FocusField | undefined }) {
  const layout = index.doc.diagram?.transitions[t.id];
  const route = layout && "route" in layout && layout.route === "s" ? "S (orthogonal)" : "Free (bend points)";
  const trigger = t.on ? triggerLabel(index, t) : t.auto ? "auto" : t.completion ? "completion" : "none";
  // design rules: nothing triggers or guards a transition out of an initial/history state or fork; a transition into
  // a join has no trigger (its outgoing transition has). The editors stay when the file has one anyway, to remove it.
  const fromKind = index.vertices.get(t.from)?.vertex.kind;
  const toKind = index.vertices.get(t.to)?.vertex.kind;
  const pseudoSource = fromKind === "initial" || fromKind === "shallow-history" || fromKind === "deep-history" || fromKind === "fork";
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
            <TriggerField index={index} current={trigger} open={focus === "trigger"} onPick={(p) => pickTrigger(ops, t.id, p)} />
          </Field>
        ) : (
          <div class="none">{pseudoSource ? `None: it is taken as soon as the ${KIND_NAMES[fromKind!].toLowerCase()} is reached.` : "None: the join's outgoing transition has the trigger."}</div>
        )}
      </Section>
      <Section title="Guard" count={t.guard?.length}>
        {showGuard ? (
          <GuardList index={index} terms={t.guard ?? []} open={focus === "guard"} onChange={(g) => ops.edit((d) => setGuard(d, t.id, g))} use={appendTerm(ops, t.guard ?? [], (d, g) => setGuard(d, t.id, g))} />
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

function Properties({ doc, ops, focus }: { doc: PanelDoc | undefined; ops: PanelOps; focus: FocusField | undefined }) {
  if (!doc) return <div class="pempty">No machine open.</div>;
  const { index, selection } = doc;
  if (selection.size === 0) {
    return (
      <div class="pempty">
        Select a state or transition to see its properties.
        <div class="dim">Machine {index.doc.name}: {index.vertices.size} states, {index.transitions.size} transitions.</div>
      </div>
    );
  }
  if (selection.size > 1) return <div class="pempty">{selection.size} items selected.</div>;
  const id = selection.values().next().value!;
  const v = index.vertices.get(id)?.vertex;
  const t = index.transitions.get(id);
  return (
    // keyed by the element, so drafts in text fields never carry over to another element
    <div key={id}>
      <div class="pheader">
        <span class="kind">{v ? KIND_NAMES[v.kind] : "Transition"}</span>
        <span class="name">{v ? vertexName(index, v.id) : t ? `${vertexName(index, t.from)} → ${vertexName(index, t.to)}` : id}</span>
      </div>
      {v?.kind === "state" && <StateProps index={index} s={v} ops={ops} focus={focus} />}
      {v && v.kind !== "state" && <PseudoProps index={index} v={v} ops={ops} focus={focus} />}
      {t && <TransitionProps index={index} t={t} ops={ops} focus={focus} />}
    </div>
  );
}

// ---------------------------------------------------------------- project

type TargetSettings = Record<string, unknown>;

export interface TargetOption {
  key: string;
  label: string;
  fallback(name: string, set: TargetSettings): string;
}

/** The behaviour options of the `options` section, shared by every code generator and the simulator: shown once, defaults as placeholders. */
export const MODEL_OPTIONS: { key: BehaviourOption; label: string }[] = [
  { key: "signalQueue", label: "Signal queue" },
  { key: "maxMicrosteps", label: "Max microsteps" },
];

/** The API options of the `options` section (true/false; each code generator may override them). */
export const API_OPTION_INFO: { key: ApiOption; label: string; text: string }[] = [
  {
    key: "debugInfo",
    label: "Debug info",
    text: "The generated code can name events, signals and states and tell whether a state is active. In C and Rust the names cost strings in flash.",
  },
  {
    key: "trace",
    label: "Trace hook",
    text:
      "The generated code calls trace(kind, id), which you implement, with ids only: event received, signal taken, transition taken, " +
      "state entered and exited. It runs inside process(), so it must not block or call the machine; timestamps and transport are yours.",
  },
];

/** Code generator settings as stored in `targets`, with the generators' defaults shown as placeholders when unset. */
export const TARGETS: { key: string; title: string; options: TargetOption[] }[] = [
  {
    key: "c",
    title: "C",
    options: [
      { key: "prefix", label: "Prefix", fallback: (n) => `${identifier(n)}_` },
      {
        key: "file",
        label: "File",
        fallback: (n, set) => (typeof set["prefix"] === "string" ? set["prefix"].replace(/_+$/, "") : "") || identifier(n),
      },
    ],
  },
  {
    key: "python",
    title: "Python",
    options: [
      { key: "className", label: "Class", fallback: (n) => pascalCase(n) },
      { key: "module", label: "Module", fallback: (n) => identifier(n) },
    ],
  },
  {
    key: "ts",
    title: "TypeScript",
    options: [
      { key: "className", label: "Class", fallback: (n) => pascalCase(n) },
      { key: "module", label: "Module", fallback: (n) => identifier(n) },
    ],
  },
  {
    key: "rust",
    title: "Rust",
    options: [
      { key: "className", label: "Struct", fallback: (n) => pascalCase(n) },
      { key: "module", label: "Module", fallback: (n) => rustModuleName(n) },
    ],
  },
];

const KIND_TITLES: { kind: DeclKind; title: string; one: string }[] = [
  { kind: "event", title: "Events", one: "event" },
  { kind: "signal", title: "Signals", one: "signal" },
  { kind: "action", title: "Actions", one: "action" },
  { kind: "guard", title: "Guards", one: "guard" },
];

function DeclRow({ index, id, name, doc, ops, highlight }: { index: DocIndex; id: Id; name: string; doc: string | undefined; ops: PanelOps; highlight: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  const uses = declUses(index, id).length;
  return (
    <li ref={ref} class={`erow decl${highlight ? " flash" : ""}`} data-decl={id} title={doc}>
      <TextInput
        label={`Name of ${name}`}
        value={name}
        validate={(v) => declNameProblem(index, v.trim(), id)}
        onCommit={(v) => ops.edit((d) => renameDecl(d, id, v.trim()))}
      />
      <span class="dim uses">{uses === 0 ? "unused" : `${uses} use${uses > 1 ? "s" : ""}`}</span>
      <IconButton label="×" title={uses ? `Delete, and remove its ${uses} use${uses > 1 ? "s" : ""}` : "Delete"} onClick={() => ops.edit((d) => deleteDecl(d, id))} />
    </li>
  );
}

function DeclList({ index, kind, one, ops, highlight }: { index: DocIndex; kind: DeclKind; one: string; ops: PanelOps; highlight: Id | undefined }) {
  const [adding, setAdding] = useState(false);
  const decls = declsOf(index, kind);
  return (
    <>
      {decls.length === 0 ? (
        <div class="none">None</div>
      ) : (
        <ul class="plist">
          {decls.map((d) => (
            <DeclRow key={d.id} index={index} id={d.id} name={d.name} doc={d.doc} ops={ops} highlight={d.id === highlight} />
          ))}
        </ul>
      )}
      {adding ? (
        <TextInput
          label={`New ${one}`}
          placeholder={`New ${one} name`}
          value=""
          focus
          validate={(v) => (v.trim() === "" ? undefined : declNameProblem(index, v.trim()))}
          onCommit={(v) => {
            setAdding(false);
            if (v.trim()) ops.edit((d) => void addDecl(d, kind, v.trim()));
          }}
        />
      ) : (
        <button type="button" class="add" onClick={() => setAdding(true)}>
          + Add {one}
        </button>
      )}
    </>
  );
}

/** Names of the title block's free fields, and the labels of their inputs (search and the canvas focus them by label). */
export const TITLE_FIELD_NAMES: Readonly<Record<keyof TitleBlock, string>> = {
  revision: "Revision",
  date: "Date",
  author: "Author",
  company: "Company",
  document: "Document no.",
};
export const TITLE_FIELD_LABELS: Readonly<Record<keyof TitleBlock, string>> = {
  revision: "Title block revision",
  date: "Title block date",
  author: "Title block author",
  company: "Title block company",
  document: "Title block document number",
};

/** Today as YYYY-MM-DD (local time). */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Project({ doc, ops, highlight }: { doc: PanelDoc | undefined; ops: PanelOps; highlight: Id | undefined }) {
  if (!doc) return <div class="pempty">No machine open.</div>;
  const index = doc.index;
  const d = index.doc;
  const paper = d.diagram?.paper ?? "A4";
  // The fit is part of the design rule check (core sheet.ts); counted here from its findings.
  const outside = doc.diagnostics.filter((x) => x.code === "outside-frame").length;
  const overTitle = doc.diagnostics.filter((x) => x.code === "title-block").length;
  const tb = d.diagram?.titleBlock ?? {};
  return (
    <>
      <div class="pnote">
        There is no project format yet, so this shows the settings stored in the active machine's file. Project-wide
        settings will move here.
      </div>
      <Section title="Machine">
        <Field label="Name">
          <TextInput label="Machine name" value={d.name} validate={(v) => (v.trim() ? undefined : "A name is needed.")} onCommit={(v) => ops.edit((x) => setMachineName(x, v.trim()))} />
        </Field>
        <Field label="File">
          <span title={doc.path ?? doc.fileName}>{doc.fileName}</span>
        </Field>
        <Field label="Format">{doc.converted ? "v0, converted (save to write v1)" : "v1"}</Field>
        <Field label="Status">{doc.dirty ? "Unsaved changes" : "Saved"}</Field>
        <Field label="Paper">
          <select aria-label="Paper size" value={paper} onChange={(e) => ops.edit((x) => setPaper(x, e.currentTarget.value as Paper))}>
            {(Object.keys(PAPER_SIZES) as Paper[]).map((p) => (
              <option key={p} value={p}>
                {p} ({PAPER_SIZES[p].w} × {PAPER_SIZES[p].h})
              </option>
            ))}
          </select>
        </Field>
        {outside + overTitle > 0 && (
          <div class="swarn paper-warn">
            {[
              outside ? `${outside} ${outside === 1 ? "element lies" : "elements lie"} outside the frame` : "",
              overTitle ? `${overTitle} ${overTitle === 1 ? "overlaps" : "overlap"} the title block` : "",
            ]
              .filter(Boolean)
              .join(", ")}{" "}
            on {paper} (listed under Problems).
          </div>
        )}
        <div class="sublabel">Description</div>
        <TextInput multiline label="Description" placeholder="What this machine does (Ctrl+Enter to save)" value={d.doc ?? ""} onCommit={(v) => ops.edit((x) => setMachineDoc(x, v.trim()))} />
      </Section>
      <Section title="Title block">
        <div class="snote">
          Drawn on every sheet. Title, description, sheet path, sheet number, file and paper size come from the machine;
          these fields are yours. Double-click the title block on the canvas to come here.
        </div>
        {TITLE_BLOCK_FIELDS.map((k) => (
          <Field label={TITLE_FIELD_NAMES[k]} key={k}>
            <div class="title-field">
              <TextInput label={TITLE_FIELD_LABELS[k]} value={tb[k] ?? ""} onCommit={(v) => ops.edit((x) => setTitleField(x, k, v))} />
              {k === "date" && (
                <button type="button" class="mini" title="Set to today's date" onClick={() => ops.edit((x) => setTitleField(x, "date", today()))}>
                  Today
                </button>
              )}
            </div>
          </Field>
        ))}
      </Section>
      {KIND_TITLES.map((k) => (
        <Section key={k.kind} title={k.title} count={d.declarations[`${k.kind}s` as "events"].length}>
          <DeclList index={index} kind={k.kind} one={k.one} ops={ops} highlight={highlight} />
        </Section>
      ))}
      <Section title="Options">
        <div class="snote">
          The same for every code generator and the simulator, so the machine behaves alike in every language. Max
          microsteps: per reset or event before a livelock error (0: no check in generated code).
        </div>
        {MODEL_OPTIONS.map((o) => (
          <Field label={o.label} key={o.key}>
            <TextInput
              label={o.label}
              placeholder={String(OPTION_DEFAULTS[o.key])}
              value={d.options?.[o.key] === undefined ? "" : String(d.options[o.key])}
              validate={(v) => (v.trim() !== "" && !/^\d+$/.test(v.trim()) ? "A whole number, 0 or more" : undefined)}
              onCommit={(v) => {
                const s = v.trim();
                ops.edit((x) => setModelOption(x, o.key, s === "" ? undefined : Number(s)));
              }}
            />
          </Field>
        ))}
        {API_OPTION_INFO.map((o) => (
          <Fragment key={o.key}>
            <Field label={o.label}>
              <label class="check">
                <input
                  type="checkbox"
                  aria-label={o.label}
                  checked={d.options?.[o.key] === true}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    ops.edit((x) => setModelOption(x, o.key, on ? true : undefined));
                  }}
                />
                {d.options?.[o.key] === true ? "on" : "off"}
              </label>
            </Field>
            <div class="snote">{o.text}</div>
          </Fragment>
        ))}
      </Section>
      {TARGETS.map((t) => {
        const set = d.targets?.[t.key] ?? {};
        return (
          <Section title={`Code generation: ${t.title}`} key={t.key}>
            {t.options.map((o) => (
              <Field label={o.label} key={o.key}>
                <TextInput
                  label={`${t.title} ${o.label}`}
                  placeholder={o.fallback(d.name, set)}
                  value={o.key in set ? String(set[o.key]) : ""}
                  onCommit={(v) => {
                    const s = v.trim();
                    ops.edit((x) => setTargetOption(x, t.key, o.key, s === "" ? undefined : s));
                  }}
                />
              </Field>
            ))}
            {API_OPTION_INFO.map((o) => {
              const own = set[o.key];
              const model = d.options?.[o.key] === true ? "on" : "off";
              return (
                <Field label={o.label} key={o.key}>
                  <select
                    aria-label={`${t.title} ${o.label}`}
                    value={own === true ? "on" : own === false ? "off" : ""}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      ops.edit((x) => setTargetOption(x, t.key, o.key, v === "" ? undefined : v === "on"));
                    }}
                  >
                    <option value="">As in Options ({model})</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </Field>
              );
            })}
          </Section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- problems

/** " · sheet 2, B4": where the element is drawn (nothing for declarations, or when the diagram cannot say). */
function ProblemPlace({ index, id }: { index: DocIndex; id: Id }) {
  const loc = locate(index, id);
  return loc ? <span class="dim loc"> · {locationText(loc)}</span> : null;
}

function Problems({ doc, ops }: { doc: PanelDoc | undefined; ops: PanelOps }) {
  if (!doc) return <div class="pempty">No machine open.</div>;
  const rows = [
    ...doc.diagnostics.filter((x) => x.severity === "error"),
    ...doc.diagnostics.filter((x) => x.severity === "warning"),
  ];
  if (rows.length === 0 && doc.notes.length === 0) return <div class="pempty">No problems found.</div>;
  return (
    <ul class="problems-list">
      {rows.map((r, i) => (
        <li key={`${r.code}-${r.id ?? ""}-${i}`}>
          <button type="button" class="problem" disabled={!r.id} onClick={() => r.id && ops.jump(r.id)} title={r.id ? "Show it" : undefined}>
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
