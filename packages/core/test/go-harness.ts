// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs generated Go: every machine is generated as package u<k> of one Go module (with a small handler file next to
 * it), linked into one test driver that runs a script per machine read from stdin. Used by backend-go.test.ts. Same
 * protocol and output as c-harness.ts:
 *
 *   u <unit> <autoReset>  start unit: fresh machine, guards false
 *   g, x, r, e            a script step (driverLines in harness.ts)
 *
 * `x raise` makes the action or guard panic; the driver recovers. `x reenter` makes the action call Process with the
 * same event; its outcome is reported. Each r/e prints "calls<TAB>active ids<TAB>error<TAB>nested"
 * (parseDriverOutput). With autoReset, an error is followed by a reset; if that fails too, the unit is dead and prints
 * nothing more (like runScript in harness.ts).
 *
 * A unit generated with debugInfo from an IR lowered with trace logs its trace hook calls among the action calls
 * (harness.ts: decodeHooks), checks the names there, reads the configuration through IsActive() and checks the
 * fingerprint.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateGo, goName, hex32, type GoOptions, type IrModule } from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { driverLines, parseDriverOutput, type ScriptStep, type StepResult } from "./harness";

const execFileAsync = promisify(execFile);

export interface GoTools {
  go?: string;
  gofmt?: string;
  problem?: string;
}

/** The environment Go runs in: no toolchain downloads, no network, modules on. */
export function goEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GOTOOLCHAIN: "local", GOFLAGS: "-mod=mod", GOPROXY: "off", GO111MODULE: "on" };
}

/** `go` ($GO, else `go` on PATH) and gofmt ($GOFMT, else the one in GOROOT/bin). */
export function findGo(): GoTools {
  const go = process.env["GO"] ?? "go";
  const v = spawnSync(go, ["version"], { encoding: "utf8", env: goEnv() });
  if (v.status !== 0) return { problem: "go not found (install Go from https://go.dev/dl, or set GO)" };
  const tools: GoTools = { go };
  const root = spawnSync(go, ["env", "GOROOT"], { encoding: "utf8", env: goEnv() }).stdout.trim();
  const gofmt = process.env["GOFMT"] ?? join(root, "bin", process.platform === "win32" ? "gofmt.exe" : "gofmt");
  if (spawnSync(gofmt, ["-l"], { input: "package x\n", encoding: "utf8" }).status === 0) tools.gofmt = gofmt;
  return tools;
}

/** Run a go command in `dir`; throws with its messages on failure. */
export async function goRun(go: string, dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(go, args, { cwd: dir, env: goEnv(), maxBuffer: 1 << 26 });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message: string };
    throw new Error(`go ${args.join(" ")} failed:\n${String(err.stderr || err.stdout || err.message).slice(0, 6000)}`);
  }
}

export const GO_MOD = "module ufsmtest\n\ngo 1.20\n";

export interface GoUnit {
  ir: IrModule;
  options?: GoOptions;
  script: ScriptStep[];
  autoReset: boolean;
}

const str = (s: string): string => JSON.stringify(s);

