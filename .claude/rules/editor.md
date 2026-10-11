---
paths:
  - "apps/editor/**"
---

# Editor (`apps/editor/`)

## Files

```
apps/editor/            @ufsm/editor: Vite + TypeScript frontend, laid out after VS Code
  src/main.ts           entry point: creates the parts (app.ts lists them), routes the workspace's changes to the shell
                        and the canvas, attaches the editor model's input (~80 lines)
  src/app.ts            the App object every part gets: ws, shell, canvas, tools, commands, files, nav, edits, settings,
                        sim, search, input, pickTool
  src/workspace.ts      the one store (no DOM): open machines (sessions), the active one, clipboard, status message;
                        `changed(kind)` announces document | selection | view | sim | chrome | shell | active
  src/session.ts        DocSession, one open machine (no DOM): history, index, diagnostics, sheet, selection, views,
                        simulator state; edit/undo/redo, begin/preview/commit/cancel, refresh
  src/shell.ts          the window around the canvas: title bar (titlebar.tsx, quickpick.tsx), tabs (tabs.tsx), explorer
                        rows (explorer.ts, tree.ts), breadcrumbs, the right panel, status bar; `update(changes)` redraws
  src/commands.ts       every command once (id = the editor model's action name where a key runs it): menus, the command
                        palette and the key actions use it
  src/canvas/           view.ts (drawing a frame, pan/zoom, coordinates), state.ts (tool, placing, link, drag, lasso),
                        keys.ts / pointer.ts / tools.ts (the editor model's actions and guards, by its regions Keys,
                        Pointer and Tool)
  src/files.ts          open, File › New, save, save as, close; navigation.ts (sheets, entering states, jumping);
                        edit-commands.ts (delete, clipboard, regions, bend points, S routes, bars, off-page);
                        settings-controller.ts (settings.json, theme, UI zoom); sim-controller.ts (Simulator and Code
                        tabs, Generate: into the selected target's output folder, out-path.ts turns a picked folder into
                        the stored relative form); search-items.ts (what the search finds, search.ts ranks); automation.ts
                        (`window.ufsm`)
  src/hit.ts            hit testing, rubber band, bounds (no DOM: label widths come from a measure, render.ts has the
                        canvas's); render.ts draws a sheet; handles.ts (grips: what a drag at a point would do);
                        preview.ts (tool previews); icons.ts (Tabler outlines, MIT)
  src/panel/            index.tsx (tab strip), types.ts, fields.tsx (inputs, pickers, lists), properties.tsx, project.tsx,
                        problems.tsx; simpanel.tsx, codepanel.tsx, settingspanel.tsx, widgets.tsx are the other tabs and
                        shared Section/Field
  src/fsm/              editor.ufsm (the editor's interaction model: regions Keys {Tools, Zoom, Jump, Add, Edit}, Pointer,
                        Tool), editor-fsm.ts and KEYMAP.md (both generated and committed: `npm run gen:editor-fsm`; keymap.ts
                        writes the table of every key, a test keeps it fresh), input.ts (DOM events -> machine events)
  src/history.ts        undo/redo: Immer patches; interactive edits preview from their start, commit one step
  src/sim.ts            the simulator: interpreter on a snapshot of the document, step log, every step recorded as a
                        conformance trace (no DOM, tested); code.ts (code preview cache, highlighter)
  src/untitled.ts       File › New names (no DOM, tested); tokens.ts (DTCG design tokens, no DOM, tested); theme.ts
                        (bundled themes -> CSS properties + canvas colors `C`); settings.ts (settings.json, no DOM, tested)
  src/themes/           ui.tokens.json (the editor's token names: ui.* -> --css vars, syntax.*, canvas.*, as aliases to
                        palette roles) and one folder per theme, `<name>/<name>.resolver.json` + `<name>.tokens.json` (the
                        upstream palette, absolute colors only) + role files: gruvbox/ (appearance dark|light × contrast
                        hard|medium|soft, colors/gruvbox.vim), everforest/ (same modifiers, autoload/everforest.vim),
                        solarized/ (appearance only, the README's table), catppuccin/ (appearance: light = Latte; flavor
                        frappe|macchiato|mocha = the dark flavor, palette.json). Register a new theme in theme.ts
                        (THEME_FILES imports, THEMES)
  test/                 node:test suites (workspace + hit testing, history, sim + code, theme + settings, search);
                        browser/check.mjs: optional Playwright check of the real editor
```

## Conventions

