// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Runs generated C#: every machine is generated into namespace U<k> of one console project (with a handler file next
 * to it; the machine class is partial, so that file can also read the configuration), built once with warnings as
 * errors and fed a script per machine on stdin. Used by backend-csharp.test.ts. Same protocol and output as
 * c-harness.ts:
 *
 *   u <unit> <autoReset>  start unit: fresh machine, guards false
 *   g, x, r, e            a script step (driverLines in harness.ts)
 *
 * `x raise` makes the action or guard throw; the driver catches it. `x reenter` makes the action call Process() with
 * the same event; its outcome is reported. Each r/e prints "calls<TAB>active ids<TAB>error<TAB>nested"
 * (parseDriverOutput). With autoReset, an error is followed by a reset; if that fails too, the unit is dead and prints
 * nothing more (like runScript in harness.ts).
 *
 * A unit generated with debugInfo from an IR lowered with trace logs its trace hook calls among the action calls
 * (harness.ts: decodeHooks), checks the names there, reads the configuration through IsActive() and checks the
 * fingerprint.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { csharpName, generateCsharp, hex32, type CsharpOptions, type IrModule } from "../src/pipeline";
import { removeTempDir } from "./c-harness";
import { driverLines, parseDriverOutput, type ScriptStep, type StepResult } from "./harness";

const execFileAsync = promisify(execFile);

/** The environment dotnet runs in: quiet, no telemetry, no first-run work. */
export function dotnetEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_GENERATE_ASPNET_CERTIFICATE: "false",
  };
}

/**
 * A .NET SDK: $DOTNET, else `dotnet` on PATH, else the per-user install of dotnet-install (%LOCALAPPDATA%\Microsoft\
 * dotnet, ~/.dotnet). `framework` is the target framework of its newest SDK (net8.0, ...).
 */
export function findDotnet(): { dotnet?: string; framework?: string; problem?: string } {
  const exe = process.platform === "win32" ? "dotnet.exe" : "dotnet";
  const candidates = process.env["DOTNET"]
    ? [process.env["DOTNET"]]
    : [
        "dotnet",
        ...(process.env["LOCALAPPDATA"] ? [join(process.env["LOCALAPPDATA"], "Microsoft", "dotnet", exe)] : []),
        join(homedir(), ".dotnet", exe),
      ];
  for (const dotnet of candidates) {
    if (dotnet !== "dotnet" && !existsSync(dotnet)) continue;
    const r = spawnSync(dotnet, ["--list-sdks"], { encoding: "utf8", env: dotnetEnv() });
    if (r.status !== 0) continue;
    const majors = [...r.stdout.matchAll(/^(\d+)\.\d+\.\d+/gm)].map((m) => Number(m[1]));
    if (!majors.length) continue;
    return { dotnet, framework: `net${Math.max(...majors)}.0` };
  }
  return { problem: "no .NET SDK found (https://dot.net, or set DOTNET)" };
}

/**
 * The analyzers' naming rules: declaration names are kept as written in the model (underscores, names that differ
 * only in case, keywords of other .NET languages, `long`), so these are the model's business, not the generator's.
 */
const NAMING_RULES = ["CA1707", "CA1708", "CA1716", "CA1720"];

/**
 * A project file: warnings as errors at the highest level, nullable on, XML docs required; with `analysis`, the .NET
 * analyzers' recommended set too (but its naming rules).
 */
export function csproj(framework: string, outputType: "Exe" | "Library", analysis = false): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${framework}</TargetFramework>
    <OutputType>${outputType}</OutputType>
    <Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <WarningLevel>9999</WarningLevel>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>${[...(outputType === "Exe" ? ["CS1591"] : []), ...(analysis ? NAMING_RULES : [])].join(";")}</NoWarn>
    <AnalysisLevel>latest</AnalysisLevel>
    <AnalysisMode>${analysis ? "Recommended" : "Default"}</AnalysisMode>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
  </PropertyGroup>
