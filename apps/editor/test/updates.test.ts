// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UpdateMode } from "../src/settings";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  Updater,
  errorText,
  percent,
  phaseText,
  plainVersion,
  sizeText,
  statusItem,
  type UpdateHost,
  type UpdateInfo,
  type UpdateSupport,
} from "../src/updates";

/** A clock whose timers run when the test says so. */
class FakeClock {
  t = Date.UTC(2026, 9, 14, 8, 0);
  timers: { at: number; fn: () => void; live: boolean }[] = [];
  now = (): Date => new Date(this.t);
  after = (ms: number, fn: () => void): (() => void) => {
    const timer = { at: this.t + ms, fn, live: true };
    this.timers.push(timer);
    return () => void (timer.live = false);
  };
  /** Waiting timers, as delays from now. */
  pending(): number[] {
    return this.timers.filter((x) => x.live).map((x) => x.at - this.t);
  }
  /** Move the clock on by `ms`, running what falls due. */
  advance(ms: number): void {
    this.t += ms;
    for (const x of this.timers) {
      if (x.live && x.at <= this.t) {
        x.live = false;
        x.fn();
      }
    }
  }
}

/** The phase's kind (a function, so that one assertion does not narrow the next). */
const kind = (r: Rig): string => r.updater.phase.kind;

/** Let the updater's awaits run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

interface Rig {
  updater: Updater;
  clock: FakeClock;
  calls: string[];
  said: string[];
  changes: number;
  /** Every phase announced, as "kind" or "downloading n/total". */
  phases: string[];
  setMode(m: UpdateMode): void;
  /** What the next check finds, or throws. */
  next: { found?: UpdateInfo; error?: string };
  /** The next download fails with this. */
  downloadError?: string;
  /** The answer to "discard unsaved changes?" */
  confirm: boolean;
}

/** `support` null: the browser build. */
function rig(support: UpdateSupport | null = { configured: true, development: false, version: "0.8.0" }): Rig {
  let mode: UpdateMode = "auto";
  const clock = new FakeClock();
  const r = {
    clock,
    calls: [] as string[],
    said: [] as string[],
    changes: 0,
    phases: [] as string[],
    next: {} as { found?: UpdateInfo; error?: string },
    confirm: true,
    setMode: (m: UpdateMode) => void (mode = m),
  } as Partial<Rig> as Rig;
  const host: UpdateHost = {
    support: async () => support ?? undefined,
    check: async () => {
      r.calls.push("check");
      if (r.next.error) throw new Error(r.next.error);
      return r.next.found;
    },
    download: async (progress) => {
      r.calls.push("download");
      if (r.downloadError) throw new Error(r.downloadError);
      progress(0, 1000);
      progress(400, 1000);
      progress(1000, 1000);
    },
    install: async () => void r.calls.push("install"),
  };
  r.updater = new Updater({
    host,
    clock,
    mode: () => mode,
    changed: () => {
      r.changes++;
      const p = r.updater.phase;
      r.phases.push(p.kind === "downloading" ? `downloading ${p.downloaded}/${p.total ?? "?"}` : p.kind);
    },
    say: (m) => void r.said.push(m),
    confirmRestart: async () => {
      r.calls.push("confirm");
      return r.confirm;
    },
  });
  return r;
}

