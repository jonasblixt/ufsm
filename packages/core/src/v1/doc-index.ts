// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import type { Decl, DeclKind, Id, InternalTransition, Region, State, Transition, UfsmDocument, Vertex } from "./model";

export interface VertexInfo {
  vertex: Vertex;
  /** Region the vertex lives in. */
  region: Region;
}

export interface RegionInfo {
  region: Region;
  /** State owning the region; undefined for the root region. */
  owner: State | undefined;
}

export interface DeclInfo {
  kind: DeclKind;
  decl: Decl;
}

/** Lookup tables over a v1 document. Rebuild after structural edits. */
export interface DocIndex {
  doc: UfsmDocument;
  vertices: Map<Id, VertexInfo>;
  regions: Map<Id, RegionInfo>;
  transitions: Map<Id, Transition>;
  /** Internal transitions by id, with the state they belong to. */
  internals: Map<Id, { transition: InternalTransition; state: State }>;
  /** Transitions by source vertex id, in document order. */
  outgoing: Map<Id, Transition[]>;
  decls: Map<Id, DeclInfo>;
}

export function indexV1(doc: UfsmDocument): DocIndex {
  const index: DocIndex = {
    doc,
    vertices: new Map(),
    regions: new Map(),
    transitions: new Map(),
    internals: new Map(),
    outgoing: new Map(),
    decls: new Map(),
  };

  const d = doc.declarations;
  for (const [kind, list] of [
    ["event", d.events],
    ["signal", d.signals],
    ["action", d.actions],
    ["guard", d.guards],
  ] as const) {
    for (const decl of list) index.decls.set(decl.id, { kind, decl });
  }

  const visit = (region: Region, owner: State | undefined): void => {
    index.regions.set(region.id, { region, owner });
    for (const v of region.states) {
      index.vertices.set(v.id, { vertex: v, region });
      if (v.kind === "state") {
        for (const t of v.internal ?? []) index.internals.set(t.id, { transition: t, state: v });
        v.regions?.forEach((r) => visit(r, v));
      }
    }
  };
  visit(doc.machine.root, undefined);

  for (const t of doc.machine.transitions) {
    index.transitions.set(t.id, t);
    const list = index.outgoing.get(t.from);
    if (list) list.push(t);
    else index.outgoing.set(t.from, [t]);
  }
  return index;
}

/** Name of a declaration, or `?id` when it does not resolve. */
export function declName(index: DocIndex, id: Id): string {
  return index.decls.get(id)?.decl.name ?? `?${id}`;
}

export function vertexName(index: DocIndex, id: Id): string {
  const v = index.vertices.get(id)?.vertex;
  if (!v) return `?${id}`;
  return v.name ?? v.kind;
}

/** Regions from the root down to (and including) the region holding `vertexId`. */
export function regionChain(index: DocIndex, vertexId: Id): Region[] {
  const chain: Region[] = [];
  let region = index.vertices.get(vertexId)?.region;
  while (region) {
    chain.unshift(region);
    const owner = index.regions.get(region.id)?.owner;
    region = owner ? index.vertices.get(owner.id)?.region : undefined;
  }
  return chain;
}

/** Innermost region containing both vertices (the root region at worst). */
export function commonRegion(index: DocIndex, a: Id, b: Id): Region {
  const ca = regionChain(index, a);
  const cb = regionChain(index, b);
  let common = index.doc.machine.root;
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    if (ca[i] !== cb[i]) break;
    common = ca[i]!;
  }
  return common;
}

/** Ancestor states of a vertex, outermost first. */
export function ancestors(index: DocIndex, vertexId: Id): State[] {
  return regionChain(index, vertexId)
    .map((r) => index.regions.get(r.id)?.owner)
    .filter((s): s is State => s !== undefined);
}
