// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** What the design rule check reports. */
import type { Id } from "../format/model";

/** `info`: nothing wrong, but worth listing (a note marked TODO). */
export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  /** Stable identifier for tests and filtering, e.g. "dangling-ref". */
  code: string;
  message: string;
  /** Element the diagnostic is about, when there is one. */
  id?: Id;
}
