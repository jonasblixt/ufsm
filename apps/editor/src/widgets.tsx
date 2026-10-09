// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** Building blocks shared by the right panel's tabs. */
import type { ComponentChildren } from "preact";

/** A collapsible section with an upper-case title and an optional count badge. */
export function Section({ title, count, open = true, extra, children }: { title: string; count?: number; open?: boolean; extra?: ComponentChildren; children: ComponentChildren }) {
  return (
    <details class="psection" open={open}>
      <summary>
        <span class="twisty" aria-hidden="true" />
        {title}
        {count !== undefined && count > 0 && <span class="count">{count}</span>}
        {extra}
      </summary>
      <div class="pbody">{children}</div>
    </details>
  );
}

/** A label and its value on one row. */
export function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="field">
      <span class="flabel">{label}</span>
      <span class="fvalue">{children}</span>
    </div>
  );
}
