// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The code generator's output folder (`targets.<name>.out`): stored relative to the model's file with `/`, or
 * absolute. These turn a folder picked in a dialog into the stored form and back into a path to show (no DOM, tested).
 * The desktop shell resolves the folder itself when it writes (write_generated in main.rs).
 */

const isWindowsPath = (p: string): boolean => /^[A-Za-z]:|\\/.test(p);

/** Is `out` absolute (`/x`, `C:/x`, `C:\x`, `\\server\x`)? */
export function isAbsoluteOut(out: string): boolean {
  return /^([A-Za-z]:)?[\\/]/.test(out);
}

/** The parts of a path, with `.` and `..` resolved; the first part of an absolute path is its root ("" or "C:"). */
function parts(path: string): string[] {
  const out: string[] = [];
  path.split(/[\\/]+/).forEach((x, i) => {
    if (x === "" && i === 0) out.push("");
    else if (x === "" || x === ".") return;
    else if (x !== "..") out.push(x);
    else if (out.length === 1 && i > 0 && isRoot(out[0]!))
      return; // nothing above the root
    else if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(x);
  });
  return out;
}

const isRoot = (x: string): boolean => x === "" || /^[A-Za-z]:$/.test(x);

/**
 * How to store `dir` (a folder picked in a dialog) for the model at `modelPath`: relative to the model's folder with
 * `/` (`.` for the folder itself), or absolute with `/` when it is on another drive.
 */
export function relativeOut(modelPath: string, dir: string): string {
  const windows = isWindowsPath(modelPath) || isWindowsPath(dir);
  const same = (x: string, y: string): boolean => (windows ? x.toLowerCase() === y.toLowerCase() : x === y);
  const a = parts(modelPath).slice(0, -1);
  const b = parts(dir);
  if (a.length === 0 || b.length === 0 || !same(a[0]!, b[0]!)) return b.join("/") || "/";
  let i = 0;
  while (i < a.length && i < b.length && same(a[i]!, b[i]!)) i++;
  return [...Array<string>(a.length - i).fill(".."), ...b.slice(i)].join("/") || ".";
}

/** The folder `out` names for the model at `modelPath`, written with the model path's separator (for showing it). */
export function resolveOut(modelPath: string, out: string): string {
  const sep = modelPath.includes("\\") ? "\\" : "/";
  const joined = isAbsoluteOut(out) ? out : `${parts(modelPath).slice(0, -1).join("/")}/${out}`;
  const p = parts(joined);
  return p.length === 1 && isRoot(p[0]!) ? p[0]! + sep : p.join(sep);
}
