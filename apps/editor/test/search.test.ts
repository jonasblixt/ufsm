// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexV1, loadModel, type DocIndex } from "@ufsm/core";
import {
  elementItems,
  fuzzyMatch,
  helpItems,
  matchItem,
  menuCommands,
  parseQuery,
  remember,
  search,
  type SearchItem,
} from "../src/search";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const index = (f: string): DocIndex => indexV1(loadModel(readFileSync(join(repoRoot, f), "utf8")).doc);
const dimmer = index("examples/dimmer.ufsm");
const dhcp = index("examples/dhcpclient.ufsm");

const noop = (): void => undefined;
const commands: SearchItem[] = menuCommands([
  {
    label: "File",
    items: [
      { label: "New", keys: "Ctrl+N", run: noop },
      { label: "Open…", keys: "O", run: noop },
      "-",
      { label: "Save", keys: "S", run: noop, enabled: () => false },
    ],
  },
  {
    label: "Add",
    items: [
      { label: "State", keys: "A S", run: noop },
      { label: "Transition", keys: "A T", run: noop },
      { label: "Straight Transition", keys: "A L", run: noop },
      { label: "Region", keys: "A R", run: noop },
    ],
  },
  { label: "Run", items: [{ label: () => "Start Simulation", keys: "F5", run: noop }] },
]);
const settings: SearchItem[] = [
  { key: "set:theme:gruvbox", kind: "setting", label: "Preferences: Color Theme: Gruvbox", checked: true, run: noop },
  {
    key: "set:appearance:dark",
    kind: "setting",
    label: "Preferences: Appearance: Dark",
    keywords: "dark mode",
    run: noop,
  },
];

/** Two machines open: dimmer (key 1) and dhcpclient (key 2), plus a second dimmer (key 3) to compare equal names. */
const items: SearchItem[] = [
  ...elementItems(dimmer, 1, "dimmer.ufsm"),
  ...elementItems(dhcp, 2, "dhcpclient.ufsm"),
  ...elementItems(dimmer, 3, "dimmer2.ufsm"),
  { key: "machine:dimmer.ufsm", kind: "machine", label: "dimmer.ufsm", doc: 1, docName: "dimmer.ufsm", run: noop },
  {
    key: "machine:dhcpclient.ufsm",
    kind: "machine",
    label: "dhcpclient.ufsm",
    doc: 2,
    docName: "dhcpclient.ufsm",
    run: noop,
  },
  ...commands,
  ...settings,
  ...helpItems("dimmer.ufsm"),
];
const labels = (text: string, activeDoc: number | undefined = 1, recent: string[] = []): string[] =>
  search(items, text, { activeDoc, recent }).map((m) => m.item.label);
const rows = (text: string, activeDoc: number | undefined = 1, recent: string[] = []) =>
  search(items, text, { activeDoc, recent });

