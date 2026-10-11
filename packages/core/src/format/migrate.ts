// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Convert a legacy v0 model (GTK editor, uFSM 0.4/0.5) to the v1 format.
 *
 * What changes on the way:
 *  - UUIDs become short ids (ev1, sig1, act1, grd1, r0, s1, t1) in document order.
 *  - Regions are stored top-down (v0 files list them bottom-up, see regionsTopDown()).
 *  - Absolute coordinates become relative to the parent state / sheet.
 *  - Numeric enums become strings; guards become structured terms. A v0 term that compares a
 *    guard's value (`count() > 1`) becomes a call of a new boolean guard (`count_gt_1`), since
 *    v1 guards return a boolean; a guard that was only ever compared is removed.
 *  - Declaration names are made valid and unique (with a warning per change).
 *  - Default pseudo-state names ("Init", "Fork", ...) are dropped.
 */
import {
  V0ActionRefKind,
  V0GuardKind,
  V0Orientation,
  V0TriggerKind,
  type V0ActionRef,
  type V0GuardRef,
  type V0Model,
  type V0Named,
  type V0Region,
  type V0State,
} from "../v0/format";
import { indexV0, regionsTopDown } from "../v0/index-model";
import { indexV1 } from "../model/doc-index";
import { edgeOrigin } from "../v1/geometry";
import { sheetFit } from "../v1/sheet";
import {
  IDENTIFIER,
  PAPER_SIZES,
  type Action,
  type Decl,
  type DeclKind,
  type Diagram,
  type GuardTerm,
  type Id,
  type Paper,
  type PseudoKind,
  type Region,
  type Transition,
  type UfsmDocument,
  type Vertex,
} from "./model";

export interface MigrationNote {
  code: string;
  message: string;
}

export interface MigrationResult {
  doc: UfsmDocument;
  notes: MigrationNote[];
}

const PAPER: Record<number, Paper> = { 1: "A4", 2: "A3", 3: "A2", 4: "A1" };

const DEFAULT_NAMES: Record<string, string> = {
  init: "Init",
  final: "Final",
  "shallow-history": "Shallow history",
  "deep-history": "Deep history",
  fork: "Fork",
  join: "Join",
  terminate: "Terminate",
};

/** v0 compare kinds: the operator (for notes) and the word used in the derived guard's name. */
const COMPARE: Record<number, { op: string; word: string }> = {
  [V0GuardKind.Eq]: { op: "==", word: "eq" },
  [V0GuardKind.Gt]: { op: ">", word: "gt" },
  [V0GuardKind.Gte]: { op: ">=", word: "ge" },
  [V0GuardKind.Lt]: { op: "<", word: "lt" },
  [V0GuardKind.Lte]: { op: "<=", word: "le" },
};

/** A compared value as part of an identifier: `1`, `m1` for -1, `2p5` for 2.5. */
function valueWord(v: number): string {
  return String(v).replace("-", "m").replace(".", "p").replace(/[^A-Za-z0-9_]/g, "_");
}

function sanitize(name: string): string {
  let s = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(s)) s = `_${s}`;
  return s;
}

