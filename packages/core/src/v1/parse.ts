// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { UfsmFormatError } from "../errors";
import {
  ID_PATTERN,
  PAPER_SIZES,
  TITLE_BLOCK_FIELDS,
  PSEUDO_KINDS,
  type Action,
  type Decl,
  type Diagram,
  type EdgeEnd,
  type EdgeLayout,
  type FreeEdgeLayout,
  type LabelLayout,
  type SEdgeLayout,
  type GuardTerm,
  type InternalTransition,
  type Paper,
  type TitleBlock,
  type PseudoKind,
  type Region,
  type RegionLayout,
  type Side,
  type StateLayout,
  type Transition,
  type UfsmDocument,
  type Vertex,
} from "./model";

type Obj = Record<string, unknown>;

const SIDES: readonly Side[] = ["left", "right", "top", "bottom"];

function at(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

/** Structural reader: type checks every field and rejects unknown keys. */
class Reader {
  constructor(
    readonly o: Obj,
    readonly path: string,
  ) {}

  static object(v: unknown, path: string, allowed: readonly string[]): Reader {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new UfsmFormatError(path, "expected an object");
    }
    for (const k of Object.keys(v)) {
      if (!allowed.includes(k)) throw new UfsmFormatError(at(path, k), "unknown field");
    }
    return new Reader(v as Obj, path);
  }

  has(key: string): boolean {
    return this.o[key] !== undefined;
  }

  str(key: string): string {
    const v = this.o[key];
    if (typeof v !== "string") throw new UfsmFormatError(at(this.path, key), "expected a string");
    return v;
  }

  optStr(key: string): string | undefined {
    return this.has(key) ? this.str(key) : undefined;
  }

  id(key: string): string {
    const v = this.str(key);
    if (!ID_PATTERN.test(v)) throw new UfsmFormatError(at(this.path, key), `invalid id '${v}'`);
    return v;
  }

  num(key: string): number {
    const v = this.o[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new UfsmFormatError(at(this.path, key), "expected a number");
    }
    return v;
  }

  optNum(key: string): number | undefined {
    return this.has(key) ? this.num(key) : undefined;
  }

  /** `true` or absent; `false` is rejected so there is one way to say "off". */
  flag(key: string): true | undefined {
    const v = this.o[key];
    if (v === undefined) return undefined;
    if (v !== true) throw new UfsmFormatError(at(this.path, key), "expected true (omit the field for false)");
    return true;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T {
    const v = this.str(key);
    if (!values.includes(v as T)) {
      throw new UfsmFormatError(at(this.path, key), `expected one of ${values.join(", ")}; got '${v}'`);
    }
    return v as T;
  }

  arr<T>(key: string, item: (v: unknown, path: string) => T): T[] {
    const v = this.o[key];
    if (!Array.isArray(v)) throw new UfsmFormatError(at(this.path, key), "expected an array");
    return v.map((x, i) => item(x, at(at(this.path, key), i)));
  }

  optArr<T>(key: string, item: (v: unknown, path: string) => T): T[] | undefined {
    return this.has(key) ? this.arr(key, item) : undefined;
  }

  map<T>(key: string, item: (v: unknown, path: string) => T): Record<string, T> {
    const v = this.o[key];
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new UfsmFormatError(at(this.path, key), "expected an object");
    }
    const out: Record<string, T> = {};
    for (const [k, x] of Object.entries(v)) out[k] = item(x, at(at(this.path, key), k));
    return out;
  }

  child(key: string): unknown {
    return this.o[key];
  }
}

/** Assign optional fields only when present, so parsed objects have no `undefined` keys. */
function opt<T extends object, K extends string, V>(o: T, key: K, v: V | undefined): T & { [P in K]?: V } {
  if (v !== undefined) (o as Record<string, unknown>)[key] = v;
  return o as T & { [P in K]?: V };
}

function decl(v: unknown, path: string): Decl {
  const r = Reader.object(v, path, ["id", "name", "doc"]);
  return opt({ id: r.id("id"), name: r.str("name") }, "doc", r.optStr("doc"));
}

function action(v: unknown, path: string): Action {
  const r = Reader.object(v, path, ["call", "emit"]);
  if (r.has("call") === r.has("emit")) throw new UfsmFormatError(path, "expected exactly one of 'call' or 'emit'");
  return r.has("call") ? { call: r.id("call") } : { emit: r.id("emit") };
}

