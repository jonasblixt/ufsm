// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Building blocks of the panel tabs: links, text inputs that commit on Enter or blur, pickers that can create a
 * declaration, editable lists of actions and guard terms, trigger and timer event fields, documentation fields.
 */
import { type ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  IDENTIFIER,
  actionLabel,
  vertexName,
  type Action,
  type DeclKind,
  type DocIndex,
  type GuardTerm,
  type Id,
  type Region,
  type UfsmDocument,
  type Vertex,
} from "@ufsm/core";
import { declNameProblem, setDocText, setTrigger, type TriggerSpec } from "@ufsm/core/edit";
import { type Choice, type PanelOps, release } from "./types";

export function Link({ id, text, ops }: { id: string; text: string; ops: PanelOps }) {
  return (
    <button type="button" class="link" onClick={() => ops.select(id)}>
      {text}
    </button>
  );
}

export function IconButton({ label, title, onClick, cls = "remove" }: { label: string; title: string; onClick(): void; cls?: string }) {
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
export function TextInput(p: {
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

export interface Option {
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

export const declsOf = (index: DocIndex, kind: DeclKind) => [...index.decls.values()].filter((d) => d.kind === kind).map((d) => d.decl);

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
export function ActionList({ index, actions, onChange, use, empty, add, open }: {
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
export function GuardList({ index, terms, onChange, use, open }: {
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
export function TriggerField({ index, current, onPick, internal, open }: {
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
export function TimerEventField({ index, current, onPick, open }: { index: DocIndex; current: string; onPick(c: Choice): void; open?: boolean }) {
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
export function pickTrigger(ops: PanelOps, transitionId: Id, t: TriggerSpec | Choice): void {
  if (t && ("id" in t || "create" in t)) ops.use(t, (d, id) => setTrigger(d, transitionId, { on: id }));
  else ops.edit((d) => setTrigger(d, transitionId, t));
}

export const KIND_NAMES: Record<Vertex["kind"], string> = {
  state: "State",
  initial: "Initial state",
  final: "Final state",
  "shallow-history": "Shallow history",
  "deep-history": "Deep history",
  fork: "Fork",
  join: "Join",
  terminate: "Terminate",
};

export function regionLabel(index: DocIndex, r: Region): string {
  const owner = index.regions.get(r.id)?.owner;
  const name = r.name || "(region)";
  return owner ? `${owner.name || "(unnamed)"} › ${name}` : `${index.doc.name} (root)`;
}

export function DocField({ id, value, ops }: { id: Id; value: string | undefined; ops: PanelOps }) {
  return (
    <TextInput multiline label="Documentation" placeholder="What this is for (Ctrl+Enter to save)" value={value ?? ""} onCommit={(v) => ops.edit((d) => setDocText(d, id, v.trim()))} />
  );
}

/** Actions use: append {call} or {emit} with the chosen declaration to a list via `set`. */
export const appendAction =
  (ops: PanelOps, list: readonly Action[], set: (d: UfsmDocument, a: Action[]) => void) =>
  (c: Choice, kind: "call" | "emit"): void =>
    ops.use(c, (d, id) => set(d, [...list, kind === "call" ? { call: id } : { emit: id }]));

export const appendTerm =
  (ops: PanelOps, terms: readonly GuardTerm[], set: (d: UfsmDocument, g: GuardTerm[]) => void) =>
  (c: Choice | { in: Id }): void => {
    if ("in" in c) ops.edit((d) => set(d, [...terms, { in: c.in }]));
    else ops.use(c, (d, id) => set(d, [...terms, { call: id }]));
  };
