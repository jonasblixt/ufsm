// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** What the panel parts share: the tabs, what a key asks to focus, the operations on the document. */
import type { DeclKind, Diagnostic, DocIndex, Id, UfsmDocument } from "@ufsm/core";

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

/** Give the keyboard back to the canvas (the editor's keys are ignored while a text field has focus). */
export const release = (): void => (document.activeElement as HTMLElement | null)?.blur();
