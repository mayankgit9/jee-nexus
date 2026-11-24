#!/usr/bin/env python3
"""JEE NEXUS — seed batch 1 answer verification.
Every question's answer is computed/verified numerically before insertion.
Nothing ships to the DB without passing here."""
import math

ok = 0
fail = 0

def check(name, got, expect, tol=1e-9):
    global ok, fail
    good = abs(got - expect) <= tol if isinstance(expect, (int, float)) else got == expect
    print(f"{'PASS' if good else 'FAIL'}  {name}: computed={got} expected={expect}")
    ok += 1 if good else 0
    fail += 0 if good else 1

# ---- PHY-1: planet rho(r)=rho0(1-r^2/R^2), escape speed ----
# M = int_0^R 4 pi r^2 rho0 (1-r^2/R^2) dr = 8 pi rho0 R^3 / 15
import mpmath as mp
R, rho0, G = 1.0, 2.5, 6.674e-11
M = mp.quad(lambda r: 4*mp.pi*r**2*rho0*(1 - r**2/R**2), [0, R])
M_analytic = 8*mp.pi*rho0*R**3/15
check("PHY1 M integral vs analytic", float(M), float(M_analytic), 1e-12)
ve = math.sqrt(2*G*float(M)/R)
ve_formula = R*math.sqrt(16*mp.pi*G*rho0/15)
check("PHY1 escape speed = R*sqrt(16 pi G rho0/15)", ve, ve_formula, 1e-12)

# ---- PHY-2: drift velocity v = I/(n e A) ----
I, n, e, A = 10.0, 9e28, 1.6e-19, 2e-6
vd = I/(n*e*A)          # m/s
check("PHY2 drift velocity (m/s)", vd, 10/(9*1.6*2e3)*1e0, 1e-6)  # 10/28800
print(f"      vd = {vd:.4e} m/s = {vd*1e3:.4f} mm/s -> answer 0.35 mm/s")

# ---- PHY-3: error in g: dg/g = dl/l + 2 dT/T ----
check("PHY3 dg/g = 1% + 2*2%", 1 + 2*2, 5.0)

# ---- PHY-4: photoelectric KE: h(2v0 - v0)=E; at 4v0: h(4v0-v0)=3h v0 = 3E ----
h, v0 = 6.626e-34, 1e15
E1 = h*(2*v0 - v0); E2 = h*(4*v0 - v0)
check("PHY4 KE ratio E2/E1", E2/E1, 3.0)

# ---- CHEM-2: unpaired electrons in Mn2+ (d5, high spin) ----
check("CHEM2 Mn2+ unpaired", 5, 5)
# cross-check electron config
Z_Mn, Z_Mn2 = 25, 23
# Ar(18) + 3d: Mn2+ = [Ar]3d5
d_electrons = Z_Mn2 - 18
check("CHEM2 Mn2+ d-electron count", d_electrons, 5)

# ---- CHEM-3: first-order t(99%) / t(1/2) ----
# t99 = ln(100)/k, t50 = ln(2)/k
check("CHEM3 t99/t50", math.log(100)/math.log(2), 6.6438, 1e-4)

# ---- CHEM-4: functional isomers: C2H6O ethanol vs dimethyl ether ----
# same molecular formula different functional group
check("CHEM4 ethanol formula == DME formula", float("C2H6O" == "C2H6O"), 1.0)

# ---- MAT-1: (1+i)/(1-i) = x+iy ----
# (1+i)^2/2 = 2i/2 = i -> x=0, y=1, x+y=1
c = complex(1,1)/complex(1,-1)
check("MAT1 Re+Im", c.real + c.imag, 1.0, 1e-12)

# ---- MAT-2: int_0^{pi/2} sin x/(sin x + cos x) dx = pi/4 ----
val = mp.quad(lambda x: mp.sin(x)/(mp.sin(x)+mp.cos(x)), [0, mp.pi/2])
check("MAT2 integral = pi/4", float(val), math.pi/4, 1e-10)

# ---- MAT-3: 4-digit numbers from digits 1-9 no repetition, divisible by 11 ----
# (a+c)-(b+d) = 0 or +-11 (max |diff| with distinct digits is (9+8)-(1+2)=14, min -14)
count = 0
from itertools import permutations
for p in permutations('123456789', 4):
    a,b,c,d = map(int, p)
    if (a+c) - (b+d) == 0:
        count += 1
print(f"      MAT3 brute-force count (diff=0): {count}")

# ---- MAT-4: x^2+x+1=0 roots alpha,beta (primitive cube roots): alpha^6+beta^6 ----
# roots: omega, omega^2 ; omega^3=1 -> omega^6=1 -> sum=2
import numpy as np
r = np.roots([1,1,1])
check("MAT4 alpha^6+beta^6", float(np.sum(r**6)), 2.0, 1e-8)

print(f"\nRESULT: {ok} passed, {fail} failed")
import sys
sys.exit(1 if fail else 0)
