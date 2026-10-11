// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The Project tab: the machine's name and description, paper and title block, declarations, options, and the code
 * generators' settings.
 */
import { Fragment } from "preact";
import { Field, Section } from "../widgets";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  OPTION_DEFAULTS,
  identifier,
  pascalCase,
  TITLE_BLOCK_FIELDS,
  PAPER_SIZES,
  type DeclKind,
  type DocIndex,
  type ApiOption,
  type BehaviourOption,
  type Id,
  type Paper,
  type TitleBlock,
} from "@ufsm/core";
import {
  addDecl,
  declNameProblem,
  declUses,
  deleteDecl,
  renameDecl,
  setMachineDoc,
  setMachineName,
  setPaper,
  setTitleField,
  setModelOption,
  setTargetOption,
} from "@ufsm/core/edit";
import { rustModuleName } from "@ufsm/core/pipeline";
import { type PanelOps, type PanelDoc } from "./types";
import { IconButton, TextInput, declsOf } from "./fields";

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

export function Project({ doc, ops, highlight }: { doc: PanelDoc | undefined; ops: PanelOps; highlight: Id | undefined }) {
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
