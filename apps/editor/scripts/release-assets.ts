// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Release assets for the editor, run by CI (.github/workflows/ci.yml) with plain `node` (Node 24 strips the types; so
 * only erasable TypeScript and `node:` imports here):
 *
 *   node apps/editor/scripts/release-assets.ts stage <bundle-dir> <out-dir> --version <x.y.z>
 *     after `npm run build` on each OS: copies the installers to <out-dir>, and for every installer the updater can
 *     install (it has a `.sig` next to it, made when the build had the signing key) records its platform key and
 *     signature in <out-dir>/updater-<os>-<arch>.json.
 *
 *   node apps/editor/scripts/release-assets.ts manifest <dir> --tag v<x.y.z> --repo <owner/name>
 *     in the release job, over the merged outputs of every OS: writes <dir>/latest.json, the file the app's updater
 *     reads from `releases/latest/download/latest.json`, and removes the per-OS records. Without any signed installer
 *     (no signing key in CI) it writes nothing and the release has no update.
 *
 * Platform keys are `<os>-<arch>-<installer>` (`windows-x86_64-nsis`): tauri-plugin-updater looks for that first, so an
 * app installed from the MSI updates from the MSI and one from a .deb from a .deb. The plain `<os>-<arch>` key is its
 * fallback and points at the NSIS installer, the macOS app and the AppImage.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export type Installer = "nsis" | "msi" | "app" | "appimage" | "deb";

/** What one OS build contributes to latest.json. */
export interface UpdaterRecord {
  version: string;
  /** Platform key -> the asset's file name and its signature (the text of the `.sig` file). */
  assets: Record<string, { file: string; signature: string }>;
}

export interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { url: string; signature: string }>;
}

/** The files `npm run build` makes that are release assets (the updater's macOS archive among them). */
export function isReleaseAsset(file: string): boolean {
  return /\.(msi|exe|dmg|AppImage|deb)$/.test(file) || file.endsWith(".app.tar.gz");
}

/** The installer an asset is, as tauri-plugin-updater names it, or undefined when the updater cannot install it. */
export function installerOf(file: string): Installer | undefined {
  if (file.endsWith(".app.tar.gz")) return "app";
  if (file.endsWith("-setup.exe")) return "nsis";
  if (file.endsWith(".msi")) return "msi";
  if (file.endsWith(".AppImage")) return "appimage";
  if (file.endsWith(".deb")) return "deb";
  return undefined;
}

/** The updater's name for an OS (`process.platform`). */
export function updaterOs(platform: string): string {
  const os = { win32: "windows", darwin: "darwin", linux: "linux" }[platform];
  if (!os) throw new Error(`no updater for the platform ${platform}`);
  return os;
}

/** The updater's name for a CPU (`process.arch`). */
export function updaterArch(arch: string): string {
  const a = { x64: "x86_64", arm64: "aarch64", ia32: "i686", arm: "armv7" }[arch];
  if (!a) throw new Error(`no updater for the architecture ${arch}`);
  return a;
}

/** The installer the plain `<os>-<arch>` key points at. */
const FALLBACK: Record<string, Installer> = { windows: "nsis", darwin: "app", linux: "appimage" };

/** Asset names go into URLs as they are: keep to what GitHub never renames. */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** Every file under `dir`, recursively, but not inside a macOS `.app` bundle or a Linux `.AppDir`. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) return [path];
    return /\.(app|AppDir)$/.test(name) ? [] : walk(path);
  });
}

/**
 * Copy the release assets found under `bundleDir` into `outDir` and return the updater record (assets without a
 * signature are copied but not recorded). Only assets of `version` are taken: the bundler never removes what an
 * earlier build of another version left there. The macOS archive is named `uFSM.app.tar.gz` by the bundler (each build
 * overwrites it); it is renamed to `uFSM_<version>_<arch>.app.tar.gz` so builds for two architectures cannot collide.
 */
