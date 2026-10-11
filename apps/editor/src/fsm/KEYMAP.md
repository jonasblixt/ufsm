<!-- Generated from editor.ufsm by keymap.ts (npm run gen:editor-fsm). Do not edit. -->

# Editor key map

What every key and pointer event does, as the editor's interaction model (`editor.ufsm`) decides it: one row per
transition, by region. *When* lists the guards (`<State>` means the state is active), *Does* the actions in order;
an action with the name of a command runs that command (`commands.ts`), the others are in `canvas/keys.ts`,
`canvas/pointer.ts` and `canvas/tools.ts`. Internal transitions stay in their state.

## Keys

| State | Event | When | Does | Then |
|---|---|---|---|---|
| Tools | z | `!ctrl()` |  | Zoom |
| Tools | j |  |  | Jump |
| Tools | a | `!ctrl()` `<Idle>` |  | Add |
| Tools | e | `!ctrl()` `<Idle>` |  | Edit |
| Tools | o |  | `openFile()` | (stays) |
| Tools | s |  | `save()` | (stays) |
| Tools | S |  | `saveAs()` | (stays) |
| Tools | n | `ctrl()` `<Idle>` | `newModel()` | (stays) |
| Tools | n | `!ctrl()` | `toggleSidebar()` | (stays) |
| Tools | p | `!ctrl()` | `togglePanel()` | (stays) |
| Tools | a | `ctrl()` | `selectAll()` | (stays) |
| Tools | z | `ctrl()` `!<Dragging>` | `undo()` | (stays) |
| Tools | r | `ctrl()` `!<Dragging>` | `redo()` | (stays) |
| Tools | Tab | `ctrl()` `shift()` `<Idle>` | `prevTab()` | (stays) |
| Tools | Tab | `ctrl()` `<Idle>` | `nextTab()` | (stays) |
| Tools | Enter | `singleState()` | `enterSelected()` | (stays) |
| Tools | Backspace | `<Idle>` | `goUp()` | (stays) |
| Tools | mouse back button | `<Idle>` | `goUp()` | (stays) |
| Tools | Esc | `!<Lasso>` `!<Dragging>` `<Select>` | `clearSelection()` `closePanels()` | (stays) |
| Tools | Delete | `<Idle>` | `deleteSelection()` | (stays) |
| Tools | c | `ctrl()` `<Idle>` | `copy()` | (stays) |
| Tools | x | `ctrl()` `<Idle>` | `cut()` | (stays) |
| Tools | v | `ctrl()` `<Idle>` | `paste()` | (stays) |
| Tools | F5 | `shift()` | `simStop()` | (stays) |
| Tools | F5 |  | `simStart()` | (stays) |
| Tools | + | `ctrl()` `<Idle>` | `uiZoomIn()` | (stays) |
| Tools | - | `ctrl()` `<Idle>` | `uiZoomOut()` | (stays) |
| Tools | 0 | `ctrl()` `<Idle>` | `uiZoomReset()` | (stays) |
| Tools | p | `ctrl()` `<Idle>` | `quickOpen()` | (stays) |
| Tools | P | `ctrl()` `<Idle>` | `commandPalette()` | (stays) |
| Tools | F1 | `<Idle>` | `commandPalette()` | (stays) |
| Tools | B | `ctrl()` `<Idle>` | `generate()` | (stays) |
| Zoom | f |  | `fit()` | Tools |
| Zoom | n |  | `zoomNormal()` | Tools |
| Zoom | Esc |  |  | Tools |
| Jump | a |  | `goUp()` | Tools |
| Jump | r |  | `goRoot()` | Tools |
| Jump | Esc |  |  | Tools |
| Add | signal sDone |  |  | Tools |
| Add | Esc |  |  | Tools |
| Add | s |  | `toolState()` `^sPlace` `^sDone` | (stays) |
| Add | t |  | `toolTransition()` `^sConnect` `^sDone` | (stays) |
| Add | l |  | `toolStraight()` `^sConnect` `^sDone` | (stays) |
| Add | r | `singleState()` | `addRegion()` `^sDone` | (stays) |
| Add | r |  | `toolRegion()` `^sPlace` `^sDone` | (stays) |
| Add | i |  | `toolInitial()` `^sPlace` `^sDone` | (stays) |
| Add | f |  | `toolFinal()` `^sPlace` `^sDone` | (stays) |
| Add | h |  | `toolHistory()` `^sPlace` `^sDone` | (stays) |
| Add | H |  | `toolDeepHistory()` `^sPlace` `^sDone` | (stays) |
| Add | F |  | `toolFork()` `^sPlace` `^sDone` | (stays) |
| Add | j |  | `toolJoin()` `^sPlace` `^sDone` | (stays) |
| Add | T |  | `toolTerminate()` `^sPlace` `^sDone` | (stays) |
| Add | v | `singleTransition()` | `addBendPoint()` `^sDone` | (stays) |
| Add | e | `singleState()` | `addEntry()` `^sDone` | (stays) |
| Add | x | `singleState()` | `addExit()` `^sDone` | (stays) |
| Add | g | `singleTransition()` | `addGuard()` `^sDone` | (stays) |
| Add | a | `singleTransition()` | `addAction()` `^sDone` | (stays) |
| Edit | signal sDone |  |  | Tools |
| Edit | Esc |  |  | Tools |
| Edit | n | `singleState()` | `editName()` `^sDone` | (stays) |
| Edit | t | `singleTransition()` | `editTrigger()` `^sDone` | (stays) |
| Edit | r | `singleBar()` | `turnBar()` `^sDone` | (stays) |
| Edit | O | `singleState()` | `toggleOffPage()` `^sDone` | (stays) |

