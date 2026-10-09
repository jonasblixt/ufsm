// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import {
  V0_STATE_KINDS,
  type V0ActionRef,
  type V0Endpoint,
  type V0GuardRef,
  type V0Model,
  type V0Named,
  type V0Point,
  type V0Rect,
  type V0Region,
  type V0Side,
  type V0State,
  type V0StateKind,
  type V0Transition,
} from "./format";

import { UfsmFormatError } from "../errors";

export { UfsmFormatError };

type Obj = Record<string, unknown>;

const SIDES: readonly V0Side[] = ["left", "right", "top", "bottom"];

function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new UfsmFormatError(path, "expected an object");
  }
  return v as Obj;
}

function arr(o: Obj, key: string, path: string, optional = false): unknown[] {
  const v = o[key];
  if (v === undefined && optional) return [];
  if (!Array.isArray(v)) throw new UfsmFormatError(join(path, key), "expected an array");
  return v;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new UfsmFormatError(join(path, key), "expected a string");
  return v;
}

function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new UfsmFormatError(join(path, key), "expected a number");
  }
  return v;
}

function optStr(o: Obj, key: string, path: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, path);
}

function optNum(o: Obj, key: string, path: string): number | undefined {
  return o[key] === undefined ? undefined : num(o, key, path);
}

function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new UfsmFormatError(join(path, key), "expected a boolean");
  return v;
}

function join(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function named(v: unknown, path: string): V0Named {
  const o = obj(v, path);
  return { id: str(o, "id", path), name: str(o, "name", path) };
}

function actionRef(v: unknown, path: string): V0ActionRef {
  const o = obj(v, path);
  const ref: V0ActionRef = { id: str(o, "id", path), kind: num(o, "kind", path) };
  const actionId = optStr(o, "action-id", path);
  const signalId = optStr(o, "signal-id", path);
  if (actionId !== undefined) ref["action-id"] = actionId;
  if (signalId !== undefined) ref["signal-id"] = signalId;
  return ref;
}

function guardRef(v: unknown, path: string): V0GuardRef {
  const o = obj(v, path);
  const ref: V0GuardRef = { id: str(o, "id", path), kind: num(o, "kind", path) };
  const actionId = optStr(o, "action-id", path);
  const stateId = optStr(o, "state-id", path);
  const value = optNum(o, "value", path);
  if (actionId !== undefined) ref["action-id"] = actionId;
  if (stateId !== undefined) ref["state-id"] = stateId;
  if (value !== undefined) ref.value = value;
  return ref;
}

function endpoint(v: unknown, path: string): V0Endpoint {
  const o = obj(v, path);
  const side = str(o, "side", path);
  if (!SIDES.includes(side as V0Side)) {
    throw new UfsmFormatError(join(path, "side"), `unknown side '${side}'`);
  }
  return { state: str(o, "state", path), side: side as V0Side, offset: num(o, "offset", path) };
}

function rect(v: unknown, path: string): V0Rect {
  const o = obj(v, path);
  return { x: num(o, "x", path), y: num(o, "y", path), w: num(o, "w", path), h: num(o, "h", path) };
}

function point(v: unknown, path: string): V0Point {
  const o = obj(v, path);
  return { x: num(o, "x", path), y: num(o, "y", path) };
}

function transition(v: unknown, path: string): V0Transition {
  const o = obj(v, path);
  const t: V0Transition = {
    id: str(o, "id", path),
    source: endpoint(o["source"], join(path, "source")),
    dest: endpoint(o["dest"], join(path, "dest")),
    "text-block": rect(o["text-block"], join(path, "text-block")),
    vertices: arr(o, "vertices", path).map((x, i) => point(x, join(join(path, "vertices"), i))),
    guards: arr(o, "guards", path).map((x, i) => guardRef(x, join(join(path, "guards"), i))),
    actions: arr(o, "actions", path).map((x, i) => actionRef(x, join(join(path, "actions"), i))),
  };
  const trigger = optStr(o, "trigger", path);
  const triggerKind = optNum(o, "trigger-kind", path);
  if (trigger !== undefined) t.trigger = trigger;
  if (triggerKind !== undefined) t["trigger-kind"] = triggerKind;
  return t;
}

function state(v: unknown, path: string): V0State {
  const o = obj(v, path);
  const kind = str(o, "kind", path);
  if (!V0_STATE_KINDS.includes(kind as V0StateKind)) {
    throw new UfsmFormatError(join(path, "kind"), `unknown state kind '${kind}'`);
  }
  return {
    id: str(o, "id", path),
    name: str(o, "name", path),
    kind: kind as V0StateKind,
    x: num(o, "x", path),
    y: num(o, "y", path),
    width: num(o, "width", path),
    height: num(o, "height", path),
    orientation: optNum(o, "orientation", path) ?? 0,
    entries: arr(o, "entries", path).map((x, i) => actionRef(x, join(join(path, "entries"), i))),
    exits: arr(o, "exits", path).map((x, i) => actionRef(x, join(join(path, "exits"), i))),
    region: arr(o, "region", path).map((x, i) => region(x, join(join(path, "region"), i))),
    transitions: arr(o, "transitions", path).map((x, i) =>
      transition(x, join(join(path, "transitions"), i)),
    ),
  };
}

function region(v: unknown, path: string): V0Region {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    name: str(o, "name", path),
    off_page: bool(o, "off_page", path),
    height: num(o, "height", path),
    states: arr(o, "states", path).map((x, i) => state(x, join(join(path, "states"), i))),
  };
}

/** Parse and structurally validate a v0 `.ufsm` file. */
export function parseV0(text: string): V0Model {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UfsmFormatError("", `not valid JSON (${(e as Error).message})`);
  }
  const o = obj(data, "");
  const kind = str(o, "kind", "");
  if (kind !== "uFSM Model") throw new UfsmFormatError("kind", `expected 'uFSM Model', got '${kind}'`);
  const version = num(o, "version", "");
  if (version !== 0) throw new UfsmFormatError("version", `unsupported version ${version}`);

  return {
    kind: "uFSM Model",
    version: 0,
    name: str(o, "name", ""),
    "paper-size": optNum(o, "paper-size", "") ?? 1,
    triggers: arr(o, "triggers", "").map((x, i) => named(x, join("triggers", i))),
    signals: arr(o, "signals", "", true).map((x, i) => named(x, join("signals", i))),
    actions: arr(o, "actions", "").map((x, i) => named(x, join("actions", i))),
    guards: arr(o, "guards", "").map((x, i) => named(x, join("guards", i))),
    region: region(o["region"], "region"),
  };
}
