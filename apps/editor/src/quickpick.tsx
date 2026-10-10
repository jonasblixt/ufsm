// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The title bar's search field and its result list, after VS Code's quick pick: typing filters, Up/Down (or
 * Ctrl+P / Ctrl+Shift+P while it is open, as in VS Code) move, Enter or a click runs, Esc closes and gives the focus
 * back. Ctrl+Shift+P on the plain search switches to commands, Ctrl+P on commands back to everything. The list is
 * ranked by search.ts; what the rows do is up to the owner (`onPick`).
 */
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { modeHint, parseQuery, search, type ItemKind, type Match, type SearchItem } from "./search";

export interface QuickPickProps {
  /** Placeholder while closed, e.g. "Search dimmer.ufsm". */
  hint: string;
  /** File name of the machine in focus (the `@` hint). */
  machine: string | undefined;
  /** Everything searchable now (called when the list opens, so commands reflect what is enabled). */
  items(): SearchItem[];
  activeDoc: number | undefined;
  /** Keys of recently picked items, most recent first (read when the list opens). */
  recent(): readonly string[];
  onPick(item: SearchItem): void;
  /** The highlighted row changed (undefined: the list closed without a pick). */
  onPreview(item: SearchItem | undefined): void;
}

/** Lets main.ts open the field (Ctrl+P, Ctrl+Shift+P, menus) with some text in it. */
let opener: ((text: string) => void) | undefined;
export function openQuickPick(text = ""): void {
  opener?.(text);
}