describe("updates: helpers", () => {
  it("show versions, progress and sizes", () => {
    assert.equal(plainVersion("v0.9.0"), "0.9.0");
    assert.equal(plainVersion("0.9.0"), "0.9.0");
    assert.equal(percent(0, 1000), 0);
    assert.equal(percent(499, 1000), 49);
    assert.equal(percent(1000, 1000), 100);
    assert.equal(percent(2000, 1000), 100);
    assert.equal(percent(10, undefined), undefined, "no size known");
    assert.equal(percent(10, 0), undefined);
    assert.equal(sizeText(10), "1 kB");
    assert.equal(sizeText(640 * 1024), "640 kB");
    assert.equal(sizeText(5.25 * 1024 * 1024), "5.3 MB");
    assert.equal(errorText(new Error("Error: offline\nmore")), "offline");
    assert.equal(errorText("plain"), "plain");
    assert.equal(errorText(""), "unknown error");
  });

  it("put an item in the status bar only while downloading, ready or installing", () => {
    assert.equal(statusItem({ kind: "idle" }), undefined);
    assert.equal(statusItem({ kind: "current", checked: new Date() }), undefined);
    assert.equal(
      statusItem({ kind: "failed", message: "x", checked: new Date() }),
      undefined,
      "background failures are quiet",
    );
    assert.deepEqual(statusItem({ kind: "downloading", version: "0.9.0", downloaded: 250, total: 1000 }), {
      text: "Downloading update 25%",
      title: "Downloading uFSM 0.9.0 in the background",
      install: false,
    });
    assert.equal(statusItem({ kind: "downloading", version: "0.9.0", downloaded: 250 })!.text, "Downloading update");
    const ready = statusItem({ kind: "ready", version: "0.9.0", notes: "Fixes" })!;
    assert.equal(ready.text, "Restart to Update");
    assert.equal(ready.install, true);
    assert.match(ready.title, /0\.9\.0[\s\S]*Fixes/);
    assert.equal(statusItem({ kind: "installing", version: "0.9.0" })!.install, false);
  });

  it("describe every phase in one line", () => {
    const checked = new Date(2026, 9, 14, 9, 5);
    assert.equal(phaseText({ kind: "current", checked }), "Up to date (checked 09:05).");
    assert.equal(phaseText({ kind: "ready", version: "0.9.0" }), "uFSM 0.9.0 is ready. Restart to update.");
    assert.equal(
      phaseText({ kind: "downloading", version: "0.9.0", downloaded: 3 * 1024 * 1024 }),
      "Downloading uFSM 0.9.0… 3.0 MB",
    );
    assert.equal(phaseText({ kind: "failed", message: "offline", checked }), "Update failed at 09:05: offline");
    assert.equal(phaseText({ kind: "unsupported", reason: "Because." }), "Because.");
  });
});