describe("search: fuzzy matching", () => {
  it("needs every character, in order, any case", () => {
    assert.ok(fuzzyMatch("rq", "Requesting"));
    assert.ok(fuzzyMatch("REQ", "Requesting"));
    assert.equal(fuzzyMatch("qr", "Requesting"), undefined);
    assert.equal(fuzzyMatch("requestingx", "Requesting"), undefined);
    assert.deepEqual(fuzzyMatch("", "x"), { score: 0, positions: [] });
  });

  it("starts scattered letters at a word start only; a whole run may start anywhere", () => {
    assert.ok(fuzzyMatch("rqst", "Requesting"));
    assert.equal(fuzzyMatch("eqst", "Requesting"), undefined);
    assert.deepEqual(fuzzyMatch("quest", "Requesting")!.positions, [2, 3, 4, 5, 6]);
  });

  it("matches the detail and hidden words only as whole runs", () => {
    const sys: SearchItem = {
      key: "s",
      kind: "setting",
      label: "Preferences: Appearance: System",
      keywords: "follow the operating system dark light mode",
    };
    assert.equal(matchItem(sys, "add tran"), undefined, "t-r-a-n spread over 'the operating' is no match");
    assert.ok(matchItem(sys, "dark"));
    const st: SearchItem = { key: "x", kind: "state", label: "10%", detail: "Broadcast Mode" };
    assert.equal(matchItem(st, "bm"), undefined);
    assert.deepEqual(matchItem(st, "mode")!.detailHits, [10, 11, 12, 13]);
  });

  it("prefers word starts and runs to scattered letters", () => {
    // "st" is the start of State, not the s of "Add" plus a later t
    assert.deepEqual(fuzzyMatch("st", "Add: State")!.positions, [5, 6]);
    // camelCase and snake_case words
    assert.deepEqual(fuzzyMatch("ob", "eOffButton")!.positions, [1, 4]);
    assert.deepEqual(fuzzyMatch("off", "lamp_off")!.positions, [5, 6, 7]);
    assert.deepEqual(fuzzyMatch("sb", "Straight Transition Broadcast")!.positions, [0, 20]);
    // a run at a word start beats the same letters spread out
    assert.ok(fuzzyMatch("tra", "Add: Transition")!.score > fuzzyMatch("tra", "Add: Straight")!.score);
  });

  it("classes a match: exact, prefix, words at word starts, anything else", () => {
    const st = (label: string): SearchItem => ({ key: label, kind: "state", label });
    assert.equal(matchItem(st("Requesting"), "requesting")!.tier, 3);
    assert.equal(matchItem(st("Requesting"), "req")!.tier, 2);
    assert.equal(
      matchItem({ key: "c", kind: "command", label: "Add: Transition" }, "trans")!.tier,
      2,
      "the name after the category counts as a prefix",
    );
    assert.equal(matchItem({ key: "c", kind: "command", label: "Add: Transition" }, "add: t")!.tier, 2);
    assert.equal(
      matchItem({ key: "c", kind: "command", label: "Add: Transition" }, "ad")!.tier,
      1,
      "the category alone does not",
    );
    assert.equal(matchItem({ key: "c", kind: "command", label: "Add: Straight Transition" }, "add tr")!.tier, 1);
    assert.equal(matchItem(st("Broadcast Mode"), "mode")!.tier, 1);
    assert.equal(matchItem(st("Requesting"), "rqst")!.tier, 0);
    assert.equal(matchItem(st("Requesting"), "zz"), undefined);
  });

  it("matches words in the detail and hidden keywords too, more weakly", () => {
    // "on 10": 10% is in state On
    const m = rows("on 10").find((r) => r.item.label === "10%" && r.item.doc === 1)!;
    assert.ok(m, "10% (in On) found by its parent's name");
    assert.deepEqual(m.labelHits, [0, 1]);
    assert.deepEqual(m.detailHits, [0, 1]);
    assert.ok(labels(">dark mode").includes("Preferences: Appearance: Dark"));
    // entry/exit actions are a state's hidden words: lamp_off finds Off, which calls it on entry
    const off = rows("lamp_off").map((r) => `${r.item.kind} ${r.item.label}`);
    assert.ok(off.includes("action lamp_off") && off.includes("state Off"), off.join(", "));
    assert.ok(off.indexOf("action lamp_off") < off.indexOf("state Off"), "the declaration's own name first");
  });
});

describe("search: elements of a machine", () => {
  const els = elementItems(dhcp, 7, "dhcpclient.ufsm");
  it("lists states with their parents, transitions with their ends, internal transitions and declarations", () => {
    const find = (label: string, kind: string): SearchItem | undefined =>
      els.find((e) => e.label === label && e.kind === kind);
    assert.equal(find("Requesting", "state")?.detail, "Broadcast Mode");
    assert.equal(find("Broadcast Mode", "state")?.detail, "");
    assert.equal(find("SELECT", "transition")?.detail, "Selecting → Requesting");
    assert.equal(find("initial → Init", "transition")?.detail, "", "a transition without a label is named by its ends");
    assert.equal(find("DHCPACK", "event")?.detail, "event");
    assert.equal(find("dhcp_check", "guard")?.detail, "guard");
    assert.ok(els.every((e) => e.doc === 7 && e.docName === "dhcpclient.ufsm" && e.id !== undefined));
    assert.equal(new Set(els.map((e) => e.key)).size, els.length, "keys are unique");
  });

  it("leaves out unnamed pseudo-states and the only region of a state", () => {
    assert.ok(!els.some((e) => e.kind === "pseudo"));
    assert.ok(!els.some((e) => e.kind === "region"), "converted files name every region 'New region'");
  });

  it("finds timers by name, with their label and state as detail", () => {
    const found = elementItems(index("tests/models/test_timers.ufsm"), 1, "test_timers.ufsm").filter(
      (e) => e.kind === "timer",
    );
    assert.deepEqual(
      found.map((e) => e.label),
      ["travel", "poll", "blink", "long"],
    );
    assert.equal(found[1]!.detail, "t/poll(every 100 ms, eTick) in P");
  });

  it("finds internal transitions, timers, off-page regions and named regions of states with several", () => {
    for (const f of readdirSync(join(repoRoot, "tests/models")).filter((x) => x.endsWith(".ufsm"))) {
      const ix = index(`tests/models/${f}`);
      const found = elementItems(ix, 1, f);
      assert.equal(found.filter((e) => e.kind === "internal").length, ix.internals.size, f);
      assert.equal(found.filter((e) => e.kind === "timer").length, ix.timers.size, f);
      for (const { region, owner } of ix.regions.values()) {
        const wanted =
          owner &&
          (ix.doc.diagram?.regions[region.id]?.offPage === true || (region.name && (owner.regions?.length ?? 0) > 1));
        assert.equal(
          found.some((e) => e.id === region.id),
          !!wanted,
          `${f} ${region.id}`,
        );
      }
    }
  });
});

