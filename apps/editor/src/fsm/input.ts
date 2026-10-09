// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Turns DOM events into events of the editor's interaction model
 * (editor.ufsm, generated into editor-fsm.ts). uFSM events carry no data, so
 * the pointer position, the modifiers and the wheel delta of the event being
 * processed are kept in `input`, where the handler's actions and guards
 * read them.
 */
import { EditorFsm, EditorFsmEvent, type EditorFsmHandler } from "./editor-fsm";

export interface InputState {
  /** Pointer position of the current event, client coordinates. */
  x: number;
  y: number;
  /** Where the current button was pressed. */
  startX: number;
  startY: number;
  /** Position of the previous pointer event, for panning. */
  lastX: number;
  lastY: number;
  shift: boolean;
  /** Ctrl, or Cmd on macOS. */
  ctrl: boolean;
  wheelDeltaY: number;
  /** Palette tool of the current ePalette event. */
  tool: string;
  /** True while the pointer is over the canvas (where paste and `a v` put things). */
  over: boolean;
}

/** Plain keys of the old editor's key map; Ctrl/Shift combinations reach the same events with the modifier guards. */
const KEYS: Record<string, EditorFsmEvent> = {
  o: EditorFsmEvent.eKey_o,
  s: EditorFsmEvent.eKey_s,
  S: EditorFsmEvent.eKey_S,
  n: EditorFsmEvent.eKey_n,
  p: EditorFsmEvent.eKey_p,
  P: EditorFsmEvent.eKey_P,
  a: EditorFsmEvent.eKey_a,
  t: EditorFsmEvent.eKey_t,
  i: EditorFsmEvent.eKey_i,
  h: EditorFsmEvent.eKey_h,
  H: EditorFsmEvent.eKey_H,
  F: EditorFsmEvent.eKey_F,
  T: EditorFsmEvent.eKey_T,
  v: EditorFsmEvent.eKey_v,
  c: EditorFsmEvent.eKey_c,
  x: EditorFsmEvent.eKey_x,
  e: EditorFsmEvent.eKey_e,
  g: EditorFsmEvent.eKey_g,
  O: EditorFsmEvent.eKey_O,
  Delete: EditorFsmEvent.eKey_delete,
  z: EditorFsmEvent.eKey_z,
  f: EditorFsmEvent.eKey_f,
  j: EditorFsmEvent.eKey_j,
  l: EditorFsmEvent.eKey_l,
  r: EditorFsmEvent.eKey_r,
  Enter: EditorFsmEvent.eKey_enter,
  Backspace: EditorFsmEvent.eKey_backspace,
  Escape: EditorFsmEvent.eKey_esc,
  Tab: EditorFsmEvent.eKey_tab,
  F1: EditorFsmEvent.eKey_f1,
  F5: EditorFsmEvent.eKey_f5,
  // UI zoom (with Ctrl): "=" is the plus key without Shift on US layouts, "+" on others and the keypad.
  "+": EditorFsmEvent.eKey_plus,
  "=": EditorFsmEvent.eKey_plus,
  "-": EditorFsmEvent.eKey_minus,
  "0": EditorFsmEvent.eKey_0,
};

/** Ctrl+these work while typing in a field too (they mean nothing to a text field): UI zoom, the search (Ctrl+P,
 * Ctrl+Shift+P; the search field handles them itself while it has the focus). F1 too. */
const FIELD_KEYS: ReadonlySet<string> = new Set(["+", "=", "-", "0", "p", "P"]);

function inTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}

export interface Input {
  machine: EditorFsm;
  input: InputState;
  /** A palette click (or an Add menu item): send ePalette with that tool. */
  pickTool(tool: string): void;
}

/**
 * Create the machine around `handler` (whose guards can read `input`) and feed it the canvas's and the window's
 * events. Pointer events are only passed on while `active()` (a model is open); keys always are. `before` runs before
 * every key, button press and palette pick.
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  makeHandler: (input: InputState) => EditorFsmHandler,
  active: () => boolean,
  before: () => void = () => undefined,
): Input {
  const input: InputState = { x: 0, y: 0, startX: 0, startY: 0, lastX: 0, lastY: 0, shift: false, ctrl: false, wheelDeltaY: 0, tool: "select", over: false };
  const machine = new EditorFsm(makeHandler(input));
  machine.reset();
  let pointer: number | undefined;

  const send = (event: EditorFsmEvent, e: MouseEvent | KeyboardEvent): void => {
    input.shift = e.shiftKey;
    input.ctrl = e.ctrlKey || e.metaKey;
    if (e instanceof MouseEvent) {
      input.x = e.clientX;
      input.y = e.clientY;
    }
    if (e instanceof KeyboardEvent || event === EditorFsmEvent.eLMBDown || event === EditorFsmEvent.eRMBDown) before();
    machine.process(event);
    if (e instanceof MouseEvent) {
      input.lastX = e.clientX;
      input.lastY = e.clientY;
    }
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (pointer !== undefined || !active()) return;
    const event = e.button === 0 ? EditorFsmEvent.eLMBDown : e.button === 1 || e.button === 2 ? EditorFsmEvent.eRMBDown : undefined;
    if (event === undefined) return;
    if (e.button === 1) e.preventDefault(); // no middle-button autoscroll
    pointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    input.startX = e.clientX;
    input.startY = e.clientY;
    send(event, e);
  });
  canvas.addEventListener("pointerenter", () => void (input.over = true));
  canvas.addEventListener("pointerleave", () => void (input.over = false));
  canvas.addEventListener("pointermove", (e) => {
    input.over = true;
    if (!active() || (pointer !== undefined && e.pointerId !== pointer)) return;
    send(EditorFsmEvent.eMotion, e);
  });
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    pointer = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel") send(EditorFsmEvent.eCancel, e);
    else send(e.button === 0 ? EditorFsmEvent.eLMBUp : EditorFsmEvent.eRMBUp, e);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("dblclick", (e) => {
    if (active()) send(EditorFsmEvent.eDoubleClick, e);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (!active()) return;
      input.wheelDeltaY = e.deltaY;
      send(EditorFsmEvent.eWheel, e);
    },
    { passive: false },
  );
  // The webview's own context menu ("Save image as…") is no use on the canvas.
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("auxclick", (e) => e.preventDefault());
  // Losing the window (Alt+Tab) ends any drag.
  window.addEventListener("blur", () => {
    if (pointer === undefined) return;
    pointer = undefined;
    machine.process(EditorFsmEvent.eCancel);
  });

  window.addEventListener("keydown", (e) => {
    // Ctrl+Shift+P: some layouts and platforms report the key in lower case
    const key = e.key === "p" && e.shiftKey ? "P" : e.key;
    if (inTextField(e.target) && !(((e.ctrlKey || e.metaKey) && FIELD_KEYS.has(key)) || key === "F1")) return;
    const event = KEYS[key];
    if (event === undefined) return;
    // Plain Tab keeps moving focus between controls; Ctrl+Tab switches machines.
    if (key === "Tab" && !(e.ctrlKey || e.metaKey)) return;
    // Mapped keys never do anything else: an action may move the focus into a field (`a g` opens a picker), and the
    // key's default would then type into it.
    e.preventDefault();
    send(event, e);
  });
  return {
    machine,
    input,
    pickTool(tool) {
      input.tool = tool;
      before();
      machine.process(EditorFsmEvent.ePalette);
    },
  };
}