export function stage(
  bundleDir: string,
  outDir: string,
  version: string,
  platform: string = process.platform,
  arch: string = process.arch,
): UpdaterRecord {
  const os = updaterOs(platform);
  const cpu = updaterArch(arch);
  mkdirSync(outDir, { recursive: true });
  const record: UpdaterRecord = { version, assets: {} };
  for (const path of walk(bundleDir)
    .filter((p) => isReleaseAsset(basename(p)))
    .sort()) {
    const installer = installerOf(basename(path));
    if (installer !== "app" && !basename(path).includes(`_${version}_`)) continue;
    const name = installer === "app" ? `${basename(path, ".app.tar.gz")}_${version}_${cpu}.app.tar.gz` : basename(path);
    if (!SAFE_NAME.test(name)) throw new Error(`release asset name ${name} would not survive as a URL`);
    if (existsSync(join(outDir, name))) throw new Error(`two release assets are called ${name}`);
    copyFileSync(path, join(outDir, name));
    if (!installer || !existsSync(`${path}.sig`)) continue;
    const key = `${os}-${cpu}-${installer}`;
    if (record.assets[key]) throw new Error(`two ${installer} installers for ${os}-${cpu}`);
    const signature = readFileSync(`${path}.sig`, "utf8").trim();
    writeFileSync(join(outDir, `${name}.sig`), `${signature}\n`);
    record.assets[key] = { file: name, signature };
  }
  writeFileSync(join(outDir, `updater-${os}-${cpu}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** latest.json from the records of every OS build. */
export function manifest(records: readonly UpdaterRecord[], tag: string, repo: string, date: Date): LatestJson {
  const version = tag.replace(/^v/, "");
  const platforms: LatestJson["platforms"] = {};
  for (const r of records) {
    if (r.version !== version) throw new Error(`an installer was built as ${r.version}, the tag is ${tag}`);
    for (const [key, a] of Object.entries(r.assets)) {
      if (platforms[key]) throw new Error(`two installers for ${key}`);
      if (!SAFE_NAME.test(a.file)) throw new Error(`release asset name ${a.file} would not survive as a URL`);
      platforms[key] = { url: `https://github.com/${repo}/releases/download/${tag}/${a.file}`, signature: a.signature };
    }
  }
  // The plain <os>-<arch> keys, for an app that does not know how it was installed.
  for (const key of Object.keys(platforms)) {
    const [os, arch, installer] = key.split("-");
    const plain = `${os}-${arch}`;
    if (installer === FALLBACK[os!] && !platforms[plain]) platforms[plain] = platforms[key]!;
  }
  const sorted = Object.fromEntries(Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)));
  return {
    version,
    notes: `See the release notes: https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: sorted,
  };
}

/**
 * Read and remove the `updater-*.json` records in `dir` and write `dir/latest.json`. Returns undefined (and writes
 * nothing) when no build was signed.
 */
export function writeManifest(dir: string, tag: string, repo: string, date = new Date()): LatestJson | undefined {
  const files = readdirSync(dir).filter((f) => /^updater-.*\.json$/.test(f));
  const records = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as UpdaterRecord);
  for (const f of files) rmSync(join(dir, f));
  if (records.every((r) => Object.keys(r.assets).length === 0)) return undefined;
  const latest = manifest(records, tag, repo, date);
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
  return latest;
}

function option(args: string[], name: string): string {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

function main(args: string[]): void {
  const [cmd, a, b] = args;
  if (cmd === "stage" && a && b) {
    const r = stage(a, b, option(args, "--version"));
    const keys = Object.keys(r.assets);
    console.log(keys.length ? `updater: ${keys.join(", ")}` : "updater: no signed installers (no signing key)");
  } else if (cmd === "manifest" && a) {
    const latest = writeManifest(a, option(args, "--tag"), option(args, "--repo"));
    console.log(
      latest
        ? `latest.json: ${latest.version} for ${Object.keys(latest.platforms).join(", ")}`
        : "no signed installers: no latest.json, this release does not update installed apps",
    );
  } else {
    throw new Error(
      "usage: release-assets.ts stage <bundle-dir> <out-dir> --version <v> | manifest <dir> --tag <t> --repo <r>",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