function guardTerm(v: unknown, path: string): GuardTerm {
  const r = Reader.object(v, path, ["call", "in", "not"]);
  if (r.has("call") === r.has("in")) throw new UfsmFormatError(path, "expected exactly one of 'call' or 'in'");
  if (r.has("in")) return opt({ in: r.id("in") }, "not", r.flag("not"));
  return opt({ call: r.id("call") }, "not", r.flag("not"));
}

function vertex(v: unknown, path: string): Vertex {
  const kind = Reader.object(v, path, ["id", "kind", "name", "doc", "entry", "exit", "internal", "regions"]).oneOf<
    "state" | PseudoKind
  >("kind", ["state", ...PSEUDO_KINDS]);
  if (kind === "state") {
    const r = Reader.object(v, path, ["id", "kind", "name", "doc", "entry", "exit", "internal", "regions"]);
    const s = { id: r.id("id"), kind: "state" as const, name: r.str("name") };
    opt(s, "doc", r.optStr("doc"));
    opt(s, "entry", r.optArr("entry", action));
    opt(s, "exit", r.optArr("exit", action));
    opt(s, "internal", r.optArr("internal", internalTransition));
    opt(s, "regions", r.optArr("regions", region));
    return s;
  }
  const r = Reader.object(v, path, ["id", "kind", "name"]);
  return opt({ id: r.id("id"), kind }, "name", r.optStr("name"));
}

function region(v: unknown, path: string): Region {
  const r = Reader.object(v, path, ["id", "name", "states"]);
  const out: Region = { id: r.id("id"), states: [] };
  opt(out, "name", r.optStr("name"));
  out.states = r.arr("states", vertex);
  return out;
}

function internalTransition(v: unknown, path: string): InternalTransition {
  const r = Reader.object(v, path, ["id", "on", "guard", "do", "doc"]);
  const t: InternalTransition = { id: r.id("id"), on: r.id("on") };
  opt(t, "guard", r.optArr("guard", guardTerm));
  opt(t, "do", r.optArr("do", action));
  opt(t, "doc", r.optStr("doc"));
  return t;
}

function transition(v: unknown, path: string): Transition {
  const r = Reader.object(v, path, ["id", "from", "to", "on", "auto", "completion", "guard", "do", "doc"]);
  const t: Transition = { id: r.id("id"), from: r.id("from"), to: r.id("to") };
  opt(t, "on", r.has("on") ? r.id("on") : undefined);
  opt(t, "auto", r.flag("auto"));
  opt(t, "completion", r.flag("completion"));
  if ([t.on, t.auto, t.completion].filter((x) => x !== undefined).length > 1) {
    throw new UfsmFormatError(path, "at most one of 'on', 'auto' and 'completion'");
  }
  opt(t, "guard", r.optArr("guard", guardTerm));
  opt(t, "do", r.optArr("do", action));
  opt(t, "doc", r.optStr("doc"));
  return t;
}

function stateLayout(v: unknown, path: string): StateLayout {
  const r = Reader.object(v, path, ["x", "y", "w", "h", "orientation"]);
  const l: StateLayout = { x: r.num("x"), y: r.num("y"), w: r.num("w"), h: r.num("h") };
  if (r.has("orientation")) l.orientation = r.oneOf("orientation", ["horizontal", "vertical"] as const);
  return l;
}

function regionLayout(v: unknown, path: string): RegionLayout {
  const r = Reader.object(v, path, ["h", "offPage"]);
  const l: RegionLayout = {};
  opt(l, "h", r.optNum("h"));
  opt(l, "offPage", r.flag("offPage"));
  return l;
}

function edgeEnd(v: unknown, path: string): EdgeEnd {
  const r = Reader.object(v, path, ["side", "offset"]);
  return { side: r.oneOf("side", SIDES), offset: r.num("offset") };
}

function point(v: unknown, path: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new UfsmFormatError(path, "expected [x, y]");
  }
  return [v[0] as number, v[1] as number];
}

