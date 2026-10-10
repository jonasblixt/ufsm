// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * State numbering, state names, the fingerprint and where the trace hooks fire (docs/semantics.md, "Trace hooks").
 * The hook order here is derived from the rule by hand: each hook comes just before the actions it introduces, a
 * transition after every exit of its microstep, and initial transitions, reset and terminate report no transition and
 * no exit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODE_TARGETS,
  CodegenError,
  Interpreter,
  IrRunner,
  fingerprint,
  flatten,
  fnv1a32,
  generateFiles,
  loadModel,
  lowerToIr,
  stateIdentifier,
  stateNames,
  type IrModule,
  type TraceKind,
  type UfsmDocument,
} from "../src/index";
import { decodeHooks, interpreterHooks } from "./harness";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * P{A} -e/act,^s-> Q{B}; B -s-> B; Q has an internal transition on tick; B -stop-> a terminate inside Q's region.
 * Every state has entry and exit actions named e<State>/x<State>.
 */
function hookModel(): UfsmDocument {
  const ex = (n: string) => ({ entry: [{ call: `ae${n}` }], exit: [{ call: `ax${n}` }] });
  return {
    format: "ufsm",
    version: 1,
    name: "hooks",
    declarations: {
      events: [{ id: "ev1", name: "e" }, { id: "ev2", name: "tick" }, { id: "ev3", name: "stop" }],
      signals: [{ id: "sig1", name: "s" }],
      actions: [
        ...["P", "A", "Q", "B"].flatMap((n) => [{ id: `ae${n}`, name: `e${n}` }, { id: `ax${n}`, name: `x${n}` }]),
        { id: "a1", name: "act" },
        { id: "a2", name: "ia" },
      ],
      guards: [],
    },
    machine: {
      root: {
        id: "r0",
        states: [
          { id: "i0", kind: "initial" },
          { id: "P", kind: "state", name: "P", ...ex("P"), regions: [{ id: "r1", states: [{ id: "i1", kind: "initial" }, { id: "A", kind: "state", name: "A", ...ex("A") }] }] },
          {
            id: "Q",
            kind: "state",
            name: "Q",
            ...ex("Q"),
            internal: [{ id: "it1", on: "ev2", do: [{ call: "a2" }] }],
            regions: [{ id: "r2", states: [{ id: "i2", kind: "initial" }, { id: "B", kind: "state", name: "B", ...ex("B") }, { id: "T", kind: "terminate" }] }],
          },
        ],
      },
      transitions: [
        { id: "t0", from: "i0", to: "P" },
        { id: "t1", from: "i1", to: "A" },
        { id: "t2", from: "i2", to: "B" },
        { id: "t3", from: "P", to: "Q", on: "ev1", do: [{ call: "a1" }, { emit: "sig1" }] },
        { id: "t4", from: "B", to: "B", on: "sig1" },
        { id: "t5", from: "B", to: "T", on: "ev3" },
      ],
    },
  };
}

const EXPECTED = [
  "reset: @enter:P eP @enter:A eA",
  "e: @event:e @exit:A xA @exit:P xP @t:t3 act @enter:Q eQ @enter:B eB @signal:s @exit:B xB @t:t4 @enter:B eB",
  "tick: @event:tick @t:it1 ia",
  // terminate inside Q: B is exited by the transition; Q is cleared without an exit
  "stop: @event:stop @exit:B xB @t:t5",
  // terminated: process() returns before reporting the event
  "e: ",
];
const SCRIPT = [undefined, "e", "tick", "stop", "e"];

function run(make: (log: (s: string) => void) => { reset(): void; process(e: string): unknown }): string[] {
  let calls: string[] = [];
  const m = make((s) => void calls.push(s));
  return SCRIPT.map((e) => {
    calls = [];
    if (e === undefined) m.reset();
    else m.process(e);
    return `${e ?? "reset"}: ${calls.join(" ")}`;
  });
}

/** The IR runner's hook calls as the pseudo-calls of harness.ts. */
function irHook(ir: IrModule, log: (s: string) => void): (kind: TraceKind, index: number) => void {
  return (kind, index) => {
    const raw = kind === "event" ? `@event:${ir.events[index]!.name}` : kind === "signal" ? `@signal:${ir.signals[index]!.name}` : `@${kind === "transition" ? "t" : kind}:${index}`;
    log(decodeHooks([raw], ir)[0]!);
  };
}

