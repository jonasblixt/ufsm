// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  UFSM_VERSION,
  UfsmFormatError,
  CodegenError,
  Interpreter,
  InterpreterError,
  checkV1,
  locate,
  locationText,
  sheets,
  flatten,
  generateFiles,
  formatFailure,
  indexV1,
  loadModel,
  lowerToIr,
  printIr,
  hex32,
  modelIr,
  parseTrace,
  runTrace,
  serializeV1,
  formatJson,
  v1JsonSchema,
  transitionLabel,
  internalTransitionLabel,
  vertexName,
  type GenerateOverrides,
  type LoadedModel,
} from "@ufsm/core";

const USAGE = `ufsm ${UFSM_VERSION}

Usage:
  ufsm info <model.ufsm>                 Summary of a model
  ufsm check <model.ufsm>                Design rule check (exit 2 on errors)
  ufsm list <model.ufsm>                 List all transitions
  ufsm migrate <old.ufsm> [-o out.ufsm]  Convert a v0 model to v1 (stdout without -o)
  ufsm fmt <model.ufsm>...               Rewrite files in canonical v1 form
  ufsm run <model.ufsm> [event...]       Simulate: reset, then process the events
         [-g guard[=true|false]]...      (guards are false unless set; -g name sets it true)
         [--signal-queue n] [--max-microsteps n]  (override the model's options)
  ufsm trace <trace.json>...             Replay conformance traces (exit 2 on failure)
  ufsm flatten <model.ufsm> [--json]     Show the static tables code generators work from
  ufsm ir <model.ufsm> [--json]          Show the IR every backend prints, as pseudo-code
  ufsm generate c <model.ufsm> [-o dir]  Generate <name>.h and <name>.c (default: current directory)
         [--prefix p] [--signal-queue n] [--max-microsteps n] [--debug-info] [--trace]
                                         (override targets.c and options in the model; see docs/backend-c.md)
  ufsm generate python <model.ufsm> [-o dir]
         [--class-name C] [--signal-queue n] [--max-microsteps n] [--debug-info] [--trace]
                                         Generate <name>.py (overrides targets.python, options; docs/backend-python.md)
  ufsm generate ts <model.ufsm> [-o dir]
         [--class-name C] [--signal-queue n] [--max-microsteps n] [--debug-info] [--trace]
                                         Generate <name>.ts (overrides targets.ts, options; docs/backend-ts.md)
  ufsm generate rust <model.ufsm> [-o dir]
         [--class-name C] [--signal-queue n] [--max-microsteps n] [--debug-info] [--trace]
                                         Generate <name>.rs (overrides targets.rust, options; docs/backend-rust.md)
  ufsm schema [-o file]                  The JSON Schema of format v1 (stdout without -o)
  ufsm --version

All commands accept v0 (legacy) and v1 files; v0 files are converted in memory.`;

/** npm runs workspace scripts from the package dir; resolve paths against where the user ran npm. */
function userPath(p: string): string {
  return resolve(process.env["INIT_CWD"] ?? process.cwd(), p);
}

function load(file: string): LoadedModel {
  return loadModel(readFileSync(userPath(file), "utf8"));
}

