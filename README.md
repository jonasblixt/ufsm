![](https://github.com/jonpe960/ufsm/raw/master/doc/logo.png)

A statechart library for C. ufsm is designed without any external dependencies and uses no dynamic memory allocation besides stack.

ufsm is currently not in any working order, it is very much a work in progress.

Stage 1 objectives:
 - Support all features in UML Statecharts
 
Stage 2 objectives:
 - XMI import tool
 
Stage 3 objectives:
 - Verification/Simulation tool

## Description of test cases

# Compound transitions

![](https://github.com/jonpe960/ufsm/raw/master/doc/test_compound_transition.png)

This statechart is taken from the UML standard, see chapter 14.2.3.9.6 for a complete description.

'test_compound_transition' tests entry and exits of parent states up until a least common ancestor. When event 'sig' is dispatched the transition algoritm executes the following: xS11; t1; xS1; t2; eT1; eT11; t3; eT111



