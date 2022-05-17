from ufsm_compile.flat_model import *

a = FlatState()
a.name = 'a'
b = FlatState()
b.name = 'b'
c = FlatState()
c.name = 'c'

g = StateConditionGuard()
g.add_state(a)
g.add_state(b)

print(g)

g2 = StateConditionGuard()
g2.inverted = True
g2.add_state(a)
g2.add_state(b)
g2.add_state(c)

print(g2)
