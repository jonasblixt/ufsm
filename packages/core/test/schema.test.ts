// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { formatJson, parseV1, v1JsonSchema, UfsmFormatError } from "../src";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaFile = join(repoRoot, "packages/core/schema/ufsm-v1.schema.json");
const model = (name: string): string => readFileSync(join(repoRoot, "tests/models", name), "utf8");

type J = any;

/** Broken variants of test_guard1.ufsm (or canvas.ufsm for depth) and the error the reader reports for each. */
const BROKEN: [string, string, (d: J) => void, string][] = [
  ["a wrong type deep in the state tree", "canvas.ufsm", (d) => (deepState(d).name = 3), "expected a string"],
  [
    "an unknown kind deep in the state tree",
    "canvas.ufsm",
    (d) => (deepState(d).kind = "stat"),
    "kind: expected one of state, initial, final",
  ],
  ["an unknown field deep in the state tree", "canvas.ufsm", (d) => (deepState(d).colour = 1), "colour: unknown field"],
  ["entry actions on a pseudo-state", "test_guard1.ufsm", (d) => (pseudo(d).entry = []), "entry: unknown field"],
  [
    "an action with call and emit",
    "test_guard1.ufsm",
    (d) => (state(d).entry = [{ call: "a", emit: "b" }]),
    "entry[0]: expected exactly one of 'call' or 'emit'",
  ],
  ["an invalid id", "test_guard1.ufsm", (d) => (state(d).entry = [{ call: "9a" }]), "entry[0].call: invalid id '9a'"],
  [
    "an empty guard term",
    "test_guard1.ufsm",
    (d) => (d.machine.transitions[0].guard = [{}]),
    "guard[0]: expected exactly one of 'call' or 'in'",
  ],
  ["a missing name", "test_guard1.ufsm", (d) => delete d.name, "name: missing"],
  ["another version", "test_guard1.ufsm", (d) => (d.version = 2), "unsupported version 2"],
  ["a free route without its end", "test_guard1.ufsm", (d) => (free(d).to = undefined), "to: missing"],
  ["a bend point with one coordinate", "test_guard1.ufsm", (d) => (free(d).via = [[1]]), "via[0]: expected [x, y]"],
  [
    "an unknown paper size",
    "test_guard1.ufsm",
    (d) => (d.diagram.paper = "A5"),
    "paper: expected one of A4, A3, A2, A1; got 'A5'",
  ],
  [
    "an unknown route",
    "test_guard1.ufsm",
    (d) => (free(d).route = "curvy"),
    "route: expected one of free, s; got 'curvy'",
  ],
  [
    "target options that are not an object",
    "test_guard1.ufsm",
    (d) => (d.targets = { c: 3 }),
    "targets.c: expected an object",
  ],
  [
    "a negative option",
    "test_guard1.ufsm",
    (d) => (d.options = { signalQueue: -1 }),
    "options.signalQueue: must be >= 0",
  ],
  [
    "an option that is not a whole number",
    "test_guard1.ufsm",
    (d) => (d.options = { maxMicrosteps: 1.5 }),
    "options.maxMicrosteps: expected an integer",
  ],
  ["an unknown option", "test_guard1.ufsm", (d) => (d.options = { prefix: "x_" }), "options.prefix: unknown field"],
  [
    "a flag set to false",
    "test_guard1.ufsm",
    (d) => (d.diagram.regions["r0"] = { offPage: false }),
    "offPage: expected true (omit the field for false)",
  ],
];

function vertices(region: J): J[] {
  return region.states.flatMap((v: J) => [v, ...(v.regions ?? []).flatMap(vertices)]);
}
const deepState = (d: J): J =>
  vertices(d.machine.root).find((v) => v.kind === "state" && !d.machine.root.states.includes(v));
const state = (d: J): J => d.machine.root.states.find((v: J) => v.kind === "state");
const pseudo = (d: J): J => d.machine.root.states.find((v: J) => v.kind !== "state");
function free(d: J): J {
  const e = Object.values(d.diagram.transitions)[0] as J;
  delete e.route;
  delete e.jog;
  e.from ??= { side: "left", offset: 10 };
  e.to ??= { side: "right", offset: 10 };
  return e;
}

describe("v1 JSON Schema", () => {
  it("matches the committed schema file (regenerate with `npm run gen:schema`)", () => {
    assert.equal(readFileSync(schemaFile, "utf8").replace(/\r\n/g, "\n"), formatJson(v1JsonSchema()));
  });

  it("explains a broken file with the path and what was expected", () => {
    for (const [what, file, breakIt, expected] of BROKEN) {
      const doc = JSON.parse(model(file));
      breakIt(doc);
      assert.throws(
        () => parseV1(JSON.stringify(doc)),
        (e: unknown) => e instanceof UfsmFormatError && e.message.includes(expected),
        `${what}: expected a message containing "${expected}"`,
      );
    }
  });

  it("accepts and rejects the same documents as a JSON Schema validator reading the published file", () => {
    const validate = new Ajv({ allErrors: true, strict: false } as ConstructorParameters<typeof Ajv>[0]).compile(
      JSON.parse(readFileSync(schemaFile, "utf8")),
    );
    for (const file of ["test_guard1.ufsm", "canvas.ufsm"]) assert.ok(validate(JSON.parse(model(file))), file);
    for (const [what, file, breakIt] of BROKEN) {
      const doc = JSON.parse(model(file));
      breakIt(doc);
      assert.equal(validate(JSON.parse(JSON.stringify(doc))), false, what);
    }
  });
});
