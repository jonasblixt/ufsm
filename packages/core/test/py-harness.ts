// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs generated Python: many machines are generated as modules u0.py,
 * u1.py, ... next to one driver script, which runs a script per machine
 * read from stdin, in a single Python process. Used by
 * backend-python.test.ts. Same protocol and output as c-harness.ts:
 *
 *   u <unit> <autoReset>  start unit: fresh machine, guards false
 *   g, x, r, e            a script step (driverLines in harness.ts)
 *
 * Each r/e prints "calls<TAB>active ids<TAB>error<TAB>nested" (parseDriverOutput). With
 * autoReset, an error is followed by a reset; if that fails too, the unit
 * is dead and prints nothing more (like runScript in harness.ts).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePython, pythonName, type IrModule, type PythonOptions } from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { driverLines, parseDriverOutput, type ScriptStep, type StepResult } from "./harness";

/** Oldest Python the generated code supports (its grammar is checked against it too). */
export const MIN_PYTHON = [3, 8] as const;

/**
 * A Python 3.8+ interpreter: $PYTHON (a command, may include arguments), else the first of python3, python,
 * `py -3` that runs. Otherwise `problem` says why not (e.g. only the Windows Store alias is installed).
 */
export function findPython(): { python?: string[]; problem?: string } {
  const env = process.env["PYTHON"];
  const candidates = env ? [env.split(" ").filter(Boolean)] : [["python3"], ["python"], ["py", "-3"]];
  const problems: string[] = [];
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(cmd!, [...args, "-c", `import sys; print(sys.version_info[:2] >= (${MIN_PYTHON.join(", ")}))`], { encoding: "utf8" });
    if (r.status !== 0) continue;
    if (r.stdout.trim() === "True") return { python: [cmd!, ...args] };
    problems.push(`${[cmd, ...args].join(" ")} is older than Python ${MIN_PYTHON.join(".")}`);
  }
  return { problem: problems.length ? problems.join("; ") : "no Python 3 found (set PYTHON)" };
}

/** pyright (the type checker the generated code is checked with): $PYRIGHT, else `pyright` on PATH. */
export function findPyright(): { pyright?: string; problem?: string } {
  const cmd = process.env["PYRIGHT"] ?? "pyright";
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (r.status === 0 && /pyright/i.test(r.stdout)) return { pyright: cmd };
  return { problem: "pyright not found (npm install --global pyright, or set PYRIGHT)" };
}

export interface PyrightDiagnostic {
  file: string;
  severity: string;
  message: string;
  line: number;
}

/** Run `pyright --strict` (Python 3.8 rules) over every .py file in `dir`; returns all diagnostics. */
export function runPyright(pyright: string, dir: string): PyrightDiagnostic[] {
  writeFileSync(join(dir, "pyrightconfig.json"), JSON.stringify({ typeCheckingMode: "strict", pythonVersion: `${MIN_PYTHON.join(".")}` }));
  const r = spawnSync(pyright, ["--outputjson"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26, shell: process.platform === "win32" });
  let report: { generalDiagnostics?: { file: string; severity: string; message: string; range?: { start: { line: number } } }[] };
  try {
    report = JSON.parse(r.stdout) as typeof report;
  } catch {
    throw new Error(`pyright failed: ${(r.stderr || r.stdout || "").slice(0, 2000)}`);
  }
  return (report.generalDiagnostics ?? []).map((d) => ({
    file: d.file.replace(/^.*[\\/]/, ""),
    severity: d.severity,
    message: d.message.split("\n")[0]!,
    line: (d.range?.start.line ?? 0) + 1,
  }));
}

export interface PyUnit {
  ir: IrModule;
  options?: PythonOptions;
  script: ScriptStep[];
  autoReset: boolean;
}

/** Generate and run the units; returns the results of every reset/send step, per unit. */
export function runPython(python: string[], units: PyUnit[]): StepResult[][] {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-py-"));
  try {
    const meta = units.map((u, k) => {
      const out = generatePython(u.ir, { ...u.options, className: `U${k}`, module: `u${k}` });
      writeFileSync(join(dir, out.fileName), out.source);
      return {
        module: `u${k}`,
        cls: `U${k}`,
        actions: u.ir.actions.map((a) => [pythonName(a.name), a.name]),
        guards: u.ir.guards.map((g) => [pythonName(g.name), g.name]),
        states: u.ir.states.map((s) => [s.region, s.slot, s.id]),
        // generated with debugInfo and trace: log the trace hook calls, read the state through is_active()
        debug: u.ir.trace && u.options?.debugInfo === true,
        labels: u.ir.states.map((s) => s.label),
        // name and expiry event (index) per timer, checked against the module's timer_event() and TIMER_NAMES
        timers: u.ir.timers.map((t) => [t.name, t.event]),
        fingerprint: u.ir.fingerprint,
      };
    });
    writeFileSync(join(dir, "units.json"), JSON.stringify(meta));
    writeFileSync(join(dir, "driver.py"), DRIVER);
    const input: string[] = [];
    units.forEach((u, k) => {
      const gi = new Map(u.ir.guards.map((g, i) => [g.name, i]));
      const ei = new Map(u.ir.events.map((e, i) => [e.name, i]));
      input.push(`u ${k} ${u.autoReset ? 1 : 0}`);
      for (const s of u.script) input.push(...driverLines(s, gi, ei));
    });
    input.push("q");
    const [cmd, ...args] = python;
    let output: string;
    try {
      output = execFileSync(cmd!, [...args, "-B", "-X", "utf8", join(dir, "driver.py"), dir], { input: `${input.join("\n")}\n`, encoding: "utf8", maxBuffer: 1 << 28, stdio: "pipe" });
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      throw new Error(`generated Python failed:\n${String(err.stderr ?? err.message).slice(-4000)}`);
    }
    return parseDriverOutput(output, units.length);
  } finally {
    removeTempDir(dir);
  }
}

