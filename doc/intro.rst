Introduction
============

uFSM is a library and tool for running and creating hierarchical state machines.

As of writing this uFSM only supports C and was from the begining mainly indended
to be used in embedded systems. There is however work being done to support
other languages as well.

State machine models are created using the 'ufsm-compose' tool. Models are
translated to code using the 'ufsm-generate' tool and the generated code
is linked together with the core library (libufsm-core) to produce a working
state machine.

.. image:: ufsm_design_guides.gif
