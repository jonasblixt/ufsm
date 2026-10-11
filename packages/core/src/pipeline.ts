// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * @ufsm/core/pipeline: the stages between a checked model and generated code (docs/architecture.md):
 * structure -> flat tables -> IR -> printers. For the CLI's `flatten` and `ir` commands, the tests and new backends;
 * applications generate code through generateFiles in the main entry.
 */
export * from "./semantics/structure";
export * from "./semantics/flatten";
export * from "./ir/ir";
export * from "./ir/lower";
export * from "./ir/analyze";
export * from "./ir/ids";
export * from "./ir/print";
export * from "./backends/c";
export * from "./backends/python";
export * from "./backends/ts";
export * from "./backends/rust";
export * from "./backends/go";
export * from "./backends/cpp";
