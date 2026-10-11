// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs generated C++: every machine is generated as a header in its own namespace (u<k>), instantiated with a test
 * handler in a translation unit of its own (compiled with the strict flags, so warnings in the generated template code
 * fail the build), linked into one test driver with a common command loop and fed a script per machine on stdin. Used
 * by backend-cpp.test.ts. Same protocol and output as c-harness.ts:
 *
 *   u <unit> <autoReset>  start unit: fresh machine, guards false
 *   g, x, r, e            a script step (driverLines in harness.ts)
 *
 * `x raise` makes the action or guard throw; the driver catches it. `x reenter` makes the action call process() with
 * the same event; its outcome is reported. Each r/e prints "calls<TAB>active ids<TAB>error<TAB>nested"
 * (parseDriverOutput). With autoReset, an error is followed by a reset; if that fails too, the unit is dead and prints
 * nothing more (like runScript in harness.ts).
 *
 * A unit generated with debugInfo from an IR lowered with trace logs its trace hook calls among the action calls
 * (harness.ts: decodeHooks), checks the names there, reads the configuration through is_active() and checks the
 * fingerprint with a static_assert. Without debugInfo the configuration is read through an accessor the harness adds
 * to the class.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cppName, generateCpp, hex32, type CppOptions, type IrModule } from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { driverLines, parseDriverOutput, type ScriptStep, type StepResult } from "./harness";

const execFileAsync = promisify(execFile);

/**
 * A C++ compiler that can build and run a hosted hello-world: $CXX, else the C++ driver next to $CC (clang ->
 * clang++, gcc -> g++), else the first of c++, g++, clang++.
 */
export function findCxx(): { cxx?: string; problem?: string } {
  const env = process.env["CXX"];
  const cc = process.env["CC"];
  const fromCc =
    cc && /(clang|gcc)(\.exe)?$/i.test(cc)
      ? [
          cc.replace(
            /(clang|gcc)(\.exe)?$/i,
            (_, n: string, e?: string) => `${n.toLowerCase() === "gcc" ? "g++" : "clang++"}${e ?? ""}`,
          ),
        ]
      : [];
  const candidates = env ? [env] : [...fromCc, "c++", "g++", "clang++"];
  const problems: string[] = [];
  for (const cxx of candidates) {
    if (spawnSync(cxx, ["--version"], { encoding: "utf8" }).status !== 0) continue;
    const dir = mkdtempSync(join(tmpdir(), "ufsm-cxx-"));
    try {
      writeFileSync(join(dir, "probe.cpp"), '#include <cstdio>\nint main() { std::puts("ok"); return 0; }\n');
      const exe = join(dir, process.platform === "win32" ? "probe.exe" : "probe");
      const b = spawnSync(cxx, ["-std=c++17", "probe.cpp", "-o", exe], { cwd: dir, encoding: "utf8" });
      if (b.status !== 0) {
        problems.push(`${cxx} cannot build a hello-world: ${(b.stderr || b.stdout || "").trim().split(/\r?\n/)[0]}`);
        continue;
      }
      const run = spawnSync(exe, [], { encoding: "utf8" });
      if (run.status === 0 && run.stdout.trim() === "ok") return { cxx };
      problems.push(`${cxx} builds programs that do not run`);
    } finally {
      removeTempDir(dir);
    }
  }
  return { problem: problems.length ? problems.join("; ") : "no C++ compiler found (set CXX)" };
}

/** Warnings the generated code must compile cleanly with (g++ and clang++). */
export const CXX_STRICT_FLAGS = [
  "-Wall",
  "-Wextra",
  "-Wpedantic",
  "-Werror",
  "-Wconversion",
  "-Wsign-conversion",
  "-Wshadow",
  "-Wold-style-cast",
  "-Wcast-qual",
  "-Wundef",
  "-Wzero-as-null-pointer-constant",
  "-Wextra-semi",
  "-Wnon-virtual-dtor",
];

/** CXX_STRICT_FLAGS, plus clang-only checks for dead or contradictory conditions. */
export function cxxStrictFlags(cxx: string): string[] {
  const v = spawnSync(cxx, ["--version"], { encoding: "utf8" }).stdout ?? "";
  return /clang/i.test(v)
    ? [...CXX_STRICT_FLAGS, "-Wtautological-overlap-compare", "-Wunreachable-code"]
    : CXX_STRICT_FLAGS;
}

