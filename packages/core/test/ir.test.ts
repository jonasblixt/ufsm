// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatFailure, loadModel, parseTrace, runTrace, type UfsmDocument } from "../src";
import {
  analyzeIr,
  flatten,
  lowerToIr,
  someStmt,
  walkStmts,
  type Expr,
  type IrModule,
  type Stmt,
} from "../src/pipeline";
import { simplify } from "../src/ir/simplify";
import { IrRunner } from "../src/verify/ir-run";
import { checkJoinAgreement, compareWithInterpreter, type Engine } from "./harness";
import { randomModel } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const traceDir = join(repoRoot, "tests/traces");
const modelFiles = ["examples", "tests/models"].flatMap((d) =>
  existsSync(join(repoRoot, d))
    ? readdirSync(join(repoRoot, d))
        .filter((f) => f.endsWith(".ufsm"))
        .map((f) => join(repoRoot, d, f))
    : [],
);

const irEngine: Engine = (doc, host, options) => new IrRunner(lowerToIr(flatten(doc)), host, options);

describe("IR: conformance traces", () => {
  for (const f of existsSync(traceDir)
    ? readdirSync(traceDir)
        .filter((x) => x.endsWith(".json"))
        .sort()
    : []) {
    it(f, () => {
      const path = join(traceDir, f);
      const trace = parseTrace(readFileSync(path, "utf8"));
      const doc = loadModel(readFileSync(resolve(dirname(path), trace.model), "utf8")).doc;
      const failures = runTrace(doc, trace, {}, irEngine);
      assert.equal(failures.length, 0, failures.map((x) => formatFailure(trace, x)).join("\n"));
    });
  }
});

describe("IR: joins", () => {
  it("fire only when every source has the join as its first enabled transition", () => checkJoinAgreement(irEngine));
});

describe("IR matches the interpreter", () => {
  for (const f of modelFiles) {
    it(`on random events: ${f.slice(repoRoot.length + 1)}`, () => {
      const doc = loadModel(readFileSync(f, "utf8")).doc;
      for (let seed = 1; seed <= 20; seed++) compareWithInterpreter(irEngine, doc, seed, 60);
    });
  }
  it("on 1500 random models", () => {
    for (let seed = 1; seed <= 1500; seed++)
      compareWithInterpreter(irEngine, randomModel(seed, { transitions: 16 }), seed * 31, 40);
  });
  it("on random models with a small signal queue", () => {
    for (let seed = 1; seed <= 300; seed++)
      compareWithInterpreter(irEngine, randomModel(seed, { signals: 2, transitions: 18 }), seed, 30, {
        signalQueue: 2,
      });
  });
});

describe("IR shape", () => {
  const walk = (stmts: Stmt[], f: (s: Stmt) => void): void => {
    for (const s of stmts) {
      f(s);
      if (s.op === "if") {
        walk(s.then, f);
        if (s.else) walk(s.else, f);
      } else if (s.op === "switch") for (const c of s.cases) walk(c.body, f);
    }
  };
  const all = (ir: IrModule, f: (s: Stmt) => void): void => {
    walk(ir.start, f);
    for (const fn of ir.functions) walk(fn.body, f);
  };

  it("only references functions it defines, and defines each once", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ir = lowerToIr(flatten(randomModel(seed)));
      const names = ir.functions.map((f) => f.name);
      assert.equal(new Set(names).size, names.length);
      all(ir, (s) => {
        if (s.op === "invoke") assert.ok(names.includes(s.fn), `${ir.name}: ${s.fn}`);
      });
      for (const fn of [
        ...Object.values(ir.onEvent),
        ...Object.values(ir.onSignal),
        ...(ir.eventless ? [ir.eventless] : []),
      ])
        assert.ok(names.includes(fn));
    }
  });

  it("has no recursion between helper functions", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ir = lowerToIr(flatten(randomModel(seed)));
      const calls = new Map(
        ir.functions.map((f) => {
          const out: string[] = [];
          walk(f.body, (s) => void (s.op === "invoke" && out.push(s.fn)));
          return [f.name, out] as const;
        }),
      );
      const visiting = new Set<string>();
      const check = (n: string): void => {
        assert.ok(!visiting.has(n), `${ir.name}: recursion through ${n}`);
        visiting.add(n);
        for (const c of calls.get(n) ?? []) check(c);
        visiting.delete(n);
      };
      for (const f of ir.functions) check(f.name);
    }
  });

  it("uses only flags it declares", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ir = lowerToIr(flatten(randomModel(seed)));
      for (const fn of ir.functions) {
        walk(fn.body, (s) => {
          if (s.op === "setFlag") assert.ok(fn.flags.includes(s.name));
        });
      }
    }
  });
});

