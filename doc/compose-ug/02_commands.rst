.. _editor-commands:

Editor commands
===============

The ufsm-compose editor is controlled by keyboard commands, there are no menus
beyond the navigation tree.

Basic commands
--------------

==========  =================
Key         Description
==========  =================
s           Save model
S           Save as
o           Open
p           Open project settings
Ctrl+c      Copy
Ctrl+v      Paste
Ctrl+x      Cut
Ctrl+z      Undo
Ctrl+r      Redo
Ctrl        Pressing and holding ctrl during drawing inhibits snapping to guides
==========  =================

Navigation commands
-------------------

===========  =================
Key          Description
===========  =================
n            Toggle navigation tree
j-r          Jump to root region
j-a          Ascend to parent region
z-f          Zoom fit
z-n          Zoom 100%
Ctrl+scroll  Zoom
RMB          Pan
Del          Delete objects
===========  =================

Adding new objects
------------------

==========  =================
Key         Description
==========  =================
a-s         Add state
a-i         Add init state
a-f         Add final state
a-F         Add fork
a-j         Add join
a-t         Add terminate
a-h         Add shallow history state
a-H         Add deep history state
a-t         Add transition
==========  =================

State specific commands
-----------------------

The following commands are only applicable when a state is selected.

==========  =================
Key         Description
==========  =================
a-e         Add entry action
a-x         Add exit action
==========  =================

Transition specific commands
----------------------------

The following commands are only applicable when a transition is selected.

==========  =================
Key         Description
==========  =================
a-a         Add action
a-g         Add guard
a-v         Add vertice
==========  =================

Edit commands
-------------

==========  =================
Key         Description
==========  =================
e-n         Edit name
e-O         Toggle region off-page
e-t         Set trigger (On selected transition)
e-r         Rotate (Join and fork states)
==========  =================