</Project>
`;
}

/** Build the project in `dir`; throws with the compiler's messages on failure. */
export async function dotnetBuild(dotnet: string, dir: string): Promise<void> {
  try {
    await execFileAsync(dotnet, ["build", "-c", "Release", "-nologo", "-clp:NoSummary;ErrorsOnly", "-o", "out"], {
      cwd: dir,
      env: dotnetEnv(),
      maxBuffer: 1 << 26,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`dotnet build failed:\n${String(err.stdout || err.stderr || err.message).slice(0, 6000)}`);
  }
}

export interface CsharpUnit {
  ir: IrModule;
  options?: CsharpOptions;
  script: ScriptStep[];
  autoReset: boolean;
}

const str = (s: string): string => JSON.stringify(s);

/** The handler and the test entry points of unit `k`, in its namespace. */
function unitCode(k: number, ir: IrModule, debug: boolean): string {
  const c: string[] = [`namespace U${k}`, "{", "    internal sealed class TestHandler : IMachineHandler", "    {"];
  for (const a of ir.actions) c.push(`        public void ${csharpName(a.name)}() => Driver.Call(${str(a.name)});`);
  ir.guards.forEach((g, i) =>
    c.push(`        public bool ${csharpName(g.name)}() => Driver.Guard(${i}, ${str(g.name)});`),
  );
  if (ir.timers.length) {
    // logged as "~start:<name>:<ms>:<0|1>" / "~stop:<name>" (driverCall in harness.ts); each call also checks the
    // timer's event (and name with debugInfo)
    c.push(
      `        private static readonly string[] TimerNames = { ${ir.timers.map((t) => str(t.name)).join(", ")} };`,
      `        private static readonly int[] TimerEventNos = { ${ir.timers.map((t) => t.event).join(", ")} };`,
      "        private static string Timer(MachineTimer timer)",
      "        {",
      "            int i = (int)timer;",
      '            if (i < 0 || i >= TimerNames.Length) { Driver.Call("BAD_TIMER"); return "?"; }',
      '            if ((int)Machine.TimerEvent(timer) != TimerEventNos[i]) Driver.Call("BAD_TIMER_EVENT");',
      ...(debug ? ['            if (Machine.TimerNames[i] != TimerNames[i]) Driver.Call("BAD_TIMER_NAME");'] : []),
      "            return TimerNames[i];",
      "        }",
      '        public void TimerStart(MachineTimer timer, uint ms, bool periodic) => Driver.Call("~start:" + Timer(timer) + ":" + ms + (periodic ? ":1" : ":0"));',
      '        public void TimerStop(MachineTimer timer) => Driver.Call("~stop:" + Timer(timer));',
    );
  }
  if (debug) {
    c.push(
      `        private static readonly string[] Labels = { ${ir.states.map((s) => str(s.label)).join(", ")} };`,
      "        public void Trace(MachineTraceKind kind, int id)",
      "        {",
      "            switch (kind)",
      "            {",
      "                case MachineTraceKind.Event:",
      '                    Driver.Call("@event:" + Machine.EventNames[id]);',
      "                    break;",
      "                case MachineTraceKind.Signal:",
      '                    Driver.Call("@signal:" + Machine.SignalNames[id]);',
      "                    break;",
      "                case MachineTraceKind.Transition:",
      '                    Driver.Call("@t:" + id);',
      "                    break;",
      "                default:",
      '                    Driver.Call((kind == MachineTraceKind.Enter ? "@enter:" : "@exit:") + id);',
      '                    if (id < 0 || id >= Labels.Length || Machine.StateNames[id] != Labels[id]) Driver.Call("BAD_STATE_NAME");',
      "                    break;",
      "            }",
      "        }",
    );
  }
  c.push("    }", "");
  c.push(
    "    public sealed partial class Machine",
    "    {",
    "        internal bool TestCfg(int r, int s) => cfg[r] == s;",
    "    }",
    "",
    "    internal sealed class Unit : IUnit",
    "    {",
    "        private readonly Machine m;",
    "        public Unit()",
    "        {",
    ...(debug
      ? [
          `            if (Machine.Fingerprint != ${hex32(ir.fingerprint)}u) throw new global::System.InvalidOperationException("fingerprint");`,
        ]
      : []),
    "            var h = new TestHandler();",
    "            m = new Machine(h);",
    "        }",
    "        private static string Run(global::System.Action a, string ok)",
    "        {",
    "            try { a(); return ok; }",
    "            catch (MachineException e) { return e.Code; }",
    "        }",
    '        public string Reset() => Run(m.Reset, "-");',
    '        public string Process(int e) => Run(() => m.Process((MachineEvent)e), "-");',
    '        public string Nested(int e) => Run(() => m.Process((MachineEvent)e), "ok");',
    debug && ir.states.length
      ? "        public bool Active(int i) => m.IsActive((MachineState)i);"
      : `        private static readonly int[,] At = { ${ir.states.length ? ir.states.map((s) => `{ ${s.region}, ${s.slot} }`).join(", ") : "{ 0, 0 }"} };\n        public bool Active(int i) => m.TestCfg(At[i, 0], At[i, 1]);`,
    `        public string[] States { get; } = { ${ir.states.map((s) => str(s.id)).join(", ")} };`,
    "    }",
    "}",
  );
  return `${c.join("\n")}\n`;
}

function programCode(n: number): string {
  return `using System;
