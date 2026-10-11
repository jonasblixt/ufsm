// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The Simulator tab and the Code tab of the active machine: starting and stopping the simulation, sending events,
 * guard values and option overrides, saving the recorded trace, and the generated code (preview, copy, save, File ›
 * Generate). The simulation itself is sim.ts; what the session keeps of it is in session.ts.
 */
import { MachineError, behaviourOptions, formatTrace, type CodeTarget, type GeneratedFile } from "@ufsm/core";
import { el, type App } from "./app";
import { generatedCode } from "./code";
import type { CodeOps } from "./codepanel";
import { baseName, copyText, inTauri, saveFilesToFolder, saveTextFile } from "./platform";
import type { DocSession } from "./session";
import { Simulation, relativePath } from "./sim";
import type { SimOps, SimProps } from "./simpanel";

export interface SimController {
  /** Start the simulation of the active machine, or start it over (F5). */
  start(): void;
  /** Stop the simulation (Shift+F5); the canvas goes back to plain colours. */
  stop(): void;
  saveTrace(): Promise<void>;
  copyTrace(): Promise<void>;
  /** The trace of the running simulation, its model path relative to `tracePath` when both paths are known. */
  traceText(d: DocSession, sim: Simulation, tracePath: string | undefined): string;
  readonly ops: SimOps;
  props(d: DocSession): SimProps;
  readonly codeOps: CodeOps;
  /** Write the generated files of a target into a folder (File › Generate …). */
  generateTo(target: CodeTarget): Promise<void>;
  /** The status bar's simulation item. */
  updateStatus(): void;
}

