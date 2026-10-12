// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Canonical writer for v1 documents. The same document always produces the
 * same bytes: fixed key order, ids in document order, numbers without
 * trailing ".0", 2-space indent, and short arrays/objects kept on one line.
 * This keeps git diffs small and merge conflicts local.
 */
import {
  TITLE_BLOCK_FIELDS,
  type Action,
  type ArrowEnd,
  type ArrowLayout,
  type Decl,
  type Diagram,
  type EdgeEnd,
  type EdgeLayout,
  type FrameLayout,
  type GuardTerm,
  type InternalTransition,
  type ModelOptions,
  type NoteLayout,
  type Region,
  type RegionLayout,
  type StateLayout,
  type TitleBlock,
  type Timer,
  type Transition,
  type UfsmDocument,
  type Vertex,
} from "./model";
import { OPTION_KEYS } from "./options";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const LINE_WIDTH = 100;

/** Build an object with keys in the given order, skipping undefined and empty optional arrays. */
function ordered(entries: [string, Json | undefined][]): { [k: string]: Json } {
  const o: { [k: string]: Json } = {};
  for (const [k, v] of entries) {
    if (v === undefined) continue;
    o[k] = v;
  }
  return o;
}

function nonEmpty<T>(a: T[] | undefined, f: (x: T) => Json): Json[] | undefined {
  return a && a.length > 0 ? a.map(f) : undefined;
}

function num(n: number): number {
  return Math.round(n * 1000) / 1000 + 0; // + 0 turns -0 into 0
}

const declJ = (d: Decl): Json =>
  ordered([
    ["id", d.id],
    ["name", d.name],
    ["doc", d.doc],
  ]);

const actionJ = (a: Action): Json => ("call" in a ? { call: a.call } : { emit: a.emit });

function guardJ(g: GuardTerm): Json {
  if ("in" in g)
    return ordered([
      ["in", g.in],
      ["not", g.not],
    ]);
  return ordered([
    ["call", g.call],
    ["not", g.not],
  ]);
}

function vertexJ(v: Vertex): Json {
  if (v.kind === "state") {
    return ordered([
      ["id", v.id],
      ["kind", v.kind],
      ["name", v.name],
      ["doc", v.doc],
      ["entry", nonEmpty(v.entry, actionJ)],
      ["exit", nonEmpty(v.exit, actionJ)],
      ["timers", nonEmpty(v.timers, timerJ)],
      ["internal", nonEmpty(v.internal, internalJ)],
      ["regions", nonEmpty(v.regions, regionJ)],
    ]);
  }
  return ordered([
    ["id", v.id],
    ["kind", v.kind],
    ["name", v.name],
  ]);
}

function regionJ(r: Region): Json {
  return ordered([
    ["id", r.id],
    ["name", r.name],
    ["states", r.states.map(vertexJ)],
  ]);
}

function timerJ(t: Timer): Json {
  return ordered([
    ["id", t.id],
    ["name", t.name],
    ["after", t.after],
    ["every", t.every],
    ["unit", t.unit],
    ["event", t.event],
    ["doc", t.doc],
  ]);
}

function internalJ(t: InternalTransition): Json {
  return ordered([
    ["id", t.id],
    ["on", t.on],
    ["guard", nonEmpty(t.guard, guardJ)],
    ["do", nonEmpty(t.do, actionJ)],
    ["doc", t.doc],
  ]);
}

function transitionJ(t: Transition): Json {
  return ordered([
    ["id", t.id],
    ["from", t.from],
    ["to", t.to],
    ["on", t.on],
    ["auto", t.auto],
    ["completion", t.completion],
    ["guard", nonEmpty(t.guard, guardJ)],
    ["do", nonEmpty(t.do, actionJ)],
    ["doc", t.doc],
  ]);
}

const stateLayoutJ = (l: StateLayout): Json =>
  ordered([
    ["x", num(l.x)],
    ["y", num(l.y)],
    ["w", num(l.w)],
    ["h", num(l.h)],
    ["orientation", l.orientation],
    ["actionsHeight", l.actionsHeight === undefined ? undefined : num(l.actionsHeight)],
  ]);

