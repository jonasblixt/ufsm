// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * @ufsm/core: everything that is not UI.
 *
 *   v1/        the current file format: model, reader, canonical writer,
 *              index, geometry, routes, layout edits (what the editor's drags
 *              do), structure edits (add, delete, copy/paste, ids), property
 *              edits (names, actions, triggers, guards, declarations), labels,
 *              design rule check, v0 migration
 *   v0/        legacy reader (exported as the `v0` namespace)
 *
 *   semantics/ static structure (document order, compound transitions),
 *              flattening into tables, and a runner for those tables
 *   runtime/   the run-time contract every executable form shares: host, options, errors, busy
 *   interp/    reference interpreter and conformance trace runner
 *   ir/        the IR backends print, lowered from the flat tables, and an evaluator for it
 *
 *   backends/  code generators: IR printers (c, python, ts, rust) and generateFiles, the one entry point
 *
 * Rule: no Node or DOM APIs in this package, so it runs unchanged in the
 * editor, the CLI and tests.
 */

export { UFSM_VERSION } from "./version";

export { UfsmFormatError } from "./errors";
export * from "./v1/model";
export * from "./v1/parse";
export * from "./v1/schema";
export * from "./v1/serialize";
export * from "./v1/doc-index";
export * from "./v1/action-block";
export * from "./v1/geometry";
export * from "./v1/route";
export * from "./v1/edit";
export * from "./v1/ids";
export * from "./v1/create";
export * from "./v1/clipboard";
export * from "./v1/props";
export * from "./v1/labels";
export * from "./v1/sheet";
export * from "./v1/check";
export * from "./v1/options";
export * from "./v1/migrate";
export * from "./v1/load";
export * from "./semantics/structure";
export * from "./semantics/flatten";
export * from "./semantics/flat-run";
export * from "./ir/ir";
export * from "./ir/lower";
export * from "./ir/analyze";
export * from "./ir/ids";
export * from "./ir/eval";
export * from "./ir/print";
export * from "./backends/c";
export * from "./backends/python";
export * from "./backends/ts";
export * from "./backends/rust";
export * from "./backends/generate";
export * from "./runtime/contract";
export * from "./interp/interpreter";
export * from "./interp/trace";
export * as v0 from "./v0/index";
