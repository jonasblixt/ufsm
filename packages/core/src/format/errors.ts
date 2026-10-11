// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** Thrown when a file is not a structurally valid model. `path` is a JSON path like `machine.root.states[2].name`. */
export class UfsmFormatError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "UfsmFormatError";
    this.path = path;
  }
}