const S = { fill: "none", stroke: "currentColor", "stroke-width": "1.3", "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

/** Small symbol per kind, like VS Code's symbol icons (colored by CSS per kind). */
function KindIcon({ kind }: { kind: ItemKind }) {
  let body: ComponentChildren;
  switch (kind) {
    case "state":
      body = <rect x="2.5" y="4" width="11" height="8" rx="2.5" {...S} />;
      break;
    case "pseudo":
      body = <circle cx="8" cy="8" r="3.5" {...S} />;
      break;
    case "region":
      body = <rect x="2.5" y="3.5" width="11" height="9" rx="1" {...S} stroke-dasharray="2 1.5" />;
      break;
    case "transition":
      body = <path d="M2.5 8H12.5M9.5 5L12.5 8L9.5 11" {...S} />;
      break;
    case "timer":
      body = <path d="M8 2.5A5.5 5.5 0 1 0 8 13.5A5.5 5.5 0 1 0 8 2.5ZM8 5V8L10 9.5" {...S} />;
      break;
    case "internal":
      body = <path d="M11.5 5.5A4 4 0 1 0 12 9.5M11.5 2.5V5.5H8.5" {...S} />;
      break;
    case "event":
      body = <path d="M9 2L4.5 9H8L7 14L11.5 7H8Z" {...S} />;
      break;
    case "signal":
      body = <path d="M4 10L8 5L12 10" {...S} />;
      break;
    case "action":
      body = <path d="M10.5 3.5C8.5 3 8 4.5 7.5 7L6.5 12.5C6 14 5 13.5 4.5 13.5M5 7.5H10" {...S} />;
      break;
    case "guard":
      body = <path d="M6 3H4V13H6M10 3H12V13H10" {...S} />;
      break;
    case "machine":
      body = <path d="M4 2.5H9.5L12 5V13.5H4ZM9.5 2.5V5H12" {...S} />;
      break;
    case "setting":
      body = (
        <>
          <circle cx="8" cy="8" r="2" {...S} />
          <path d="M8 2V4M8 12V14M2 8H4M12 8H14M3.8 3.8L5.2 5.2M10.8 10.8L12.2 12.2M3.8 12.2L5.2 10.8M10.8 5.2L12.2 3.8" {...S} />
        </>
      );
      break;
    case "help":
      body = <path d="M6 6A2 2 0 1 1 8.5 8C8 8.3 8 8.7 8 9.5M8 12V12.2" {...S} />;
      break;
    default:
      body = <path d="M4 5L7 8L4 11M8.5 11H12" {...S} />; // command: a prompt
  }
  return (
    <svg class={`qp-icon k-${kind}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {body}
    </svg>
  );
}

/** `text` with the characters at `hits` marked. */
function Highlighted({ text, hits }: { text: string; hits: readonly number[] }) {
  if (hits.length === 0) return <>{text}</>;
  const parts: ComponentChildren[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const on = hits[k] === i;
    let j = i;
    if (on) while (hits[k] === j) (j++, k++);
    else while (j < text.length && hits[k] !== j) j++;
    parts.push(on ? <mark key={i}>{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return <>{parts}</>;
}

/** "Ctrl+Shift+P" or "A T" as key caps. */
function Keys({ keys }: { keys: string }) {
  return (
    <span class="qp-keys">
      {keys.split(" ").map((chord, i) => (
        <span class="chord" key={i}>
          {chord.split(/\+(?!$)/).map((k, j) => (
            <kbd key={j}>{k}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

export function QuickPick(p: QuickPickProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [recent, setRecent] = useState<readonly string[]>([]);
  /** `open` without waiting for a render: focusing the field from show() must not open it a second time. */
  const isOpen = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Where the focus was before the field took it (given back on Esc). */
  const before = useRef<HTMLElement | null>(null);
  const props = useRef(p);
  props.current = p;

  const rows: Match[] = useMemo(
    () => (open ? search(items, text, { activeDoc: p.activeDoc, recent }) : []),
    [open, items, text, p.activeDoc, recent],
  );
  const current = rows[Math.min(active, rows.length - 1)];

  const show = (t: string): void => {
    if (!isOpen.current && document.activeElement instanceof HTMLElement && document.activeElement !== input.current) before.current = document.activeElement;
    isOpen.current = true;
    setItems(props.current.items());
    setRecent(props.current.recent());
    setText(t);
    setActive(0);
    setOpen(true);
    const el = input.current;
    if (el) {
      // the text and the caret now, not at the next render: keys typed right after must land after the prefix
      el.value = t;
      el.focus();
      el.setSelectionRange(t.length, t.length);
    }
  };
  opener = show;

  const close = (refocus: boolean): void => {
    if (!isOpen.current) return;
    isOpen.current = false;
    setOpen(false);
    setText("");
    props.current.onPreview(undefined);
    const el = input.current;
    const back = before.current;
    before.current = null;
    if (refocus && back?.isConnected && back !== el && back !== document.body) back.focus();
    if (document.activeElement === el) el?.blur();
  };

  const pick = (m: Match | undefined): void => {
    if (!m) return;
    const it = m.item;
    if (it.prefix !== undefined) {
      show(it.prefix);
      return;
    }
    isOpen.current = false;
    setOpen(false);
    setText("");
    input.current?.blur();
    before.current = null;
    props.current.onPick(it);
  };

  // the highlighted row: keep it in view, preview it (a color theme)
  useLayoutEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
    props.current.onPreview(current?.item);
  }, [open, current]);

  // a press anywhere else closes the list
  useLayoutEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  });

  const move = (step: number, wrap = true): void => {
    if (rows.length === 0) return;
    const i = Math.min(active, rows.length - 1) + step;
    setActive(wrap ? (i + rows.length) % rows.length : Math.min(Math.max(i, 0), rows.length - 1));
  };

  const { mode } = parseQuery(text);
  return (
    <div class={`search${open ? " open" : ""}`} ref={root}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" />
        <path d="M10.5 10.5L14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
      <input
        ref={input}
        id="search"
        type="text"
        placeholder={open ? modeHint(mode, p.machine) : p.hint}
        aria-label="Search"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results"
        aria-activedescendant={open && current ? `qp-${rows.indexOf(current)}` : undefined}
        spellcheck={false}
        autocomplete="off"
        value={text}
        onFocus={() => {
          if (!isOpen.current) show(text);
        }}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setActive(0);
          if (!isOpen.current) show(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          const ctrl = e.ctrlKey || e.metaKey;
          const key = e.key === "p" && e.shiftKey ? "P" : e.key;
          if (key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close(true);
          } else if (key === "Enter") {
            e.preventDefault();
            pick(current);
          } else if (key === "ArrowDown" || (ctrl && key === "n")) {
            e.preventDefault();
            move(1);
          } else if (key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (key === "PageDown") {
            e.preventDefault();
            move(10, false);
          } else if (key === "PageUp") {
            e.preventDefault();
            move(-10, false);
          } else if (ctrl && (key === "p" || key === "P")) {
            // as in VS Code: the other shortcut switches mode, the same one walks the list
            e.preventDefault();
            e.stopPropagation();
            const commands = text.startsWith(">");
            if (key === "P" && !commands) show(`>${text}`);
            else if (key === "p" && commands) show(text.slice(1));
            else move(key === "P" ? -1 : 1);
          } else if (key === "F1") {
            e.preventDefault();
            e.stopPropagation();
            if (!text.startsWith(">")) show(`>${text}`);
          } else if (key === "Tab") {
            // the list owns the field while open; Tab would leave it with the list still showing
            e.preventDefault();
            move(e.shiftKey ? -1 : 1);
          }
        }}
      />
      {open && (
        <div class="quick-pick" role="presentation">
          <ul id="search-results" role="listbox" aria-label="Search results" ref={list}>
            {rows.map((m, i) => {
              const it = m.item;
              const other = it.doc !== undefined && it.doc !== p.activeDoc;
              return (
                <li
                  key={it.key}
                  id={`qp-${i}`}
                  role="option"
                  aria-selected={m === current}
                  class={`qp-row${m === current ? " active" : ""}${m.group && i > 0 ? " group-start" : ""}`}
                  data-key={it.key}
                  onPointerDown={(e) => e.preventDefault() /* keep the focus in the field */}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => pick(m)}
                >
                  <KindIcon kind={it.kind} />
                  <span class="qp-text">
                    <span class="qp-label">
                      <Highlighted text={it.label} hits={m.labelHits} />
                    </span>
                    {it.detail && (
                      <span class="qp-detail">
                        <Highlighted text={it.detail} hits={m.detailHits} />
                      </span>
                    )}
                  </span>
                  {m.group && <span class="qp-group">{m.group}</span>}
                  {it.checked && <span class="qp-check" title="In use">✓</span>}
                  {other && it.docName && it.kind !== "machine" && <span class="qp-doc">{it.docName}</span>}
                  {it.keys && <Keys keys={it.keys} />}
                </li>
              );
            })}
            {rows.length === 0 && <li class="qp-empty">No matching elements, commands or settings</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
