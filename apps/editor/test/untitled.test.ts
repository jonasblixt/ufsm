// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nameOnSave, untitledName } from "../src/untitled";

describe("new machines", () => {
  it("are called untitled, then untitled2, ... while those files are open", () => {
    assert.equal(untitledName([]), "untitled");
    assert.equal(untitledName(["dimmer.ufsm"]), "untitled");
    assert.equal(untitledName(["untitled.ufsm"]), "untitled2");
    assert.equal(untitledName(["Untitled.UFSM", "untitled2.ufsm", "untitled4.ufsm"]), "untitled3");
    assert.equal(untitledName(["untitled2.ufsm"]), "untitled", "a gap at the start is used");
  });

  it("take the file's name on their first save, unless renamed", () => {
    assert.equal(nameOnSave("untitled", "untitled", "blinker.ufsm"), "blinker");
    assert.equal(nameOnSave("untitled2", "untitled2", "Traffic Light.UFSM"), "Traffic Light");
    assert.equal(nameOnSave("lamp", "untitled", "blinker.ufsm"), undefined, "renamed in the Project tab");
    assert.equal(nameOnSave("untitled", undefined, "blinker.ufsm"), undefined, "opened from a file");
    assert.equal(nameOnSave("untitled", "untitled", "untitled.ufsm"), undefined, "same name: no edit");
    assert.equal(nameOnSave("untitled", "untitled", ".ufsm"), undefined, "no empty name");
    assert.equal(
      nameOnSave("untitled", "untitled", "notes.json"),
      "notes.json",
      "another extension stays part of the name",
    );
  });
});
