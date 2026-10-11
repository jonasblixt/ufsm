// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Machines as files: open (v0 files are converted in memory and never overwritten silently), File › New, save and
 * save as (the first save of a new machine names it after its file), close (asking first when there are unsaved
 * changes). Each open machine gets its tab and its section in the explorer.
 */
import { UfsmFormatError, loadModel, serializeV1, type DocIndex, type LoadedModel } from "@ufsm/core";
import { newDocument, setMachineName } from "@ufsm/core/edit";
import { el, type App } from "./app";
import { explorerEntry } from "./explorer";
import { baseName, confirmDiscard, inTauri, openModelFile, saveModelFile } from "./platform";
import type { DocSession } from "./session";
import { buildTree, type Tree } from "./tree";
import { nameOnSave, untitledName } from "./untitled";

export interface Files {
  /** Open a model in a new tab and show it. */
  showModel(loaded: LoadedModel, fileName: string, path: string | undefined, untitled?: string): DocSession;
  openModel(): Promise<void>;
  /** File › New: an empty machine in a new tab, named untitled (untitled2, ... while those are open). */
  newModel(): void;
  saveModel(saveAs?: boolean): Promise<void>;
  /** Close a machine; asks first when it has unsaved changes. Resolves true when it was closed. */
  closeDoc(d: DocSession | undefined, force?: boolean): Promise<boolean>;
}

export function createFiles(app: App): Files {
  const ws = app.ws;
  const explorerEl = el<HTMLElement>("explorer");
  const explorerEmptyEl = el<HTMLElement>("explorer-empty");
  const fileInput = el<HTMLInputElement>("file-input");

  const closeDoc = async (d: DocSession | undefined, force = false): Promise<boolean> => {
    if (!d) return false;
    if (!force && d.dirty && !(await confirmDiscard(`${d.fileName} has unsaved changes. Close it and discard them?`)))
      return false;
    if (!ws.sessions.includes(d)) return false;
    d.explorer?.entry.root.remove();
    explorerEmptyEl.hidden = ws.sessions.length > 1;
    ws.close(d);
    return true;
  };

  const showModel = (
    loaded: LoadedModel,
    fileName: string,
    path: string | undefined,
    untitled?: string,
  ): DocSession => {
    const d = ws.open(loaded, fileName, path, untitled);
    const entry = explorerEntry(
      () => ws.activate(d),
      () => void closeDoc(d),
    );
    const inDoc = (go: () => void): void => {
      ws.activate(d);
      go();
    };
    const makeTree = (ix: DocIndex): Tree =>
      buildTree(entry.body, ix, {
        onState: (s) => inDoc(() => app.nav.revealVertex(s)),
        onRegion: (r) => inDoc(() => app.nav.onTreeRegion(r)),
      });
    let treeMachine = loaded.doc.machine;
    const explorer = {
      entry,
      tree: makeTree(d.index),
      // Build the tree again when the machine section changed since it was built (edits, undo, redo).
      syncTree: () => {
        if (d.history.current.machine === treeMachine) return;
        treeMachine = d.history.current.machine;
        explorer.tree = makeTree(d.index);
        explorer.tree.setSheet(d.sheet.id);
      },
    };
    d.explorer = explorer;
    explorerEl.append(entry.root);
    explorerEmptyEl.hidden = true;
    ws.activate(d);
    if (loaded.sourceVersion === 0) app.shell.setStatus("Converted from the v0 format. Save to write it as v1.");
    requestAnimationFrame(() => {
      if (ws.active === d) app.canvas.fit();
    });
    return d;
  };

  return {
    showModel,
    openModel: async () => {
      try {
        const file = await openModelFile(fileInput);
        if (!file) return;
        // The same file twice would be two diverging copies: show the open one instead.
        const open = inTauri ? ws.sessions.find((d) => d.path === file.path) : undefined;
        if (open) {
          ws.activate(open);
          app.shell.setStatus(`${open.fileName} is already open`);
          return;
        }
        showModel(loadModel(file.text), file.name, inTauri ? file.path : undefined);
      } catch (e) {
        app.shell.setStatus(e instanceof UfsmFormatError ? `Not a valid uFSM model: ${e.message}` : String(e));
        console.error(e);
      }
    },
    newModel: () => {
      const name = untitledName(ws.sessions.map((d) => d.fileName));
      showModel({ doc: newDocument(name), sourceVersion: 1, notes: [] }, `${name}.ufsm`, undefined, name);
      app.shell.setStatus(`New machine ${name}. Add a state with A then S, or from the palette.`);
    },
    saveModel: async (saveAs = false) => {
      const d = ws.active;
      if (!d) return;
      try {
        let version = d.history.version;
        const written = await saveModelFile(
          (target) => {
            // A new machine still called by its placeholder takes the name of its file (the generated code is named after it).
            const name = nameOnSave(d.history.current.name, d.untitled, baseName(target));
            if (name !== undefined && d.edit((x) => setMachineName(x, name)) && d === ws.active) ws.changed("document");
            version = d.history.version;
            return serializeV1(d.history.current);
          },
          saveAs ? undefined : d.path,
          d.fileName,
        );
        if (!written) return;
        d.path = inTauri ? written : undefined;
        d.fileName = baseName(written);
        d.savedVersion = version;
        d.untitled = undefined;
        d.notes = [];
        ws.changed("document");
        app.shell.setStatus(`Saved ${d.fileName}`);
      } catch (e) {
        app.shell.setStatus(`Save failed: ${String(e)}`);
        console.error(e);
      }
    },
    closeDoc,
  };
}