const DRIVER = `import json
import sys

sys.path.insert(0, sys.argv[1])
with open(sys.argv[1] + "/units.json") as f:
    META = json.load(f)
calls = []
guards = {}
# x raise/reenter for the next step (action or guard names), its event, the nested call's outcome
step = {"raise": None, "reenter": None, "event": 0, "nested": "-"}


class Raised(Exception):
    pass


class Handler(object):
    pass


def action(name):
    calls.append(name)
    if name == step["raise"]:
        raise Raised(name)
    if name == step["reenter"] and step["nested"] == "-":
        try:
            machine.process(step["event"])
            step["nested"] = "ok"
        except error as e:
            step["nested"] = e.code


def guard(i, name):
    if name == step["raise"]:
        raise Raised(name)
    return guards.get(i, False)


def tracer(unit, cls):
    def trace(kind, id):
        if kind == 0:
            calls.append("@event:" + cls.EVENT_NAMES[id])
        elif kind == 1:
            calls.append("@signal:" + cls.SIGNAL_NAMES[id])
        else:
            calls.append("@%s:%d" % (("t", "enter", "exit")[kind - 2], id))
            if kind > 2 and cls.STATE_NAMES[id] != unit["labels"][id]:
                calls.append("BAD_STATE_NAME")
    return trace


def timer_check(unit, mod, cls, timer):
    # the machine passes members of the timer enum; their expiry event and name must match the model
    if not isinstance(timer, getattr(mod, unit["cls"] + "Timer")):
        calls.append("BAD_TIMER_TYPE")
    name, event = unit["timers"][timer]
    if getattr(mod, unit["module"] + "_timer_event")(timer) != event:
        calls.append("BAD_TIMER_EVENT")
    if unit["debug"] and cls.TIMER_NAMES[timer] != name:
        calls.append("BAD_TIMER_NAME")
    return name


def make_handler(unit, mod, cls):
    h = Handler()
    if unit["debug"]:
        h.trace = tracer(unit, cls)
    if unit["timers"]:
        def timer_start(timer, ms, periodic):
            name = timer_check(unit, mod, cls, timer)
            if type(ms) is not int or type(periodic) is not bool:
                calls.append("BAD_TIMER_ARGS")
            calls.append("~start:%s:%d:%d" % (name, ms, 1 if periodic else 0))

        def timer_stop(timer):
            calls.append("~stop:" + timer_check(unit, mod, cls, timer))

        h.timer_start = timer_start
        h.timer_stop = timer_stop
    for py, name in unit["actions"]:
        setattr(h, py, (lambda n: lambda: action(n))(name))
    for i, (py, name) in enumerate(unit["guards"]):
        setattr(h, py, (lambda i, n: lambda: guard(i, n))(i, name))
    return h


out = []
unit = machine = error = None
auto = dead = False
for line in sys.stdin:
    parts = line.split()
    if not parts:
        continue
    cmd = parts[0]
    if cmd == "q":
        break
    if cmd == "u":
        k = int(parts[1])
        auto = parts[2] == "1"
        dead = False
        unit = META[k]
        guards.clear()
        mod = __import__(unit["module"])
        cls = getattr(mod, unit["cls"])
        if cls.FINGERPRINT != unit["fingerprint"]:
            sys.exit("unit %d: FINGERPRINT %x, expected %x" % (k, cls.FINGERPRINT, unit["fingerprint"]))
        machine = cls(make_handler(unit, mod, cls))
        error = getattr(mod, unit["cls"] + "Error")
        out.append("#u %d" % k)
        continue
    if cmd == "g":
        guards[int(parts[1])] = parts[2] == "1"
        continue
    if cmd == "x":
        step[parts[1]] = parts[2]
        continue
    if dead or machine is None:
        continue
    del calls[:]
    code = "-"
    try:
        if cmd == "r":
            machine.reset()
        else:
            step["event"] = int(parts[1])
            machine.process(step["event"])
    except error as e:
        code = e.code
    except Raised:
        code = "raised"
    if unit["debug"]:
        active = [sid for i, (r, s, sid) in enumerate(unit["states"]) if machine.is_active(i)]
    else:
        active = [sid for (r, s, sid) in unit["states"] if machine._cfg[r] == s]
    out.append("%s\\t%s\\t%s\\t%s" % (" ".join(calls), ",".join(active), code, step["nested"]))
    step.update({"raise": None, "reenter": None, "nested": "-"})
    if code != "-" and auto:
        try:
            machine.reset()
        except error:
            dead = True
sys.stdout.write("\\n".join(out) + "\\n")
`;
