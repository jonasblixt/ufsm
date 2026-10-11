// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAbsoluteOut, relativeOut, resolveOut } from "../src/out-path";

describe("output folder", () => {
  it("stores a picked folder relative to the model's folder, with /", () => {
    assert.equal(relativeOut("/w/p/m.ufsm", "/w/p/gen"), "gen");
    assert.equal(relativeOut("/w/p/m.ufsm", "/w/p"), ".");
    assert.equal(relativeOut("/w/p/m.ufsm", "/w/p/"), ".");
    assert.equal(relativeOut("/w/p/m.ufsm", "/w/src/gen"), "../src/gen");
    assert.equal(relativeOut("/w/p/m.ufsm", "/"), "../..");
    assert.equal(relativeOut("C:\\w\\p\\m.ufsm", "C:\\w\\p\\gen\\c"), "gen/c");
    assert.equal(relativeOut("C:\\w\\p\\m.ufsm", "c:\\W\\src"), "../src", "Windows paths compare without case");
    assert.equal(relativeOut("C:\\w\\p\\m.ufsm", "D:\\gen"), "D:/gen", "another drive stays absolute");
    assert.equal(relativeOut("/w/Ab/m.ufsm", "/w/ab/gen"), "../ab/gen", "POSIX paths compare with case");
  });

  it("resolves a stored folder against the model for showing it", () => {
    assert.equal(resolveOut("/w/p/m.ufsm", "gen"), "/w/p/gen");
    assert.equal(resolveOut("/w/p/m.ufsm", "."), "/w/p");
    assert.equal(resolveOut("/w/p/m.ufsm", "../src/./gen/"), "/w/src/gen");
    assert.equal(resolveOut("/w/p/m.ufsm", "../../../.."), "/");
    assert.equal(resolveOut("/w/p/m.ufsm", "/opt/gen"), "/opt/gen");
    assert.equal(resolveOut("C:\\w\\p\\m.ufsm", "gen/c"), "C:\\w\\p\\gen\\c");
    assert.equal(resolveOut("C:\\w\\p\\m.ufsm", "D:/gen"), "D:\\gen");
    for (const [model, dir] of [
      ["/w/p/m.ufsm", "/w/src/gen"],
      ["C:\\w\\p\\m.ufsm", "C:\\x\\y"],
      ["C:\\w\\p\\m.ufsm", "C:\\w\\p"],
    ] as const)
      assert.equal(resolveOut(model, relativeOut(model, dir)).toLowerCase(), dir.toLowerCase(), "round trip");
  });

  it("tells absolute folders", () => {
    for (const p of ["/x", "C:/x", "C:\\x", "\\\\server\\x"]) assert.ok(isAbsoluteOut(p), p);
    for (const p of ["gen", "../gen", "./gen", "C:gen"]) assert.ok(!isAbsoluteOut(p), p);
  });
});
