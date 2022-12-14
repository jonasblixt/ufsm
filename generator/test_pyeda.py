from pyeda.inter import *

#flattener:     (D1^B)
#flattener:     (D12^D1^B)
#flattener:     ¬(E11^E1^B)


#<s1> A → B
#State conditions:
#    (A)
#    ¬(C2^A)
#Exit rules to run:
#    (C12^C1^A) / xC12()
#    (C11^C1^A) / xC11()
#    (C2^A) / xC2()
#    (C1^A) / xC1()
#    (A) / xA()
#Actions to run
#    o2()
#Entry rules to run:
#    True / eB() → B
#    (B) / eE1() → E1
#    H (D1^B) / eD1() → D1
#    H (D2^B) / eD2() → D2
#    (D1^B) / eD11() → D11
#    (E1^B) / eE11() → E11
#

#f = (a | b) & Implies(a, ~b) & Implies(b, ~a)


a, b, c, d = map(bddvar, 'abcd')

root = (c & a) ^ (d & a) ^ b & ~(a & b) & ~(c & d) & ~(c & a)

for s in root.satisfy_all():
    print(s)
