// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Properties of notes, group frames and arrows: documentation on the diagram that the machine never sees.
 */
import { ARROW_HEADS, type ArrowEnd, type ArrowHead, type DocIndex, type Id } from "@ufsm/core";
import { reverseArrow, setArrowDashed, setArrowHead, setFrameCaption, setNoteText, setNoteTodo } from "@ufsm/core/edit";
import { noteDisplayText, noteHeightFor, noteRefs, referenceName } from "@ufsm/core/diagram";
import { canvasLabelMeasure } from "../render";
import { Field, Section } from "../widgets";
import { TextInput } from "./fields";
import type { PanelOps } from "./types";

const HEAD_NAMES: Record<ArrowHead, string> = { none: "none", end: "at the end", both: "at both ends" };

/** What an arrow end is attached to, with a link to it. */
function EndField({ index, end, ops }: { index: DocIndex; end: ArrowEnd; ops: PanelOps }) {
  if (!("ref" in end)) return <span class="dim">free</span>;
  const name = referenceName(index, end.ref);
  return name === undefined ? (
    <span class="dim">unknown {end.ref}</span>
  ) : (
    <button type="button" class="link" onClick={() => ops.jump(end.ref)}>
      {name || end.ref}
    </button>
  );
}

function NoteProps({ index, id, ops }: { index: DocIndex; id: Id; ops: PanelOps }) {
  const n = index.doc.diagram!.notes![id]!;
  const refs = [...new Set(noteRefs(n.text).map((r) => r.id))];
  return (
    <>
      <Section title="Note">
        <TextInput
          multiline
          label="Note text"
          placeholder="Text ({id} shows that element's name; Ctrl+Enter to save)"
          value={n.text}
          onCommit={(v) =>
            ops.edit((d) => {
              const text = v.replace(/\s+$/, "");
              const need = noteHeightFor(noteDisplayText(index, text), n.w, canvasLabelMeasure());
              setNoteText(d, id, text, Math.max(n.h, need));
            })
          }
        />
        <label class="check" title="An open question: drawn in the warning color and listed in Problems">
          <input
            type="checkbox"
            checked={n.todo === true}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              ops.edit((d) => setNoteTodo(d, id, on));
            }}
          />
          TODO
        </label>
      </Section>
      {refs.length > 0 && (
        <Section title="Refers to" count={refs.length}>
          {refs.map((r) => {
            const name = referenceName(index, r);
            return (
              <Field key={r} label={r}>
                {name === undefined ? (
                  <span class="dim">no such element</span>
                ) : (
                  <button type="button" class="link" onClick={() => ops.jump(r)}>
                    {name || r}
                  </button>
                )}
              </Field>
            );
          })}
        </Section>
      )}
      <div class="none">Documentation only: notes never reach the generated code.</div>
    </>
  );
}

function FrameProps({ index, id, ops }: { index: DocIndex; id: Id; ops: PanelOps }) {
  const f = index.doc.diagram!.frames![id]!;
  return (
    <>
      <Section title="Group frame">
        <Field label="Caption">
          <TextInput
            label="Caption"
            placeholder="(none)"
            value={f.caption ?? ""}
            onCommit={(v) => ops.edit((d) => setFrameCaption(d, id, v.trim()))}
          />
        </Field>
        <Field label="Size">
          {f.w} × {f.h}
        </Field>
      </Section>
      <div class="none">Documentation only: a frame groups what it surrounds for the reader, not for the machine.</div>
    </>
  );
}

function ArrowProps({ index, id, ops }: { index: DocIndex; id: Id; ops: PanelOps }) {
  const a = index.doc.diagram!.arrows![id]!;
  return (
    <>
      <Section title="Arrow">
        <Field label="From">
          <EndField index={index} end={a.from} ops={ops} />
        </Field>
        <Field label="To">
          <EndField index={index} end={a.to} ops={ops} />
        </Field>
        <Field label="Head">
          <select
            aria-label="Arrowheads"
            value={a.head ?? "end"}
            onChange={(e) => ops.edit((d) => setArrowHead(d, id, e.currentTarget.value as ArrowHead))}
          >
            {ARROW_HEADS.map((h) => (
              <option key={h} value={h}>
                {HEAD_NAMES[h]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Line">
          <label class="check" title="A dashed line (with no head: UML's anchor from a note to what it is about)">
            <input
              type="checkbox"
              checked={a.dashed === true}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                ops.edit((d) => setArrowDashed(d, id, on));
              }}
            />
            dashed
          </label>
        </Field>
        <button type="button" class="link" onClick={() => ops.edit((d) => reverseArrow(d, id))}>
          Reverse
        </button>
      </Section>
      <div class="none">Drag an end onto an element to attach it there, or onto empty canvas to leave it free.</div>
    </>
  );
}

/** Header kind of a note, frame or arrow. */
export const ANNOTATION_NAMES = { note: "Note", frame: "Group frame", arrow: "Arrow" } as const;

export function AnnotationProps({
  index,
  id,
  kind,
  ops,
}: {
  index: DocIndex;
  id: Id;
  kind: "note" | "frame" | "arrow";
  ops: PanelOps;
}) {
  if (kind === "note") return <NoteProps index={index} id={id} ops={ops} />;
  if (kind === "frame") return <FrameProps index={index} id={id} ops={ops} />;
  return <ArrowProps index={index} id={id} ops={ops} />;
}
