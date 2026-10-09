// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Id generation for new elements. Ids are unique across the whole document (format-v1.md); new ones are a prefix
 * and the next number after the highest one in use with that prefix (`s12` after `s11`), so deleted ids are not
 * reused while the document still has higher ones and new ids sort after the old ones.
 */
import type { DeclKind, Id, Region, UfsmDocument } from "./model";

/** Prefix of generated ids per element kind. */
export const ID_PREFIX = {
  vertex: "s",
  region: "r",
  transition: "t",
  event: "ev",
  signal: "sig",
  action: "act",
  guard: "grd",
} as const satisfies Record<string, string>;

export const DECL_PREFIX: Readonly<Record<DeclKind, string>> = {
  event: ID_PREFIX.event,
  signal: ID_PREFIX.signal,
  action: ID_PREFIX.action,
  guard: ID_PREFIX.guard,
};

/** Every id in the document: declarations, regions, vertices, transitions and internal transitions. */
export function documentIds(doc: UfsmDocument): Set<Id> {
  const ids = new Set<Id>();
  const d = doc.declarations;
  for (const list of [d.events, d.signals, d.actions, d.guards]) for (const decl of list) ids.add(decl.id);
  const visit = (r: Region): void => {
    ids.add(r.id);
    for (const v of r.states) {
      ids.add(v.id);
      if (v.kind !== "state") continue;
      for (const t of v.internal ?? []) ids.add(t.id);
      v.regions?.forEach(visit);
    }
  };
  visit(doc.machine.root);
  for (const t of doc.machine.transitions) ids.add(t.id);
  return ids;
}

const NUMBERED = /^([A-Za-z_]+)(\d+)$/;

/** Hands out fresh ids for one document. Take a new allocator after the document changed by other means. */
export class IdAllocator {
  private readonly used: Set<Id>;
  private readonly top = new Map<string, number>();

  constructor(doc: UfsmDocument) {
    this.used = documentIds(doc);
    for (const id of this.used) {
      const m = NUMBERED.exec(id);
      if (m) this.top.set(m[1]!, Math.max(this.top.get(m[1]!) ?? 0, Number(m[2])));
    }
  }

  /** A new id `<prefix><n>`, with n one above the highest in use for that prefix. */
  take(prefix: string): Id {
    let n = (this.top.get(prefix) ?? 0) + 1;
    while (this.used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    this.top.set(prefix, n);
    this.used.add(id);
    return id;
  }
}
