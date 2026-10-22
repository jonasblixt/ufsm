// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  installerOf,
  isReleaseAsset,
  manifest,
  stage,
  updaterArch,
  updaterOs,
  writeManifest,
  type UpdaterRecord,
} from "../scripts/release-assets";

/** A fake `target/release/bundle` folder: path -> contents (a `.sig` next to an installer = signed). */
function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-bundle-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const out = (): string => join(mkdtempSync(join(tmpdir(), "ufsm-assets-")), "out");

describe("release assets", () => {
  it("know the installers and the updater's names for OS and CPU", () => {
    assert.equal(installerOf("uFSM_0.9.0_x64-setup.exe"), "nsis");
    assert.equal(installerOf("uFSM_0.9.0_x64_en-US.msi"), "msi");
    assert.equal(installerOf("uFSM.app.tar.gz"), "app");
    assert.equal(installerOf("uFSM_0.9.0_amd64.AppImage"), "appimage");
    assert.equal(installerOf("uFSM_0.9.0_amd64.deb"), "deb");
    assert.equal(installerOf("uFSM_0.9.0_aarch64.dmg"), undefined, "the dmg is for people, not the updater");
    assert.ok(isReleaseAsset("uFSM_0.9.0_aarch64.dmg"));
    assert.ok(isReleaseAsset("uFSM.app.tar.gz"));
    assert.ok(!isReleaseAsset("uFSM_0.9.0_amd64.deb.sig"));
    assert.ok(!isReleaseAsset("uFSM-0.9.0-1.x86_64.rpm"), "no rpm, as before");
    assert.equal(updaterOs("win32"), "windows");
    assert.equal(updaterOs("darwin"), "darwin");
    assert.equal(updaterArch("x64"), "x86_64");
    assert.equal(updaterArch("arm64"), "aarch64");
    assert.throws(() => updaterOs("aix"));
  });

  it("stage the installers of a Windows build, with the signed ones recorded", () => {
    const dir = bundle({
      "nsis/uFSM_0.9.0_x64-setup.exe": "nsis",
      "nsis/uFSM_0.9.0_x64-setup.exe.sig": "SIG-NSIS\n",
      "msi/uFSM_0.9.0_x64_en-US.msi": "msi",
      "msi/uFSM_0.9.0_x64_en-US.msi.sig": "SIG-MSI",
    });
    const o = out();
    const r = stage(dir, o, "0.9.0", "win32", "x64");
    assert.deepEqual(r, {
      version: "0.9.0",
      assets: {
        "windows-x86_64-msi": { file: "uFSM_0.9.0_x64_en-US.msi", signature: "SIG-MSI" },
        "windows-x86_64-nsis": { file: "uFSM_0.9.0_x64-setup.exe", signature: "SIG-NSIS" },
      },
    });
    assert.deepEqual(readdirSync(o).sort(), [
      "uFSM_0.9.0_x64-setup.exe",
      "uFSM_0.9.0_x64-setup.exe.sig",
      "uFSM_0.9.0_x64_en-US.msi",
      "uFSM_0.9.0_x64_en-US.msi.sig",
      "updater-windows-x86_64.json",
    ]);
    assert.deepEqual(JSON.parse(readFileSync(join(o, "updater-windows-x86_64.json"), "utf8")), r);
  });

  it("name the macOS archive after the version and CPU, and skip what is inside the .app", () => {
    const dir = bundle({
      "macos/uFSM.app/Contents/MacOS/ufsm-editor": "binary",
      "macos/uFSM.app/Contents/Resources/odd.exe": "never copied",
      "macos/uFSM.app.tar.gz": "tgz",
      "macos/uFSM.app.tar.gz.sig": "SIG-APP",
      "dmg/uFSM_0.9.0_aarch64.dmg": "dmg",
    });
    const o = out();
    const r = stage(dir, o, "0.9.0", "darwin", "arm64");
    assert.deepEqual(r.assets, {
      "darwin-aarch64-app": { file: "uFSM_0.9.0_aarch64.app.tar.gz", signature: "SIG-APP" },
    });
    assert.deepEqual(readdirSync(o).sort(), [
      "uFSM_0.9.0_aarch64.app.tar.gz",
      "uFSM_0.9.0_aarch64.app.tar.gz.sig",
      "uFSM_0.9.0_aarch64.dmg",
      "updater-darwin-aarch64.json",
    ]);
  });

  it("copy unsigned installers but record nothing (a build without the signing key)", () => {
    const dir = bundle({ "deb/uFSM_0.9.0_amd64.deb": "deb", "appimage/uFSM_0.9.0_amd64.AppImage": "ai" });
    const o = out();
    assert.deepEqual(stage(dir, o, "0.9.0", "linux", "x64").assets, {});
    assert.deepEqual(readdirSync(o).sort(), [
      "uFSM_0.9.0_amd64.AppImage",
      "uFSM_0.9.0_amd64.deb",
      "updater-linux-x86_64.json",
    ]);
  });

  it("leave out what a build of another version left in the bundle folder", () => {
    const dir = bundle({
      "nsis/uFSM_0.6.0_x64-setup.exe": "old",
      "nsis/uFSM_0.8.0_x64-setup.exe": "older signed",
      "nsis/uFSM_0.8.0_x64-setup.exe.sig": "SIG-OLD",
      "nsis/uFSM_0.9.0_x64-setup.exe": "nsis",
      "nsis/uFSM_0.9.0_x64-setup.exe.sig": "SIG-NSIS",
      "msi/uFSM_0.6.0_x64_en-US.msi": "old",
    });
    const o = out();
    const r = stage(dir, o, "0.9.0", "win32", "x64");
    assert.deepEqual(r.assets, {
      "windows-x86_64-nsis": { file: "uFSM_0.9.0_x64-setup.exe", signature: "SIG-NSIS" },
    });
    assert.deepEqual(readdirSync(o).sort(), [
      "uFSM_0.9.0_x64-setup.exe",
      "uFSM_0.9.0_x64-setup.exe.sig",
      "updater-windows-x86_64.json",
    ]);
  });

  it("refuse names that would not survive as a URL", () => {
    const dir = bundle({ "nsis/u FSM_0.9.0_x64-setup.exe": "x" });
    assert.throws(() => stage(dir, out(), "0.9.0", "win32", "x64"), /would not survive/);
  });
});