/** The handler and test entry points of one unit, in its package. */
function unitCode(pkg: string, ir: IrModule, debug: boolean): string {
  const methods: string[] = [];
  for (const a of ir.actions)
    methods.push(`func (h *handler) ${goName(a.name)}() {\n\th.c.Call(${str(a.name)}, h.process)\n}`);
  ir.guards.forEach((g, i) =>
    methods.push(`func (h *handler) ${goName(g.name)}() bool {\n\treturn h.c.Guard(${i}, ${str(g.name)})\n}`),
  );
  if (ir.timers.length) {
    // logged as "~start:<name>:<ms>:<0|1>" / "~stop:<name>" (driverCall in harness.ts); each call also checks the
    // timer's Event() (and String() with debugInfo)
    methods.push(
      `func (h *handler) timer(t Timer) string {
\tnames := []string{${ir.timers.map((t) => str(t.name)).join(", ")}}
\tevents := []int{${ir.timers.map((t) => t.event).join(", ")}}
\tif t < 0 || int(t) >= len(names) {
\t\th.c.Calls = append(h.c.Calls, "BAD_TIMER")
\t\treturn "?"
\t}
\tif int(t.Event()) != events[t] {
\t\th.c.Calls = append(h.c.Calls, "BAD_TIMER_EVENT")
\t}
${debug ? `\tif t.String() != names[t] {\n\t\th.c.Calls = append(h.c.Calls, "BAD_TIMER_NAME")\n\t}\n` : ""}\treturn names[t]
}`,
      `func (h *handler) TimerStart(t Timer, ms uint32, periodic bool) {
\tp := 0
\tif periodic {
\t\tp = 1
\t}
\th.c.Calls = append(h.c.Calls, fmt.Sprintf("~start:%s:%d:%d", h.timer(t), ms, p))
}`,
      `func (h *handler) TimerStop(t Timer) {\n\th.c.Calls = append(h.c.Calls, "~stop:"+h.timer(t))\n}`,
    );
  }
  if (debug) {
    const hasSignalType = ir.signals.length > 0;
    methods.push(`var labels = []string{${ir.states.map((s) => str(s.label)).join(", ")}}

func (h *handler) Trace(kind TraceKind, id int) {
\tswitch kind {
\tcase TraceEvent:
\t\th.c.Calls = append(h.c.Calls, ${ir.events.length ? `"@event:"+Event(id).String()` : `fmt.Sprintf("@event:%d", id)`})
\tcase TraceSignal:
\t\th.c.Calls = append(h.c.Calls, ${hasSignalType ? `"@signal:"+Signal(id).String()` : `fmt.Sprintf("@signal:%d", id)`})
\tcase TraceTransition:
\t\th.c.Calls = append(h.c.Calls, fmt.Sprintf("@t:%d", id))
\tdefault:
\t\twhat := "exit"
\t\tif kind == TraceEnter {
\t\t\twhat = "enter"
\t\t}
\t\th.c.Calls = append(h.c.Calls, fmt.Sprintf("@%s:%d", what, id))
\t\tif id < 0 || id >= len(labels) || ${ir.states.length ? "State(id).String() != labels[id]" : "true"} {
\t\t\th.c.Calls = append(h.c.Calls, "BAD_STATE_NAME")
\t\t}
\t}
}`);
  }
  const active = debug
    ? "\treturn u.m.IsActive(State(i))"
    : `\tat := [][2]int{${ir.states.map((s) => `{${s.region}, ${s.slot}}`).join(", ")}}\n\treturn int(u.m.cfg[at[i][0]]) == at[i][1]`;
  return `package ${pkg}

import (
\t"fmt"

\t"ufsmtest/drv"
)

var _ = fmt.Sprint

type handler struct {
\tc *drv.Ctx
\tm *Machine
}

func (h *handler) process(e int) string {
\treturn code(h.m.Process(Event(e)), "ok")
}

${methods.join("\n\n")}

func code(err error, ok string) string {
\tif err == nil {
\t\treturn ok
\t}
\tif e, isErr := err.(*Error); isErr {
\t\treturn e.Code()
\t}
\treturn "BAD_ERROR"
}

type unit struct {
\tm *Machine
}

// Make returns a fresh, unstarted machine.
func Make(c *drv.Ctx) drv.Unit {
${debug ? `\tif Fingerprint != ${hex32(ir.fingerprint)} {\n\t\tpanic("fingerprint")\n\t}\n` : ""}\th := &handler{c: c}
\th.m = New(h)
\treturn &unit{m: h.m}
}

func (u *unit) Reset() string {
\treturn code(u.m.Reset(), "-")
}

func (u *unit) Process(e int) string {
\treturn code(u.m.Process(Event(e)), "-")
}

func (u *unit) Active(i int) bool {
${active}
}

// States are the state ids by number.
var States = []string{${ir.states.map((s) => str(s.id)).join(", ")}}
`;
}

const DRV = `package drv

// Ctx is what the handler of the unit under test records and reads.
type Ctx struct {
	Calls   []string
	Guards  [256]bool
	Raise   string
	Reenter string
	Event   int
	Nested  string
}

// Raised is the panic of an "x raise" action or guard.
type Raised struct{}

// Call logs an action; it panics or calls the machine again when the step says so.
func (c *Ctx) Call(name string, process func(int) string) {
	c.Calls = append(c.Calls, name)
	if name == c.Raise {
		panic(Raised{})
	}
	if name == c.Reenter && c.Nested == "-" {
		c.Nested = "pending"
		c.Nested = process(c.Event)
	}
}

// Guard returns a preset guard value; it panics when the step says so.
func (c *Ctx) Guard(i int, name string) bool {
	if name == c.Raise {
		panic(Raised{})
	}
	return c.Guards[i]
}

// Unit is a machine under test.
type Unit interface {
	Reset() string
	Process(e int) string
	Active(i int) bool
}
`;

