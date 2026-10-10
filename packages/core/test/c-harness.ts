// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs generated C: many machines are generated with distinct prefixes,
 * linked into one test driver with a common command loop, compiled once
 * and fed a script per machine on stdin. Used by backend-c.test.ts.
 *
 * Driver protocol (one command per line):
 *   u <unit> <autoReset>  start unit: fresh zeroed machine, guards false
 *   g, x, r, e            a script step (driverLines in harness.ts); r is
 *                         init the first time
 * `x raise` leaves the generated code with a longjmp, the C counterpart of
 * an exception. Each r/e prints "calls<TAB>active ids<TAB>error<TAB>nested"
 * (parseDriverOutput; error codes as numbers). With
 * autoReset, an error is followed by a reset; if that fails too, the unit
 * is dead and prints nothing more (like runScript in harness.ts).
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { generateC, type COptions, type IrModule } from "../src/index";
import { driverLines, parseDriverOutput, type ScriptStep, type StepResult } from "./harness";

/**
 * Remove a temp directory, best effort. On Windows a just-exited driver.exe is
 * often still held open for a moment (virus scanner), so retry and never fail
 * the test over cleanup.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // left in the OS temp directory
  }
}

/**
 * A C compiler that can build and run a hosted hello-world (the test driver
 * needs <stdio.h>): $CC, else the first of cc, gcc, clang. Otherwise
 * `problem` says why not, e.g. clang on Windows that cannot find the
 * Windows SDK headers.
 */
export function findCompiler(): { cc?: string; problem?: string } {
  const candidates = process.env["CC"] ? [process.env["CC"]] : ["cc", "gcc", "clang"];
  const problems: string[] = [];
  for (const cc of candidates) {
    const r = spawnSync(cc, ["--version"], { encoding: "utf8", shell: false });
    if (r.status !== 0) continue;
    const dir = mkdtempSync(join(tmpdir(), "ufsm-cc-"));
    try {
      writeFileSync(join(dir, "probe.c"), '#include <stdio.h>\nint main(void) { puts("ok"); return 0; }\n');
      const exe = join(dir, process.platform === "win32" ? "probe.exe" : "probe");
      const b = spawnSync(cc, ["probe.c", "-o", exe], { cwd: dir, encoding: "utf8" });
      if (b.status !== 0) {
        problems.push(`${cc} cannot build a hello-world: ${(b.stderr || b.stdout || "").trim().split(/\r?\n/)[0]}`);
        continue;
      }
      const run = spawnSync(exe, [], { encoding: "utf8" });
      if (run.status === 0 && run.stdout.trim() === "ok") return { cc };
      problems.push(`${cc} builds programs that do not run`);
    } finally {
      removeTempDir(dir);
    }
  }
  return { problem: problems.length ? problems.join("; ") : "no C compiler found (set CC)" };
}

/** Warnings the generated code must compile cleanly with (gcc and clang). */
export const STRICT_FLAGS = [
  "-std=c99", "-Wall", "-Wextra", "-Wpedantic", "-Werror", "-Wconversion", "-Wsign-conversion", "-Wshadow",
  "-Wstrict-prototypes", "-Wmissing-prototypes", "-Wcast-qual", "-Wundef",
];

/** STRICT_FLAGS, plus clang-only checks for dead or contradictory conditions (newer clangs have them in -Wall). */
export function strictFlags(cc: string): string[] {
  const v = spawnSync(cc, ["--version"], { encoding: "utf8" }).stdout ?? "";
  return /clang/i.test(v) ? [...STRICT_FLAGS, "-Wtautological-overlap-compare", "-Wunreachable-code"] : STRICT_FLAGS;
}

export interface CUnit {
  ir: IrModule;
  options?: COptions;
  script: ScriptStep[];
  autoReset: boolean;
}

const str = (s: string): string => JSON.stringify(s);
const ERRORS: Record<string, string> = { "-1": "queue-overflow", "-2": "livelock", "-3": "unknown-event", "-4": "busy" };

const execFileAsync = promisify(execFile);