const regionLayoutJ = (l: RegionLayout): Json =>
  ordered([
    ["h", l.h === undefined ? undefined : num(l.h)],
    ["offPage", l.offPage],
  ]);

const edgeEndJ = (end: EdgeEnd | undefined): Json | undefined =>
  end ? { side: end.side, offset: num(end.offset) } : undefined;

// `route` is written only for S routes: absent means "free".
const edgeLayoutJ = (e: EdgeLayout): Json =>
  ordered([
    ["route", e.route === "s" ? "s" : undefined],
    ["from", edgeEndJ(e.from)],
    ["to", edgeEndJ(e.to)],
    ["via", e.route === "s" ? undefined : nonEmpty(e.via, ([x, y]) => [num(x), num(y)])],
    ["jog", e.route === "s" && e.jog ? ("x" in e.jog ? { x: num(e.jog.x) } : { y: num(e.jog.y) }) : undefined],
    ["label", e.label ? { x: num(e.label.x), y: num(e.label.y), w: num(e.label.w) } : undefined],
  ]);

const frameJ = (f: FrameLayout): Json =>
  ordered([
    ["region", f.region],
    ["x", num(f.x)],
    ["y", num(f.y)],
    ["w", num(f.w)],
    ["h", num(f.h)],
    ["caption", f.caption || undefined],
  ]);

const noteJ = (n: NoteLayout): Json =>
  ordered([
    ["region", n.region],
    ["x", num(n.x)],
    ["y", num(n.y)],
    ["w", num(n.w)],
    ["h", num(n.h)],
    ["text", n.text],
    ["todo", n.todo],
  ]);

const arrowEndJ = (e: ArrowEnd): Json =>
  "at" in e
    ? { ref: e.ref, at: Math.round(e.at * 10000) / 10000 + 0 }
    : ordered([
        ["ref", "ref" in e ? e.ref : undefined],
        ["x", num(e.x)],
        ["y", num(e.y)],
      ]);

const arrowJ = (a: ArrowLayout): Json =>
  ordered([
    ["region", a.region],
    ["from", arrowEndJ(a.from)],
    ["to", arrowEndJ(a.to)],
    ["head", a.head === "end" ? undefined : a.head],
    ["dashed", a.dashed],
  ]);