export function migrateV0(v0: V0Model): MigrationResult {
  const notes: MigrationNote[] = [];
  const note = (code: string, message: string): void => {
    notes.push({ code, message });
  };
  const v0index = indexV0(v0);

  // ---------------------------------------------------------------- declarations
  /** v0 uuid -> v1 id, per declaration kind (v0 ids of different kinds never collide, but be safe). */
  const declId = { event: new Map<string, Id>(), signal: new Map<string, Id>(), action: new Map<string, Id>(), guard: new Map<string, Id>() };
  const usedNames = new Map<string, DeclKind>();

  const declare = (kind: DeclKind, prefix: string, list: V0Named[]): Decl[] => {
    const out: Decl[] = [];
    const byName = new Map<string, Decl>();
    for (const x of list) {
      let valid = x.name;
      if (!IDENTIFIER.test(valid)) {
        valid = sanitize(valid);
        note("renamed", `${kind} '${x.name}' is not a valid identifier; renamed to '${valid}'`);
      }
      const dup = byName.get(valid);
      if (dup) {
        note("merged", `${kind} '${valid}' was declared twice; references now point to one declaration`);
        declId[kind].set(x.id, dup.id);
        continue;
      }
      let name = valid;
      const clash = usedNames.get(name);
      if (clash) {
        name = `${valid}_${kind}`;
        note("renamed", `${kind} '${valid}' has the same name as a ${clash}; renamed to '${name}'`);
      }
      const decl: Decl = { id: `${prefix}${out.length + 1}`, name };
      out.push(decl);
      byName.set(valid, decl);
      usedNames.set(name, kind);
      declId[kind].set(x.id, decl.id);
    }
    return out;
  };

  const declarations = {
    events: declare("event", "ev", v0.triggers),
    signals: declare("signal", "sig", v0.signals),
    actions: declare("action", "act", v0.actions),
    guards: declare("guard", "grd", v0.guards),
  };

  // ---------------------------------------------------------------- structure
  const vertexId = new Map<string, Id>(); // v0 state uuid -> v1 id
  const regionId = new Map<string, Id>();
  let nextState = 1;
  let nextRegion = 0;

  // Assign ids first, in top-down document order, so references can be resolved in any order.
  const assign = (r: V0Region): void => {
    regionId.set(r.id, `r${nextRegion++}`);
    for (const s of r.states) {
      vertexId.set(s.id, `s${nextState++}`);
      regionsTopDown(s).forEach(assign);
    }
  };
  assign(v0.region);

  const action = (ref: V0ActionRef, where: string): Action | undefined => {
    if (ref.kind === V0ActionRefKind.Signal) {
      const id = declId.signal.get(ref["signal-id"] ?? "");
      if (id) return { emit: id };
      note("dropped", `${where}: unknown signal '${ref["signal-id"]}' dropped`);
      return undefined;
    }
    const id = declId.action.get(ref["action-id"] ?? "");
    if (id) return { call: id };
    note("dropped", `${where}: unknown action '${ref["action-id"]}' dropped`);
    return undefined;
  };

  const actions = (refs: V0ActionRef[], where: string): Action[] | undefined => {
    const list = refs.map((r) => action(r, where)).filter((a): a is Action => a !== undefined);
    return list.length ? list : undefined;
  };

  const guard = (g: V0GuardRef, where: string): GuardTerm | undefined => {
    if (g.kind === V0GuardKind.PState || g.kind === V0GuardKind.NState) {
      const id = vertexId.get(g["state-id"] ?? "");
      if (!id) {
        note("dropped", `${where}: guard on unknown state dropped`);
        return undefined;
      }
      return g.kind === V0GuardKind.NState ? { in: id, not: true } : { in: id };
    }
    const id = declId.guard.get(g["action-id"] ?? "");
    if (!id) {
      note("dropped", `${where}: unknown guard function dropped`);
      return undefined;
    }
    if (g.kind === V0GuardKind.True || g.kind === V0GuardKind.False) {
      calledPlain.add(id);
      return g.kind === V0GuardKind.False ? { call: id, not: true } : { call: id };
    }
    const cmp = COMPARE[g.kind];
    if (!cmp) {
      note("dropped", `${where}: unknown guard kind ${g.kind} dropped`);
      return undefined;
    }
    return { call: derivedGuard(id, cmp, g.value ?? 0) };
  };

  // v1 guards return a boolean: each distinct (guard, operator, value) of a v0 compare term becomes a guard of its own.
  const calledPlain = new Set<Id>();
  const compared = new Set<Id>();
  const derived = new Map<string, Id>();
  const derivedGuard = (id: Id, cmp: { op: string; word: string }, value: number): Id => {
    compared.add(id);
    const key = `${id} ${cmp.word} ${value}`;
    const known = derived.get(key);
    if (known) return known;
    const base = declarations.guards.find((d) => d.id === id)!.name;
    const stem = `${base}_${cmp.word}_${valueWord(value)}`;
    let name = stem;
    for (let i = 2; usedNames.has(name); i++) name = `${stem}_${i}`;
    const next = 1 + Math.max(0, ...declarations.guards.map((d) => Number(d.id.slice(3))));
    const decl: Decl = { id: `grd${next}`, name };
    declarations.guards.push(decl);
    usedNames.set(name, "guard");
    derived.set(key, decl.id);
    note("derived", `guard term '${base}() ${cmp.op} ${value}' is now a call of the new boolean guard '${name}'`);
    return decl.id;
  };

  const vertex = (s: V0State): Vertex => {
    const id = vertexId.get(s.id)!;
    if (s.kind === "state") {
      const v: Vertex = { id, kind: "state", name: s.name };
      const entry = actions(s.entries, `state '${s.name}' entry`);
      const exit = actions(s.exits, `state '${s.name}' exit`);
      if (entry) v.entry = entry;
      if (exit) v.exit = exit;
      const regions = regionsTopDown(s).map(region);
      if (regions.length) v.regions = regions;
      return v;
    }
    const kind: PseudoKind = s.kind === "init" ? "initial" : s.kind;
    const v: Vertex = { id, kind };
    if (s.name && s.name !== DEFAULT_NAMES[s.kind]) v.name = s.name;
    return v;
  };

  const region = (r: V0Region): Region => {
    const out: Region = { id: regionId.get(r.id)!, states: r.states.map(vertex) };
    if (r.name) out.name = r.name;
    return out;
  };

  const root = region(v0.region);

  // ---------------------------------------------------------------- transitions
  const transitions: Transition[] = [];
  const v0TransitionOf = new Map<Id, (typeof v0index.transitions)[number]>();
  const visitTransitions = (r: V0Region): void => {
    for (const s of r.states) {
      for (const t of s.transitions) {
        const from = vertexId.get(t.source.state);
        const to = vertexId.get(t.dest.state);
        const srcName = v0index.states.get(t.source.state)?.state.name ?? "?";
        const dstName = v0index.states.get(t.dest.state)?.state.name ?? "?";
        const where = `transition ${srcName} -> ${dstName}`;
        if (!from || !to) {
          note("dropped", `${where}: unknown endpoint, transition dropped`);
          continue;
        }
        const tr: Transition = { id: `t${transitions.length + 1}`, from, to };
        const kind = t["trigger-kind"];
        if (kind === V0TriggerKind.Auto) tr.auto = true;
        else if (kind === V0TriggerKind.Completion) tr.completion = true;
        else if (t.trigger !== undefined) {
          const ev = declId.event.get(t.trigger);
          const sig = declId.signal.get(t.trigger);
          const id = kind === V0TriggerKind.Signal ? (sig ?? ev) : (ev ?? sig);
          if (!id) note("dropped", `${where}: unknown trigger dropped`);
          else {
            tr.on = id;
            if (kind === undefined) {
              const name = (ev ? v0index.triggers : v0index.signals).get(t.trigger)?.name ?? t.trigger;
              note("trigger-kind", `${where}: trigger kind missing in the v0 file; using ${ev ? "event" : "signal"} '${name}'`);
            }
          }
        }
        const g = t.guards.map((x) => guard(x, where)).filter((x): x is GuardTerm => x !== undefined);
        if (g.length) tr.guard = g;
        const a = actions(t.actions, where);
        if (a) tr.do = a;
        transitions.push(tr);
        v0TransitionOf.set(tr.id, t);
      }
      regionsTopDown(s).forEach(visitTransitions);
    }
  };
  visitTransitions(v0.region);
  for (const id of compared) {
    if (calledPlain.has(id)) continue;
    const i = declarations.guards.findIndex((d) => d.id === id);
    note("removed", `guard '${declarations.guards[i]!.name}' was only compared with values; its terms now call the derived guards`);
    declarations.guards.splice(i, 1);
  }

  const doc: UfsmDocument = {
    format: "ufsm",
    version: 1,
    name: v0.name,
    declarations,
    machine: { root, transitions },
  };

  // ---------------------------------------------------------------- diagram
  const diagram: Diagram = { paper: PAPER[v0["paper-size"]] ?? "A4", states: {}, regions: {}, transitions: {} };
  doc.diagram = diagram;

  const layoutRegion = (r: V0Region, owner: V0State | undefined): void => {
    const rid = regionId.get(r.id)!;
    if (owner) diagram.regions[rid] = r.off_page ? { h: r.height, offPage: true } : { h: r.height };
    // Children of a sheet (root / off-page region) keep sheet coordinates; others are relative to the owner.
    const ox = owner && !r.off_page ? owner.x : 0;
    const oy = owner && !r.off_page ? owner.y : 0;
    for (const s of r.states) {
      const l: Diagram["states"][string] = { x: s.x - ox, y: s.y - oy, w: s.width, h: s.height };
      if (s.kind === "fork" || s.kind === "join") {
        if (s.orientation === V0Orientation.Horizontal) l.orientation = "horizontal";
        else if (s.orientation === V0Orientation.Vertical) l.orientation = "vertical";
      }
      diagram.states[vertexId.get(s.id)!] = l;
      for (const child of regionsTopDown(s)) layoutRegion(child, s);
    }
  };
  layoutRegion(v0.region, undefined);

  // Edge coordinates depend on the (now complete) state layout.
  const index = indexV1(doc);
  for (const tr of transitions) {
    const t = v0TransitionOf.get(tr.id)!;
    const o = edgeOrigin(index, tr.id);
    const tb = t["text-block"];
    const e: Diagram["transitions"][string] = {
      from: { side: t.source.side, offset: t.source.offset },
      to: { side: t.dest.side, offset: t.dest.offset },
      label: { x: tb.x - o.x, y: tb.y - o.y, w: tb.w },
    };
    if (t.vertices.length) e.via = t.vertices.map((p) => [p.x - o.x, p.y - o.y] as [number, number]);
    diagram.transitions[tr.id] = e;
  }

  // v0 drew on the bare paper; a v1 sheet has a frame and a title block. Take the smallest paper, no smaller than the
  // v0 one, on which every sheet fits (nothing moves); keep the v0 paper when not even the largest is enough.
  const v0Paper = diagram.paper;
  const papers = Object.keys(PAPER_SIZES) as Paper[];
  const fits = papers.slice(papers.indexOf(v0Paper)).find((p) => {
    diagram.paper = p;
    return sheetFit(indexV1(doc)).length === 0;
  });
  diagram.paper = fits ?? v0Paper;
  if (fits && fits !== v0Paper) note("paper", `paper ${v0Paper} is now ${fits}, so the drawing fits inside the frame and clear of the title block`);

  return { doc, notes };
}
