// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Names of machines made with File › New (no DOM, tested). A new machine is called "untitled" ("untitled2", ...
 * while those file names are open); its first save names it after the file, unless it was renamed in the meantime.
 */

/** Placeholder machine name for a new machine, given the file names of the open machines. */
export function untitledName(openFileNames: Iterable<string>): string {
  const taken = new Set([...openFileNames].map((f) => f.toLowerCase()));
  let name = "untitled";
  for (let n = 2; taken.has(`${name}.ufsm`); n++) name = `untitled${n}`;
  return name;
}

/**
 * The machine name a save gives: the file's base name without `.ufsm` when the machine still has its placeholder
 * name `untitled`; undefined (keep the name) for a machine that was renamed, was never untitled, or a name that would
 * be empty.
 */
export function nameOnSave(current: string, untitled: string | undefined, fileName: string): string | undefined {
  if (untitled === undefined || current !== untitled) return undefined;
  const name = fileName.replace(/\.ufsm$/i, "").trim();
  return name && name !== current ? name : undefined;
}
