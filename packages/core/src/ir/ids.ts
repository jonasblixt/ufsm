// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The numbering generated code exposes: state names for the state enum, and a
 * fingerprint of the numbering so a host can check it decodes ids (trace hook
 * output, state numbers) with the matching model.
 *
 * States are numbered in document order. Their names are free text and may
 * repeat, so each state gets a unique identifier and display name: its own
 * name if that is unique, else qualified with its parent states' names, outer
 * ones first, as far as needed ("Door_Open", "Door/Open"); when even the full
 * path repeats (two "Idle" in two regions of one state), the state id is
 * appended.
 */
import type { Id } from "../v1/model";

export interface NamedState {
  id: Id;
  name: string;
  /** Index of the parent state in the same list, -1 at the root. */
  parent: number;
}

/** Free text as an identifier that starts with a letter ("door open" -> "door_open", "2nd" -> "s2nd"). */
export function stateIdentifier(text: string): string {
  const s = text.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(s) ? s : `s${s}`;
}

/** Unique identifiers and display names for `states`, in the same order. */
export function stateNames(states: NamedState[]): { ident: string; label: string }[] {
  const path = states.map((_, i) => {
    const out: number[] = [];
    for (let k = i; k >= 0; k = states[k]!.parent) out.unshift(k);
    return out;
  });
  const depth = states.map(() => 1);
  const suffix = states.map(() => false);
  const parts = (i: number): number[] => path[i]!.slice(-depth[i]!);
  const ident = (i: number): string => {
    const base = parts(i).map((k) => stateIdentifier(states[k]!.name)).join("_");
    return suffix[i] ? `${base}_${stateIdentifier(states[i]!.id)}` : base;
  };
  const label = (i: number): string => {
    const base = parts(i).map((k) => states[k]!.name).join("/");
    return suffix[i] ? `${base} (${states[i]!.id})` : base;
  };
  // Qualify the states of a clashing group (same identifier or label) one level further, those that have a parent
  // left; when none has, append the ids. Repeat until nothing clashes.
  for (let round = 0; ; round++) {
    const groups = new Map<string, number[]>();
    states.forEach((_, i) => {
      for (const key of [`i:${ident(i)}`, `l:${label(i)}`]) groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    const clashing = [...groups.values()].filter((g) => g.length > 1);
    if (clashing.length === 0) break;
    if (round > 2 * states.length + 2) throw new Error(`no unique name for state '${states[clashing[0]![0]!]!.id}'`);
    const deepen = new Set<number>();
    const tag = new Set<number>();
    for (const g of clashing) {
      const can = g.filter((i) => depth[i]! < path[i]!.length);
      for (const i of can.length ? can : g) (can.length ? deepen : tag).add(i);
    }
    for (const i of deepen) depth[i]!++;
    for (const i of tag) suffix[i] = true;
  }
  return states.map((_, i) => ({ ident: ident(i), label: label(i) }));
}

/** The content the fingerprint is computed over: the model name, then every numbered item's id and name in order. */
export interface Numbering {
  name: string;
  events: { id: Id; name: string }[];
  signals: { id: Id; name: string }[];
  states: { id: Id; label: string }[];
  transitions: { id: Id }[];
}

/**
 * FNV-1a (32 bit) over the UTF-8 bytes of the JSON text
 * `["ufsm-ids",1,name,[[id,name],...events],[...signals],[[id,label],...states],[id,...transitions]]`.
 * Layout, actions and guards are not part of it: moving a state keeps the fingerprint, renumbering or renaming changes it.
 */
export function fingerprint(n: Numbering): number {
  const text = JSON.stringify([
    "ufsm-ids",
    1,
    n.name,
    n.events.map((e) => [e.id, e.name]),
    n.signals.map((s) => [s.id, s.name]),
    n.states.map((s) => [s.id, s.label]),
    n.transitions.map((t) => t.id),
  ]);
  return fnv1a32(text);
}

/** FNV-1a, 32 bit, over the UTF-8 bytes of `text`. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of utf8(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The UTF-8 bytes of `text`. */
export function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** `0x1a2b3c4d`: how every backend prints the fingerprint. */
export function hex32(n: number): string {
  return `0x${n.toString(16).padStart(8, "0")}`;
}
