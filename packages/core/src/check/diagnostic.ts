// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** What the design rule check reports. */
import type { Id } from "../format/model";

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** Stable identifier for tests and filtering, e.g. "dangling-ref". */
  code: string;
  message: string;
  /** Element the diagnostic is about, when there is one. */
  id?: Id;
}
