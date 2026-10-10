// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs generated Rust: many machines are generated as modules u0.rs, u1.rs, ... of one library crate (built with
 * `-D warnings`, so dead code and every other rustc warning in the generated code fails the build; with clippy's
 * driver when one is given), linked into one test driver that runs a script per machine read from stdin. Used by
 * backend-rust.test.ts. Same protocol and output as c-harness.ts:
 *
 *   u <unit> <autoReset>  start unit: fresh machine, guards false
 *   g, x, r, e            a script step (driverLines in harness.ts)
 *
 * `x raise` makes the action or guard panic; the driver catches it (catch_unwind). `x reenter` cannot be done in
 * safe Rust (the machine is borrowed while an action runs), so the driver reports the nested call as refused.
 *
 * Each r/e prints "calls<TAB>active ids<TAB>error<TAB>nested" (parseDriverOutput). With autoReset, an error is
 * followed by a reset; if that fails too, the unit is dead and prints nothing more (like runScript in harness.ts).
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateRust, rustName, type IrModule, type RustOptions } from "../src/index";
import { removeTempDir } from "./c-harness";
import { driverLines, parseDriverOutput, type ScriptStep, type StepResult } from "./harness";

const execFileAsync = promisify(execFile);
const exe = (name: string): string => (process.platform === "win32" ? `${name}.exe` : name);

/** Edition the tests build with by default (the generated code is also checked with 2024). */
export const RUST_EDITION = "2021";

export interface RustTools {
  rustc?: string;
  /** clippy-driver: a rustc that also runs clippy's lints (rustup's default profile has it). */
  clippy?: string;
  rustfmt?: string;
  problem?: string;
}

/**
 * rustc that can build and run a hello-world: $RUSTC, else `rustc` on PATH. clippy-driver ($CLIPPY_DRIVER, else
 * `clippy-driver`) and rustfmt ($RUSTFMT, else `rustfmt`) are optional; each is reported when found.
 */
export function findRust(): RustTools {
  const rustc = process.env["RUSTC"] ?? "rustc";
  const v = spawnSync(rustc, ["--version"], { encoding: "utf8" });
  if (v.status !== 0) return { problem: "rustc not found (install Rust from https://rustup.rs, or set RUSTC)" };
  const dir = mkdtempSync(join(tmpdir(), "ufsm-rustc-"));
  const tools: RustTools = {};
  try {
    writeFileSync(join(dir, "probe.rs"), 'fn main() { println!("ok"); }\n');
    const b = spawnSync(rustc, ["--edition", RUST_EDITION, "probe.rs", "-o", exe("probe")], { cwd: dir, encoding: "utf8" });
    if (b.status !== 0) return { problem: `${rustc} cannot build a hello-world: ${(b.stderr || b.stdout || "").trim().split(/\r?\n/)[0]}` };
    const run = spawnSync(join(dir, exe("probe")), [], { encoding: "utf8" });
    if (run.status !== 0 || run.stdout.trim() !== "ok") return { problem: `${rustc} builds programs that do not run` };
    tools.rustc = rustc;
    const clippy = process.env["CLIPPY_DRIVER"] ?? "clippy-driver";
    if (spawnSync(clippy, ["--edition", RUST_EDITION, "--crate-type", "lib", "probe.rs", "-o", "probe.rlib"], { cwd: dir, encoding: "utf8" }).status === 0) tools.clippy = clippy;
    const rustfmt = process.env["RUSTFMT"] ?? "rustfmt";
    if (spawnSync(rustfmt, ["--version"], { encoding: "utf8" }).status === 0) tools.rustfmt = rustfmt;
  } finally {
    removeTempDir(dir);
  }
  return tools;
}

/** Lints the generated code must pass, on top of rustc's defaults: no warnings, documented public items. */
export const RUSTC_FLAGS = ["-D", "warnings", "-W", "missing_docs"];
/** With clippy: its default lints and the pedantic group. */
export const CLIPPY_FLAGS = [...RUSTC_FLAGS, "-W", "clippy::pedantic"];