function mainCode(n: number): string {
  const imports = Array.from({ length: n }, (_, k) => `\tu${k} "ufsmtest/u${k}"`).join("\n");
  return `package main

import (
\t"bufio"
\t"fmt"
\t"os"
\t"strconv"
\t"strings"

\t"ufsmtest/drv"
${imports}
)

var makes = []func(*drv.Ctx) drv.Unit{${Array.from({ length: n }, (_, k) => `u${k}.Make`).join(", ")}}
var states = [][]string{${Array.from({ length: n }, (_, k) => `u${k}.States`).join(", ")}}

func atoi(s string) int {
\tn, err := strconv.Atoi(s)
\tif err != nil {
\t\tpanic(err)
\t}
\treturn n
}

func run(f func() string) (code string) {
\tdefer func() {
\t\tif r := recover(); r != nil {
\t\t\tif _, ok := r.(drv.Raised); !ok {
\t\t\t\tpanic(r)
\t\t\t}
\t\t\tcode = "raised"
\t\t}
\t}()
\treturn f()
}

func main() {
\tin := bufio.NewScanner(os.Stdin)
\tin.Buffer(make([]byte, 1<<20), 1<<20)
\tout := bufio.NewWriter(os.Stdout)
\tdefer out.Flush()
\tvar u drv.Unit
\tc := &drv.Ctx{Nested: "-"}
\tindex, auto, dead := 0, false, false
\tfor in.Scan() {
\t\tw := strings.Fields(in.Text())
\t\tif len(w) == 0 {
\t\t\tcontinue
\t\t}
\t\tswitch w[0] {
\t\tcase "q":
\t\t\treturn
\t\tcase "u":
\t\t\tindex, auto, dead = atoi(w[1]), w[2] == "1", false
\t\t\tc = &drv.Ctx{Nested: "-"}
\t\t\tu = makes[index](c)
\t\t\tfmt.Fprintf(out, "#u %d\\n", index)
\t\t\tcontinue
\t\tcase "g":
\t\t\tc.Guards[atoi(w[1])] = w[2] == "1"
\t\t\tcontinue
\t\tcase "x":
\t\t\tif w[1] == "raise" {
\t\t\t\tc.Raise = w[2]
\t\t\t} else {
\t\t\t\tc.Reenter = w[2]
\t\t\t}
\t\t\tcontinue
\t\t}
\t\tif dead || u == nil {
\t\t\tcontinue
\t\t}
\t\tc.Calls = c.Calls[:0]
\t\tcode := run(func() string {
\t\t\tif w[0] == "r" {
\t\t\t\treturn u.Reset()
\t\t\t}
\t\t\tc.Event = atoi(w[1])
\t\t\treturn u.Process(c.Event)
\t\t})
\t\tc.Raise, c.Reenter = "", ""
\t\tvar active []string
\t\tfor i, id := range states[index] {
\t\t\tif u.Active(i) {
\t\t\t\tactive = append(active, id)
\t\t\t}
\t\t}
\t\tfmt.Fprintf(out, "%s\\t%s\\t%s\\t%s\\n", strings.Join(c.Calls, " "), strings.Join(active, ","), code, c.Nested)
\t\tc.Nested = "-"
\t\tif code != "-" && auto && u.Reset() != "-" {
\t\t\tdead = true
\t\t}
\t}
}
`;
}

/** Write a module with one package per generated file: `<dir>/<pkg>/<file>`. */
export function writeGoModule(dir: string, packages: { pkg: string; files: { name: string; text: string }[] }[]): void {
  writeFileSync(join(dir, "go.mod"), GO_MOD);
  for (const p of packages) {
    mkdirSync(join(dir, p.pkg), { recursive: true });
    for (const f of p.files) writeFileSync(join(dir, p.pkg, f.name), f.text);
  }
}

/** Generate, build and run the units; returns the results of every reset/send step, per unit. */
export async function runGo(tools: GoTools, units: GoUnit[]): Promise<StepResult[][]> {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-go-"));
  try {
    writeGoModule(dir, [
      { pkg: "drv", files: [{ name: "drv.go", text: DRV }] },
      ...units.map((u, k) => {
        const out = generateGo(u.ir, { ...u.options, package: `u${k}`, className: "Machine" });
        return {
          pkg: `u${k}`,
          files: [
            { name: out.fileName, text: out.source },
            { name: "harness.go", text: unitCode(`u${k}`, u.ir, u.ir.trace && u.options?.debugInfo === true) },
          ],
        };
      }),
    ]);
    writeFileSync(join(dir, "main.go"), mainCode(units.length));
    const exe = process.platform === "win32" ? "driver.exe" : "driver";
    await goRun(tools.go!, dir, ["build", "-o", exe, "."]);
    const input: string[] = [];
    units.forEach((u, k) => {
      const gi = new Map(u.ir.guards.map((g, i) => [g.name, i]));
      const ei = new Map(u.ir.events.map((e, i) => [e.name, i]));
      input.push(`u ${k} ${u.autoReset ? 1 : 0}`);
      for (const s of u.script) input.push(...driverLines(s, gi, ei));
    });
    input.push("q");
    const output = execFileSync(join(dir, exe), [], {
      input: `${input.join("\n")}\n`,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    return parseDriverOutput(output, units.length);
  } finally {
    removeTempDir(dir);
  }
}
