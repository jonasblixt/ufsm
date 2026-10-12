// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Title bar in the style of VS Code: app icon, menu bar, the search field in the middle (quickpick.tsx) and (on
 * Windows and Linux, where the window is frameless) minimize/maximize/close. The empty parts drag the window
 * (`data-tauri-drag-region`; double-click maximizes). On macOS the system's traffic lights sit at the left.
 */
import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { QuickPick, type QuickPickProps } from "./quickpick";

export interface MenuItem {
  /** Text, or a function for one that changes ("Start Simulation" / "Restart Simulation"). */
  label: string | (() => string);
  /** Shortcut as shown, e.g. "Ctrl+Z" or "Z F". */
  keys?: string;
  run(): void;
  enabled?(): boolean;
  /** Shows a check mark when true (toggles such as panels). */
  checked?(): boolean;
  /** Dimmed text in place of the keys (a recent file's folder). */
  detail?: string;
  /** Tooltip (a recent file's full path). */
  title?: string;
  /** Items of a submenu that opens beside this one (File › Open Recent); clicking the item opens it too. */
  submenu?(): MenuEntry[];
}

export type MenuEntry = MenuItem | "-";

export interface Menu {
  label: string;
  items: MenuEntry[];
}

export interface TitleBarProps {
  menus: Menu[];
  /** The search field (Ctrl+P) and what it finds. */
  search: QuickPickProps;
  /** Draw minimize/maximize/close (frameless window). */
  windowControls: boolean;
  /** Leave room for the macOS traffic lights. */
  mac: boolean;
  maximized: boolean;
  onMinimize(): void;
  onToggleMaximize(): void;
  onClose(): void;
}

const S = { fill: "none", stroke: "currentColor", "stroke-width": "1" } as const;

function AppIcon() {
  return (
    <svg class="app-icon" viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
      <g fill="#fe8019" stroke="#fe8019" stroke-width="1" stroke-linejoin="round">
        <polygon points="119.66,250.00 205.33,132.21 132.71,169.19 89.75,228.25" />
        <polygon points="110.51,132.21 141.44,70.35 108.36,53.81 50.67,169.19" />
        <polygon points="141.65,69.92 152.44,86.10 152.94,6.00 89.16,54.46 108.58,53.38" />
      </g>
      <polygon fill="#d65d0e" points="205.33,132.21 110.51,132.21 50.67,169.19 132.71,169.19" />
    </svg>
  );
}

function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpenMenu] = useState<number | undefined>(undefined);
  /** The item of the open menu whose submenu is shown. */
  const [sub, setSub] = useState<number | undefined>(undefined);
  const ref = useRef<HTMLElement>(null);
  const setOpen = (i: number | undefined): void => {
    setOpenMenu(i);
    setSub(undefined);
  };

  const item = (it: MenuItem, k: number, onEnter: () => void) => (
    <button
      type="button"
      key={k}
      class={`menu-item${it.submenu ? " has-submenu" : ""}`}
      role={it.checked ? "menuitemcheckbox" : "menuitem"}
      aria-checked={it.checked ? it.checked() : undefined}
      aria-haspopup={it.submenu ? "true" : undefined}
      title={it.title}
      disabled={it.enabled ? !it.enabled() : false}
      onPointerDown={(e) => e.preventDefault()}
      onPointerEnter={onEnter}
      onClick={() => {
        if (it.submenu) {
          setSub(k);
          return;
        }
        setOpen(undefined);
        it.run();
      }}
    >
      <span class="check">{it.checked?.() ? "✓" : ""}</span>
      <span class="text">{typeof it.label === "function" ? it.label() : it.label}</span>
      {it.detail !== undefined && <span class="detail">{it.detail}</span>}
      <span class="keys">{it.submenu ? "›" : (it.keys ?? "")}</span>
    </button>
  );
  const sep = (k: number) => <div class="menu-sep" key={k} role="separator" />;

  // layout effect: the listeners must be in place before the next key press, not after the next paint
  useLayoutEffect(() => {
    if (open === undefined) return;
    const away = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(undefined);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(undefined);
      }
    };
    const blur = (): void => setOpen(undefined);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
      window.removeEventListener("blur", blur);
    };
  }, [open]);

  return (
    <nav class="menubar" ref={ref} role="menubar">
      {menus.map((m, i) => (
        <div class={`menu${open === i ? " open" : ""}`} key={m.label}>
          <button
            type="button"
            class="menu-label"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === i}
            onPointerDown={(e) => {
              e.preventDefault(); // keep focus where it is (the canvas keys keep working)
              setOpen(open === i ? undefined : i);
            }}
            onPointerEnter={() => {
              if (open !== undefined) setOpen(i);
            }}
          >
            {m.label}
          </button>
          {open === i && (
            <div class="menu-dropdown" role="menu">
              {m.items.map((it, k) =>
                it === "-" ? (
                  sep(k)
                ) : it.submenu ? (
                  <div class="menu-sub" key={k}>
                    {item(it, k, () => setSub(k))}
                    {sub === k && (
                      <div class="menu-dropdown submenu" role="menu">
                        {it.submenu().map((s, j) => (s === "-" ? sep(j) : item(s, j, () => undefined)))}
                      </div>
                    )}
                  </div>
                ) : (
                  item(it, k, () => setSub(undefined))
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function WindowControls(p: Pick<TitleBarProps, "maximized" | "onMinimize" | "onToggleMaximize" | "onClose">) {
  return (
    <div class="window-controls">
      <button type="button" class="wc" title="Minimize" aria-label="Minimize" onClick={p.onMinimize}>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0 5.5H10" {...S} />
        </svg>
      </button>
      <button
        type="button"
        class="wc"
        title={p.maximized ? "Restore" : "Maximize"}
        aria-label={p.maximized ? "Restore" : "Maximize"}
        onClick={p.onToggleMaximize}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          {p.maximized ? (
            <>
              <rect x="0.5" y="2.5" width="7" height="7" {...S} />
              <path d="M2.5 2.5V0.5H9.5V7.5H7.5" {...S} />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" {...S} />
          )}
        </svg>
      </button>
      <button type="button" class="wc close" title="Close" aria-label="Close" onClick={p.onClose}>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" {...S} />
        </svg>
      </button>
    </div>
  );
}

function TitleBar(p: TitleBarProps) {
  return (
    <>
      {p.mac ? <div class="traffic-lights" data-tauri-drag-region /> : <AppIcon />}
      <MenuBar menus={p.menus} />
      <div class="drag" data-tauri-drag-region />
      <QuickPick {...p.search} />
      <div class="drag" data-tauri-drag-region />
      {p.windowControls && <WindowControls {...p} />}
    </>
  );
}

export function renderTitleBar(container: HTMLElement, props: TitleBarProps): void {
  render(<TitleBar {...props} />, container);
}
