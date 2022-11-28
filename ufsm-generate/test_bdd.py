from dd import autoref as _bdd

bdd = _bdd.BDD()
bdd.declare("A", "C1", "C11", "C12", "C2", "B", "D1", "D11", "D12", "D2", "E1", "E11", "E12")

c1 = bdd.add_expr("((C11 & ~C12) | (~C11 & C12))")
a = bdd.add_expr(f"({c1} & ~C2) | (~{c1} & C2)")

#ap = bdd.add_expr(f"(C1 & {c1p} & ~C2) | (~C1 & C2 & ~C11 & ~C12)")
#d1p = bdd.add_expr("(D11 & ~D12) | (~D11 & D12)")
#d = bdd.add_expr(f"(D1 & {d1p} & ~D2) | (~D1 & D2 & ~D11 & ~D12)")
#e = bdd.add_expr("E1 & ((E11 & ~E12) | (~E11 & E12))")
#b = bdd.add_expr(f"{d} & {e}")
#root = bdd.add_expr(f"(A & {ap} & ~{b} & ~B) | ({b} & ~A & ~C1 & ~C2 & ~C11 & ~C12)")

values = dict(C2=False)
p = bdd.let(values, a)

#models = list(bdd.pick_iter(a, ["C2", "C11", "C12"]))
#for m in models:
#    print(m)

qvars = dict(C11=True, C12=True)
print(bdd.exist(qvars, c1))