function edgeLayout(v: unknown, path: string): EdgeLayout {
  const r = Reader.object(v, path, ["route", "from", "to", "via", "jog", "label"]);
  const route = r.has("route") ? r.oneOf<"s" | "free">("route", ["s", "free"]) : "free";
  const label = (): LabelLayout | undefined => {
    if (!r.has("label")) return undefined;
    const l = Reader.object(r.child("label"), at(path, "label"), ["x", "y", "w"]);
    return { x: l.num("x"), y: l.num("y"), w: l.num("w") };
  };
  if (route === "s") {
    if (r.has("via")) throw new UfsmFormatError(at(path, "via"), "bend points belong to free routes; an S route is derived");
    const e: SEdgeLayout = { route: "s" };
    if (r.has("from")) e.from = edgeEnd(r.child("from"), at(path, "from"));
    if (r.has("to")) e.to = edgeEnd(r.child("to"), at(path, "to"));
    if (r.has("jog")) {
      const j = Reader.object(r.child("jog"), at(path, "jog"), ["x", "y"]);
      if (j.has("x") === j.has("y")) throw new UfsmFormatError(at(path, "jog"), "expected exactly one of x or y");
      e.jog = j.has("x") ? { x: j.num("x") } : { y: j.num("y") };
    }
    opt(e, "label", label());
    return e;
  }
  if (r.has("jog")) throw new UfsmFormatError(at(path, "jog"), "a jog belongs to S routes");
  const e: FreeEdgeLayout = { from: edgeEnd(r.child("from"), at(path, "from")), to: edgeEnd(r.child("to"), at(path, "to")) };
  opt(e, "via", r.optArr("via", point));
  opt(e, "label", label());
  return e;
}

function diagram(v: unknown, path: string): Diagram {
  const r = Reader.object(v, path, ["paper", "titleBlock", "states", "regions", "transitions"]);
  const d: Pick<Diagram, "paper" | "titleBlock"> = { paper: r.oneOf<Paper>("paper", Object.keys(PAPER_SIZES) as Paper[]) };
  if (r.has("titleBlock")) {
    const tr = Reader.object(r.child("titleBlock"), at(path, "titleBlock"), [...TITLE_BLOCK_FIELDS]);
    const tb: TitleBlock = {};
    for (const k of TITLE_BLOCK_FIELDS) opt(tb, k, tr.optStr(k));
    d.titleBlock = tb;
  }
  return {
    ...d,
    states: r.map("states", stateLayout),
    regions: r.map("regions", regionLayout),
    transitions: r.map("transitions", edgeLayout),
  };
}

/** True when the text looks like a v1 document (cheap check before parsing). */
export function isV1Text(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as Obj)["format"] === "ufsm";
}

/** Parse and structurally validate a v1 document. Semantic checks live in checkV1(). */
export function parseV1(text: string): UfsmDocument {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UfsmFormatError("", `not valid JSON (${(e as Error).message})`);
  }
  return readV1(data);
}

/** Validate an already-parsed JSON value as a v1 document. */
export function readV1(data: unknown): UfsmDocument {
  const r = Reader.object(data, "", [
    "$schema",
    "format",
    "version",
    "name",
    "doc",
    "declarations",
    "machine",
    "diagram",
    "targets",
  ]);
  if (r.str("format") !== "ufsm") throw new UfsmFormatError("format", "expected 'ufsm'");
  const version = r.num("version");
  if (version !== 1) throw new UfsmFormatError("version", `unsupported version ${version} (this build reads version 1)`);

  const d = Reader.object(r.child("declarations"), "declarations", ["events", "signals", "actions", "guards"]);
  const m = Reader.object(r.child("machine"), "machine", ["root", "transitions"]);

  const doc: UfsmDocument = {
    format: "ufsm",
    version: 1,
    name: r.str("name"),
    declarations: {
      events: d.arr("events", decl),
      signals: d.arr("signals", decl),
      actions: d.arr("actions", decl),
      guards: d.arr("guards", decl),
    },
    machine: {
      root: region(m.child("root"), "machine.root"),
      transitions: m.arr("transitions", transition),
    },
  };
  opt(doc, "doc", r.optStr("doc"));
  if (r.has("diagram")) doc.diagram = diagram(r.child("diagram"), "diagram");
  if (r.has("targets")) {
    doc.targets = r.map("targets", (v, p) => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new UfsmFormatError(p, "expected an object");
      return v as Record<string, unknown>;
    });
  }
  return doc;
}