describe("IR simplifier", () => {
  const active = (region: number, slot: number): Expr => ({ op: "active", region, slot });
  const call: Stmt = { op: "call", action: "a" };
  const inner: Stmt = { op: "if", cond: active(1, 2), then: [call] };

  it("decides slot tests that an enclosing condition implies", () => {
    const out = simplify([
      {
        op: "if",
        cond: active(1, 2),
        then: [
          { op: "if", cond: { op: "and", exprs: [active(0, 1), { op: "not", expr: active(1, 3) }] }, then: [call] },
        ],
      },
    ]);
    assert.deepEqual(out, [{ op: "if", cond: active(1, 2), then: [{ op: "if", cond: active(0, 1), then: [call] }] }]);
    const sw = simplify([{ op: "switch", on: { kind: "cfg", region: 1 }, cases: [{ slot: 2, body: [inner] }] }]);
    assert.deepEqual(sw, [{ op: "switch", on: { kind: "cfg", region: 1 }, cases: [{ slot: 2, body: [call] }] }]);
  });

  it("uses the negated condition in the else branch", () => {
    const out = simplify([{ op: "if", cond: active(1, 2), then: [call], else: [inner] }]);
    assert.deepEqual(out, [{ op: "if", cond: active(1, 2), then: [call] }]);
  });

  it("forgets what it knew once a statement may change the region", () => {
    const changes: Stmt[] = [
      { op: "set", region: 1, slot: 3 },
      { op: "invoke", fn: "exit_r1" },
      { op: "if", cond: active(0, 1), then: [{ op: "set", region: 1, slot: 3 }] },
      { op: "switch", on: { kind: "cfg", region: 0 }, cases: [{ slot: 1, body: [{ op: "invoke", fn: "exit_r1" }] }] },
    ];
    for (const change of changes) {
      const out = simplify([{ op: "if", cond: active(1, 2), then: [change, inner] }]);
      assert.deepEqual((out[0] as Extract<Stmt, { op: "if" }>).then[1], inner, `after ${JSON.stringify(change)}`);
    }
    // a set on another region keeps the fact
    const other = simplify([{ op: "if", cond: active(1, 2), then: [{ op: "set", region: 4, slot: 1 }, inner] }]);
    assert.deepEqual((other[0] as Extract<Stmt, { op: "if" }>).then[1], call);
  });
});

describe("IR analysis", () => {
  const lowered = (doc: UfsmDocument): IrModule => lowerToIr(flatten(doc));
  const invoked = (ir: IrModule): Set<string> => {
    const out = new Set<string>([
      ...Object.values(ir.onEvent),
      ...Object.values(ir.onSignal),
      ...(ir.eventless ? [ir.eventless] : []),
    ]);
    const visit = (s: Stmt): void => void (s.op === "invoke" && out.add(s.fn));
    walkStmts(ir.start, visit);
    for (const f of ir.functions) walkStmts(f.body, visit);
    return out;
  };

  it("the lowering keeps only functions the runtime loop reaches, and no signal steps without emits", () => {
    for (const f of modelFiles) {
      const ir = lowered(loadModel(readFileSync(f, "utf8")).doc);
      const reached = invoked(ir);
      for (const fn of ir.functions) assert.ok(reached.has(fn.name), `${f}: ${fn.name} is never reached`);
      if (!analyzeIr(ir, 1).hasQueue) assert.deepEqual(ir.onSignal, {}, f);
    }
  });

  it("finds the queue, terminate, timers, the step counter and the functions that can fail", () => {
    const load = (name: string): IrModule =>
      lowered(loadModel(readFileSync(join(repoRoot, "tests/models", name), "utf8")).doc);
    const signals = analyzeIr(load("test_signals.ufsm"), 10);
    assert.ok(signals.hasQueue && !signals.hasTimers && signals.checkSteps && signals.countSteps);
    const emitting = load("test_signals.ufsm").functions.filter((f) =>
      someStmt({ start: [], functions: [f] }, (s) => s.op === "emit"),
    );
    assert.ok(
      emitting.length > 0 && emitting.every((f) => signals.fallible.has(f.name)),
      "a function that emits can fail",
    );
    assert.ok(analyzeIr(load("test_terminate.ufsm"), 10).hasTerminate);
    assert.ok(analyzeIr(load("test_timers.ufsm"), 10).hasTimers);
    // without a microstep limit only emitting functions (and their callers) can fail
    const guard1 = analyzeIr(load("test_guard1.ufsm"), 0);
    assert.ok(!guard1.checkSteps && !guard1.countSteps && !guard1.hasQueue && guard1.fallible.size === 0);
    assert.ok(analyzeIr(load("test_guard1.ufsm"), 10).fallible.size > 0, "with a limit, counting a microstep can fail");
  });
});
