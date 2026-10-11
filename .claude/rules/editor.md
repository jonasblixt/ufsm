---
paths:
  - "apps/editor/**"
---

# Editor (`apps/editor/`)

## Files

```
apps/editor/            @ufsm/editor: Vite + TypeScript frontend. Window laid out after VS Code: title bar (titlebar.tsx: menus,
                        search field (quickpick.tsx; search.ts ranks, no DOM, tested), window buttons; frameless window except macOS), explorer (palette.ts above explorer.ts,
                        one section per open machine holding its tree.ts), tab strip (tabs.tsx; every open machine is a Doc in
                        main.ts with its own history, view, page and selection), canvas, right panel (panel.tsx: Properties
                        edits the selection, Project edits declarations and file-level settings, Problems lists the design
                        rule check live, Simulator (simpanel.tsx), Code (codepanel.tsx); widgets.tsx has the shared
                        Section/Field), Settings (settingspanel.tsx: color theme, UI zoom), status bar; sash.ts resizes the side panels;
                        scrollbars.ts shows scrollbars only while scrolling
  src/fsm/              editor.ufsm (the editor's interaction model: regions Keys {Tools, Zoom, Jump, Add, Edit}, Pointer, Tool), editor-fsm.ts (generated and committed:
                        `npm run gen:editor-fsm`), input.ts (DOM events -> machine events); panels: Preact, edits: Immer
  src/history.ts        undo/redo: Immer patches; interactive edits preview from their start, commit one step
  src/handles.ts        grips: selection handles, labels, movable vertices; what a drag at a point would do
  src/preview.ts        tool previews drawn over the page (ghost of a vertex to place, transition being drawn)
  src/icons.ts          canvas icons as Path2D strokes (Tabler outlines, MIT): the kinds of action block lines, chevrons
  src/sim.ts            the simulator: interpreter on a snapshot of the document, step log, canvas highlight, every step
                        recorded as a conformance trace; out of date once machine or declarations change (no DOM, tested)
  src/code.ts           code preview: generated files cached per machine/declarations/name/targets, syntax highlighter
  src/untitled.ts       File › New names: untitled, untitled2, ...; the first save names the machine after its file (no DOM, tested)
  src/tokens.ts         Design Tokens 2025.10 (DTCG): resolver sets/modifiers/inputs, deep merge, aliases, sRGB/HSL colors (no DOM, tested)
  src/theme.ts          bundled themes, resolveTheme(setting, systemDark) -> CSS custom properties + canvas colors `C` (no DOM)
  src/themes/           ui.tokens.json (the editor's token names: ui.* -> --css vars, syntax.*, canvas.*, as aliases to
                        palette roles) and one folder per theme, `<name>/<name>.resolver.json` + `<name>.tokens.json` (the
                        upstream palette, absolute colors only) + role files: gruvbox/ (appearance dark|light × contrast
                        hard|medium|soft, colors/gruvbox.vim), everforest/ (same modifiers, autoload/everforest.vim),
                        solarized/ (appearance only, the README's table), catppuccin/ (appearance: light = Latte; flavor
                        frappe|macchiato|mocha = the dark flavor, palette.json). Register a new theme in theme.ts
                        (THEME_FILES imports, THEMES)
  src/settings.ts       settings.json: parse (never fails; unknown keys kept), canonical text, UI zoom steps (no DOM, tested);
                        settingspanel.tsx is the Settings tab. UI zoom = CSS `zoom: var(--ui-zoom)` on the parts around
                        the canvas (title bar, explorer, tabs, breadcrumbs, panel, status bar), never on the canvas
  test/                 node:test suites (history, sim + code, theme + settings, search); browser/check.mjs: optional Playwright check of the real editor
```

## Conventions

- Editor: canvas in vanilla TS + Canvas 2D, panels and dialogs in Preact.
  Drawing rules mirror `old/compose/src/render.c`. Every edit is a core
  function (`v1/edit.ts`, `v1/create.ts`, `v1/clipboard.ts`, `v1/props.ts`) run on an Immer draft by
  `history.ts`; the document is the only state, everything else (index,
  handles, geometry) is rebuilt from it.
  Avoid APIs newer than Safari 15 (macOS 12 WKWebView), e.g. use the manual
  `roundedRect` helper instead of `ctx.roundRect`.
- A state's action block (entry, exit, timers, internal transitions) is laid out in core (`v1/action-block.ts`: lines,
  wrapping, height, hidden counts, the marker's box) on a 7-unit character cell; `render.ts` only draws that layout, in
  a monospace font sized so one character is exactly one cell (`blockFont`). Never measure its text in the editor.
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
`box(id)`, `route(id)`, `actionBlock(id)` (a state's action block layout from core, plus `pillScreen`, the screen centre of its hidden-lines marker), `problems()` (the design rule check's findings), `handles()` (with screen positions), `undo()`, `redo()`,
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
