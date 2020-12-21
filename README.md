![](/doc/logo.png)

[![Coverity](https://scan.coverity.com/projects/15860/badge.svg)](https://scan.coverity.com/projects/jonpe960-ufsm)
[![Build Status](https://travis-ci.org/jonasblixt/ufsm.svg?branch=master)](https://travis-ci.org/jonpe960/ufsm)
[![codecov](https://codecov.io/gh/jonasblixt/ufsm/branch/master/graph/badge.svg)](https://codecov.io/gh/jonpe960/ufsm)
[![Donate](https://img.shields.io/badge/paypal-donate-yellow.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=4XMK2G3TPN3BQ)

uFSM is a statechart library written in C. uFSM is designed without any external 
dependencies and uses no dynamic memory allocation or recursion.

uFSM is designed with embedded applications in mind but can also be used in 
other environments. 

Supported UML statechart features:

| Feature              | Implemented | Test case                              |
| -------------------- |:-----------:| -------------------------------------- |
| Simple state         | Yes         | test_simple                            |
| Composite states     | Yes         | test_simple_substate, test_xmi_machine |
| Sub machines         | Yes         | test_xmi_machine                       |
| Compound transition  | Yes         | test_compound_transition               |
| Fork                 | Yes         | test_fork                              |
| Join                 | Yes         | test_join                              |
| Guards/Actions       | Yes         | test_guards_actions + various          |
| Shallow/Deep history | Yes         | test_xmi_machine, test_deephistory     | 
| Exit/Entry points    | Yes         | test_compound_transition               |
| Init/Final           | Yes         | all                                    |
| Event deferral       | Yes         | test_defer                             |
| Terminate            | Yes         | test_terminate                         |
| Choice               | Yes         | test_choice                            |
| Junction             | Yes         | test_junction                          |
| Do activity          | Yes         | test_do                                |
| Connection point ref | Yes         | test_conref                            |
| Protocol Machines    | No          |                                        |

Planned additions:
 - More examples
 - Simulation tool
 - Analysis tool
 - Test XMI files from other tools
 - Potentially support SCXML data

# Examples
All examples are located in 'src/examples'. Some of the examples have specific
 platform dependencies. For example, 'dhcpclient' will only work with linux.

## Simple

This video gives an introduction to ufsm, drawing statecharts and how to import them.

[![uFSM Demo](https://img.youtube.com/vi/7fhL58BJNas/0.jpg)](https://www.youtube.com/watch?v=7fhL58BJNas)

## dhcpclient

This is a work in progress.

# Design

uFSM can be used as it is, without any XMI files or graphical editors by writing
the various ufsm - structs manually, This works for trivial state machines. 
This, however, defeats the purpose of uFSM, and quickly becomes difficult to 
work with. The real use case for this library is with applications that have complex logic.

See 'test_simple' or 'test_simple_substate' for examples on how to create
state machines manually.

uFSM comes with an XMI import tool 'ufsmimport'. The import tool can be called 
by an application makefile and used to generate the data structures needed by uFSM.

See examples/dhcpclient for a more detailed example on how this can be done.

uFSM can be part of an application by including it as a sub repo and add 
ufsm.c, ufsm.h ufsm_stack.c and ufsm_queue.c to the applications makefile. 
Alternatively, just copy these files into the target application.

Calling the topmost makefile in this repository builds the library with
gcov and code coverage flags which is not something that should be done for
an application. Furthermore, calling the top makefile will build the import
tool and run through all of the test cases.

## Build parameters

| Parameter             | Default | Description                               |
| --------------------- |:-------:| ----------------------------------------- |
| UFSM_STACK_SIZE       | 128     | uFSM stack size                           |
| UFSM_QUEUE_SIZE       | 16      | Number of events that can be queued       |
| UFSM_DEFER_QUEUE_SIZE | 16      | Number of events that can be deferred     |

These are all highly dependant on the complexity of the state machine and must
be manually tuned for each application.

## Transitions
The UML specification does not enforce how transitions are owned but suggests 
that the transition should be owned by the least common region. 
This, however, comes at a much greater computational cost in the transition algorithm. 
uFSM stores the transition in the region where the source state is located.

## Event deferral
uFSM implements event deferral by using an internal transition on the state where
a event should be deferred. The local transition should have an action with
the name 'ufsm_defer'. This is a special keyword which is detected by
the transition algorithm. Whenever an 'ufsm_defer' action is found,
the event will be stored on a deferred event queue.

## Code complexity and memory usage
uFSM is designed with embedded and safety critical applications in mind. 
uFSM does not use any dynamic memory allocation and uses no recursion.
Instead uFSM uses a statically allocated stack; 'ufsm_stack'. The stack depth
can be adjusted by setting 'UFSM_STACK_SIZE' build variable.

Functions with highest cyclomatic complexity:

| CCN | LoC   | Function                   |
|:---:|:-----:| ---------------------------|
| 15  | 51    | ufsm_process               |
| 13  | 124   | ufsm_make_transition       |
| 13  | 49    | ufsm_process_final_state   |
| 12  | 53    | ufsm_enter_parent_states   |
| 10  | 41    | ufsm_enter_state           |

## Event queue
The event is implemented as a circular buffer with a 'put' and 'get' function to
store and retrieve data. 

The queue has three optional callbacks; 'on_data', 'lock' and 'unlock'. This 
allowes some flexibility with the target environment.

The 'dhcpclient' -example demonstrates the use of mutex -locks for ensuring
thread safety with the event queue and also a way to wake the main event loop
with a nother mutext that gets unlocked by the 'on_data' callback.

In an embedded context this might be a bit different. One possible setup would 
be that whenever there is no more events to process, in the queue, the main loop
calls the 'WFI' -instruction and the CPU halts until the next interrupt.
The 'lock' and 'unlock' callbacks would disable and enable global interrupts
to ensure that the queue is accessed in an atomical way.

# Description of test cases

All of the state charts shown below were drawn in StarUML and the XMI files generated with 
the 'XMI' plugin.

## XMI machine

This is a mixture of different tests, most notably:
 - The actual state machines are generated by importing an XMI file, using ufsmimport
 - Use of sub state machines
 - Shallow history
 - Orthogonal regions

![](/doc/test_xmi_machine1.png)
Top level state machine

![](/doc/test_xmi_machine2.png)
Sub statemachine

## Deep history

![](/doc/test_deephistory.png)

This example illustrates the deep history pseudostate. In this example, the
machine is initialised and events are sent to enter the D substate. At this
point, the B event is sent and consequently state A is left but history is stored
before leaving to state B.

At a later point, A is re-entered and history is recovered which means that 
the machine will be in state A, C and D.

## Compound transitions

![](/doc/test_compound_transition.png)

This statechart is taken from the UML standard - see chapter 14.2.3.9.6 for a 
complete description.

'test_compound_transition' tests entries and exits of parent states up until a 
least common ancestor. When event 'sig' is dispatched, the transition algorithm 
executes the following: xS11; t1; xS1; t2; eT1; eT11; t3; eT111

## Fork

![](/doc/test_fork.png)

This example demonstrates the use of a fork pseudostate to enter more than
one state in different, orthogonal regions.

## Connection references

![](/doc/test_conref_1.png)

![](/doc/test_conref_2.png)

Using connection references, it is possible to transition into a specific state
 of a sub statemachine.

## Event deferral

![](/doc/test_defer.png)

## Junction

![](/doc/test_junction.png)

## Nested composit states

![](/doc/test_nested_composits.png)

## Nested composit states2

![](/doc/test_nested_composits2.png)

## Join2

![](/doc/test_join2.png)

## Conflicting transitions

Transitions are said to be in conflict if the intersection of the states that
they exit is not empty. Consider the following example:

![](/doc/conflicting_transitions.png)

If the state machine is initialized and receieves EV1, state B will be entered.
The transition back to A from B and the transition from the top state to C is in
conflict because they both will cause state B to exit.

The UML standard states that conflicting transitions with lower priority in the
active state configuration will not be executed.

In the above example that would result in the transition from B to A when EV2
is sent and if an additional EV2 is sent, state A and top states would exit and
transition to state C.

