// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * `window.ufsm`: the hook headless checks (test/browser/check.mjs) drive the editor through: load without dialogs, map
 * coordinates, read the selection, the simulator, the search and the settings. It only calls the parts' public
 * methods; .claude/rules/editor.md lists what it offers.
 */
import { loadModel, serializeV1 } from "@ufsm/core";
import { actionBlock, edgeGeometry, vertexBox } from "@ufsm/core/diagram";
import type { App } from "./app";
import type { ToolId } from "./palette";
import { search } from "./search";
import { serializeSettings } from "./settings";

export function installAutomation(app: App): void {
  const { ws, canvas } = app;
  const sim = app.sim;
  Object.assign(window, {
    ufsm: {
      /** Open a model in a new tab (no dialog). */
      load: (text: string, name: string) => void app.files.showModel(loadModel(text), name, undefined),
      /** File › New. */
      newModel: () => app.files.newModel(),
      /** Open machines in tab order. */
      tabs: () => ws.sessions.map((d) => ({ name: d.fileName, dirty: d.dirty, active: d === ws.active })),
      activateTab: (i: number) => ws.activate(ws.sessions[i]),
      /** Close tab i; `force` skips the unsaved-changes question. */
      closeTab: (i: number, force = false) => app.files.closeDoc(ws.sessions[i], force),
      view: () => ({ ...canvas.view }),
      worldToScreen: (x: number, y: number): [number, number] => canvas.worldToScreen(x, y),
      selectedName: () => {
        const v = ws.single();
        return v ? (v.name ?? v.kind) : undefined;
      },
      /** All selected ids, vertices and transitions, in no particular order. */
      selectedIds: (): string[] => (ws.active ? [...ws.active.selection] : []),
      serialize: () => (ws.active ? serializeV1(ws.active.history.current) : undefined),
      /** The armed tool ("select" when none). */
      tool: () => app.tools.tool,
      /** Pick a tool as a palette click does. */
      pickTool: (t: ToolId) => app.pickTool(t),
      /** The status line text. */
      status: () => app.shell.status(),
      select: (ids: string[]) => ws.select(ids),
      undo: () => ws.undo(),
      redo: () => ws.redo(),
      canUndo: () => ws.active?.history.canUndo ?? false,
      canRedo: () => ws.active?.history.canRedo ?? false,
      isDirty: () => ws.active?.dirty ?? false,
      /** Absolute world box of a vertex. */
      box: (id: string) => (ws.active ? vertexBox(ws.active.index, id) : undefined),
      /** The design rule check's findings for the active machine. */
      problems: () => ws.active?.diagnostics ?? [],
      /** A state's action block: lines, height, what is hidden and its marker (diagram/action-block.ts), with the marker's screen centre. */
      actionBlock: (id: string) => {
        const d = ws.active;
        const v = d?.index.vertices.get(id)?.vertex;
        if (!d || v?.kind !== "state") return undefined;
        const block = actionBlock(d.index, v);
        const b = vertexBox(d.index, id);
        const m = block.hiddenMarker;
        return { ...block, hiddenMarkerScreen: m && canvas.worldToScreen(b.x + m.x + m.w / 2, b.y + m.y + m.h / 2) };
      },
      /** Absolute polyline and label of a transition. */
      route: (id: string) => (ws.active ? edgeGeometry(ws.active.index, id) : undefined),
      /** Simulator: start (or restart), stop, send an event, set a guard, and what it shows. */
      simStart: () => sim.start(),
      simStop: () => sim.stop(),
      simSend: (event: string) => sim.ops.send(event),
      /** Fire a running timer by name (its event is sent). */
      simFire: (name: string) => {
        const t = ws.active?.sim?.timers().find((x) => x.name === name);
        if (t) sim.ops.fire(t.id);
      },
      simGuard: (name: string, value: boolean) => sim.ops.setGuard(name, value),
      sim: () => {
        const d = ws.active;
        const s = d?.sim;
        if (!d || !s) return undefined;
        return {
          stale: d.simStale,
          steps: s.steps.length,
          active: s.activeIds().map((id) => s.index.vertices.get(id)?.vertex.name ?? id),
          fired: [...s.fired],
          hover: d.hoverEvent,
          would: d.hoverEvent ? (d.wouldMap().get(d.hoverEvent) ?? []) : [],
          calls: s.steps[s.steps.length - 1]?.calls ?? [],
          timers: s.timers().map((t) => t.name),
          error: d.simError,
          trace: sim.traceText(d, s, undefined),
        };
      },
      simError: () => ws.active?.simError,
      /** The panel tab shown. */
      panelTab: () => app.shell.panelTab,
      /** Open the search field with this text (as Ctrl+P does with "", Ctrl+Shift+P with ">"). */
      openSearch: (text = "") => app.shell.openSearch(text),
      /** The rows the search would list for this text, best first. */
      search: (text: string) =>
        search(app.search.items(), text, { activeDoc: ws.active?.key, recent: app.search.recent() }).map((m) => ({
          label: m.item.label,
          kind: m.item.kind,
          detail: m.item.detail,
          machine: m.item.docName,
          checked: m.item.checked ?? false,
        })),
      /** The theme in use: id, modifier inputs, appearance. */
      theme: () => {
        const t = app.settings.theme;
        return { id: t.id, inputs: { ...t.inputs }, appearance: t.appearance };
      },
      /** The UI zoom in percent (Settings › Zoom). */
      zoom: () => app.settings.settings.zoom,
      /** The settings as settings.json would hold them. */
      settings: () => serializeSettings(app.settings.settings),
      /** Handles of the selection, with their screen positions. */
      handles: () => canvas.handles().map((h) => ({ ...h.grip, screen: canvas.worldToScreen(h.x, h.y) })),
    },
  });
}