/** Compile `sources` in `dir` (one compiler process per core); throws with the compiler's messages on failure. */
export async function compileCxx(cxx: string, dir: string, sources: string[], flags: string[]): Promise<void> {
  const n = Math.max(1, Math.min(availableParallelism(), sources.length));
  const chunks: string[][] = Array.from({ length: n }, () => []);
  sources.forEach((s, i) => chunks[i % n]!.push(s));
  try {
    await Promise.all(chunks.map((c) => execFileAsync(cxx, [...flags, "-c", ...c], { cwd: dir, maxBuffer: 1 << 24 })));
  } catch (e) {
    const err = e as { stderr?: string | Buffer; message: string };
    throw new Error(`C++ compilation failed:\n${String(err.stderr ?? err.message).slice(0, 6000)}`);
  }
}

export interface CppUnit {
  ir: IrModule;
  options?: CppOptions;
  script: ScriptStep[];
  autoReset: boolean;
}

const str = (s: string): string => JSON.stringify(s);

/** The header with an accessor for the configuration, so the driver can read it without debugInfo. */
function withAccessor(source: string): string {
  return source.replace(
    "\nprivate:\n",
    "\npublic:\n    bool test_cfg(unsigned int r, unsigned int s) const { return cfg_[r] == s; }\n\nprivate:\n",
  );
}

