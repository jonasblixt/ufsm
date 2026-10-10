// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * One entry point for every code generator: model -> files. Options are resolved in this order: the document's
 * `options`, then `targets.<name>` (the target's own settings and API options; behaviour options are not taken from
 * there), then overrides (the CLI's flags). Used by `ufsm generate` and by the editor's code preview.
 */
import { checkV1 } from "../v1/check";
import type { UfsmDocument } from "../v1/model";
import { defined } from "../v1/options";
import { flatten } from "../semantics/flatten";
import { lowerToIr } from "../ir/lower";
import type { IrModule } from "../ir/ir";
import { CodegenError, cOptionsFromTargets, generateC, type COptions } from "./c";
import { generatePython, pythonOptionsFromTargets, type PythonOptions } from "./python";
import { generateTypeScript, tsOptionsFromTargets, type TsOptions } from "./ts";
import { generateRust, rustOptionsFromTargets, type RustOptions } from "./rust";

export type CodeTarget = "c" | "python" | "ts" | "rust";

export const CODE_TARGETS: readonly CodeTarget[] = ["c", "python", "ts", "rust"];

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
  /** Python, TypeScript and Rust only. */
  className?: string;
  /** Overrides `options.signalQueue` for this run. */
  signalQueue?: number;
  /** Overrides `options.maxMicrosteps` for this run. */
  maxMicrosteps?: number;
}

/** Check, flatten and lower a model: the IR every backend prints. Throws CodegenError when the model has errors. */
export function modelIr(doc: UfsmDocument): IrModule {
  const errors = checkV1(doc).filter((d) => d.severity === "error");
  if (errors.length) throw new CodegenError(`the model has ${errors.length} error${errors.length > 1 ? "s" : ""}: ${errors.map((e) => e.message).join("; ")}`);
  return lowerToIr(flatten(doc));
}

/**
 * Generate the files of one target. `ir` may be passed when it is already at hand (it must be `modelIr(doc)`).
 * Throws CodegenError (model errors, name clashes in the generated code).
 */
export function generateFiles(doc: UfsmDocument, target: CodeTarget, overrides: GenerateOverrides = {}, ir: IrModule = modelIr(doc)): GeneratedCode {
  const { prefix, className, ...common } = defined(overrides);
  const model = defined(doc.options ?? {});
  if (target === "c") {
    const { options, problems } = cOptionsFromTargets(doc);
    const o: COptions = { ...model, ...options, ...common };
    if (prefix !== undefined) o.prefix = prefix;
    const out = generateC(ir, o);
    return { files: [{ name: out.headerName, text: out.header }, { name: out.sourceName, text: out.source }], problems };
  }
  const { options, problems } = target === "ts" ? tsOptionsFromTargets(doc) : target === "rust" ? rustOptionsFromTargets(doc) : pythonOptionsFromTargets(doc);
  const o: TsOptions & PythonOptions & RustOptions = { ...model, ...options, ...common };
  if (className !== undefined) o.className = className;
  const out = target === "ts" ? generateTypeScript(ir, o) : target === "rust" ? generateRust(ir, o) : generatePython(ir, o);
  return { files: [{ name: out.fileName, text: out.source }], problems };
}