/** Ids with a number at the end in numeric order (`n2` before `n10`), then by text. */
function naturalOrder(ids: string[]): string[] {
  const key = (id: string): [string, number] => {
    const m = /^(.*?)(\d+)$/.exec(id);
    return m ? [m[1]!, Number(m[2])] : [id, -1];
  };
  return [...ids].sort((a, b) => {
    const [pa, na] = key(a),
      [pb, nb] = key(b);
    return pa < pb ? -1 : pa > pb ? 1 : na - nb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/** A documentation map in natural id order; undefined when empty. */
function annotationMap<T>(m: Record<string, T> | undefined, f: (x: T) => Json): Json | undefined {
  if (!m || Object.keys(m).length === 0) return undefined;
  return orderedMap(m, naturalOrder(Object.keys(m)), f);
}

/** Ids of all regions and vertices in document order (depth first, top-down). */
function documentOrder(root: Region): { regions: string[]; states: string[] } {
  const regions: string[] = [];
  const states: string[] = [];
  const visit = (r: Region): void => {
    regions.push(r.id);
    for (const v of r.states) {
      states.push(v.id);
      if (v.kind === "state") v.regions?.forEach(visit);
    }
  };
  visit(root);
  return { regions, states };
}

/** A map re-keyed in the given order; keys not in `order` follow, sorted. */
function orderedMap<T>(m: Record<string, T>, order: string[], f: (x: T) => Json): { [k: string]: Json } {
  const out: { [k: string]: Json } = {};
  const known = new Set(order);
  for (const k of order) if (m[k] !== undefined) out[k] = f(m[k]);
  for (const k of Object.keys(m).sort()) if (!known.has(k)) out[k] = f(m[k]!);
  return out;
}

function titleBlockJ(tb: TitleBlock | undefined): Json | undefined {
  if (!tb) return undefined;
  const o = ordered(TITLE_BLOCK_FIELDS.map((k) => [k, tb[k] || undefined]));
  return Object.keys(o).length ? o : undefined;
}

function optionsJ(o: ModelOptions): Json | undefined {
  const j = ordered(OPTION_KEYS.map((k) => [k, o[k]]));
  return Object.keys(j).length ? j : undefined;
}

function diagramJ(d: Diagram, doc: UfsmDocument): Json {
  const order = documentOrder(doc.machine.root);
  return ordered([
    ["paper", d.paper],
    ["titleBlock", titleBlockJ(d.titleBlock)],
    ["states", orderedMap(d.states, order.states, stateLayoutJ)],
    ["regions", orderedMap(d.regions, order.regions, regionLayoutJ)],
    [
      "transitions",
      orderedMap(
        d.transitions,
        doc.machine.transitions.map((t) => t.id),
        edgeLayoutJ,
      ),
    ],
    ["frames", annotationMap(d.frames, frameJ)],
    ["notes", annotationMap(d.notes, noteJ)],
    ["arrows", annotationMap(d.arrows, arrowJ)],
  ]);
}

function sortKeysDeep(v: unknown): Json {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (typeof v === "object" && v !== null) {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    return out;
  }
  return v as Json;
}

/** The document as a plain JSON value in canonical key order. */
export function toCanonicalJson(doc: UfsmDocument): Json {
  const d = doc.declarations;
  return ordered([
    ["format", "ufsm"],
    ["version", 1],
    ["name", doc.name],
    ["doc", doc.doc],
    [
      "declarations",
      {
        events: d.events.map(declJ),
        signals: d.signals.map(declJ),
        actions: d.actions.map(declJ),
        guards: d.guards.map(declJ),
      },
    ],
    ["machine", { root: regionJ(doc.machine.root), transitions: doc.machine.transitions.map(transitionJ) }],
    ["diagram", doc.diagram ? diagramJ(doc.diagram, doc) : undefined],
    ["options", doc.options && optionsJ(doc.options)],
    ["target", doc.target],
    ["targets", doc.targets ? sortKeysDeep(doc.targets) : undefined],
  ]);
}

function inline(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (typeof v === "object" && v !== null) {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return parts.length ? `{ ${parts.join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}

/** `prefixLen`: text before the value on its line (a key); `suffixLen`: text after it (the comma before the next item). */
function pretty(v: Json, indent: number, prefixLen: number, suffixLen = 0): string {
  const one = inline(v);
  const isContainer = typeof v === "object" && v !== null;
  if (!isContainer || indent + prefixLen + one.length + suffixLen <= LINE_WIDTH) return one;

  const pad = " ".repeat(indent + 2);
  const end = " ".repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x, i) => pad + pretty(x, indent + 2, 0, i < v.length - 1 ? 1 : 0)).join(",\n")}\n${end}]`;
  }
  const entries = Object.entries(v);
  if (entries.length === 0) return "{}";
  const lines = entries.map(([k, x], i) => {
    const key = `${JSON.stringify(k)}: `;
    return pad + key + pretty(x, indent + 2, key.length, i < entries.length - 1 ? 1 : 0);
  });
  return `{\n${lines.join(",\n")}\n${end}}`;
}

/** Any JSON value in the same layout as model files (2-space indent, short arrays and objects on one line). */
export function formatJson(value: unknown): string {
  return pretty(value as Json, 0, 0) + "\n";
}

/** Serialize a document to its canonical text form (UTF-8, LF, trailing newline). */
export function serializeV1(doc: UfsmDocument): string {
  return pretty(toCanonicalJson(doc), 0, 0) + "\n";
}