/** The test handler and the entry points of unit `k`. */
function unitCode(k: number, ir: IrModule, debug: boolean): string {
  const ns = `u${k}`;
  const c: string[] = [
    `#include "u${k}.hpp"`,
    '#include "driver.hpp"',
    "",
    "#include <cstdint>",
    "#include <cstring>",
    "#include <string>",
    "",
  ];
  if (debug) c.push(`static_assert(${ns}::fingerprint == ${hex32(ir.fingerprint)}u, "fingerprint");`, "");
  c.push("namespace {", "", "struct handler {");
  for (const a of ir.actions) c.push(`    void ${cppName(a.name)}() { test_call(${str(a.name)}); }`);
  ir.guards.forEach((g, i) => c.push(`    bool ${cppName(g.name)}() { return test_guard(${i}, ${str(g.name)}); }`));
  if (ir.timers.length) {
    // logged as "~start:<name>:<ms>:<0|1>" / "~stop:<name>" (driverCall in harness.ts); each call also checks the
    // timer's event (and name with debugInfo)
    c.push(
      `    static std::string timer(${ns}::Timer which)`,
      "    {",
      `        static const char *const names[] = {${ir.timers.map((t) => str(t.name)).join(", ")}};`,
      `        static const int events[] = {${ir.timers.map((t) => t.event).join(", ")}};`,
      "        const unsigned int i = static_cast<unsigned int>(which);",
      `        if (i >= ${ns}::timer_count) {`,
      '            test_call("BAD_TIMER");',
      '            return "?";',
      "        }",
      `        if (static_cast<int>(${ns}::timer_event(which)) != events[i]) {`,
      '            test_call("BAD_TIMER_EVENT");',
      "        }",
      ...(debug
        ? [
            `        if (${ns}::timer_name(which) == nullptr || std::strcmp(${ns}::timer_name(which), names[i]) != 0) {`,
            '            test_call("BAD_TIMER_NAME");',
            "        }",
          ]
        : []),
      "        return names[i];",
      "    }",
      `    void timer_start(${ns}::Timer t, std::uint32_t ms, bool periodic)`,
      "    {",
      '        test_call("~start:" + timer(t) + ":" + std::to_string(ms) + (periodic ? ":1" : ":0"));',
      "    }",
      `    void timer_stop(${ns}::Timer t) { test_call("~stop:" + timer(t)); }`,
    );
  }
  if (debug) {
    const named = (fn: string, type: string, what: string, has: boolean): string =>
      has
        ? `{ const char *n = ${ns}::${fn}(static_cast<${ns}::${type}>(id)); test_call(std::string("@${what}:") + (n ? n : "BAD_NAME")); }`
        : `test_call("@${what}:" + std::to_string(id));`;
    c.push(
      `    void trace(${ns}::TraceKind kind, std::uint16_t id)`,
      "    {",
      ...(ir.states.length
        ? [`        static const char *const labels[] = {${ir.states.map((s) => str(s.label)).join(", ")}};`]
        : []),
      "        switch (kind) {",
      `        case ${ns}::TraceKind::event:`,
      `            ${named("event_name", "Event", "event", ir.events.length > 0)}`,
      "            break;",
      `        case ${ns}::TraceKind::signal:`,
      `            ${named("signal_name", "Signal", "signal", ir.signals.length > 0)}`,
      "            break;",
      `        case ${ns}::TraceKind::transition:`,
      '            test_call("@t:" + std::to_string(id));',
      "            break;",
      `        case ${ns}::TraceKind::enter:`,
      `        case ${ns}::TraceKind::exit:`,
      `            test_call(std::string(kind == ${ns}::TraceKind::enter ? "@enter:" : "@exit:") + std::to_string(id));`,
      ir.states.length
        ? `            if (id >= ${ir.states.length}u || ${ns}::state_name(static_cast<${ns}::State>(id)) == nullptr || std::strcmp(${ns}::state_name(static_cast<${ns}::State>(id)), labels[id]) != 0) test_call("BAD_STATE_NAME");`
        : '            test_call("BAD_STATE_NAME");',
      "            break;",
      "        }",
      "    }",
    );
  }
  c.push("};", "", "handler h;", `${ns}::Machine<handler> *m = nullptr;`, "");
  c.push(
    `const char *code(${ns}::Status s) { return s == ${ns}::Status::ok ? nullptr : ${ns}::status_code(s); }`,
    "void w_make()",
    "{",
    "    delete m;",
    `    m = new ${ns}::Machine<handler>(h);`,
    "}",
    "const char *w_reset() { return code(m->reset()); }",
    `const char *w_process(int e) { return code(m->process(static_cast<${ns}::Event>(e))); }`,
  );
  if (debug && ir.states.length)
    c.push(`bool w_active(unsigned int i) { return m->is_active(static_cast<${ns}::State>(i)); }`);
  else
    c.push(
      "bool w_active(unsigned int i)",
      "{",
      `    static const unsigned int at[][2] = {${ir.states.length ? ir.states.map((s) => `{${s.region}u, ${s.slot}u}`).join(", ") : "{0u, 0u}"}};`,
      "    return m->test_cfg(at[i][0], at[i][1]);",
      "}",
    );
  c.push(
    `const char *const states[] = {${ir.states.length ? ir.states.map((s) => str(s.id)).join(", ") : "nullptr"}};`,
    "",
    "} // namespace",
    "",
    `extern const test_unit unit${k};`,
    `const test_unit unit${k} = {w_make, w_reset, w_process, w_active, states, ${ir.states.length}u};`,
  );
  return `${c.join("\n")}\n`;
}

const DRIVER_HPP = `#ifndef DRIVER_HPP
#define DRIVER_HPP
#include <string>
struct test_unit {
    void (*make)();
    const char *(*reset)();
    const char *(*process)(int event);
    bool (*active)(unsigned int i);
    const char *const *states;
    unsigned int nstates;
};
void test_call(const std::string &name);
bool test_guard(int index, const char *name);
#endif
`;

const MAIN_CPP = `#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "driver.hpp"

struct raised {};
static std::vector<std::string> calls;
static bool guards[256];
static std::string raise_name, reenter_name, nested;
static const test_unit *current;
static int current_event;

void test_call(const std::string &name)
{
    calls.push_back(name);
    if (!name.empty() && name == raise_name) throw raised();
    if (!name.empty() && name == reenter_name && nested == "-") {
        nested = "pending";
        const char *rc = current->process(current_event);
        nested = rc ? rc : "ok";
    }
}

bool test_guard(int index, const char *name)
{
    if (raise_name == name) throw raised();
    return guards[index];
}
`;