using System.Collections.Generic;
using System.Text;

internal interface IUnit
{
    string Reset();
    string Process(int e);
    string Nested(int e);
    bool Active(int i);
    string[] States { get; }
}

internal sealed class Raised : Exception
{
}

internal static class Driver
{
    public static readonly List<string> Calls = new List<string>();
    public static readonly bool[] Guards = new bool[256];
    public static string RaiseName = "", ReenterName = "", Nested = "-";
    public static int Event;
    public static IUnit? Current;

    public static void Call(string name)
    {
        Calls.Add(name);
        if (name.Length > 0 && name == RaiseName) throw new Raised();
        if (name.Length > 0 && name == ReenterName && Nested == "-")
        {
            Nested = "pending";
            Nested = Current!.Nested(Event);
        }
    }

    public static bool Guard(int i, string name)
    {
        if (name == RaiseName) throw new Raised();
        return Guards[i];
    }

    private static IUnit Make(int k)
    {
        switch (k)
        {
${Array.from({ length: n }, (_, k) => `            case ${k}: return new U${k}.Unit();`).join("\n")}
            default: throw new ArgumentOutOfRangeException(nameof(k));
        }
    }

    public static void Main()
    {
        var output = new StringBuilder();
        IUnit? u = null;
        bool auto = false, dead = false;
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            string[] w = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (w.Length == 0) continue;
            if (w[0] == "q") break;
            if (w[0] == "u")
            {
                int k = int.Parse(w[1]);
                auto = w[2] == "1";
                dead = false;
                Array.Clear(Guards, 0, Guards.Length);
                u = Make(k);
                Current = u;
                output.Append("#u ").Append(k).Append('\\n');
                continue;
            }
            if (w[0] == "g") { Guards[int.Parse(w[1])] = w[2] == "1"; continue; }
            if (w[0] == "x") { if (w[1] == "raise") RaiseName = w[2]; else ReenterName = w[2]; continue; }
            if (dead || u == null) continue;
            Calls.Clear();
            string code;
            try
            {
                if (w[0] == "r") code = u.Reset();
                else
                {
                    Event = int.Parse(w[1]);
                    code = u.Process(Event);
                }
            }
            catch (Raised)
            {
                code = "raised";
            }
            RaiseName = "";
            ReenterName = "";
            var active = new List<string>();
            for (int i = 0; i < u.States.Length; i++) if (u.Active(i)) active.Add(u.States[i]);
            output.Append(string.Join(" ", Calls)).Append('\\t').Append(string.Join(",", active)).Append('\\t')
                .Append(code).Append('\\t').Append(Nested).Append('\\n');
            Nested = "-";
            if (code != "-" && auto && u.Reset() != "-") dead = true;
        }
        Console.Out.Write(output.ToString());
    }
}
`;
}

/** Generate, build and run the units; returns the results of every reset/send step, per unit. */
export async function runCsharp(
  tools: { dotnet: string; framework: string },
  units: CsharpUnit[],
): Promise<StepResult[][]> {
  const dir = mkdtempSync(join(tmpdir(), "ufsm-cs-"));
  try {
    units.forEach((u, k) => {
      const out = generateCsharp(u.ir, { ...u.options, namespace: `U${k}`, className: "Machine", file: `U${k}` });
      writeFileSync(join(dir, out.fileName), out.source);
      writeFileSync(join(dir, `U${k}.Test.cs`), unitCode(k, u.ir, u.ir.trace && u.options?.debugInfo === true));
    });
    writeFileSync(join(dir, "Program.cs"), programCode(units.length));
    writeFileSync(join(dir, "driver.csproj"), csproj(tools.framework, "Exe"));
    await dotnetBuild(tools.dotnet, dir);
    const input: string[] = [];
    units.forEach((u, k) => {
      const gi = new Map(u.ir.guards.map((g, i) => [g.name, i]));
      const ei = new Map(u.ir.events.map((e, i) => [e.name, i]));
      input.push(`u ${k} ${u.autoReset ? 1 : 0}`);
      for (const s of u.script) input.push(...driverLines(s, gi, ei));
    });
    input.push("q");
    const output = execFileSync(tools.dotnet, [join(dir, "out", "driver.dll")], {
      input: `${input.join("\n")}\n`,
      encoding: "utf8",
      env: dotnetEnv(),
      maxBuffer: 1 << 28,
    });
    return parseDriverOutput(output, units.length);
  } finally {
    removeTempDir(dir);
  }
}
