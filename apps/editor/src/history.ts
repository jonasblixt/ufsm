// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Undo/redo for the editor's document. The document is immutable: every edit is an Immer recipe, and the patches
 * Immer records (with their inverse) are the undo step. Interactive edits (a drag) re-run their recipe on the
 * document as it was when the drag began, so the preview never accumulates rounding, and only the end result is
 * recorded, as one step.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";

enablePatches();

interface Step {
  /** Unique per step, so a saved version can be recognised after undo and redo. */
  id: number;
  patches: Patch[];
  inverse: Patch[];
}

/** Undo steps kept; older ones are dropped. */
const LIMIT = 500;

export class History<T extends object> {
  private undos: Step[] = [];
  private redos: Step[] = [];
  private serial = 0;
  /** Document at the start of the interactive edit in progress. */
  private base: T | undefined;
  private pending: Omit<Step, "id"> | undefined;

  constructor(private doc: T) {}

  /** The document, including the preview of an interactive edit in progress. */
  get current(): T {
    return this.doc;
  }

  /** Identifies the document's content: equal versions mean equal documents (0 = as loaded). */
  get version(): number {
    return this.undos[this.undos.length - 1]?.id ?? 0;
  }

  get canUndo(): boolean {
    return this.undos.length > 0 && !this.editing;
  }

  get canRedo(): boolean {
    return this.redos.length > 0 && !this.editing;
  }

  /** True between begin() and commit()/cancel(). */
  get editing(): boolean {
    return this.base !== undefined;
  }

  /** Apply one edit as one undo step. Returns false (and records nothing) when it changed nothing. */
  edit(recipe: (draft: Draft<T>) => void): boolean {
    this.begin();
    this.preview(recipe);
    return this.commit();
  }

  /** Start an interactive edit. */
  begin(): void {
    if (this.editing) this.cancel();
    this.base = this.doc;
    this.pending = undefined;
  }

  /** Show the interactive edit's current state: `recipe` runs on the document as it was at begin(). */
  preview(recipe: (draft: Draft<T>) => void): void {
    if (!this.base) throw new Error("preview() outside begin()/commit()");
    const [next, patches, inverse] = produceWithPatches(this.base, recipe);
    this.doc = next as T;
    this.pending = patches.length > 0 ? { patches, inverse } : undefined;
  }

  /** Record the interactive edit as one step. Returns false when it changed nothing. */
  commit(): boolean {
    const p = this.pending;
    if (!p) this.doc = this.base ?? this.doc;
    this.base = undefined;
    this.pending = undefined;
    if (!p) return false;
    this.undos.push({ id: ++this.serial, ...p });
    if (this.undos.length > LIMIT) this.undos.shift();
    this.redos = [];
    return true;
  }

  /** Abandon the interactive edit: back to the document at begin(). */
  cancel(): void {
    if (this.base) this.doc = this.base;
    this.base = undefined;
    this.pending = undefined;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const step = this.undos.pop()!;
    this.doc = applyPatches(this.doc, step.inverse);
    this.redos.push(step);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const step = this.redos.pop()!;
    this.doc = applyPatches(this.doc, step.patches);
    this.undos.push(step);
    return true;
  }
}
