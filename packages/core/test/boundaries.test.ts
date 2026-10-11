// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The layering rules of docs/architecture.md, checked on every import: which folder of @ufsm/core may use which, core
 * stays platform neutral, backends never import each other, the editor reaches the host only through platform.ts,
 * and the editor and the CLI use core through its entry points only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const coreSrc = join(repoRoot, "packages/core/src");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** Every import and re-export specifier of a file (static and dynamic). */
function imports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [
    ...text.matchAll(
      /(?:^|\n)\s*(?:import|export)\b[^"';]*?from\s*"([^"]+)"|import\(\s*"([^"]+)"\s*\)|(?:^|\n)\s*import\s+"([^"]+)"/g,
    ),
  ].map((m) => m[1] ?? m[2] ?? m[3]!);
}

/** The folder of core a source file lies in ("format", "ir", ...; "version" for version.ts, "" for the entry files). */
const folderOf = (file: string): string => {
  const rel = relative(coreSrc, file).split(sep);
  return rel.length > 1 ? rel[0]! : rel[0] === "version.ts" ? "version" : "";
};

/** Which core folders each folder may import (itself always). Entry files at the top may import anything. */
const ALLOWED: Record<string, string[]> = {
  format: [],
  v0: ["format"],
  model: ["format"],
  diagram: ["format", "model"],
  edit: ["format", "model", "diagram"],
  check: ["format", "model"],
  semantics: ["format", "model"],
  runtime: ["format"],
  interp: ["format", "model", "check", "semantics", "runtime"],
  ir: ["format", "semantics"],
  backends: ["format", "model", "check", "semantics", "ir", "runtime", "version"],
  verify: ["format", "semantics", "ir", "runtime"],
};

/** Files allowed one more folder than their folder is, with the reason. */
const EXCEPTIONS: Record<string, { folders: string[]; why: string }> = {
  "format/migrate.ts": {
    folders: ["v0", "model", "diagram"],
    why: "the v0 converter picks the paper the drawing fits on",
  },
  "format/load.ts": { folders: ["v0"], why: "reading a file of either version" },
  "check/diagram.ts": { folders: ["diagram"], why: "the diagram rules measure the layout" },
};

describe("import boundaries", () => {
  const coreFiles = walk(coreSrc);

  it("core folders import only the layers below them", () => {
    const problems: string[] = [];
    for (const file of coreFiles) {
      const from = folderOf(file);
      if (from === "" || from === "version") continue;
      const rel = relative(coreSrc, file).split(sep).join("/");
      const allowed = new Set([from, ...(ALLOWED[from] ?? []), ...(EXCEPTIONS[rel]?.folders ?? [])]);
      for (const spec of imports(file)) {
        if (!spec.startsWith(".")) continue;
        const target = normalize(join(dirname(file), spec));
        const to = folderOf(target.endsWith(".ts") ? target : `${target}.ts`);
        if (!allowed.has(to)) problems.push(`${rel} imports ${spec} (${to || "an entry file"})`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it("core is platform neutral: no Node modules, no packages but typebox, no DOM", () => {
    const problems: string[] = [];
    for (const file of coreFiles) {
      const rel = relative(coreSrc, file);
      for (const spec of imports(file))
        if (!spec.startsWith(".") && spec !== "typebox" && !spec.startsWith("typebox/"))
          problems.push(`${rel} imports ${spec}`);
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (/\b(?:window|document|navigator|localStorage)\s*\./.test(text)) problems.push(`${rel} uses a DOM global`);
    }
    assert.deepEqual(problems, []);
  });

  it("a backend imports no other backend, only backends/common.ts", () => {
    const printers = ["c", "python", "ts", "rust", "go", "cpp"];
    const problems: string[] = [];
    for (const p of printers) {
      const file = join(coreSrc, "backends", `${p}.ts`);
      for (const spec of imports(file)) {
        const target = normalize(join(dirname(file), spec));
        if (printers.some((q) => target === join(coreSrc, "backends", q)))
          problems.push(`backends/${p}.ts imports ${spec}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it("the editor reaches the host (Tauri) only through platform.ts", () => {
    const editor = join(repoRoot, "apps/editor/src");
    const problems = walk(editor)
      .filter((f) => !f.endsWith(`${sep}platform.ts`))
      .flatMap((f) =>
        imports(f)
          .filter((s) => s.startsWith("@tauri-apps/"))
          .map((s) => `${relative(editor, f)} imports ${s}`),
      );
    assert.deepEqual(problems, []);
  });

  it("the editor and the CLI use core through its entry points", () => {
    const entries = new Set(
      Object.keys(JSON.parse(readFileSync(join(repoRoot, "packages/core/package.json"), "utf8")).exports).map(
        (k) => `@ufsm/core${k.slice(1)}`,
      ),
    );
    const problems = [
      join(repoRoot, "apps/editor/src"),
      join(repoRoot, "apps/editor/test"),
      join(repoRoot, "packages/cli/src"),
    ]
      .flatMap((d) => walk(d))
      .flatMap((f) =>
        imports(f)
          .filter((s) => s.startsWith("@ufsm/core") && !entries.has(s))
          .map((s) => `${relative(repoRoot, f)} imports ${s}`),
      );
    assert.deepEqual(problems, []);
  });
});
