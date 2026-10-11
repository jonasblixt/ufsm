// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * @ufsm/core: everything that is not UI. Platform neutral: no Node or DOM APIs, so it runs unchanged in the editor, the
 * CLI and tests. Four entry points, by purpose (docs/architecture.md has the layers and their import rules):
 *
 *   @ufsm/core           read, write and check a model, simulate it, generate code: the stable API
 *   @ufsm/core/diagram   derived layout: geometry, S routes, action blocks, sheets (what the editor draws)
 *   @ufsm/core/edit      edits the editor runs on a draft: layout (drags), create/delete, clipboard, properties
 *   @ufsm/core/pipeline  the stages between a model and generated code: structure, flat tables, IR, the printers
 *
 * Test oracles (verify/: the flat-table runner, the IR runner) and the IR simplifier are in no entry point; tests
 * import them by path.
 */

export { UFSM_VERSION } from "./version";

// The file format: model types, reader, canonical writer, JSON Schema, options, id allocation, v0 conversion
export { UfsmFormatError } from "./format/errors";
export * from "./format/model";
export * from "./format/parse";
export * from "./format/schema";
export * from "./format/serialize";
export * from "./format/options";
export * from "./format/ids";
export * from "./format/migrate";
export * from "./format/load";
export * as v0 from "./v0/index";

// Queries over a document: the index every query takes, and the text of labels
export * from "./model/doc-index";
export * from "./model/labels";

// The design rule check: the one validity gate
export * from "./check/index";

// Running a machine: the contract every executable form shares, the reference interpreter, conformance traces
export * from "./runtime/contract";
export * from "./interp/interpreter";
export * from "./interp/trace";

// Generating code: one entry point for every language
export * from "./backends/common";
export * from "./backends/generate";