- Editor: canvas in vanilla TS + Canvas 2D, panels and dialogs in Preact.
  Drawing rules mirror `old/compose/src/render.c`. State lives in the workspace and its sessions only; a part that
  changes something calls `ws.changed(kind)` (or a ws method that does) instead of redrawing itself. Every edit is a core
  function (`edit/layout.ts`, `edit/create.ts`, `edit/clipboard.ts`, `edit/props.ts`) run on an Immer draft by
  `history.ts`; the document is the only state, everything else (index,
  handles, geometry) is rebuilt from it.
  Avoid APIs newer than Safari 15 (macOS 12 WKWebView), e.g. use the manual
  `roundedRect` helper instead of `ctx.roundRect`.
- A state's action block (entry, exit, timers, internal transitions) is laid out in core (`diagram/action-block.ts`: lines,
  wrapping, height, hidden counts, the marker's box) on a 7-unit character cell; `render.ts` only draws that layout, in
  a monospace font sized so one character is exactly one cell (`blockFont`). Never measure its text in the editor.
- Transition labels are laid out in core too (`diagram/label-layout.ts`: items, wrapping, the box, the line offsets as
  constants); labels keep a proportional font, so the editor passes its canvas measure (`labelFont` in render.ts) and
  core falls back to `estimateLabelWidth` (the sheet fit check).
- Host access goes through `apps/editor/src/platform.ts` only, so the
  frontend also works in a plain browser (`dev:web`).
- Colors: never write a color literal in the editor's CSS or TS. Add a token to `src/themes/ui.tokens.json` (an
  alias to a palette role) and use `var(--name)` (ui.*), `var(--syntax-*)` or `C.<name>`/`canvasAlpha()` (canvas.*);
  `test/theme.test.ts` rejects literals in style.css outside the `:root` fallback (which must equal gruvbox dark
  medium). Theme files follow the DTCG 2025.10 format, color and resolver modules. A bundled theme's palette file holds
  the upstream colors exactly (a test compares them with values copied from upstream); ufsm's own choices (which palette
  color plays which role, extra shades) live in the role files and are checked per variant in theme.test.ts.

## Verifying UI changes

The editor exposes `window.ufsm` for automation: `load(text, name)`, `newModel()`,
`worldToScreen(x, y)`, `selectedName()`, `selectedIds()`, `select(ids)`, `serialize()`,
`box(id)`, `route(id)`, `actionBlock(id)` (a state's action block layout from core, plus `hiddenMarkerScreen`, the screen centre of its hidden-lines marker), `problems()` (the design rule check's findings), `handles()` (with screen positions), `undo()`, `redo()`,
`canUndo()`, `canRedo()`, `isDirty()`, `tabs()`, `activateTab(i)`, `closeTab(i, force)`, `view()`,
`tool()`, `pickTool(id)`, `status()`, `panelTab()`, `openSearch(text)`, `search(text)` (the rows the search lists: label, kind, detail, machine, checked), `theme()` (id, inputs, appearance), `zoom()` (UI zoom %), `settings()` (settings.json text), simulator: `simStart()`, `simStop()`, `simSend(event)`,
`simGuard(name, true|false)`, `sim()` (steps, active, fired, last calls, hovered event and its transitions, trace text),
`simError()` (all act on the active tab; `load` opens a new one). `apps/editor/test/browser/check.mjs` bundles
`apps/editor/src/main.ts` with esbuild (stubbing `@tauri-apps/*`), serves it and drives
it with Playwright (~350 checks; the page emulates a dark OS, mostly on `test/browser/edit.ufsm`: select, drag, resize,
separators, transition handles, labels, undo/redo, pan/zoom, the action block (wrapping, icons, its resize handle, the hidden-lines marker), then menus, search field,
panel keys, Properties/Project, sash, several machines in tabs, File › New, adding/deleting (tools,
transitions, regions, bend points, Delete, copy/cut/paste) and properties (e/a keys, pickers,
guards, internal transitions, declarations, options, Problems tab), then the simulator (F5, events, guards, canvas
highlight read back as pixels, log, saved traces, out of date, a model with errors), the code preview on repository
models (C, Python, TypeScript, Rust) and the Settings tab (all six gruvbox variants and Everforest/Solarized/Catppuccin dark and light read back as pixels,
Catppuccin's flavor, following the OS, kept across a reload; UI zoom with the canvas unchanged), then the search
(Ctrl+P/Ctrl+Shift+P/F1, other machines, focus order, commands, settings preview, Project settings, prefixes),
the sheet frame and title block (frame, zones, off-page marker, fields, double-click, fit findings with sheet and zone), the mouse's back button (sent through CDP, so the webview's history navigation is covered), no webview context menu outside text fields;
with a second argument
it writes screenshots there); it needs esbuild and
playwright (`UFSM_NODE_TOOLS=/opt/npm-tools` in the cloud workspace). Run it after
renderer, hit-test or interaction changes.