/** Build a library crate from `lib.rs` in `dir`; throws with the compiler's messages on failure. */
export async function buildLib(compiler: string, dir: string, flags: string[], edition = RUST_EDITION, name = "units"): Promise<void> {
  try {
    await execFileAsync(compiler, ["--edition", edition, "--crate-type", "rlib", "--crate-name", name, ...flags, "lib.rs", "-o", `lib${name}.rlib`], {
      cwd: dir,
      maxBuffer: 1 << 26,
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`Rust compilation failed:\n${String(err.stderr ?? err.message).slice(0, 6000)}`);
  }
}

export interface RustUnit {
  ir: IrModule;
  options?: RustOptions;
  script: ScriptStep[];
  autoReset: boolean;
}

const str = (s: string): string => JSON.stringify(s);

/**
 * Test code appended to a generated module (inside it, so it can read the private configuration): which state is
 * active, an event by number, and the handler every unit uses.
 */
function testCode(ir: IrModule): string {
  const events = ir.events.map((e, i) => `        ${i} => Some(Event::${rustName(e.name)}),`);
  const raise = (name: string): string => `        if self.raise.as_deref() == Some(${str(name)}) {\n            panic!("raised");\n        }\n`;
  const actions = ir.actions.map((a) => `    fn ${rustName(a.name)}(&mut self) {\n        self.calls.push(${str(a.name)});\n${raise(a.name)}    }`);
  const guards = ir.guards.map((g, i) => `    fn ${rustName(g.name)}(&mut self) -> bool {\n${raise(g.name)}        self.guards[${i}]\n    }`);
  return `
// ---- test harness (not generated) ----

impl<H: Handler> Machine<H> {
    /// Whether region \`r\` is in slot \`s\`.
    pub fn test_active(&self, r: usize, s: u32) -> bool {
        u32::from(self.cfg[r]) == s
    }
}

/// Event number \`i\`.
pub fn test_event(i: i64) -> Option<Event> {
${ir.events.length ? `    match i {\n${events.join("\n")}\n        _ => None,\n    }` : "    let _ = i;\n    None"}
}

impl Handler for crate::TestHandler {
${[...actions, ...guards].join("\n")}
}
`;
}

/** Generate, compile and run the units; returns the results of every reset/send step, per unit. */
export async function runRust(tools: RustTools, units: RustUnit[], options: { lint?: boolean } = {}): Promise<StepResult[][]> {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-rs-"));
  try {
    const lib: string[] = [
      "//! Generated machines under test.",
      "",
      "/// The handler every unit calls: records actions, returns preset guard values.",
      "pub struct TestHandler {",
      "    /// Actions called since the last clear.",
      "    pub calls: Vec<&'static str>,",
      "    /// Guard values by guard number.",
      "    pub guards: [bool; 256],",
      "    /// The action or guard that panics when called (`x raise`).",
      "    pub raise: Option<String>,",
      "}",
      "",
      "/// A machine under test, driven by event numbers.",
      "pub trait Unit {",
      "    /// reset(), with the error code.",
      "    fn reset(&mut self) -> Result<(), &'static str>;",
      "    /// process() of event number `e`.",
      "    fn process(&mut self, e: i64) -> Result<(), &'static str>;",
      "    /// Whether region `r` is in slot `s`.",
      "    fn active(&self, r: usize, s: u32) -> bool;",
      "    /// The handler.",
      "    fn handler(&mut self) -> &mut TestHandler;",
      "}",
      "",
    ];
    const makes: string[] = [];
    const states: string[] = [];
    units.forEach((u, k) => {
      const out = generateRust(u.ir, { ...u.options, className: "Machine", module: `u${k}` });
      writeFileSync(join(dir, out.fileName), out.source + testCode(u.ir));
      lib.push(`/// Unit ${k}.`, `pub mod u${k};`, "");
      lib.push(
        `impl Unit for u${k}::Machine<TestHandler> {`,
        "    fn reset(&mut self) -> Result<(), &'static str> {",
        `        u${k}::Machine::reset(self).map_err(u${k}::Error::code)`,
        "    }",
        "    fn process(&mut self, e: i64) -> Result<(), &'static str> {",
        `        match u${k}::test_event(e) {`,
        `            Some(event) => u${k}::Machine::process(self, event).map_err(u${k}::Error::code),`,
        '            None => Err("unknown-event"),',
        "        }",
        "    }",
        "    fn active(&self, r: usize, s: u32) -> bool {",
        "        self.test_active(r, s)",
        "    }",
        "    fn handler(&mut self) -> &mut TestHandler {",
        "        self.handler_mut()",
        "    }",
        "}",
        "",
      );
      makes.push(`        ${k} => Box::new(u${k}::Machine::new(TestHandler { calls: Vec::new(), guards: [false; 256], raise: None })),`);
      states.push(`    &[${u.ir.states.map((s) => `(${s.region}, ${s.slot}, ${str(s.id)})`).join(", ")}],`);
    });
    lib.push(
      "/// A fresh, unstarted machine of unit `k`.",
      "#[must_use]",
      "pub fn make(k: usize) -> Box<dyn Unit> {",
      "    match k {",
      ...makes,
      '        _ => panic!("no unit {k}"),',
      "    }",
      "}",
      "",
      "/// States of each unit: (region, slot, id).",
      `pub static STATES: [&[(usize, u32, &str)]; ${units.length}] = [`,
      ...states,
      "];",
    );
    writeFileSync(join(dir, "lib.rs"), `${lib.join("\n")}\n`);
    writeFileSync(join(dir, "main.rs"), DRIVER);
    const compiler = options.lint !== false && tools.clippy ? tools.clippy : tools.rustc!;
    // the generated code must be clean; the harness's own items are allowed what tests need (Box<dyn>, panics)
    await buildLib(compiler, dir, ["-D", "warnings", "-A", "clippy::pedantic", "-A", "missing_docs"]);
    try {
      execFileSync(tools.rustc!, ["--edition", RUST_EDITION, "main.rs", "--extern", "units=libunits.rlib", "-L", ".", "-o", exe("driver")], { cwd: dir, stdio: "pipe" });
    } catch (e) {
      const err = e as { stderr?: Buffer; message: string };
      throw new Error(`Rust driver failed to build:\n${String(err.stderr ?? err.message).slice(0, 4000)}`);
    }

    const input: string[] = [];
    units.forEach((u, k) => {
      const gi = new Map(u.ir.guards.map((g, i) => [g.name, i]));
      const ei = new Map(u.ir.events.map((e, i) => [e.name, i]));
      input.push(`u ${k} ${u.autoReset ? 1 : 0}`);
      for (const s of u.script) input.push(...driverLines(s, gi, ei));
    });
    input.push("q");
    const output = execFileSync(join(dir, exe("driver")), [], { input: `${input.join("\n")}\n`, encoding: "utf8", maxBuffer: 1 << 28 });
    return parseDriverOutput(output, units.length);
  } finally {
    removeTempDir(dir);
  }
}

const DRIVER = `use std::io::{BufRead, Write};

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout());
    let mut unit: Option<Box<dyn units::Unit>> = None;
    let mut index = 0;
    let mut auto_reset = false;
    let mut dead = false;
    let mut reenter = false;
    // the panic of an "x raise" action or guard is the expected outcome of its step: keep stderr quiet
    let report = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if info.payload().downcast_ref::<&str>() != Some(&"raised") {
            report(info);
        }
    }));
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let words: Vec<&str> = line.split_whitespace().collect();
        let num = |i: usize| -> i64 { words[i].parse().unwrap() };
        match words.first().copied() {
            Some("q") => break,
            Some("u") => {
                index = usize::try_from(num(1)).unwrap();
                auto_reset = num(2) != 0;
                dead = false;
                unit = Some(units::make(index));
                writeln!(out, "#u {index}").unwrap();
                continue;
            }
            Some("g") => {
                let g = usize::try_from(num(1)).unwrap();
                unit.as_mut().unwrap().handler().guards[g] = num(2) != 0;
                continue;
            }
            Some("x") if words[1] == "raise" => {
                unit.as_mut().unwrap().handler().raise = Some(words[2].to_string());
                continue;
            }
            Some("x") => {
                // An action cannot call process(): the machine is borrowed mutably while it runs, so the compiler
                // refuses the nested call that the other languages refuse at run time with "busy".
                reenter = true;
                continue;
            }
            _ => {}
        }
        if dead {
            continue;
        }
        let Some(u) = unit.as_mut() else { continue };
        u.handler().calls.clear();
        let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| if words[0] == "r" { u.reset() } else { u.process(num(1)) }));
        u.handler().raise = None;
        let (failed, error) = match run {
            Ok(Ok(())) => (false, "-"),
            Ok(Err(code)) => (true, code),
            Err(_) => (true, "raised"),
        };
        let nested = if std::mem::take(&mut reenter) { "busy" } else { "-" };
        let active: Vec<&str> = units::STATES[index].iter().filter(|s| u.active(s.0, s.1)).map(|s| s.2).collect();
        writeln!(out, "{}\\t{}\\t{}\\t{}", u.handler().calls.join(" "), active.join(","), error, nested).unwrap();
        if failed && auto_reset && u.reset().is_err() {
            dead = true;
        }
    }
}
`;