function printNotes(m: LoadedModel, file: string): void {
  if (m.sourceVersion === 0) {
    console.error(`${file}: legacy v0 file, converted in memory (${m.notes.length} change${m.notes.length === 1 ? "" : "s"})`);
    for (const n of m.notes) console.error(`  note: ${n.message}`);
  }
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "boolean", short: "V" },
      help: { type: "boolean", short: "h" },
      output: { type: "string", short: "o" },
      guard: { type: "string", short: "g", multiple: true },
      json: { type: "boolean" },
      prefix: { type: "string" },
      "class-name": { type: "string" },
      "signal-queue": { type: "string" },
      "max-microsteps": { type: "string" },
      "debug-info": { type: "boolean" },
      trace: { type: "boolean" },
    },
  });

  /** --signal-queue and --max-microsteps: overrides of the model's options for `run` and `generate`. */
  const optionFlags = (): { signalQueue?: number; maxMicrosteps?: number } => {
    const out: { signalQueue?: number; maxMicrosteps?: number } = {};
    for (const [flag, key] of [["signal-queue", "signalQueue"], ["max-microsteps", "maxMicrosteps"]] as const) {
      const v = values[flag];
      if (v === undefined) continue;
      if (!/^\d+$/.test(v)) throw new CodegenError(`--${flag}: expected a whole number, got '${v}'`);
      out[key] = Number(v);
    }
    return out;
  };

  if (values.version) {
    console.log(UFSM_VERSION);
    return 0;
  }
  const [command, ...files] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }
  if (command === "schema") {
    const text = formatJson(v1JsonSchema());
    if (values.output) writeFileSync(userPath(values.output), text);
    else process.stdout.write(text);
    return 0;
  }
  const file = files[0];
  if (!file) {
    console.error(`ufsm ${command}: missing model file\n\n${USAGE}`);
    return 1;
  }

  switch (command) {
    case "info": {
      const m = load(file);
      const { doc } = m;
      const index = indexV1(doc);
      const kinds: Record<string, number> = {};
      for (const { vertex } of index.vertices.values()) kinds[vertex.kind] = (kinds[vertex.kind] ?? 0) + 1;
      const d = doc.declarations;
      console.log(`Model:       ${doc.name}  (file format v${m.sourceVersion})`);
      console.log(`States:      ${index.vertices.size}  (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", ")})`);
      console.log(`Regions:     ${index.regions.size}`);
      console.log(`Transitions: ${index.transitions.size}${index.internals.size ? ` (+ ${index.internals.size} internal)` : ""}`);
      console.log(`Events:      ${d.events.length}`);
      console.log(`Signals:     ${d.signals.length}`);
      console.log(`Actions:     ${d.actions.length}`);
      console.log(`Guards:      ${d.guards.length}`);
      if (doc.diagram) console.log(`Sheets:      ${sheets(index).length} (${doc.diagram.paper})`);
      // the fingerprint of the numbering generated code uses (state enum, trace ids)
      const ok = checkV1(doc).every((x) => x.severity !== "error");
      console.log(`Fingerprint: ${ok ? hex32(modelIr(doc).fingerprint) : "- (the model has errors)"}`);
      return 0;
    }
    case "check": {
      const m = load(file);
      printNotes(m, file);
      const diags = checkV1(m.doc);
      const index = indexV1(m.doc);
      // Where it is drawn ("sheet 2, B4"); nothing for declarations or without a diagram.
      const where = (id: string | undefined): string => {
        const loc = id === undefined || !m.doc.diagram ? undefined : locate(index, id);
        return loc ? `, ${locationText(loc)}` : "";
      };
      for (const d of diags) console.log(`${d.severity}: ${d.message}  [${d.code}${d.id ? ` ${d.id}` : ""}${where(d.id)}]`);
      const errors = diags.filter((d) => d.severity === "error").length;
      console.log(errors === 0 ? `OK (${diags.length} warning${diags.length === 1 ? "" : "s"})` : `${errors} error(s)`);
      return errors === 0 ? 0 : 2;
    }
    case "list": {
      const { doc } = load(file);
      const index = indexV1(doc);
      for (const t of doc.machine.transitions) {
        const label = transitionLabel(index, t);
        console.log(`${vertexName(index, t.from)} -> ${vertexName(index, t.to)}${label ? `  : ${label}` : ""}`);
      }
      for (const { transition, state } of index.internals.values()) {
        console.log(`${state.name} (internal)  : ${internalTransitionLabel(index, transition)}`);
      }
      return 0;
    }
    case "migrate": {
      const m = load(file);
      printNotes(m, file);
      const text = serializeV1(m.doc);
      if (values.output) {
        writeFileSync(userPath(values.output), text);
        console.error(`wrote ${values.output}`);
      } else {
        process.stdout.write(text);
      }
      return 0;
    }
    case "fmt": {
      for (const f of files) {
        const before = readFileSync(userPath(f), "utf8");
        const m = loadModel(before);
        if (m.sourceVersion === 0) {
          console.error(`${f}: legacy v0 file; use 'ufsm migrate ${f} -o <new.ufsm>' instead`);
          return 1;
        }
        const after = serializeV1(m.doc);
        if (after !== before) {
          writeFileSync(userPath(f), after);
          console.log(`formatted ${f}`);
        }
      }
      return 0;
    }
    case "run": {
      const { doc } = load(file);
      const index = indexV1(doc);
      const guards = new Map<string, boolean>();
      for (const g of values.guard ?? []) {
        const m = /^([A-Za-z_]\w*)(?:=(true|false|1|0))?$/.exec(g);
        if (!m) {
          console.error(`ufsm run: bad guard '${g}', expected name, name=true or name=false`);
          return 1;
        }
        guards.set(m[1]!, m[2] === undefined || m[2] === "true" || m[2] === "1");
      }
      const name = (id: string): string => vertexName(index, id);
      const m = new Interpreter(doc, { guard: (g) => guards.get(g) ?? false }, {
        ...optionFlags(),
        onTrace: (e) => {
          switch (e.type) {
            case "reset": console.log("-> reset"); break;
            case "event": console.log(e.signal ? `-> signal ${e.name}` : `-> ${e.name}`); break;
            case "exit": console.log(`   exit  ${name(e.state)}`); break;
            case "enter": console.log(`   enter ${name(e.state)}`); break;
            case "transition": {
              const t = index.transitions.get(e.id);
              const it = index.internals.get(e.id);
              if (t) console.log(`   take  ${name(t.from)} -> ${name(t.to)}`);
              else if (it) console.log(`   take  ${it.state.name} (internal) ${internalTransitionLabel(index, it.transition)}`);
              break;
            }
            case "call": console.log(`   call  ${e.action}`); break;
            case "emit": console.log(`   emit  ${e.signal}`); break;
            case "terminate": console.log("   terminated"); break;
          }
        },
      });
      m.reset();
      for (const ev of files.slice(1)) m.process(ev);
      console.log(`active: ${m.activeIds().map(name).join(", ") || "(none)"}`);
      return 0;
    }
    case "flatten": {
      const { doc } = load(file);
      const f = flatten(doc);
      if (values.json) {
        console.log(JSON.stringify(f, null, 1));
        return 0;
      }
      const vname = (v: number): string => f.vertices[v]!.name;
      const rname = (r: number): string => {
        const reg = f.regions[r]!;
        return reg.owner < 0 ? "root" : `${vname(reg.owner)}.${reg.name ?? reg.id}`;
      };
      const tname = (t: number): string => {
        const x = f.transitions[t]!;
        return `${x.id} ${x.sources.map(vname).join("+")}`;
      };
      console.log(`regions (${f.regions.length}), cfg slot = index in the list, 0 = inactive`);
      f.regions.forEach((r, i) => {
        const hist = r.history === "none" ? "" : `  ${r.history} history`;
        console.log(`  r${i} ${rname(i)}: ${r.slots.map((v, k) => `${k + 1}=${vname(v)}`).join(" ") || "(empty)"}${hist}`);
      });
      console.log(`transitions (${f.transitions.length})`);
      f.transitions.forEach((t, i) => {
        const trig = t.trigger.kind === "event" ? t.trigger.name : t.trigger.kind;
        const what = t.terminate ? " terminate" : "";
        console.log(`  #${i} ${tname(i)} [${trig}] exit r${t.domain} (${rname(t.domain)}), blocks ${t.blocks.map((b) => `r${b}`).join(" ")}${what}`);
      });
      const show = (label: string, offers: typeof f.eventless): void => {
        if (!offers.length) return;
        console.log(`  ${label}: ${offers.map((o) => `${vname(o.state)}(${o.candidates.map((c) => `#${c.transition}${c.offer ? "" : "?"}`).join(" ")})`).join(" ")}`);
      };
      console.log("offers in visit order (? = join offered by its last source)");
      for (const e of [...f.events, ...f.signals]) show(e.name, f.offers[e.id] ?? []);
      show("eventless", f.eventless);
      return 0;
    }
    case "ir": {
      const ir = lowerToIr(flatten(load(file).doc));
      process.stdout.write(values.json ? `${JSON.stringify(ir, null, 1)}\n` : printIr(ir));
      return 0;
    }
    case "generate": {
      const [given, model] = files;
      const target = given === "typescript" ? "ts" : given;
      if (target !== "c" && target !== "python" && target !== "ts" && target !== "rust") {
        console.error(`ufsm generate: unknown target '${given}' (available: c, python, ts, rust)`);
        return 1;
      }
      if (!model) {
        console.error(`ufsm generate: missing model file\n\n${USAGE}`);
        return 1;
      }
      for (const [flag, targets] of [["prefix", ["c"]], ["class-name", ["python", "ts", "rust"]]] as const) {
        if (values[flag] !== undefined && !(targets as readonly string[]).includes(target)) {
          console.error(`ufsm generate: --${flag} only applies to ${targets.slice(0, -1).join(", ")}${targets.length > 1 ? " and " : ""}${targets[targets.length - 1]}`);
          return 1;
        }
      }
      const m = load(model);
      printNotes(m, model);
      const errors = checkV1(m.doc).filter((d) => d.severity === "error");
      if (errors.length) {
        for (const d of errors) console.error(`error: ${d.message}  [${d.code}${d.id ? ` ${d.id}` : ""}]`);
        console.error(`${model}: ${errors.length} error(s); run 'ufsm check ${model}'`);
        return 2;
      }
      const overrides: GenerateOverrides = {};
      if (values.prefix !== undefined) overrides.prefix = values.prefix;
      if (values["class-name"] !== undefined) overrides.className = values["class-name"];
      Object.assign(overrides, optionFlags());
      if (values["debug-info"]) overrides.debugInfo = true;
      if (values.trace) overrides.trace = true;
      const out = generateFiles(m.doc, target, overrides);
      for (const p of out.problems) console.error(`warning: ${p}`);
      const written = out.files.map((f) => [f.name, f.text] as const);
      const dir = userPath(values.output ?? ".");
      for (const [name, text] of written) {
        writeFileSync(join(dir, name), text);
        console.log(`wrote ${join(values.output ?? ".", name)}`);
      }
      return 0;
    }
    case "trace": {
      let failed = 0;
      for (const f of files) {
        const path = userPath(f);
        const trace = parseTrace(readFileSync(path, "utf8"));
        const { doc } = loadModel(readFileSync(resolve(dirname(path), trace.model), "utf8"));
        const failures = runTrace(doc, trace);
        if (failures.length === 0) {
          console.log(`ok    ${f} (${trace.steps.length} steps)`);
        } else {
          failed++;
          console.log(`FAIL  ${f}`);
          for (const x of failures) console.log(`  ${formatFailure(trace, x).replace(/\n/g, "\n  ")}`);
        }
      }
      return failed === 0 ? 0 : 2;
    }
    default:
      console.error(`ufsm: unknown command '${command}'\n\n${USAGE}`);
      return 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UfsmFormatError || e instanceof InterpreterError || e instanceof CodegenError || (e as NodeJS.ErrnoException).code === "ENOENT") {
    console.error(`ufsm: ${(e as Error).message}`);
    process.exitCode = e instanceof CodegenError ? 2 : 1;
  } else {
    throw e;
  }
}