describe("search: ranking", () => {
  it("lists the machine in focus first among equal matches", () => {
    const first = (text: string, active: number): number | undefined => rows(text, active)[0]?.item.doc;
    assert.equal(first("On", 1), 1);
    assert.equal(first("On", 3), 3);
    const offs = rows("Off", 3).filter((r) => r.item.label === "Off");
    assert.deepEqual(
      offs.map((r) => `${r.item.kind}@${r.item.doc}`),
      ["state@3", "state@1"],
    );
  });

  it("puts a better match in another machine before a weak one in focus", () => {
    // "Init" is a state of dhcpclient only; dimmer's "initial → Off" starts with the query, but an exact name wins
    const l = rows("init", 1).map((r) => `${r.item.label}@${r.item.doc}`);
    assert.equal(l[0], "Init@2", l.join(", "));
    assert.equal(l[1], "initial → Off@1", "then the prefixes, the focused machine first");
    // scattered letters in the focused machine come after an exact name elsewhere
    const r = rows("bound", 1);
    assert.equal(r[0]?.item.label, "Bound");
    assert.equal(r[0]?.item.doc, 2);
  });

  it("ranks commands and settings with the focused machine, recent picks first among equals", () => {
    assert.equal(labels("tran")[0], "Add: Transition");
    assert.equal(
      labels("tran", 1, ["cmd:Add: Straight Transition"])[0],
      "Add: Transition",
      "a recent pick does not beat a better class",
    );
    const add = labels(">add", 1, ["cmd:Add: Region"]);
    assert.equal(add[0], "Add: Region");
  });

  it("hides disabled commands and labels commands with their menu", () => {
    const all = labels(">");
    assert.ok(all.includes("File: Open"), "the ellipsis is dropped");
    assert.ok(!all.includes("File: Save"), "disabled");
    assert.ok(all.includes("Run: Start Simulation"));
    assert.equal(
      commands.find((c) => c.label === "Run: Start Simulation")?.key,
      "cmd:Run#0",
      "a label that changes keys by position",
    );
    assert.equal(commands.find((c) => c.label === "Add: Transition")?.keys, "A T");
  });
});

describe("search: prefixes", () => {
  it("parses the prefix", () => {
    assert.deepEqual(parseQuery(">  add "), { mode: "commands", query: "add", prefix: ">" });
    assert.deepEqual(parseQuery("@idle"), { mode: "machine", query: "idle", prefix: "@" });
    assert.deepEqual(parseQuery("#x"), { mode: "machines", query: "x", prefix: "#" });
    assert.deepEqual(parseQuery("?"), { mode: "help", query: "", prefix: "?" });
    assert.deepEqual(parseQuery(" on"), { mode: "all", query: "on", prefix: "" });
  });

  it("> commands and settings only", () => {
    const r = rows(">o");
    assert.ok(r.length > 0 && r.every((m) => m.item.kind === "command" || m.item.kind === "setting"));
  });

  it("@ the focused machine's elements only", () => {
    const r = rows("@o", 2);
    assert.ok(r.length > 0 && r.every((m) => m.item.doc === 2 && m.item.kind !== "machine"));
    assert.deepEqual(search(items, "@", { activeDoc: undefined, recent: [] }), [], "nothing when no machine is open");
  });

  it("# every machine's elements and the machines, the focused machine first", () => {
    const r = rows("#", 2);
    assert.ok(r.every((m) => m.item.doc !== undefined));
    assert.equal(r[0]?.item.doc, 2);
    assert.ok(rows("#dimmer", 2).some((m) => m.item.kind === "machine"));
  });

  it("? lists the prefixes", () => {
    assert.deepEqual(
      rows("?").map((m) => m.item.prefix),
      ["", ">", "@", "#"],
    );
  });
});

