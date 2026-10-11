// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The `options` section: settings shared by every code generator, the interpreter and the simulator.
 *
 * Two kinds of option:
 * - behaviour options change what the machine does (queue size, livelock limit). They live in `options` only, with no
 *   per-target override, so a model behaves the same in every language.
 * - API options change only the shape of the generated code. They live in `options` and may be overridden per target
 *   in `targets.<name>`: `debugInfo` and `trace`.
 *
 * A generator resolves them in this order: `options`, then `targets.<name>` (API options only), then the caller's
 * overrides (the CLI's flags). Unset options take OPTION_DEFAULTS.
 */
import type { ModelOptions, UfsmDocument } from "./model";

export type OptionKey = keyof ModelOptions;

/** The value of every option when the model does not set it; the generated code's defaults too. */
export const OPTION_DEFAULTS: Readonly<Required<ModelOptions>> = { signalQueue: 16, maxMicrosteps: 10000, debugInfo: false, trace: false };

/** Options that change behaviour (whole numbers): set in `options` only. */
export const BEHAVIOUR_OPTIONS = ["signalQueue", "maxMicrosteps"] as const satisfies readonly OptionKey[];
export type BehaviourOption = (typeof BEHAVIOUR_OPTIONS)[number];

/** Options that change only the generated API (true/false): set in `options`, overridable in `targets.<name>`. */
export const API_OPTIONS = ["debugInfo", "trace"] as const satisfies readonly OptionKey[];
export type ApiOption = (typeof API_OPTIONS)[number];

/** Is `key` one of the behaviour options? */
export function isBehaviourOption(key: string): key is BehaviourOption {
  return (BEHAVIOUR_OPTIONS as readonly string[]).includes(key);
}

/** Is `key` one of the API options? */
export function isApiOption(key: string): key is ApiOption {
  return (API_OPTIONS as readonly string[]).includes(key);
}

/** Every option of `options` in canonical order. */
export const OPTION_KEYS: readonly OptionKey[] = [...BEHAVIOUR_OPTIONS, ...API_OPTIONS];

/** What a value of each option must be, as a check and as the words of a problem report. */
const VALID: Record<OptionKey, { test(v: unknown): boolean; expected: string }> = {
  signalQueue: { test: (v) => Number.isInteger(v) && (v as number) >= 0, expected: "a whole number >= 0" },
  maxMicrosteps: { test: (v) => Number.isInteger(v) && (v as number) >= 0, expected: "a whole number >= 0" },
  debugInfo: { test: (v) => typeof v === "boolean", expected: "true or false" },
  trace: { test: (v) => typeof v === "boolean", expected: "true or false" },
};

/** The model's options with the defaults filled in. */
export function modelOptions(doc: UfsmDocument): Required<ModelOptions> {
  return { ...OPTION_DEFAULTS, ...defined(doc.options ?? {}) };
}

/** The model's behaviour options with the defaults filled in: what the interpreter and the simulator run with. */
export function behaviourOptions(doc: UfsmDocument): Pick<Required<ModelOptions>, BehaviourOption> {
  const o = modelOptions(doc);
  return { signalQueue: o.signalQueue, maxMicrosteps: o.maxMicrosteps };
}

/** `o` without the keys whose value is undefined, so that spreading it never unsets anything. */
export function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Split `targets.<target>` into the API options it overrides and the target's own keys (prefix, className, ...),
 * which the generator reads. Behaviour options and API options with a wrong value are reported and ignored.
 */
export function targetSection(doc: UfsmDocument, target: string): { api: ModelOptions; own: [string, unknown][]; problems: string[] } {
  const api: Record<string, unknown> = {};
  const own: [string, unknown][] = [];
  const problems: string[] = [];
  for (const [k, v] of Object.entries(doc.targets?.[target] ?? {})) {
    if (isBehaviourOption(k)) problems.push(`targets.${target}.${k}: changes behaviour, so it is set in options for every target (ignored)`);
    else if (!isApiOption(k)) own.push([k, v]);
    else if (VALID[k].test(v)) api[k] = v;
    else problems.push(`targets.${target}.${k}: expected ${VALID[k].expected}`);
  }
  return { api: api as ModelOptions, own, problems };
}
