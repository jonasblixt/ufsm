// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * @ufsm/core/edit: edits on a document. Every function mutates the document it is given (an Immer draft in the
 * editor) and rebuilds what it needs from it; queries take a DocIndex instead.
 */
export * from "./layout";
export * from "./create";
export * from "./clipboard";
export * from "./props";
export * from "./annotations";
