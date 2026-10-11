// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * What every backend shares: the error a printer throws, the notice in every generated file, identifier helpers, the
 * options every target takes, reading `targets.<name>`, the checks and analysis a printer starts with, and a line
 * writer. Language-specific printing stays in each backend's own file; backends never import each other.
 */
import type { ModelOptions, UfsmDocument } from "../format/model";
import { OPTION_DEFAULTS, defined, targetSection } from "../format/options";
import type { IrModule } from "../ir/ir";
import { analyzeIr, type IrAnalysis } from "../ir/analyze";

export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodegenError";
  }
}

/**
 * Stated in every generated file: generator output is not covered by uFSM's
 * GPL (see LICENSE-EXCEPTION in the repository root).
 */
export const OUTPUT_NOTICE = "May be used, modified and distributed under any terms (uFSM output exception).";

/** Turn free text into a C-style identifier ("New model" -> "New_model"). */
export function identifier(text: string): string {
  let s = text.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(s)) s = `m${s}`;
  return s;
}

/** "test_guard1" -> "TestGuard1", "New model" -> "NewModel": the default class or struct name of a machine. */
export function pascalCase(text: string): string {
  const parts = identifier(text)
    .split("_")
    .filter((p) => p !== "");
  const s = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  return /^[A-Za-z]/.test(s) ? s : `M${s}`;
}

/** The options every target takes (format-v1.md "Options"); each backend's options add its own. */
export interface CommonOptions {
  /** Capacity of the signal queue (only generated when the model emits signals). Default 16. */
  signalQueue?: number;
  /** Microsteps per reset/process call before a livelock error; 0 disables the check. Default 10000. */
  maxMicrosteps?: number;
  /** Name lookup for events, signals and states, and an is-active query. Default false. */
  debugInfo?: boolean;
  /** Must equal the IR's `trace` when given (the trace calls are emitted by the lowering). */
  trace?: boolean;
}

export type ResolvedOptions = Required<CommonOptions>;

/**
 * The common options of one target: the model's `options`, then the API options of `targets.<name>` (`debugInfo`,
 * `trace`), then overrides (the CLI's flags). Behaviour options are never taken from `targets`.
 */
export function resolveOptions(doc: UfsmDocument, target: CommonOptions, overrides: CommonOptions): ResolvedOptions {
  const { signalQueue, maxMicrosteps, debugInfo, trace } = overrides;
  return {
    ...OPTION_DEFAULTS,
    ...defined(doc.options ?? {}),
    ...defined({ debugInfo: target.debugInfo, trace: target.trace }),
    ...defined({ signalQueue, maxMicrosteps, debugInfo, trace }),
  };
}

/**
 * Read `targets.<target>`: its API options and the target's own keys, all strings (prefix, className, ...). Unknown
 * keys and wrong types are reported, not fatal: the defaults are used instead.
 */
export function readTargetOptions<K extends string>(
  doc: UfsmDocument,
  target: string,
  keys: readonly K[],
): { options: ModelOptions & Partial<Record<K, string>>; problems: string[] } {
  const { api, own, problems } = targetSection(doc, target);
  const options = { ...api } as ModelOptions & Partial<Record<K, string>>;
  for (const [k, v] of own) {
    if (!(keys as readonly string[]).includes(k)) problems.push(`targets.${target}.${k}: unknown option (ignored)`);
    else if (typeof v === "string") (options as Record<string, unknown>)[k] = v;
    else problems.push(`targets.${target}.${k}: expected a string`);
  }
  return { options, problems };
}

/** What a printer starts from: the options with defaults filled in, and the facts about the IR it prints. */
export interface Prepared extends ResolvedOptions, IrAnalysis {}

/** Resolve the common options against the IR, analyze it, and refuse what cannot be generated. */
export function prepare(ir: IrModule, options: CommonOptions): Prepared {
  if (options.trace !== undefined && options.trace !== ir.trace)
    throw new CodegenError("options.trace differs from the IR's: lower the model with { trace }");
  const signalQueue = options.signalQueue ?? OPTION_DEFAULTS.signalQueue;
  const maxMicrosteps = options.maxMicrosteps ?? OPTION_DEFAULTS.maxMicrosteps;
  const analysis = analyzeIr(ir, maxMicrosteps);
  if (analysis.hasQueue && signalQueue < 1)
    throw new CodegenError("the model emits signals: signalQueue must be at least 1");
  return { signalQueue, maxMicrosteps, debugInfo: options.debugInfo ?? false, trace: ir.trace, ...analysis };
}

/** Precedence of a printed expression; what the numbers mean is up to each language (higher binds tighter). */
export interface Printed {
  s: string;
  p: number;
}

/** Lines of generated text, indented by depth with `indent` per level; an empty line stays empty. */
export interface Lines {
  readonly out: string[];
  line(depth: number, text: string): void;
  /** The text so far, ending with a newline. */
  text(): string;
}

export function lines(indent: string): Lines {
  const out: string[] = [];
  return {
    out,
    line: (depth, text) => void out.push(text === "" ? "" : `${indent.repeat(depth)}${text}`),
    text: () => `${out.join("\n")}\n`,
  };
}
