// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { UfsmFormatError } from "./errors";
import { parseV0 } from "../v0/parse";
import { migrateV0, type MigrationNote } from "./migrate";
import type { UfsmDocument } from "./model";
import { readV1 } from "./parse";

export interface LoadedModel {
  doc: UfsmDocument;
  /** Format version of the file on disk. 0 means it was converted while loading. */
  sourceVersion: 0 | 1;
  /** What the v0 conversion changed; empty for v1 files. */
  notes: MigrationNote[];
}

/** Load a model file of any supported version. v0 files are converted to v1 in memory. */
export function loadModel(text: string): LoadedModel {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UfsmFormatError("", `not valid JSON (${(e as Error).message})`);
  }
  const o = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (o["format"] === "ufsm") return { doc: readV1(data), sourceVersion: 1, notes: [] };
  if (o["kind"] === "uFSM Model") {
    const { doc, notes } = migrateV0(parseV0(text));
    return { doc, sourceVersion: 0, notes };
  }
  throw new UfsmFormatError("", "not a uFSM model (expected \"format\": \"ufsm\", or a legacy \"kind\": \"uFSM Model\" file)");
}