export function createSimController(app: App): SimController {
  const ws = app.ws;
  const statusEl = el<HTMLButtonElement>("sim-status");
  statusEl.addEventListener("click", () => app.shell.showPanelTab("simulator"));

  const start = (): void => {
    const d = ws.active;
    if (!d) return;
    d.hoverEvent = undefined;
    try {
      d.sim = new Simulation(d.history.current, d.guards, d.simOptions);
      d.simError = undefined;
      d.sim.reset();
    } catch (e) {
      d.sim = undefined;
      const errors = d.diagnostics.filter((x) => x.severity === "error").length;
      d.simError =
        e instanceof MachineError && e.code === "invalid-model"
          ? `The machine has ${errors || "some"} error${errors === 1 ? "" : "s"} (see Problems); fix ${errors === 1 ? "it" : "them"} to simulate.`
          : `Cannot simulate: ${String(e)}`;
    }
    app.shell.showPanelTab("simulator", false);
    ws.changed("sim");
  };

  const stop = (): void => {
    const d = ws.active;
    if (!d?.sim && !d?.simError) return;
    d.sim = undefined;
    d.simError = undefined;
    d.hoverEvent = undefined;
    ws.changed("sim");
  };

  const traceText = (d: DocSession, sim: Simulation, tracePath: string | undefined): string => {
    const model = d.path && tracePath ? relativePath(tracePath, d.path) : d.path ? baseName(d.path) : d.fileName;
    return formatTrace(sim.trace(model, { active: d.recordActive }));
  };

  const saveTrace = async (): Promise<void> => {
    const d = ws.active, sim = d?.sim;
    if (!d || !sim) return;
    try {
      const name = `${d.fileName.replace(/\.ufsm$/i, "")}.json`;
      const written = await saveTextFile(name, { name: "uFSM trace", extensions: ["json"] }, (path) => traceText(d, sim, inTauri ? path : undefined));
      if (written) ws.say(`Saved the trace (${sim.steps.length} steps) as ${baseName(written)}. Replay it with: ufsm trace ${baseName(written)}`);
    } catch (e) {
      ws.say(`Saving the trace failed: ${String(e)}`);
    }
  };

  const copyTrace = async (): Promise<void> => {
    const d = ws.active, sim = d?.sim;
    if (!d || !sim) return;
    ws.say((await copyText(traceText(d, sim, undefined))) ? `Copied the trace (${sim.steps.length} steps).` : "Could not use the clipboard.");
  };

  /** A running, up-to-date simulation of the active machine. */
  const running = (): DocSession | undefined => {
    const d = ws.active;
    return d?.sim && !d.simStale ? d : undefined;
  };

  const ops: SimOps = {
    start,
    stop,
    send: (event) => {
      const d = running();
      if (!d) return;
      d.sim!.send(event);
      ws.changed("sim");
    },
    fire: (timerId) => {
      const d = running();
      if (!d) return;
      d.sim!.fire(timerId);
      ws.changed("sim");
    },
    setGuard: (name, value) => {
      const d = ws.active;
      if (!d) return;
      d.guards.set(name, value);
      d.guardsVersion++;
      ws.changed("sim");
    },
    setOption: (key, value) => {
      const d = ws.active;
      if (!d) return;
      const { [key]: _, ...rest } = d.simOptions;
      // The model's own value is no override: the run follows the model again when its options change.
      d.simOptions = value === behaviourOptions(d.history.current)[key] ? rest : { ...rest, [key]: value };
      ws.changed("shell");
    },
    hover: (event) => {
      const d = ws.active;
      if (!d || d.hoverEvent === event) return;
      d.hoverEvent = event;
      app.canvas.requestDraw();
    },
    select: (id) => app.nav.selectFromPanel(id),
    saveTrace: () => void saveTrace(),
    copyTrace: () => void copyTrace(),
    setRecordActive: (on) => {
      const d = ws.active;
      if (!d) return;
      d.recordActive = on;
      ws.changed("shell");
    },
  };

  const codeOps: CodeOps = {
    setView: (id) => {
      const d = ws.active;
      if (!d) return;
      d.codeView = id;
      ws.changed("shell");
    },
    copy: (text, what) => void copyText(text).then((ok) => ws.say(ok ? `Copied ${what}.` : "Could not use the clipboard.")),
    save: (file: GeneratedFile) =>
      void saveTextFile(file.name, { name: file.name.split(".").pop()!.toUpperCase(), extensions: [file.name.split(".").pop()!] }, () => file.text)
        .then((p) => p && ws.say(`Saved ${baseName(p)}`))
        .catch((e: unknown) => ws.say(`Saving failed: ${String(e)}`)),
    saveAll: (files) =>
      void saveFilesToFolder(files)
        .then((dir) => dir && ws.say(`Wrote ${files.map((f) => f.name).join(" and ")} to ${dir}`))
        .catch((e: unknown) => ws.say(`Writing the files failed: ${String(e)}`)),
    showProblems: () => app.shell.showPanelTab("problems"),
  };

  return {
    start,
    stop,
    saveTrace,
    copyTrace,
    traceText,
    ops,
    props: (d) => ({
      index: d.index,
      sim: d.sim,
      stale: d.simStale,
      error: d.simError,
      would: d.wouldMap(),
      guards: d.guards,
      options: { ...behaviourOptions(d.history.current), ...d.simOptions },
      overridden: d.simOptions,
      recordActive: d.recordActive,
      ops,
    }),
    codeOps,
    generateTo: async (target) => {
      const d = ws.active;
      if (!d) return;
      const r = generatedCode(d.history.current, target);
      if ("error" in r) {
        ws.say(`Cannot generate code: ${r.error}`);
        return;
      }
      try {
        const dir = await saveFilesToFolder(r.files);
        if (dir) ws.say(`Wrote ${r.files.map((f) => f.name).join(" and ")} to ${dir}`);
      } catch (e) {
        ws.say(`Writing the files failed: ${String(e)}`);
      }
    },
    updateStatus: () => {
      const d = ws.active;
      const sim = d?.sim;
      statusEl.hidden = !sim;
      if (!d || !sim) return;
      const stale = d.simStale;
      statusEl.textContent = stale ? "Simulation out of date" : `Simulating · step ${sim.steps.length - 1}${sim.terminated ? " · terminated" : ""}`;
      statusEl.classList.toggle("stale", stale);
    },
  };
}
