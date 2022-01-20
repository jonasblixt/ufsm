.. _ug-emit-events:

-----------
Emit events
-----------

Event's can be emitted from the statemachine as actions/entries/exits. These
are prefixed with '^'.

This can be used to forward events to other state machines or feed them back
to the same state machine. When events are feed back to the same machine
the machine must be de-coupled with an external queue.

The machine_process call must never be called indirectly from the same machine.
This will cause stack corruption.
