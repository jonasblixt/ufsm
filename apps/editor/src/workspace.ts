// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The editor's one store: the open machines (sessions) in tab order, the one shown, the clipboard and the status
 * message. No DOM. Whatever changes it says what changed (`changed`), and the shell decides what to redraw (main.ts):
 *
 *   document   the active machine's document (an edit, undo, redo, preview, save): title, problems, chrome, canvas
 *   selection  what is selected: chrome (status line, tree), panel, canvas
 *   view       pan/zoom or the sheet shown: canvas
 *   sim        the simulator: panel, status bar, canvas
 *   chrome     status line, breadcrumbs, tabs, panel (also a status message)
 *   shell      the panels only (settings, a panel tab), and the canvas (a theme)
 *   active     another machine is shown (or none): everything
 */
import type { LoadedModel, UfsmDocument, Vertex } from "@ufsm/core";
import type { Fragment } from "@ufsm/core/edit";
import { DocSession } from "./session";

export type Change = "document" | "selection" | "view" | "sim" | "chrome" | "shell" | "active";

export class Workspace {
  /** Open machines in tab order. */
  readonly sessions: DocSession[] = [];
  /** The machine shown. */
  active: DocSession | undefined;
  /** Copied fragment and the machine it came from (state references outside it are kept only when pasting there). */
  clipboard: { frag: Fragment; key: number } | undefined;
  /** A message for the status line that stays until the next key or button press. */
  note: string | undefined;
  private nextKey = 1;
  private readonly listeners: ((changes: ReadonlySet<Change>) => void)[] = [];

  /** Call `fn` with every change, synchronously (so code after a change sees the screen updated). */
  onChange(fn: (changes: ReadonlySet<Change>) => void): void {
    this.listeners.push(fn);
  }

  changed(...kinds: Change[]): void {
    const set = new Set(kinds);
    for (const fn of this.listeners) fn(set);
  }

  // ---- machines

  /** Add a machine as the last tab (not shown yet). */
  open(loaded: LoadedModel, fileName: string, path: string | undefined, untitled?: string): DocSession {
    const d = new DocSession(this.nextKey++, loaded, fileName, path, untitled);
    this.sessions.push(d);
    return d;
  }

  /** Remove a machine; shows its neighbour when it was the active one. */
  close(d: DocSession): void {
    const i = this.sessions.indexOf(d);
    if (i < 0) return;
    this.sessions.splice(i, 1);
    if (this.active === d) this.activate(this.sessions[Math.min(i, this.sessions.length - 1)]);
    else this.changed("chrome");
  }

  /** Show another machine (or none). Its view, sheet, selection and undo history come with it. */
  activate(d: DocSession | undefined, force = false): void {
    if (d === this.active && !force) return;
    this.active = d;
    this.changed("active");
  }

  cycle(step: number): void {
    const d = this.active;
    if (!d || this.sessions.length < 2) return;
    const i = this.sessions.indexOf(d);
    this.activate(this.sessions[(i + step + this.sessions.length) % this.sessions.length]);
  }

  byKey(key: number | undefined): DocSession | undefined {
    return this.sessions.find((d) => d.key === key);
  }

  // ---- the active machine

  select(ids: Iterable<string>): void {
    if (!this.active) return;
    this.active.selection = new Set(ids);
    this.changed("selection");
  }

  /** Apply one edit to the active machine as one undo step. */
  edit(recipe: (d: UfsmDocument) => void): void {
    if (this.active?.edit(recipe)) this.changed("document");
  }

  undo(): void {
    if (this.active?.undo()) this.changed("document");
  }

  redo(): void {
    if (this.active?.redo()) this.changed("document");
  }

  /** The selected vertex when exactly one thing is selected and it is a vertex. */
  single(): Vertex | undefined {
    const d = this.active;
    if (!d || d.selection.size !== 1) return undefined;
    return d.index.vertices.get(d.selection.values().next().value!)?.vertex;
  }

  /** The selected transition when exactly one thing is selected and it is a transition. */
  singleTransition(): string | undefined {
    const d = this.active;
    if (!d || d.selection.size !== 1) return undefined;
    const id = d.selection.values().next().value!;
    return d.index.transitions.has(id) ? id : undefined;
  }

  // ---- status line

  /** Show a message in the status line until the next key or button press. */
  say(msg: string): void {
    this.note = msg;
    this.changed("chrome");
  }

  /** A key or button press ends a status message. */
  clearNote(): void {
    if (this.note === undefined) return;
    this.note = undefined;
    this.changed("chrome");
  }
}