/** Compile in parallel chunks (one compiler process per core), then link. */
async function build(cc: string, dir: string, sources: string[], exe: string): Promise<void> {
  const n = Math.max(1, Math.min(availableParallelism(), sources.length));
  const chunks: string[][] = Array.from({ length: n }, () => []);
  sources.forEach((s, i) => chunks[i % n]!.push(s));
  // _CRT_SECURE_NO_WARNINGS: the driver's sscanf is "deprecated" in Microsoft's C runtime (clang/gcc on Windows)
  const flags = [...strictFlags(cc), "-Wno-missing-prototypes", "-D_CRT_SECURE_NO_WARNINGS", "-O0"];
  try {
    await Promise.all(chunks.map((c) => execFileAsync(cc, [...flags, "-c", ...c], { cwd: dir, maxBuffer: 1 << 24 })));
    execFileSync(cc, ["-o", exe, ...sources.map((s) => s.replace(/\.c$/, ".o"))], { cwd: dir, stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: string | Buffer; message: string };
    throw new Error(`C compilation failed:\n${String(err.stderr ?? err.message).slice(0, 4000)}`);
  }
}

/** Generate, compile and run the units; returns the results of every reset/send step, per unit. */
export async function runC(cc: string, units: CUnit[]): Promise<StepResult[][]> {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-c-"));
  try {
    const sources: string[] = [];
    const table: string[] = [];
    units.forEach((u, k) => {
      const p = `u${k}_`;
      const files = generateC(u.ir, { ...u.options, prefix: p, file: `u${k}` });
      writeFileSync(join(dir, files.headerName), files.header);
      writeFileSync(join(dir, files.sourceName), files.source);
      sources.push(files.sourceName);
      const c: string[] = [];
      c.push(`#include "${files.headerName}"`, '#include "driver.h"', "");
      u.ir.actions.forEach((a) => c.push(`void ${p}${a.name}(void *user) { test_call(user, ${str(a.name)}); }`));
      u.ir.guards.forEach((g, i) => c.push(`bool ${p}${g.name}(void *user) { return test_guard(user, ${i}, ${str(g.name)}); }`));
      c.push(`static struct ${p}machine machine;`);
      c.push(`static int w_init(void *user) { return ${p}init(&machine, user); }`);
      c.push(`static int w_reset(void) { return ${p}reset(&machine); }`);
      if (u.ir.events.length) c.push(`static int w_process(int e) { return ${p}process(&machine, (enum ${p}event)e); }`);
      c.push(`static int w_active(unsigned int r, unsigned int s) { return machine.cfg[r] == s; }`);
      c.push(`static void w_clear(void) { static const struct ${p}machine zero; machine = zero; }`);
      const states = u.ir.states.map((s) => `{ ${s.region}u, ${s.slot}u, ${str(s.id)} }`);
      c.push(`static const struct test_state states[] = { ${states.length ? states.join(", ") : "{ 0u, 0u, 0 }"} };`);
      c.push(`static const char *const events[] = { ${u.ir.events.length ? u.ir.events.map((e) => str(e.name)).join(", ") : "0"} };`);
      c.push(`const struct test_unit unit${k} = { w_init, w_reset, ${u.ir.events.length ? "w_process" : "0"}, w_active, w_clear, states, ${u.ir.states.length}u, events, ${u.ir.events.length}u };`);
      writeFileSync(join(dir, `drv${k}.c`), `${c.join("\n")}\n`);
      sources.push(`drv${k}.c`);
      table.push(`&unit${k}`);
    });
    writeFileSync(join(dir, "driver.h"), DRIVER_H);
    writeFileSync(
      join(dir, "main.c"),
      `${MAIN_C}\n${units.map((_, k) => `extern const struct test_unit unit${k};`).join("\n")}\nstatic const struct test_unit *const units[] = { ${table.join(", ")} };\n${MAIN_LOOP}`,
    );
    sources.push("main.c");
    const exe = join(dir, process.platform === "win32" ? "driver.exe" : "driver");
    await build(cc, dir, sources, exe);

    const input: string[] = [];
    units.forEach((u, k) => {
      const gi = new Map(u.ir.guards.map((g, i) => [g.name, i]));
      const ei = new Map(u.ir.events.map((e, i) => [e.name, i]));
      input.push(`u ${k} ${u.autoReset ? 1 : 0}`);
      for (const s of u.script) input.push(...driverLines(s, gi, ei));
    });
    input.push("q");
    const output = execFileSync(exe, [], { input: `${input.join("\n")}\n`, encoding: "utf8", maxBuffer: 1 << 28 });
    return parseDriverOutput(output, units.length, ERRORS);
  } finally {
    removeTempDir(dir);
  }
}

const DRIVER_H = `#ifndef DRIVER_H
#define DRIVER_H
#include <stdbool.h>
struct test_state { unsigned int region, slot; const char *id; };
struct test_unit {
    int (*init)(void *user);
    int (*reset)(void);
    int (*process)(int event);
    int (*active)(unsigned int region, unsigned int slot);
    void (*clear)(void);
    const struct test_state *states;
    unsigned int nstates;
    const char *const *events;
    unsigned int nevents;
};
void test_call(void *user, const char *name);
bool test_guard(void *user, int index, const char *name);
#endif
`;

const MAIN_C = `#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "driver.h"

struct ctx { int guards[256]; };
static struct ctx context;
static char calls[1 << 20];
static size_t ncalls;
/* x raise / x reenter of the next step, the unit and event being run, the nested call's result */
static char raise_name[256], reenter_name[256];
static const struct test_unit *current;
static int current_event, nested_done, nested_rc;
static jmp_buf raised;

void test_call(void *user, const char *name)
{
    size_t n = strlen(name);
    const char *logged = user == &context ? name : "BAD_USER_POINTER";
    size_t ln = strlen(logged);
    if (ncalls + ln + 2 >= sizeof calls) { fprintf(stderr, "call buffer full\\n"); exit(3); }
    if (ncalls) calls[ncalls++] = ' ';
    memcpy(calls + ncalls, logged, ln);
    ncalls += ln;
    calls[ncalls] = 0;
    if (n && strcmp(name, raise_name) == 0) longjmp(raised, 1);
    if (n && strcmp(name, reenter_name) == 0 && !nested_done) {
        nested_done = 1;
        nested_rc = current->process ? current->process(current_event) : -3;
    }
}

bool test_guard(void *user, int index, const char *name)
{
    if (user != &context) test_call(user, "guard"); /* logged as BAD_USER_POINTER */
    if (strcmp(name, raise_name) == 0) longjmp(raised, 1);
    return context.guards[index] != 0;
}

/* One reset/init or process; returns 1 when an action or guard raised (longjmp), else 0 and the result in *rc. */
static int run_step(int reset, int started, int *rc)
{
    if (setjmp(raised)) return 1;
    if (reset) *rc = started ? current->reset() : current->init(&context);
    else *rc = current->process ? current->process(current_event) : -3;
    return 0;
}
`;

const MAIN_LOOP = `
int main(void)
{
    char line[256];
    const struct test_unit *u = 0;
    int auto_reset = 0, started = 0, dead = 0;
    while (fgets(line, sizeof line, stdin)) {
        int a = 0, b = 0, rc = 0, raised_now;
        if (line[0] == 'q') break;
        if (line[0] == 'u') {
            if (sscanf(line + 1, "%d %d", &a, &b) != 2) return 2;
            u = units[a];
            auto_reset = b;
            started = dead = 0;
            memset(&context, 0, sizeof context);
            u->clear();
            printf("#u %d\\n", a);
            continue;
        }
        if (line[0] == 'g') {
            if (sscanf(line + 1, "%d %d", &a, &b) != 2 || a < 0 || a >= 256) return 2;
            context.guards[a] = b;
            continue;
        }
        if (line[0] == 'x') {
            char mode[16], name[256];
            if (sscanf(line + 1, "%15s %255s", mode, name) != 2) return 2;
            strcpy(strcmp(mode, "raise") == 0 ? raise_name : reenter_name, name);
            continue;
        }
        if (dead || !u) continue;
        ncalls = 0;
        calls[0] = 0;
        current = u;
        nested_done = 0;
        if (line[0] == 'e' && sscanf(line + 1, "%d", &current_event) != 1) return 2;
        raised_now = run_step(line[0] == 'r', started, &rc);
        if (line[0] == 'r') started = 1;
        raise_name[0] = reenter_name[0] = 0;
        printf("%s\\t", calls);
        {
            int first = 1;
            unsigned int i;
            for (i = 0; i < u->nstates; i++) {
                if (u->active(u->states[i].region, u->states[i].slot)) {
                    printf("%s%s", first ? "" : ",", u->states[i].id);
                    first = 0;
                }
            }
        }
        if (raised_now) printf("\\traised"); else if (rc < 0) printf("\\t%d", rc); else printf("\\t-");
        if (nested_done) printf("\\t%d\\n", nested_rc); else printf("\\t-\\n");
        if ((raised_now || rc < 0) && auto_reset && u->reset() < 0) dead = 1;
    }
    return 0;
}
`;