## Pointer

| State | Event | When | Does | Then |
|---|---|---|---|---|
| Idle | left button down | `<Select>` | `pressStart()` | Pressed |
| Idle | right/middle button down |  | `panStart()` | PanPressed |
| Idle | left button down | `<Place>` | `placeStart()` | Sizing |
| Idle | left button down | `<Connect>` `validSource()` | `linkStart()` | Linking |
| Idle | wheel |  | `zoomAtPointer()` | (stays) |
| Idle | double-click |  | `openAtPointer()` | (stays) |
| Idle | pointer moves | `<Place>` | `placeMove()` | (stays) |
| Idle | pointer moves |  | `hover()` | (stays) |
| Idle | left button down | `<Connect>` | `linkRefuse()` | (stays) |
| Idle | palette click / Add menu | `paletteSelect()` | `^sSelect` | (stays) |
| Idle | palette click / Add menu | `paletteConnect()` | `paletteTool()` `^sConnect` | (stays) |
| Idle | palette click / Add menu |  | `paletteTool()` `^sPlace` | (stays) |
| Pressed | pointer moves | `beyondThreshold()` `pressedOnGrip()` | `dragBegin()` `dragUpdate()` | Dragging |
| Pressed | pointer moves | `beyondThreshold()` | `lassoUpdate()` | Lasso |
| Pressed | left button up | `shift()` | `toggleAtPointer()` | Idle |
| Pressed | left button up |  | `selectAtPointer()` | Idle |
| Pressed | pointer lost (cancel) |  |  | Idle |
| Lasso | left button up |  | `lassoFinish()` | Idle |
| Lasso | Esc |  | `lassoCancel()` | Idle |
| Lasso | pointer lost (cancel) |  | `lassoCancel()` | Idle |
| Lasso | pointer moves |  | `lassoUpdate()` | (stays) |
| PanPressed | pointer moves | `beyondThreshold()` | `panBegin()` `panMove()` | Panning |
| PanPressed | right/middle button up |  |  | Idle |
| PanPressed | pointer lost (cancel) |  |  | Idle |
| PanPressed | wheel |  | `zoomAtPointer()` | (stays) |
| Panning | right/middle button up |  | `panEnd()` | Idle |
| Panning | pointer lost (cancel) |  | `panEnd()` | Idle |
| Panning | pointer moves |  | `panMove()` | (stays) |
| Panning | wheel |  | `zoomAtPointer()` | (stays) |
| Dragging | left button up |  | `dragFinish()` | Idle |
| Dragging | Esc |  | `dragCancel()` | Idle |
| Dragging | pointer lost (cancel) |  | `dragCancel()` | Idle |
| Dragging | pointer moves |  | `dragUpdate()` | (stays) |
| Sizing | left button up |  | `placeFinish()` `^sSelect` | Idle |
| Sizing | Esc |  | `placeCancel()` | Idle |
| Sizing | pointer lost (cancel) |  | `placeCancel()` | Idle |
| Sizing | pointer moves |  | `placeUpdate()` | (stays) |
| Linking | left button down | `!shift()` `validTarget()` | `linkFinish()` `^sSelect` | Idle |
| Linking | left button up | `beyondThreshold()` `validTarget()` | `linkFinish()` `^sSelect` | Idle |
| Linking | Esc |  | `linkCancel()` | Idle |
| Linking | pointer lost (cancel) |  | `linkCancel()` | Idle |
| Linking | pointer moves |  | `linkUpdate()` | (stays) |
| Linking | wheel |  | `zoomAtPointer()` | (stays) |
| Linking | left button down | `shift()` | `linkBend()` | (stays) |
| Linking | left button down | `overVertex()` | `linkRefuse()` | (stays) |
| Linking | left button down |  | `linkBend()` | (stays) |
| Linking | Backspace |  | `linkUnbend()` | (stays) |

## Tool

| State | Event | When | Does | Then |
|---|---|---|---|---|
| Select | signal sPlace |  |  | Place |
| Select | signal sConnect |  |  | Connect |
| Armed | signal sPlace |  |  | Place |
| Armed | signal sConnect |  |  | Connect |
| Armed | signal sSelect |  |  | Select |
| Armed | Esc |  |  | Select |
| Place | r | `!ctrl()` `<Tools>` | `rotateTool()` | (stays) |
