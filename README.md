<img src="docs/logo.png" alt="uFSM logo" width="80">

# uFSM

[![CI](https://github.com/jonasblixt/ufsm/actions/workflows/ci.yml/badge.svg)](https://github.com/jonasblixt/ufsm/actions/workflows/ci.yml)

uFSM is a tool for drawing hierarchical state machines (UML statecharts) and
generating code from them. Version 0.6 is a rewrite: a TypeScript core with
code generator backends for C, C++, C#, Python, TypeScript/JavaScript, Rust and Go, and a
cross-platform desktop editor built with [Tauri](https://tauri.app).

The previous C/GTK editor and Python generator (v0.5.x) are available at the
[v0.5.3](https://github.com/jonasblixt/ufsm/tree/v0.5.3) tag. Models drawn with
v0.5 open in the new editor and CLI and are converted to the new format.

## Disclaimer

uFSM is a work in progress. Until 1.0 the file format, the generated APIs and
the editor can still change between releases.

## Documentation

[Architecture](docs/architecture.md) (how the parts fit together), [glossary](docs/glossary.md),
[contributing](docs/contributing.md) (rules and recipes), the [file format](docs/format-v1.md) and the
[execution semantics](docs/semantics.md), and one page per code generator (`docs/backend-*.md`).

## Layout

```
packages/core     @ufsm/core: model, v0 importer, checks, semantics, IR, backends (no Node/DOM APIs)
packages/cli      @ufsm/cli:  `ufsm` command line
apps/editor       @ufsm/editor: Vite + TypeScript frontend
apps/editor/src-tauri   Rust shell (window, native dialogs, file IO)
docs/             architecture, glossary, contributing, file format, semantics, generators
examples/         example models (v1)
tests/models/     test models (v1), including the v0.5 editor's own canvas.ufsm
```

## Prerequisites

| Tool | Version | Windows | macOS | Linux |
|------|---------|---------|-------|-------|
| Node.js | 24 LTS (≥ 22.18) | `winget install OpenJS.NodeJS.LTS` | `brew install node` | distro or nodejs.org |
| Rust | stable, via rustup | `winget install Rustlang.Rustup` | `curl https://sh.rustup.rs -sSf \| sh` | same |
| C/C++ toolchain | | Visual Studio Build Tools, “Desktop development with C++” workload | `xcode-select --install` | `build-essential` |
| WebView | | WebView2, preinstalled on Windows 10/11 | built in | `libwebkit2gtk-4.1-dev` and friends, see below |

Linux (Debian/Ubuntu) system packages:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Getting started

```sh
npm install          # installs all workspaces
npm run dev          # starts Vite + the Tauri window (first run compiles Rust, takes a few minutes)
```

Other scripts, run from the repository root:

| Command | What it does |
|---------|--------------|
| `npm run dev:web` | Frontend only in a browser at http://localhost:1420 (no Rust needed) |
| `npm run build` | Release build and installers in `apps/editor/src-tauri/target/release/bundle/` |
| `npm test` | Unit tests and conformance tests (core, CLI, editor; generated code is compiled and run when gcc/clang (C and C++), Python, pyright, Rust, Go and .NET are found) |
| `npm run typecheck` | `tsc` across all packages |
| `npm run ufsm -- check examples/dimmer.ufsm` | CLI: `info`, `check`, `list`, `migrate`, `fmt`, `run`, `trace`, `flatten`, `ir`, `generate`, `schema` |
| `npm run ufsm -- generate examples/dimmer.ufsm` | Generate code for the model's selected language into its output folder ([targets](docs/format-v1.md#targets)) |
| `npm run ufsm -- generate c examples/dimmer.ufsm -o build` | Generate C ([docs/backend-c.md](docs/backend-c.md)) |
| `npm run ufsm -- generate python examples/dimmer.ufsm -o build` | Generate Python ([docs/backend-python.md](docs/backend-python.md)) |
| `npm run ufsm -- generate ts examples/dimmer.ufsm -o build` | Generate TypeScript ([docs/backend-ts.md](docs/backend-ts.md)) |
| `npm run ufsm -- generate rust examples/dimmer.ufsm -o build` | Generate Rust ([docs/backend-rust.md](docs/backend-rust.md)) |
| `npm run ufsm -- generate go examples/dimmer.ufsm -o build/dimmer` | Generate Go ([docs/backend-go.md](docs/backend-go.md)) |
| `npm run ufsm -- generate cpp examples/dimmer.ufsm -o build` | Generate C++ ([docs/backend-cpp.md](docs/backend-cpp.md)) |
| `npm run ufsm -- generate csharp examples/dimmer.ufsm -o build` | Generate C# ([docs/backend-csharp.md](docs/backend-csharp.md)) |

### Editor controls

The key map follows the v0.5 editor; two-key commands start with <kbd>A</kbd> (add), <kbd>E</kbd> (edit), <kbd>Z</kbd> (zoom) or <kbd>J</kbd> (jump).

| Action | Mouse | Key |
|--------|-------|-----|
| New machine (empty, named after its file on the first save), in its own tab | File › New, or New in the empty explorer | <kbd>Ctrl</kbd>+<kbd>N</kbd> |
| Open model (v0 or v1), each in its own tab | File › Open… | <kbd>O</kbd>, <kbd>Ctrl</kbd>+<kbd>O</kbd> |
| Save as v1 / Save As | File › Save / Save As… | <kbd>S</kbd>, <kbd>Ctrl</kbd>+<kbd>S</kbd> / <kbd>Shift</kbd>+<kbd>S</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> |
| Switch machine / close it | click its tab or its name in the explorer / × or middle-click on the tab | <kbd>Ctrl</kbd>+<kbd>Tab</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd> |
| Pan / zoom | right or middle drag / wheel (also while panning) | |
| Fit sheet / 100% | double-click empty space | <kbd>Z</kbd> <kbd>F</kbd> / <kbd>Z</kbd> <kbd>N</kbd> |
| Select | click a state or transition (canvas or tree; a selected state is drawn in orange); drag a rectangle on empty space: to the right it takes what is inside, to the left what it touches; <kbd>Shift</kbd> adds | <kbd>Ctrl</kbd>+<kbd>A</kbd> all, <kbd>Esc</kbd> clears |
| Move | drag a state (a composite by its header, or anywhere once it is selected); the whole selection moves, inside its region, on a 10-unit grid | |
| Resize | drag a side of the selected state anywhere along it, or a corner to resize both ways (the cursor shows it); the dashed line between its regions | |
| Transition handles | drag an end (on an S route this pins it), the movable segment of an S route, a bend point or the label; double-click an end, the movable segment or an S label to make it automatic again | |
| Cancel a drag | | <kbd>Esc</kbd> |
| Undo / redo | | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>R</kbd> |
| Add a state or pseudo state | pick a tool in the explorer's palette or the Add menu, then click where it goes (into the region under the pointer); drag to draw a state or a fork/join bar; a tool disarms after one placement | <kbd>A</kbd> + <kbd>S</kbd> state, <kbd>I</kbd> initial, <kbd>F</kbd> final, <kbd>H</kbd> / <kbd>Shift</kbd>+<kbd>H</kbd> shallow / deep history, <kbd>Shift</kbd>+<kbd>F</kbd> fork, <kbd>J</kbd> join, <kbd>Shift</kbd>+<kbd>T</kbd> terminate; <kbd>R</kbd> turns a fork/join while placing; <kbd>Esc</kbd> disarms |
| Add a region | Region tool, then click a state; Properties › Add region | <kbd>A</kbd> <kbd>R</kbd> (to the selected state; without one it arms the tool) |
| Add a transition | S transition tool (an orthogonal route that lays itself out on the grid and follows its states) or straight transition tool (one line, or through bend points: clicks on empty canvas in between, <kbd>Shift</kbd>-click forces one): click the source, then the target, or drag from one to the other; the preview shows the route; an initial state is never a target | <kbd>A</kbd> <kbd>T</kbd> S, <kbd>A</kbd> <kbd>L</kbd> straight; <kbd>Backspace</kbd> removes the last bend point |
| Bend points | Add › Bend Point; double-click one to remove it; Add › Convert to S Route | <kbd>A</kbd> <kbd>V</kbd> (on the selected transition, at the pointer) |
| Delete (with what is inside and the transitions attached) | Edit › Delete; × next to a region in Properties | <kbd>Delete</kbd> |
| Cut / copy / paste (at the pointer, into the region under it) | Edit › Cut / Copy / Paste | <kbd>Ctrl</kbd>+<kbd>X</kbd> / <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd> |
| Rename, set a trigger | Properties (Name, Trigger); Edit › Rename / Trigger | <kbd>E</kbd> <kbd>N</kbd> (selected state), <kbd>E</kbd> <kbd>T</kbd> (selected transition) |
| Entry/exit actions, guard terms, transition actions | Properties: + Add …, ↑ ↓ to reorder, × to remove; type to filter, or type a new name to declare it (`^name` for a signal to emit) | <kbd>A</kbd> <kbd>E</kbd> / <kbd>A</kbd> <kbd>X</kbd> (selected state), <kbd>A</kbd> <kbd>G</kbd> / <kbd>A</kbd> <kbd>A</kbd> (selected transition) |
| Internal transitions, regions, documentation | Properties of the state: + Add internal transition, region name, off-page, × | <kbd>E</kbd> <kbd>Shift</kbd>+<kbd>O</kbd> puts the region under the pointer on its own sheet (or back) |
| Turn a fork/join | Properties › Orientation | <kbd>E</kbd> <kbd>R</kbd> |
| Declarations, machine name, paper size, code generator options | Project tab: rename (every use follows), × deletes with its uses, + Add; Paper (A4–A1) warns when states lie beyond the sheet | |
| Problems | Problems tab (live; click one to go to it); badges on the canvas; the count in the status bar opens the tab | |
| Simulate | Run › Start Simulation; Simulator tab: click an event to send it (marked when it would take a transition now; hover to see which), set guard values, follow the log; active states are green on the canvas | <kbd>F5</kbd> start / restart, <kbd>Shift</kbd>+<kbd>F5</kbd> stop |
| Record a conformance trace | every simulation step is recorded: Simulator › Trace › Save trace… (replay with `ufsm trace`) | |
| Generated code | Code tab: C header and source, C++, C#, Python, TypeScript, Rust, Go, live; Copy, Save…. Project › Code generator: the language, its output folder (relative to the model) and settings; Generate (also File › Generate Code and the Code tab) writes the files there, File › Generate Code To… into a folder picked once | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> generate |
| Open state (off-page region, or zoom in) | double-click | <kbd>Enter</kbd> |
| Up to parent page / root | breadcrumb, ↑, the mouse's back button | <kbd>Backspace</kbd>, <kbd>J</kbd> <kbd>A</kbd> / <kbd>J</kbd> <kbd>R</kbd> |
| Show / hide the explorer (tools and machine trees) | View › Explorer | <kbd>N</kbd> |
| Show / hide the Properties / Project panel | View › Properties Panel | <kbd>P</kbd> |
| Resize the explorer or the panel | drag its edge (double-click resets) | |
| Color theme (Catppuccin, Everforest, Gruvbox or Solarized, each dark or light, with the scheme's own options: contrast, flavor; follows the OS by default) | File › Settings or View › Settings: Settings tab; saved to `settings.json` in the app's config folder | |
| Title block fields (revision, date, author, company, document no.); paper size | Project tab › Title block / Paper; double-click the title block on the canvas | |
| UI zoom: larger or smaller text and controls around the canvas, 50–300% (the diagram keeps its own zoom) | View › Zoom In / Zoom Out / Reset Zoom; Settings tab › Zoom; saved to `settings.json` | <kbd>Ctrl</kbd>+<kbd>+</kbd> (or <kbd>=</kbd>) / <kbd>Ctrl</kbd>+<kbd>-</kbd> / <kbd>Ctrl</kbd>+<kbd>0</kbd> |

The application icons are rendered from `apps/editor/src-tauri/icons/icon.svg`
(`npx tauri icon apps/editor/src-tauri/icons/icon.svg` regenerates the set from one
render; the committed small sizes were rendered one by one).

## Status

- [x] Workspace, Tauri shell, CI on Windows/macOS/Linux
- [x] [v1 file format](docs/format-v1.md): JSON Schema, strict reader, canonical writer, design rule check
- [x] v0 → v1 converter (lossless geometry, tested on every legacy model); editor and CLI read both, write v1
- [x] Read-only canvas (pan/zoom/fit), model tree, breadcrumb, off-page navigation, problems list
- [x] [Semantics](docs/semantics.md): flattening with UML/SCXML conflict resolution → IR
- [x] Reference interpreter and trace-based conformance tests
- [x] [C backend](docs/backend-c.md), tested against the interpreter
- [x] [Python backend](docs/backend-python.md), tested against the interpreter
- [x] [TypeScript backend](docs/backend-ts.md), tested against the interpreter
- [x] [Rust backend](docs/backend-rust.md) (`no_std`, no heap), tested against the interpreter
- [x] [Go backend](docs/backend-go.md) (no imports, gofmt and vet clean), tested against the interpreter
- [x] [C++ backend](docs/backend-cpp.md) (header-only C++11 template, no heap, exceptions or RTTI), tested against the interpreter
- [x] [C# backend](docs/backend-csharp.md) (one file, no usings, warning- and analyzer-clean), tested against the interpreter
- [x] Editor: move, resize, transition handles, undo/redo
- [x] Editor window after VS Code: menu and search in the title bar, machines in tabs, explorer, Properties/Project panel
- [x] Editor: search after VS Code's Quick Open and command palette (Ctrl+P, Ctrl+Shift+P): states, transitions and
  declarations of every open machine, every command, the settings
- [x] Editor: create and delete (tools, transitions, regions, bend points), copy/cut/paste
- [x] Editor: properties, declarations, live problems
- [x] Editor: simulation (record conformance traces), live code preview
- [x] Sheets as drawings: a frame with zone references (ISO 5457) and a title block on every sheet; the design rule
  check reports what does not fit, and problems name their sheet and zone ("sheet 2, B4")
- [x] Editor: color themes as [Design Tokens](https://www.designtokens.org/tr/2025.10/) (Catppuccin, Everforest, Gruvbox, Solarized), Settings tab

## History

- **0.1 – 0.3**: a runtime that operated on a tree structure true to the
  graphical representation of the state machine. It worked, but was resource
  hungry and error prone. These versions relied on external drawing tools and
  used the XMI format to translate designs to compilable code.
- **0.4.x**: shipped the "ufsm-compose" drawing tool.
- **0.5.x**: a fundamental change in how code is generated. The complicated
  runtime was dropped in favour of a code generator (Python) that computes
  most things statically, which reduced the runtime memory requirements
  substantially.
- **0.6.x**: a rewrite in TypeScript. A JSON file format (v1) with a design
  rule check, written-down [execution semantics](docs/semantics.md) with
  UML/SCXML transition priority, a reference interpreter that every code
  generator is tested against, backends for C, C++, C#, Python, TypeScript, Rust and Go,
  and a new desktop editor with a simulator, built with Tauri. This fixes
  several bugs in the 0.5 generator, among them conflicting transitions that
  both fired and a signal queue that was never drained.

## License

uFSM is free software under the GNU General Public License, version 3 or
(at your option) any later version: see [LICENSE](LICENSE).

**Generated code is yours.** The [output exception](LICENSE-EXCEPTION) lets
you use, modify and distribute the C, C++, C#, Python, TypeScript, Rust and Go code uFSM
generates under any terms, in open or closed products alike; your models
are yours too. The GPL covers uFSM itself: the editor, the CLI and the
`@ufsm/core` library (a program that embeds the library or its interpreter
is covered by the GPL).

uFSM v0.5.x and earlier ([v0.5.3](https://github.com/jonasblixt/ufsm/tree/v0.5.3)) remain under the BSD 3-Clause
licence.

The color palettes in `apps/editor/src/themes/` come from
[gruvbox](https://github.com/morhetz/gruvbox) by Pavel Pertsev (MIT/X11),
[Everforest](https://github.com/sainnhe/everforest) by sainnhe (MIT),
[Solarized](https://github.com/altercation/solarized) by Ethan Schoonover (MIT) and
[Catppuccin](https://github.com/catppuccin/palette) (MIT).
The icons in a state's action block are from
[Tabler Icons](https://github.com/tabler/tabler-icons) by Paweł Kuna (MIT).
