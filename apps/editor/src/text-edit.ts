// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Editing a note's text or a group frame's caption in place: a text field laid over the canvas at the element, in the
 * diagram's font at the current zoom. Ctrl+Enter (Enter for a caption) or a click elsewhere keeps the text, Esc drops
 * it; the edit is one undo step. A new note is only created when its text is kept.
 */
import { indexV1, type Id, type UfsmDocument } from "@ufsm/core";
import { addNote, setFrameCaption, setNoteText } from "@ufsm/core/edit";
import {
  FRAME_CAPTION_H,
  NOTE_FONT_SIZE,
  NOTE_LINE_H,
  NOTE_PAD,
  annotationBox,
  noteDisplayText,
  noteHeightFor,
  type Box,
} from "@ufsm/core/diagram";
import type { App } from "./app";

export interface TextEdit {
  /** Edit an existing note's text, or a frame's caption. */
  open(id: Id): void;
  /** Type the text of a new note with absolute box `box` in a region; the note is created when the text is kept. */
  openNew(region: Id, box: Box): void;
  /** Keep what was typed and close (nothing when closed). */
  commit(): void;
  readonly active: boolean;
}

type Target = { kind: "note"; id: Id } | { kind: "frame"; id: Id } | { kind: "new"; region: Id; box: Box };

export function createTextEdit(app: App): TextEdit {
  const field = document.createElement("textarea");
  field.className = "note-edit";
  field.spellcheck = true;
  field.hidden = true;
  field.setAttribute("aria-label", "Note text");
  document.body.append(field);
  let target: Target | undefined;
  let session: unknown;

  /** The height a note needs for `text` at width `w`, keeping a taller box the user made. */
  const noteHeight = (doc: UfsmDocument, text: string, w: number, h: number): number =>
    Math.max(h, noteHeightFor(noteDisplayText(indexV1(doc), text), w, app.canvas.measure));

  const place = (box: Box, caption: boolean): void => {
    const scale = app.canvas.view.scale;
    const [x, y] = app.canvas.worldToScreen(box.x, box.y);
    // the field is outside the parts the UI zoom scales, as the canvas is
    const px = (v: number): string => `${v}px`;
    Object.assign(field.style, {
      left: px(x),
      top: px(y),
      width: px(box.w * scale),
      minHeight: px((caption ? FRAME_CAPTION_H : box.h) * scale),
      height: px((caption ? FRAME_CAPTION_H : box.h) * scale),
      fontSize: px(NOTE_FONT_SIZE * scale),
      lineHeight: px((caption ? FRAME_CAPTION_H : NOTE_LINE_H) * scale),
      padding: caption ? `0 ${px(10 * scale)}` : `${px((NOTE_PAD - 5) * scale)} ${px(NOTE_PAD * scale)}`,
    });
    field.classList.toggle("caption", caption);
  };

  const grow = (): void => {
    if (target?.kind === "frame") return;
    field.style.height = "auto";
    field.style.height = `${Math.max(field.scrollHeight, parseFloat(field.style.minHeight) || 0)}px`;
  };

  const close = (): void => {
    target = undefined;
    field.hidden = true;
    field.value = "";
    app.canvas.canvas.focus();
  };

  const commit = (): void => {
    const t = target;
    if (!t) return;
    const d = app.ws.active;
    const text = t.kind === "frame" ? field.value.replace(/\s*\n\s*/g, " ").trim() : field.value.replace(/\s+$/, "");
    close();
    if (!d || d !== session) return;
    if (t.kind === "new") {
      if (!text) return;
      let id = "";
      app.ws.edit((doc) => {
        id = addNote(doc, t.region, t.box, text);
        const n = doc.diagram!.notes![id]!;
        n.h = Math.ceil(noteHeight(doc, text, n.w, n.h) / 10) * 10;
      });
      if (id) app.ws.select([id]);
      return;
    }
    const dia = d.history.current.diagram;
    if (t.kind === "note") {
      const n = dia?.notes?.[t.id];
      if (!n || n.text === text) return;
      app.ws.edit((doc) => setNoteText(doc, t.id, text, noteHeight(doc, text, n.w, n.h)));
    } else {
      const f = dia?.frames?.[t.id];
      if (!f || (f.caption ?? "") === text) return;
      app.ws.edit((doc) => setFrameCaption(doc, t.id, text));
    }
  };

  const start = (t: Target, text: string, box: Box, todo: boolean): void => {
    commit();
    target = t;
    session = app.ws.active;
    field.value = text;
    field.classList.toggle("todo", todo);
    field.setAttribute("aria-label", t.kind === "frame" ? "Frame caption" : "Note text");
    field.placeholder = t.kind === "frame" ? "Caption" : "Note: {id} shows a name · Ctrl+Enter keeps it";
    place(box, t.kind === "frame");
    field.hidden = false;
    grow();
    field.focus();
    field.select();
  };

  field.addEventListener("input", grow);
  field.addEventListener("blur", commit);
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || target?.kind === "frame")) {
      e.preventDefault();
      commit();
    }
    e.stopPropagation();
  });
  // zooming or panning under the field would leave it behind: keep the text first
  app.canvas.canvas.addEventListener("wheel", commit, { passive: true });
  app.canvas.canvas.addEventListener("pointerdown", commit);

  return {
    open(id) {
      const d = app.ws.active;
      const dia = d?.history.current.diagram;
      const b = d && annotationBox(d.index, id);
      if (!d || !b) return;
      const n = dia?.notes?.[id];
      if (n) start({ kind: "note", id }, n.text, b, n.todo === true);
      else if (dia?.frames?.[id]) start({ kind: "frame", id }, dia.frames[id]!.caption ?? "", b, false);
    },
    openNew(region, box) {
      start({ kind: "new", region, box }, "", box, false);
    },
    commit,
    get active() {
      return target !== undefined;
    },
  };
}
