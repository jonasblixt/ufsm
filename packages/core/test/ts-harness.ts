// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs generated TypeScript in the test process: modules are written to a
 * temp directory and imported (tsx or Node's type stripping runs them), and
 * each machine is wrapped as a TraceMachine, so the generated code plugs
 * into runTrace and compareWithInterpreter like the interpreter itself.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { InterpreterError, generateTypeScript, type InterpreterErrorCode, type InterpreterHost, type IrModule, type TraceMachine, type TsOptions } from "../src/index";
import { removeTempDir } from "./c-harness";
import { decodeHooks } from "./harness";

interface GeneratedMachine {
  reset(): void;
  process(event: number): void;
  isActive?(state: number): boolean;
}

/** Statics of a machine class generated with debugInfo. */
interface DebugStatics {
  FINGERPRINT: number;
  EVENT_NAMES: readonly string[];
  SIGNAL_NAMES: readonly string[];
  STATE_NAMES: readonly string[];
}

export interface TsUnit {
  ir: IrModule;
  /** Make a fresh machine around a host (the interpreter's host interface). */
  make(host: InterpreterHost): TraceMachine;
}

/**
 * Generate and import the modules; returns one unit per IR, in order. Call `cleanup` when done. A unit generated with
 * `debugInfo` from an IR lowered with `trace` logs its trace hook calls as decoded pseudo-calls (harness.ts) and
 * reports active states through `isActive()`; its name tables are checked when it is loaded.
 */
export async function loadTs(irs: { ir: IrModule; options?: TsOptions }[]): Promise<{ units: TsUnit[]; cleanup: () => void; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-ts-"));
  const units = await Promise.all(
    irs.map(async ({ ir, options }, k): Promise<TsUnit> => {
      const out = generateTypeScript(ir, { ...options, className: `U${k}`, module: `u${k}` });
      const file = join(dir, out.fileName);
      writeFileSync(file, out.source);
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const Machine = mod[`U${k}`] as (new (handler: object) => GeneratedMachine) & DebugStatics;
      const debug = ir.trace && options?.debugInfo === true;
      assert.equal(Machine.FINGERPRINT, ir.fingerprint);
      if (debug) {
        assert.deepEqual(Machine.EVENT_NAMES, ir.events.map((e) => e.name));
        assert.deepEqual(Machine.SIGNAL_NAMES, ir.signals.map((x) => x.name));
        assert.deepEqual(Machine.STATE_NAMES, ir.states.map((st) => st.label));
      }
      const ErrorClass = mod[`U${k}Error`] as new (code: string, message: string) => Error & { code: string };
      const eventNo = new Map(ir.events.map((e, i) => [e.name, i]));
      const make = (host: InterpreterHost): TraceMachine => {
        const handler: Record<string, () => unknown> = {};
        for (const a of ir.actions) handler[a.name] = () => host.call?.(a.name, a.id);
        for (const g of ir.guards) handler[g.name] = () => host.guard?.(g.name, g.id) ?? false;
        if (debug) {
          const what = (kind: number, id: number): string =>
            kind === 0 ? `@event:${Machine.EVENT_NAMES[id]}` : kind === 1 ? `@signal:${Machine.SIGNAL_NAMES[id]}` : `@${["t", "enter", "exit"][kind - 2]}:${id}`;
          const trace = (kind: number, id: number): void => {
            const [c] = decodeHooks([what(kind, id)], ir);
            host.call?.(c!, c!);
          };
          (handler as Record<string, unknown>)["trace"] = trace;
        }
        const m = new Machine(handler);
        const cfg = (): number[] => (m as unknown as { cfg: number[] }).cfg;
        const run = (f: () => void): number => {
          try {
            f();
          } catch (e) {
            if (e instanceof ErrorClass) throw new InterpreterError(e.code as InterpreterErrorCode, e.message);
            throw e;
          }
          return 0;
        };
        const activeIds = (): string[] =>
          debug ? ir.states.filter((_, i) => m.isActive!(i)).map((s) => s.id) : ir.states.filter((s) => cfg()[s.region] === s.slot).map((s) => s.id);
        return {
          reset: () => void run(() => m.reset()),
          process: (event) => run(() => m.process(eventNo.get(event) ?? -1)),
          isActive: (id) => activeIds().includes(id),
          activeIds,
        };
      };
      return { ir, make };
    }),
  );
  return { units, dir, cleanup: () => removeTempDir(dir) };
}