describe("search: empty field", () => {
  it("shows recent picks that still exist, then the prefixes", () => {
    const r = rows("", 1, ["cmd:Add: State", "el:gone.ufsm:s1", "el:dimmer.ufsm:s1"]);
    assert.deepEqual(
      r.slice(0, 2).map((m) => m.item.label),
      ["Add: State", "Off"],
    );
    assert.equal(r[0]?.group, "recently used");
    assert.equal(r[2]?.group, "search modes");
    assert.ok(r.slice(2).every((m) => m.item.kind === "help"));
    assert.ok(rows("").every((m) => m.item.kind === "help" && m.group === undefined));
  });

  it("> shows recent commands, then all of them alphabetically", () => {
    const r = labels(">", 1, ["cmd:Add: State"]);
    assert.equal(r[0], "Add: State");
    const rest = r.slice(1);
    assert.deepEqual(
      rest,
      [...rest].sort((a, b) => a.localeCompare(b)),
    );
    assert.equal(rows(">", 1, ["cmd:Add: State"])[1]?.group, "other commands");
  });
});

describe("search: recent picks", () => {
  it("moves a pick to the front without duplicates and keeps a few", () => {
    assert.deepEqual(remember(["a", "b", "c"], "b"), ["b", "a", "c"]);
    assert.deepEqual(remember(["a"], "z"), ["z", "a"]);
    assert.equal(
      remember(
        Array.from({ length: 40 }, (_, i) => `k${i}`),
        "new",
      ).length,
      30,
    );
  });
});

describe("search: speed", () => {
  it("ranks every element of every repository model in well under a frame per key", () => {
    const files = [
      ...readdirSync(join(repoRoot, "examples"))
        .filter((f) => f.endsWith(".ufsm"))
        .map((f) => `examples/${f}`),
      ...readdirSync(join(repoRoot, "tests/models"))
        .filter((f) => f.endsWith(".ufsm"))
        .map((f) => `tests/models/${f}`),
      "apps/editor/src/fsm/editor.ufsm",
    ];
    const all = files.flatMap((f, i) => elementItems(index(f), i, f));
    assert.ok(all.length > 1000, String(all.length));
    const t0 = performance.now();
    for (const q of ["s", "st", "sta", "stat", "idle", "e k", "dhcp ack"]) search(all, q, { activeDoc: 0, recent: [] });
    const per = (performance.now() - t0) / 7;
    assert.ok(per < 50, `${per.toFixed(1)} ms per query over ${all.length} items`);
  });
});

describe("search: menu commands", () => {
  it("lists a submenu's items under both names, keyed by their tooltip, and leaves out the disabled ones", () => {
    const opened: string[] = [];
    const recent = (path: string, name: string, dir: string) => ({
      label: name,
      detail: dir,
      title: path,
      run: () => opened.push(path),
    });
    const items = menuCommands([
      {
        label: "File",
        items: [
          {
            label: "Open Recent",
            run: noop,
            submenu: () => [
              recent("C:\a\dimmer.ufsm", "dimmer.ufsm", "C:\a"),
              recent("C:\b\dimmer.ufsm", "dimmer.ufsm", "C:\b"),
              "-",
              { label: "Nothing", run: noop, enabled: () => false },
            ],
          },
        ],
      },
    ]);
    assert.deepEqual(
      items.map((it) => [it.key, it.label, it.detail]),
      [
        ["cmd:File: Open Recent: dimmer.ufsm@C:\a\dimmer.ufsm", "File: Open Recent: dimmer.ufsm", "C:\a"],
        ["cmd:File: Open Recent: dimmer.ufsm@C:\b\dimmer.ufsm", "File: Open Recent: dimmer.ufsm", "C:\b"],
      ],
    );
    items[1]?.run?.();
    assert.deepEqual(opened, ["C:\b\dimmer.ufsm"]);
  });
});