describe("trace hooks", () => {
  it("fire in the interpreter where docs/semantics.md says", () => {
    const actual = run((log) => {
      const host = { call: (n: string) => log(n) };
      return new Interpreter(hookModel(), host, { onTrace: interpreterHooks(host) });
    });
    assert.deepEqual(actual, EXPECTED);
  });

  it("fire in the IR (what every backend prints) at the same places", () => {
    const ir = lowerToIr(flatten(hookModel()), { trace: true });
    const actual = run((log) => new IrRunner(ir, { call: (n) => log(n) }, {}, irHook(ir, log)));
    assert.deepEqual(actual, EXPECTED);
  });

  it("are not emitted without the trace option", () => {
    const ir = lowerToIr(flatten(hookModel()));
    assert.equal(ir.trace, false);
    assert.ok(!JSON.stringify(ir.functions).includes('"op":"trace"'));
    let hooks = 0;
    const m = new IrRunner(ir, {}, {}, () => void hooks++);
    m.reset();
    m.process("e");
    assert.equal(hooks, 0);
  });

  it("follow the target's resolved trace option in generateFiles (options, then targets.<name>, then overrides)", () => {
    const doc = hookModel();
    const hasHook = (target: "c" | "ts", overrides = {}): boolean =>
      generateFiles(doc, target, overrides).files.some((f) => /hooks_trace\(|\.trace\(/.test(f.text));
    assert.equal(hasHook("c"), false);
    doc.options = { trace: true };
    assert.equal(hasHook("c"), true);
    doc.targets = { c: { trace: false } };
    assert.equal(hasHook("c"), false);
    assert.equal(hasHook("ts"), true);
    assert.equal(hasHook("c", { trace: true }), true);
  });
});

describe("generated names", () => {
  it("refuse an action named like the trace hook, but only with trace on", () => {
    const doc = hookModel();
    doc.declarations.actions[0]!.name = "trace";
    for (const target of CODE_TARGETS) {
      assert.doesNotThrow(() => generateFiles(doc, target, { prefix: target === "c" ? "" : undefined }), target);
      assert.throws(() => generateFiles(doc, target, { trace: true, ...(target === "c" ? { prefix: "" } : {}) }), CodegenError, target);
    }
  });

  it("refuse a C state constant that clashes with an event", () => {
    const doc = hookModel();
    doc.declarations.events[0]!.name = "STATE_P";
    assert.throws(() => generateFiles(doc, "c", { prefix: "m_" }), /state 'P' becomes 'M_STATE_P'/);
  });
});

describe("state numbering", () => {
  it("is document order over normal and final states; transitions follow machine.transitions, then internal ones", () => {
    const ir = lowerToIr(flatten(hookModel()));
    assert.deepEqual(ir.states.map((s) => s.id), ["P", "A", "Q", "B"]);
    // initial transitions are not numbered (never reported)
    assert.deepEqual(ir.transitions.map((t) => t.id), ["t3", "t4", "t5", "it1"]);
    assert.deepEqual(ir.transitions.map((t) => t.label), ["t3: P -> Q on e", "t4: B -> B on s", "t5: B -> terminate on stop", "it1: Q -> (internal) on tick"]);
  });

  it("names states by their name, qualified with parent states only as far as needed", () => {
    const names = stateNames([
      { id: "s1", name: "Idle", parent: -1 },
      { id: "s2", name: "Door", parent: -1 },
      { id: "s3", name: "Idle", parent: 1 },
      { id: "s4", name: "Open", parent: 1 },
      { id: "s5", name: "Window", parent: -1 },
      { id: "s6", name: "Open", parent: 4 },
      { id: "s7", name: "Open", parent: 4 },
    ]);
    assert.deepEqual(
      names.map((n) => n.label),
      ["Idle", "Door", "Door/Idle", "Door/Open", "Window", "Window/Open (s6)", "Window/Open (s7)"],
    );
    assert.deepEqual(
      names.map((n) => n.ident),
      ["Idle", "Door", "Door_Idle", "Door_Open", "Window", "Window_Open_s6", "Window_Open_s7"],
    );
  });

  it("turns free text into identifiers that start with a letter", () => {
    assert.equal(stateIdentifier("door open"), "door_open");
    assert.equal(stateIdentifier("2nd"), "s2nd");
    assert.equal(stateIdentifier("_x"), "s_x");
    assert.equal(stateIdentifier("50%"), "s50_");
    // identifiers that only differ after sanitizing are qualified like equal names
    const names = stateNames([
      { id: "a", name: "P", parent: -1 },
      { id: "b", name: "a b", parent: 0 },
      { id: "c", name: "a_b", parent: -1 },
    ]);
    assert.deepEqual(names.map((n) => n.ident), ["P", "P_a_b", "a_b"]);
  });
});

describe("fingerprint", () => {
  it("is FNV-1a (32 bit) over UTF-8", () => {
    // published FNV-1a test vectors
    assert.equal(fnv1a32(""), 0x811c9dc5);
    assert.equal(fnv1a32("a"), 0xe40c292c);
    assert.equal(fnv1a32("foobar"), 0xbf9cf968);
    // a non-ASCII character is hashed as its UTF-8 bytes (c3 a5)
    assert.equal(fnv1a32("å"), fnvBytes([0xc3, 0xa5]));
  });

  it("keeps its value when only the layout or actions change, and changes with the numbering or a name", () => {
    const base = lowerToIr(flatten(hookModel())).fingerprint;
    const fp = (change: (d: UfsmDocument) => void): number => {
      const d = hookModel();
      change(d);
      return lowerToIr(flatten(d)).fingerprint;
    };
    assert.equal(fp(() => {}), base);
    assert.equal(fp((d) => (d.declarations.actions[0]!.name = "renamed")), base, "actions are not numbered");
    assert.notEqual(fp((d) => (d.machine.root.states[1]!.name = "P2")), base, "state renamed");
    assert.notEqual(fp((d) => (d.declarations.events[0]!.name = "e2")), base, "event renamed");
    assert.notEqual(fp((d) => d.declarations.events.reverse()), base, "events renumbered");
    assert.notEqual(fp((d) => (d.name = "other")), base, "model renamed");
  });

  it("does not depend on the diagram", () => {
    const doc = loadModel(readFileSync(join(repoRoot, "examples/dimmer.ufsm"), "utf8")).doc;
    const base = lowerToIr(flatten(doc)).fingerprint;
    const moved = structuredClone(doc);
    for (const s of Object.values(moved.diagram?.states ?? {})) s.x += 10;
    delete moved.diagram;
    assert.equal(lowerToIr(flatten(moved)).fingerprint, base);
    assert.equal(fingerprint({ name: "x", events: [], signals: [], states: [], transitions: [] }), fnv1a32('["ufsm-ids",1,"x",[],[],[],[]]'));
  });
});

/** FNV-1a over raw bytes, to check the UTF-8 encoding. */
function fnvBytes(bytes: number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}
