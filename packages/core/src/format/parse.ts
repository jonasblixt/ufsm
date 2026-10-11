// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import Value from "typebox/value";
import { UfsmFormatError } from "./errors";
import type { EdgeLayout, UfsmDocument } from "./model";
import { V1_DEFS, V1_SCHEMA } from "./schema";

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when the text looks like a v1 document (cheap check before parsing). */
export function isV1Text(data: unknown): boolean {
  return isObject(data) && data["format"] === "ufsm";
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

/**
 * Validate an already-parsed JSON value as a v1 document (against `V1_SCHEMA`). The result shares objects with
 * `data`; `$schema` and `"route": "free"` (the default) are left out of it.
 */
export function readV1(data: unknown): UfsmDocument {
  if (isObject(data)) {
    if (data["format"] !== "ufsm") throw new UfsmFormatError("format", "expected 'ufsm'");
    const version = data["version"];
    if (version !== 1) throw new UfsmFormatError("version", `unsupported version ${JSON.stringify(version)} (this build reads version 1)`);
  }
  if (!Value.Check(V1_SCHEMA, data)) throw explain(data);

  const { $schema: _, ...doc } = data;
  const transitions = doc.diagram?.transitions;
  if (transitions && Object.values(transitions).some((e) => e.route === "free")) {
    const plain: Record<string, EdgeLayout> = {};
    for (const [id, e] of Object.entries(transitions)) {
      if (e.route === "free") {
        const { route: _r, ...rest } = e;
        plain[id] = rest;
      } else plain[id] = e;
    }
    doc.diagram = { ...doc.diagram!, transitions: plain };
  }
  return doc;
}

// ---------------------------------------------------------------- one readable error from the schema's errors

interface SchemaError {
  keyword: string;
  schemaPath: string;
  instancePath: string;
  params: Record<string, unknown>;
  message: string;
}

type Node = Obj;

const pointer = (p: string): string[] =>
  p === "" || p === "#" ? [] : p.replace(/^#?\//, "").split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));

function deref(node: Node): Node {
  let n = node;
  for (let i = 0; i < 20 && typeof n["$ref"] === "string"; i++) n = V1_DEFS[n["$ref"]] as Node;
  return n;
}

/** The literal values a union member requires of `key` (`const` or `enum`), or undefined when it has none. */
function literals(member: Node, key: string): unknown[] | undefined {
  const p = (member["properties"] as Obj | undefined)?.[key];
  if (!isObject(p)) return undefined;
  const s = deref(p);
  if ("const" in s) return [s["const"]];
  return Array.isArray(s["enum"]) ? s["enum"] : undefined;
}

/**
 * The union member `value` is meant to be: the only one whose literal fields (`kind`, `route`) fit and whose required
 * fields are present, else the only one whose literal fields fit. Undefined when no member or several fit (an action
 * with both `call` and `emit`, a vertex of an unknown kind).
 */
function chosenMember(members: Node[], value: unknown): number | undefined {
  if (!isObject(value)) return undefined;
  const fits = (m: Node): boolean =>
    Object.keys((m["properties"] as Obj | undefined) ?? {}).every((k) => {
      const lits = literals(m, k);
      if (!lits) return true;
      if (k in value) return lits.includes(value[k]);
      return !((m["required"] as string[] | undefined) ?? []).includes(k);
    });
  const complete = (m: Node): boolean => ((m["required"] as string[] | undefined) ?? []).every((k) => k in value);
  const pick = (ok: (m: Node) => boolean): number | undefined => {
    const hits = members.flatMap((m, i) => (ok(m) ? [i] : []));
    return hits.length === 1 ? hits[0] : undefined;
  };
  return pick((m) => fits(m) && complete(m)) ?? pick(fits);
}

interface Located {
  /** The schema node the error belongs to; undefined when the error came from a union member `value` is not meant to be. */
  node: Node | undefined;
  /** For a union no member fits: the union node and the value. */
  union?: { node: Node; value: unknown };
}

/** Walk an error's schema path alongside its instance path, following `$ref`s and checking every union member taken. */
function locate(root: unknown, err: SchemaError): Located {
  const segs = pointer(err.schemaPath);
  const inst = pointer(err.instancePath);
  let node = deref(V1_SCHEMA as unknown as Node);
  let value = root;
  let i = 0;
  const step = (): void => {
    const key = inst.shift();
    value = isObject(value) || Array.isArray(value) ? (value as Obj)[key ?? ""] : undefined;
  };
  while (i < segs.length) {
    const seg = segs[i++]!;
    if (seg === "properties" || seg === "patternProperties") {
      node = deref((node[seg] as Obj)[segs[i++]!] as Node);
      step();
    } else if (seg === "items" || seg === "additionalProperties") {
      const next = node[seg];
      if (Array.isArray(next)) node = deref(next[Number(segs[i++])] as Node);
      else node = deref(next as Node);
      step();
    } else if (seg === "anyOf") {
      const members = (node["anyOf"] as Node[]).map(deref);
      const k = Number(segs[i++]);
      const chosen = chosenMember(members, value);
      if (chosen !== k) return { node: undefined };
      node = members[k]!;
    } else if (seg === "not") {
      node = deref(node["not"] as Node);
    } else break;
  }
  if (err.keyword === "anyOf") {
    const chosen = chosenMember((node["anyOf"] as Node[]).map(deref), value);
    return chosen === undefined ? { node, union: { node, value } } : { node: undefined };
  }
  return { node };
}

function at(path: string, token: string, parentIsArray: boolean): string {
  if (parentIsArray) return `${path}[${token}]`;
  return path ? `${path}.${token}` : token;
}

/** `/machine/root/states/0/name` as `machine.root.states[0].name`. */
function dotted(root: unknown, instancePath: string, extra?: string): string {
  let path = "";
  let v = root;
  for (const t of [...pointer(instancePath), ...(extra === undefined ? [] : [extra])]) {
    path = at(path, t, Array.isArray(v));
    v = isObject(v) || Array.isArray(v) ? (v as Obj)[t] : undefined;
  }
  return path;
}

function valueAt(root: unknown, instancePath: string): unknown {
  let v = root;
  for (const t of pointer(instancePath)) v = isObject(v) || Array.isArray(v) ? (v as Obj)[t] : undefined;
  return v;
}

const show = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** The node's own message for `keyword` (ajv-errors style), with `${0}` replaced by the value. */
function ownMessage(node: Node | undefined, keyword: string, value: unknown): string | undefined {
  const m = node?.["errorMessage"];
  const text = typeof m === "string" ? m : isObject(m) && typeof m[keyword] === "string" ? m[keyword] : undefined;
  return text?.replace(/\$\{0\}/g, show(value));
}

function unionMessage(root: unknown, err: SchemaError, union: { node: Node; value: unknown }): UfsmFormatError {
  const path = dotted(root, err.instancePath);
  const own = ownMessage(union.node, "anyOf", union.value);
  if (own) return new UfsmFormatError(path, own);
  // A member type no member accepts (`"kind": "stat"`): name the field and the values it may have.
  const members = (union.node["anyOf"] as Node[]).map(deref);
  if (isObject(union.value)) {
    for (const key of Object.keys(union.value)) {
      const all = members.map((m) => literals(m, key));
      if (all.every((l) => l !== undefined)) {
        const allowed = all.flat() as unknown[];
        return new UfsmFormatError(
          at(path, key, false),
          `expected one of ${allowed.map(show).join(", ")}; got '${show(union.value[key])}'`,
        );
      }
    }
  }
  return new UfsmFormatError(path, "does not match any of the allowed shapes");
}

const TYPE_NAMES: Record<string, string> = {
  string: "a string",
  number: "a number",
  integer: "an integer",
  boolean: "true or false",
  array: "an array",
  object: "an object",
};

function message(root: unknown, err: SchemaError, node: Node | undefined): UfsmFormatError {
  const value = valueAt(root, err.instancePath);
  const path = dotted(root, err.instancePath);
  const own = ownMessage(node, err.keyword, value);
  switch (err.keyword) {
    case "required": {
      const missing = (err.params["requiredProperties"] as string[] | undefined)?.find((k) => !(isObject(value) && k in value));
      return new UfsmFormatError(missing ? dotted(root, err.instancePath, missing) : path, own ?? "missing");
    }
    case "additionalProperties": {
      const extra = (err.params["additionalProperties"] as string[] | undefined)?.[0];
      return new UfsmFormatError(extra ? dotted(root, err.instancePath, extra) : path, own ?? "unknown field");
    }
    case "type":
      return new UfsmFormatError(path, own ?? `expected ${TYPE_NAMES[String(err.params["type"])] ?? err.params["type"]}`);
    case "const":
      return new UfsmFormatError(path, own ?? `expected ${JSON.stringify(err.params["allowedValue"])}`);
    case "enum":
      return new UfsmFormatError(
        path,
        own ?? `expected one of ${((err.params["allowedValues"] as unknown[]) ?? []).map(show).join(", ")}; got '${show(value)}'`,
      );
    default:
      return new UfsmFormatError(path, own ?? err.message);
  }
}

/** The first error that belongs to what the document meant to say, as a UfsmFormatError with a JSON path. */
function explain(root: unknown): UfsmFormatError {
  const errors = [...Value.Errors(V1_SCHEMA, root)] as unknown as SchemaError[];
  for (const err of errors) {
    const where = locate(root, err);
    if (where.union) return unionMessage(root, err, where.union);
    if (where.node) return message(root, err, where.node);
  }
  const first = errors[0];
  return new UfsmFormatError(first ? dotted(root, first.instancePath) : "", first?.message ?? "not a valid v1 document");
}