describe("updates: the flow", () => {
  it("checks a little after start, downloads what it finds and waits for a restart", async () => {
    const r = rig();
    r.next = { found: { version: "v0.9.0", notes: " Fixes things \n" } };
    await r.updater.start();
    assert.equal(r.updater.version, "0.8.0");
    assert.deepEqual(r.clock.pending(), [FIRST_CHECK_DELAY_MS]);
    assert.deepEqual(r.calls, [], "nothing at once");
    r.clock.advance(FIRST_CHECK_DELAY_MS);
    await settle();
    assert.deepEqual(r.calls, ["check", "download"]);
    assert.deepEqual(r.updater.phase, { kind: "ready", version: "0.9.0", notes: "Fixes things" });
    assert.deepEqual(r.said, [], "a background check says nothing in the status line");
    assert.deepEqual(r.clock.pending(), [], "no more checks once an update is ready");
    assert.equal(r.updater.canCheck(), false);
  });

  it("checks again every few hours while up to date, and after a failure", async () => {
    const r = rig();
    await r.updater.start();
    r.clock.advance(FIRST_CHECK_DELAY_MS);
    await settle();
    assert.equal(kind(r), "current");
    assert.deepEqual(r.clock.pending(), [CHECK_INTERVAL_MS]);
    r.next = { error: "Could not fetch a valid release JSON from the remote" };
    r.clock.advance(CHECK_INTERVAL_MS);
    await settle();
    assert.equal(kind(r), "failed");
    assert.match(phaseText(r.updater.phase), /could not check for updates: Could not fetch/);
    assert.deepEqual(r.said, []);
    assert.deepEqual(r.clock.pending(), [CHECK_INTERVAL_MS]);
    r.next = { found: { version: "0.9.0" } };
    r.clock.advance(CHECK_INTERVAL_MS);
    await settle();
    assert.equal(kind(r), "ready");
    assert.deepEqual(r.calls, ["check", "check", "check", "download"]);
  });

  it("announces every step, the download's progress too", async () => {
    const r = rig();
    r.next = { found: { version: "0.9.0" } };
    await r.updater.start();
    r.phases.length = 0;
    await r.updater.check(false);
    assert.deepEqual(r.phases, [
      "checking",
      "downloading 0/?",
      "downloading 0/1000",
      "downloading 400/1000",
      "downloading 1000/1000",
      "ready",
    ]);
  });

  it("checks only when asked with updates set to manual, and says what it found", async () => {
    const r = rig();
    r.setMode("manual");
    await r.updater.start();
    assert.deepEqual(r.clock.pending(), [], "no automatic check");
    await r.updater.check(true);
    assert.deepEqual(r.said, ["uFSM 0.8.0 is the newest version."]);
    assert.deepEqual(r.clock.pending(), []);
    r.next = { found: { version: "0.9.0" } };
    await r.updater.check(true);
    assert.deepEqual(r.said.slice(1), [
      "Downloading uFSM 0.9.0…",
      "uFSM 0.9.0 is ready: restart to update (status bar or Help menu).",
    ]);
    await r.updater.check(true);
    assert.equal(r.said[3], "uFSM 0.9.0 is ready: Help › Restart to Update.");
    assert.deepEqual(r.calls, ["check", "check", "download"], "no check once ready");
  });

  it("starts and stops automatic checks when the setting changes", async () => {
    const r = rig();
    r.setMode("manual");
    await r.updater.start();
    r.setMode("auto");
    r.updater.modeChanged();
    assert.deepEqual(r.clock.pending(), [FIRST_CHECK_DELAY_MS]);
    r.setMode("manual");
    r.updater.modeChanged();
    assert.deepEqual(r.clock.pending(), []);
    r.clock.advance(CHECK_INTERVAL_MS);
    await settle();
    assert.deepEqual(r.calls, []);
  });

  it("reports a failed check or download only when asked", async () => {
    const r = rig();
    r.setMode("manual");
    await r.updater.start();
    r.next = { error: "offline" };
    await r.updater.check(true);
    assert.deepEqual(r.said, ["Update could not check for updates: offline"]);
    r.next = { found: { version: "0.9.0" } };
    r.downloadError = "The signature verification failed";
    await r.updater.check(true);
    assert.equal(r.said[2], "Update could not download uFSM 0.9.0: The signature verification failed");
    assert.equal(kind(r), "failed");
    assert.equal(r.updater.canCheck(), true, "a failed download can be checked again");
  });

  it("installs only after asking about unsaved changes", async () => {
    const r = rig();
    r.next = { found: { version: "0.9.0" } };
    await r.updater.start();
    await r.updater.install();
    assert.deepEqual(r.calls, [], "nothing to install yet");
    await r.updater.check(false);
    r.confirm = false;
    await r.updater.install();
    assert.deepEqual(r.calls.slice(2), ["confirm"]);
    assert.equal(kind(r), "ready", "kept the app running");
    r.confirm = true;
    await r.updater.install();
    assert.deepEqual(r.calls.slice(2), ["confirm", "confirm", "install"]);
    assert.deepEqual(r.updater.phase, { kind: "installing", version: "0.9.0" });
  });

  it("does not update a build without the key, the browser build or a development build by itself", async () => {
    const noKey = rig({ configured: false, development: false, version: "0.8.0" });
    await noKey.updater.start();
    assert.equal(kind(noKey), "unsupported");
    assert.deepEqual(noKey.clock.pending(), []);
    await noKey.updater.check(true);
    assert.match(noKey.said[0]!, /without the update key/);
    assert.deepEqual(noKey.calls, []);

    const browser = rig(null);
    await browser.updater.start();
    assert.deepEqual(browser.updater.phase, {
      kind: "unsupported",
      reason: "The browser build does not update itself.",
    });

    const dev = rig({ configured: true, development: true, version: "0.8.0" });
    await dev.updater.start();
    assert.equal(kind(dev), "idle");
    assert.deepEqual(dev.clock.pending(), [], "npm run dev does not check by itself");
    await dev.updater.check(true);
    assert.deepEqual(dev.calls, ["check"], "but checks when asked");
  });

  it("does nothing when asked to check before it has started", async () => {
    const r = rig();
    await r.updater.check(true);
    assert.deepEqual(r.calls, []);
    assert.equal(kind(r), "idle");
  });
});
