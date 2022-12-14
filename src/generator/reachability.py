"""Reachability computation over a graph.


This example is discussed in the documentation [1].
Propositional variables are used.
If you are interested in using integers,
then take a look at the package `omega`.


[1](https://github.com/tulip-control/dd/blob/
    main/doc.md#example-reachability-analysis)
"""
from dd import autoref as _bdd
# uncomment if you have compiled `dd.cudd`
# from dd import cudd as _bdd


def transition_system(bdd):
    """Return the transition relation of a graph."""
    dvars = ["x0", "x0'", "x1", "x1'"]
    for var in dvars:
        bdd.add_var(var)
    s = r'''
           ((~ x0 /\ ~ x1) => ( (~ x0' /\ ~ x1') \/ (x0' /\ ~ x1') ))
        /\ ((x0 /\ ~ x1) => ~ (x0' /\ x1'))
        /\ ((~ x0 /\ x1) => ( (~ x0' /\ x1') \/ (x0' /\ ~ x1') ))
        /\ ~ (x0 /\ x1)
        '''
    transitions = bdd.add_expr(s)
    return transitions


def least_fixpoint(transitions, bdd):
    """Return ancestor nodes."""
    # target is the set {2}
    target = bdd.add_expr(r'~ x0 /\ x1')
    # start from empty set
    q = bdd.false
    qold = None
    prime = {"x0": "x0'", "x1": "x1'"}
    qvars = {"x0'", "x1'"}
    # fixpoint reached ?
    while q != qold:
        qold = q
        next_q = bdd.let(prime, q)
        u = transitions & next_q
        # existential quantification over x0', x1'
        pred = bdd.exist(qvars, u)
        # alternative: pred = bdd.quantify(u, qvars, forall=False)
        q = q | pred | target
    return q


if __name__ == '__main__':
    bdd = _bdd.BDD()
    transitions = transition_system(bdd)
    q = least_fixpoint(transitions, bdd)
    s = q.to_expr()
    print(s)
