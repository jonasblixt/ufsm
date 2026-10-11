// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Sheet navigation. A "sheet" is what the canvas shows at one time: the root
 * region, or an off-page region drawn on a sheet of its own. Regions that
 * are not off-page are drawn inline on their nearest sheet.
 */
import { sheetOfRegion, sheetOfVertex, type DocIndex, type Region, type State } from "@ufsm/core";

export { ancestors } from "@ufsm/core";

/** State that owns a region (undefined for the root region). */
export function ownerOf(index: DocIndex, region: Region): State | undefined {
  return index.regions.get(region.id)?.owner;
}

/** Parent sheet of an off-page region, plus the state that owns it. */
export function parentSheet(index: DocIndex, sheet: Region): { sheet: Region; owner: State } | undefined {
  const owner = ownerOf(index, sheet);
  if (!owner) return undefined;
  return { sheet: sheetOfVertex(index, owner.id), owner };
}

/** Sheets from the root down to `sheet`, for the breadcrumb. */
export function sheetPath(index: DocIndex, sheet: Region): Region[] {
  const path = [sheet];
  let p = parentSheet(index, sheet);
  while (p) {
    path.unshift(p.sheet);
    p = parentSheet(index, p.sheet);
  }
  return path;
}

export function sheetLabel(index: DocIndex, sheet: Region): string {
  const owner = ownerOf(index, sheet);
  if (!owner) return index.doc.name;
  return (owner.regions?.length ?? 0) > 1 ? `${owner.name} · ${sheet.name ?? sheet.id}` : owner.name;
}
