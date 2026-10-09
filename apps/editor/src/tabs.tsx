// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** Tab strip above the canvas: one tab per open machine. Middle-click or × closes; ● marks unsaved changes. */
import { render } from "preact";

export interface TabInfo {
  key: number;
  name: string;
  /** Tooltip: the full path when known. */
  title: string;
  dirty: boolean;
  active: boolean;
}

export interface TabsProps {
  tabs: TabInfo[];
  onActivate(key: number): void;
  onClose(key: number): void;
}

function Tabs({ tabs, onActivate, onClose }: TabsProps) {
  return (
    <>
      {tabs.map((t) => (
        <div
          key={t.key}
          role="tab"
          aria-selected={t.active}
          class={`tab${t.active ? " active" : ""}${t.dirty ? " dirty" : ""}`}
          title={t.title}
          onPointerDown={(e) => {
            if (e.button === 0) onActivate(t.key);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(t.key);
            }
          }}
          onPointerUp={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
        >
          <svg class="tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="1.5" y="3" width="13" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M1.5 6.5H14.5" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span class="tab-name">{t.name}</span>
          <button
            type="button"
            class="tab-close"
            title={t.dirty ? "Unsaved changes. Close" : "Close"}
            aria-label={`Close ${t.name}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onClose(t.key)}
          >
            <span class="x" aria-hidden="true">×</span>
            <span class="dot" aria-hidden="true">●</span>
          </button>
        </div>
      ))}
      <div class="tabs-fill" />
    </>
  );
}

export function renderTabs(container: HTMLElement, props: TabsProps): void {
  render(<Tabs {...props} />, container);
}
