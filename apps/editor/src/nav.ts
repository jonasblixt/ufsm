// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Page navigation. A "page" is what the canvas shows at one time: the root
 * region, or an off-page region drawn on a sheet of its own. Regions that
 * are not off-page are drawn inline on their nearest sheet.
 */
import { sheetOfRegion, sheetOfVertex, type DocIndex, type Region, type State } from "@ufsm/core";

export { ancestors } from "@ufsm/core";

export const pageOfRegion = sheetOfRegion;
export const pageOfVertex = sheetOfVertex;

/** State that owns a region (undefined for the root region). */
export function ownerOf(index: DocIndex, region: Region): State | undefined {
  return index.regions.get(region.id)?.owner;
}

/** Parent page of an off-page region, plus the state that owns it. */
export function parentPage(index: DocIndex, page: Region): { page: Region; owner: State } | undefined {
  const owner = ownerOf(index, page);
  if (!owner) return undefined;
  return { page: sheetOfVertex(index, owner.id), owner };
}

/** Pages from the root down to `page`, for the breadcrumb. */
export function pagePath(index: DocIndex, page: Region): Region[] {
  const path = [page];
  let p = parentPage(index, page);
  while (p) {
    path.unshift(p.page);
    p = parentPage(index, p.page);
  }
  return path;
}

export function pageLabel(index: DocIndex, page: Region): string {
  const owner = ownerOf(index, page);
  if (!owner) return index.doc.name;
  return (owner.regions?.length ?? 0) > 1 ? `${owner.name} · ${page.name ?? page.id}` : owner.name;
}
