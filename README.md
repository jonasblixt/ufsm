![](https://github.com/jonpe960/ufsm/raw/master/doc/logo.png)

[![Coverity](https://scan.coverity.com/projects/15860/badge.svg)](https://scan.coverity.com/projects/jonpe960-ufsm)
[![Build Status](https://travis-ci.org/jonpe960/ufsm.svg?branch=master)](https://travis-ci.org/jonpe960/ufsm)
[![codecov](https://codecov.io/gh/jonpe960/ufsm/branch/master/graph/badge.svg)](https://codecov.io/gh/jonpe960/ufsm)
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
| exit/entry points    | Yes         | test_compound_transition               |
| Init/Final           | Yes         | all                                    |
| Event deferral       | Yes         | test_defer                             |
| Terminate            | Yes         | test_terminate                         |
| Choice               | Yes         | test_choice                            |
| Junction             | Yes         | test_junction                          |
| Do activity          | No          |                                        |
| Connection point ref | No          |                                        |
| Protocol Machines    | No          |                                        |

Future work:
 - More examples
 - Simulation tool
 - Analysis tool
 - Test XMI files from other tools
 - Maybe support SCXML data

# Examples
All examples are located in 'src/examples'. Some of the examples have specific
 platform dependencies. For example 'dhcpclient' will only work with linux.

## dhcpclient



# Design

uFSM can be used as it is, without any XMI files or graphical editors. It is
fully possible to create the state, transition, etc.. structures. This works
for trivial state machines. This, however, defeats the purpose of uFSM, and
quickly becomes difficult to work with. The real use case for this library is
with applications that have complex logic.

See 'test_simple' or 'test_simple_substate' for examples on how to create
machines manually.

uFSM comes with an XMI import tool 'ufsmimport'. The import tool can be called 
by an application makefile and used generate the data structures needed by uFSM.

See examples/dhcpclient for a more detailed example on how this can be done.

uFSM can be part of an application by including it as a sub repo and add 
ufsm.c, ufsm.h ufsm_stack.c and ufsm_queue.c to the applications Makefile. 
Alternatively just copy those files into the target application.

Calling the top most makefile in this repository builds the library with
gcov and code coverage flags which is not something that should not be done for
an application. Further more calling the top make file will build the import
tool and run through all of the test cases.

## Build parameters

| Parameter             | Default | Description                               |
| --------------------- |:-------:| ----------------------------------------- |
| UFSM_STACK_SIZE       | 128     | uFSM stack size                           |
| UFSM_QUEUE_SIZE       | 16      | Number of events that can be queued       |
| UFSM_DEFER_QUEUE_SIZE | 16      | Number of events that can be deferred     |

These are all higly dependant on the complexity of the state machine and must
be manually tuned for each application.

## Transitions
The UML specification does not enforce how transitions are owned but suggests 
that the transition should be owned by the least common region. 
This however comes at a much greater computational cost in the transition algorithm. 
uFSM stores the transition in the region where the source state is located.

## Event deferral
uFSM implements event deferral by using a local transition on the state where
an event should be deferred. The local transition should have an action with
the name 'ufsm_defer'. This is a special keyword which is detected by
the transition algorithm. Whenever an 'ufsm_defer' action is found
the event will be stored on a deferred event queue.

## Do activities
Do activities are not implemented. 

## Code complexity and memory usage
uFSM is designed with embedded and safety critical applications in mind. 
uFSM does not use any dynamic memory allocation and uses no recursion.
Instead uFSM uses a statically allocated stack 'ufsm_stack'. The stack depth
can be adjusted by setting 'UFSM_STACK_SIZE' build variable.

Functions with highest cyclomatic complexity:

| CCN | LoC   | Function                   |
|:---:|:-----:| ---------------------------|
| 15  | 124   | ufsm_make_transition       |
| 13  | 54    | ufsm_process               |
| 13  | 48    | ufsm_process_final_state   |
| 12  | 50    | ufsm_enter_parent_states   |
| 10  | 37    | ufsm_leave_nested_states   |

# Description of test cases

All of the state charts were drawn in StarUML and the XMI files generated with 
the 'XMI' plugin.

## XMI machine

This is a mixture of different tests. Most notably:
 - The actual state machines are generated by importing an XMI file, using ufsmimport
 - Use of sub state machines
 - Shallow history
 - Orthogonal regions

![](https://github.com/jonpe960/ufsm/raw/master/doc/test_xmi_machine1.png)
Top level state machine

![](https://github.com/jonpe960/ufsm/raw/master/doc/test_xmi_machine2.png)
Sub state machine

## Deep history

![](https://github.com/jonpe960/ufsm/raw/master/doc/test_deephistory.png)

This example illustrates the deep history pseudo state. In this example the
machine is initialised and events are sent to enter the D substate. At this
point the B event is sent and consequently state A is left but history is stored
before leaving to state B.

At a later point A is re-entered and history is recovered which means that 
the machine will be in state A, C and D.

## Compound transitions

![](https://github.com/jonpe960/ufsm/raw/master/doc/test_compound_transition.png)

This statechart is taken from the UML standard, see chapter 14.2.3.9.6 for a 
complete description.

'test_compound_transition' tests entry and exits of parent states up until a 
least common ancestor. When event 'sig' is dispatched the transition algorithm 
executes the following: xS11; t1; xS1; t2; eT1; eT11; t3; eT111

## Fork

![](https://github.com/jonpe960/ufsm/raw/master/doc/test_fork.png)

This example demonstrates the use of a fork pseudo state to enter more than
one state in different, orthogonal regions.