describe("latest.json", () => {
  const records: UpdaterRecord[] = [
    {
      version: "0.9.0",
      assets: {
        "windows-x86_64-nsis": { file: "uFSM_0.9.0_x64-setup.exe", signature: "S1" },
        "windows-x86_64-msi": { file: "uFSM_0.9.0_x64_en-US.msi", signature: "S2" },
      },
    },
    {
      version: "0.9.0",
      assets: { "darwin-aarch64-app": { file: "uFSM_0.9.0_aarch64.app.tar.gz", signature: "S3" } },
    },
    {
      version: "0.9.0",
      assets: {
        "linux-x86_64-deb": { file: "uFSM_0.9.0_amd64.deb", signature: "S4" },
        "linux-x86_64-appimage": { file: "uFSM_0.9.0_amd64.AppImage", signature: "S5" },
      },
    },
  ];
  const date = new Date(Date.UTC(2026, 9, 14, 6, 30, 0, 123));

  it("lists every installer by platform key, plus a plain key per OS", () => {
    const latest = manifest(records, "v0.9.0", "jonasblixt/ufsm", date);
    const url = (f: string) => `https://github.com/jonasblixt/ufsm/releases/download/v0.9.0/${f}`;
    assert.deepEqual(latest, {
      version: "0.9.0",
      notes: "See the release notes: https://github.com/jonasblixt/ufsm/releases/tag/v0.9.0",
      pub_date: "2026-10-14T06:30:00Z",
      platforms: {
        "darwin-aarch64": { url: url("uFSM_0.9.0_aarch64.app.tar.gz"), signature: "S3" },
        "darwin-aarch64-app": { url: url("uFSM_0.9.0_aarch64.app.tar.gz"), signature: "S3" },
        "linux-x86_64": { url: url("uFSM_0.9.0_amd64.AppImage"), signature: "S5" },
        "linux-x86_64-appimage": { url: url("uFSM_0.9.0_amd64.AppImage"), signature: "S5" },
        "linux-x86_64-deb": { url: url("uFSM_0.9.0_amd64.deb"), signature: "S4" },
        "windows-x86_64": { url: url("uFSM_0.9.0_x64-setup.exe"), signature: "S1" },
        "windows-x86_64-msi": { url: url("uFSM_0.9.0_x64_en-US.msi"), signature: "S2" },
        "windows-x86_64-nsis": { url: url("uFSM_0.9.0_x64-setup.exe"), signature: "S1" },
      },
    });
  });

  it("refuses installers of another version or two for one key", () => {
    assert.throws(() => manifest(records, "v0.9.1", "jonasblixt/ufsm", date), /built as 0\.9\.0, the tag is v0\.9\.1/);
    assert.throws(
      () => manifest([records[0]!, records[0]!], "v0.9.0", "jonasblixt/ufsm", date),
      /two installers for windows-x86_64-/,
    );
  });

  it("is written from the staged records, which are removed; not at all without a signed installer", () => {
    const dir = mkdtempSync(join(tmpdir(), "ufsm-dist-"));
    records.forEach((r, i) => writeFileSync(join(dir, `updater-${i}.json`), JSON.stringify(r)));
    writeFileSync(join(dir, "uFSM_0.9.0_amd64.deb"), "deb");
    const latest = writeManifest(dir, "v0.9.0", "jonasblixt/ufsm", date);
    assert.equal(Object.keys(latest!.platforms).length, 8);
    assert.deepEqual(readdirSync(dir).sort(), ["latest.json", "uFSM_0.9.0_amd64.deb"]);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")), latest);

    const unsigned = mkdtempSync(join(tmpdir(), "ufsm-dist-"));
    writeFileSync(join(unsigned, "updater-linux-x86_64.json"), JSON.stringify({ version: "0.9.0", assets: {} }));
    assert.equal(writeManifest(unsigned, "v0.9.0", "jonasblixt/ufsm", date), undefined);
    assert.deepEqual(readdirSync(unsigned), []);
    assert.ok(!existsSync(join(unsigned, "latest.json")));
  });
});