function mainLoop(n: number): string {
  return `
${Array.from({ length: n }, (_, k) => `extern const test_unit unit${k};`).join("\n")}
static const test_unit *const units[] = {${Array.from({ length: n }, (_, k) => `&unit${k}`).join(", ")}};

int main()
{
    std::ios::sync_with_stdio(false);
    std::string line;
    const test_unit *u = nullptr;
    bool auto_reset = false, dead = false;
    nested = "-";
    while (std::getline(std::cin, line)) {
        std::istringstream in(line);
        std::string cmd;
        in >> cmd;
        if (cmd == "q") break;
        if (cmd == "u") {
            int k = 0, a = 0;
            in >> k >> a;
            u = units[k];
            auto_reset = a != 0;
            dead = false;
            for (bool &g : guards) g = false;
            u->make();
            std::cout << "#u " << k << "\\n";
            continue;
        }
        if (cmd == "g") {
            int i = 0, v = 0;
            in >> i >> v;
            guards[i] = v != 0;
            continue;
        }
        if (cmd == "x") {
            std::string mode, name;
            in >> mode >> name;
            (mode == "raise" ? raise_name : reenter_name) = name;
            continue;
        }
        if (dead || !u) continue;
        calls.clear();
        current = u;
        std::string code = "-";
        try {
            const char *rc = nullptr;
            if (cmd == "r") rc = u->reset();
            else {
                in >> current_event;
                rc = u->process(current_event);
            }
            if (rc) code = rc;
        } catch (const raised &) {
            code = "raised";
        }
        raise_name.clear();
        reenter_name.clear();
        std::string joined, active;
        for (const std::string &c : calls) joined += (joined.empty() ? "" : " ") + c;
        for (unsigned int i = 0; i < u->nstates; i++)
            if (u->active(i)) active += (active.empty() ? "" : ",") + std::string(u->states[i]);
        std::cout << joined << "\\t" << active << "\\t" << code << "\\t" << nested << "\\n";
        nested = "-";
        if (code != "-" && auto_reset && u->reset() != nullptr) dead = true;
    }
    return 0;
}
`;
}

/** Generate, compile and run the units; returns the results of every reset/send step, per unit. */
export async function runCpp(cxx: string, units: CppUnit[]): Promise<StepResult[][]> {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-cpp-"));
  try {
    const sources: string[] = [];
    units.forEach((u, k) => {
      const out = generateCpp(u.ir, { ...u.options, namespace: `u${k}`, className: "Machine", file: `u${k}` });
      writeFileSync(join(dir, out.fileName), withAccessor(out.source));
      writeFileSync(join(dir, `drv${k}.cpp`), unitCode(k, u.ir, u.ir.trace && u.options?.debugInfo === true));
      sources.push(`drv${k}.cpp`);
    });
    writeFileSync(join(dir, "driver.hpp"), DRIVER_HPP);
    writeFileSync(join(dir, "main.cpp"), MAIN_CPP + mainLoop(units.length));
    // C++14: the driver includes <string>, and Microsoft's standard library needs C++14 (the headers alone are checked as C++11)
    await compileCxx(cxx, dir, sources, ["-std=c++14", ...cxxStrictFlags(cxx), "-O0"]);
    await compileCxx(cxx, dir, ["main.cpp"], ["-std=c++17", "-O0"]);
    const exe = join(dir, process.platform === "win32" ? "driver.exe" : "driver");
    try {
      execFileSync(cxx, ["-o", exe, "main.o", ...sources.map((s) => s.replace(/\.cpp$/, ".o"))], {
        cwd: dir,
        stdio: "pipe",
      });
    } catch (e) {
      const err = e as { stderr?: Buffer; message: string };
      throw new Error(`C++ link failed:\n${String(err.stderr ?? err.message).slice(0, 4000)}`);
    }
    const input: string[] = [];
    units.forEach((u, k) => {
      const gi = new Map(u.ir.guards.map((g, i) => [g.name, i]));
      const ei = new Map(u.ir.events.map((e, i) => [e.name, i]));
      input.push(`u ${k} ${u.autoReset ? 1 : 0}`);
      for (const s of u.script) input.push(...driverLines(s, gi, ei));
    });
    input.push("q");
    const output = execFileSync(exe, [], { input: `${input.join("\n")}\n`, encoding: "utf8", maxBuffer: 1 << 28 });
    return parseDriverOutput(output, units.length);
  } finally {
    removeTempDir(dir);
  }
}
