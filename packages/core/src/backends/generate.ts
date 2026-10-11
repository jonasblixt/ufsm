// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * One entry point for every code generator: model -> files. Options are resolved in this order: the document's
 * `options`, then `targets.<name>` (the target's own settings and API options; behaviour options are not taken from
 * there), then overrides (the CLI's flags). Used by `ufsm generate` and by the editor's code preview.
 */
import { checkSemantics } from "../check/semantic";
import type { UfsmDocument } from "../format/model";
import { flatten } from "../semantics/flatten";
import { lowerToIr } from "../ir/lower";
import type { IrModule } from "../ir/ir";
import type { CodeTarget } from "../format/options";
import { CodegenError, resolveOptions } from "./common";
import { cOptionsFromTargets, generateC, type COptions } from "./c";
import { generatePython, pythonOptionsFromTargets, type PythonOptions } from "./python";
import { generateTypeScript, tsOptionsFromTargets, type TsOptions } from "./ts";
import { generateRust, rustOptionsFromTargets, type RustOptions } from "./rust";
import { generateGo, goOptionsFromTargets, type GoOptions } from "./go";
import { cppOptionsFromTargets, generateCpp, type CppOptions } from "./cpp";

export interface GeneratedFile {
  name: string;
  text: string;
}

export interface GeneratedCode {
  /** In the order a reader wants them: the C header before the source. */
  files: GeneratedFile[];
  /** Settings in `targets` that were ignored (unknown keys, wrong types, behaviour options). */
  problems: string[];
}

/** What the CLI's flags can override; prefix and className apply only to the targets that have them, the rest to all. */
export interface GenerateOverrides {
  /** C only. */
  prefix?: string;
  /** Python, TypeScript, Rust, Go and C++ only. */
  className?: string;
  /** Overrides `options.signalQueue` for this run. */
  signalQueue?: number;
  /** Overrides `options.maxMicrosteps` for this run. */
  maxMicrosteps?: number;
  /** Overrides `options.debugInfo` and `targets.<name>.debugInfo` for this run. */
  debugInfo?: boolean;
  /** Overrides `options.trace` and `targets.<name>.trace` for this run. */
  trace?: boolean;
}

/**
 * Check, flatten and lower a model: the IR every backend prints. `trace` emits the trace hook calls (the target's
 * resolved `trace` option). Throws CodegenError when the model has errors.
 */
export function modelIr(doc: UfsmDocument, trace = false): IrModule {
  const errors = checkSemantics(doc).filter((d) => d.severity === "error");
  if (errors.length)
    throw new CodegenError(
      `the model has ${errors.length} error${errors.length > 1 ? "s" : ""}: ${errors.map((e) => e.message).join("; ")}`,
    );
  return lowerToIr(flatten(doc), { trace });
}

/**
 * Generate the files of one target. `ir` may be passed when it is already at hand (it must be `modelIr(doc)`; it is
 * lowered again when the target's `trace` option differs from the IR's).
 * Throws CodegenError (model errors, name clashes in the generated code).
 */
export function generateFiles(
  doc: UfsmDocument,
  target: CodeTarget,
  overrides: GenerateOverrides = {},
  ir?: IrModule,
): GeneratedCode {
  const { prefix, className, ...common } = overrides;
  const lowered = (trace: boolean): IrModule => (ir && ir.trace === trace ? ir : modelIr(doc, trace));
  if (target === "c") {
    const { options, problems } = cOptionsFromTargets(doc);
    const resolved = resolveOptions(doc, options, common);
    const o: COptions = { ...options, ...resolved };
    if (prefix !== undefined) o.prefix = prefix;
    const out = generateC(lowered(resolved.trace), o);
    return {
      files: [
        { name: out.headerName, text: out.header },
        { name: out.sourceName, text: out.source },
      ],
      problems,
    };
  }
  const single = SINGLE_FILE[target];
  const { options, problems } = single.read(doc);
  const resolved = resolveOptions(doc, options, common);
  const o: SingleFileOptions = { ...options, ...resolved };
  if (className !== undefined) o.className = className;
  const out = single.generate(lowered(resolved.trace), o);
  return { files: [{ name: out.fileName, text: out.source }], problems };
}

type SingleFileOptions = TsOptions & PythonOptions & RustOptions & GoOptions & CppOptions;

/** The targets that write one file: how to read their `targets.<name>` and generate. */
const SINGLE_FILE: Record<
  Exclude<CodeTarget, "c">,
  {
    read(doc: UfsmDocument): { options: SingleFileOptions; problems: string[] };
    generate(ir: IrModule, options: SingleFileOptions): { fileName: string; source: string };
  }
> = {
  python: { read: pythonOptionsFromTargets, generate: generatePython },
  ts: { read: tsOptionsFromTargets, generate: generateTypeScript },
  rust: { read: rustOptionsFromTargets, generate: generateRust },
  go: { read: goOptionsFromTargets, generate: generateGo },
  cpp: { read: cppOptionsFromTargets, generate: generateCpp },
};
