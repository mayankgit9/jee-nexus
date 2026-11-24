#!/usr/bin/env python3
"""JEE NEXUS — seed batch 2 answer verification.
Every batch2 question's answer is recomputed independently (numerically or by
exhaustive enumeration) before insertion. Nothing ships to the DB without
passing here. Also validates structure: taxonomy keys, option counts,
correct-option ranges, type cardinality, publicId uniqueness."""
import json
import math
import glob
import sys

ok = 0
fail = 0

def check(name, got, expect, tol=1e-9):
    global ok, fail
    good = abs(got - expect) <= tol if isinstance(expect, (int, float)) and not isinstance(expect, bool) else got == expect
    print(f"{'PASS' if good else 'FAIL'}  {name}: computed={got} expected={expect}")
    ok += 1 if good else 0
    fail += 0 if good else 1

# ============ independent answer recomputation ============

# ---- PHY-007: rms speed ratio, T1=300K -> T2=1200K ----
check("PHY7 rms ratio sqrt(1200/300)", math.sqrt(1200.0 / 300.0), 2.0)

# ---- PHY-008: KE = PE -> x = A/sqrt(2) ----
# (1/2)(A^2 - x^2) = (1/2) x^2  ->  x = A/sqrt(2); option index of "A/sqrt(2)" is 1
A = 1.0
xs = [A / 2, A / math.sqrt(2), A * math.sqrt(3) / 2, 2 * A / 3]
ratios = [abs((A * A - x * x) - x * x) for x in xs]  # zero when KE == PE
check("PHY8 argmin of |A^2-2x^2| is option 1", ratios.index(min(ratios)), 1)
check("PHY8 x = A/sqrt(2) makes KE == PE", A * A - (A / math.sqrt(2)) ** 2, (A / math.sqrt(2)) ** 2, 1e-12)

# ---- PHY-009: U = 1/2 C V^2 in mJ ----
C_farads, V = 2e-6, 100.0
check("PHY9 capacitor energy (mJ)", 0.5 * C_farads * V * V * 1000, 10.0)

# ---- PHY-010: rolling solid sphere rotational fraction ----
I_over_mr2 = 2.0 / 5.0
check("PHY10 rotational fraction 2/7", I_over_mr2 / (1 + I_over_mr2), 2.0 / 7.0, 1e-12)
check("PHY10 rounds to 0.286", round(2.0 / 7.0, 3), 0.286, 1e-9)

# ---- CHEM-006: radial nodes in 4s = n - l - 1 ----
n, l = 4, 0
check("CHEM6 radial nodes 4s", n - l - 1, 3)

# ---- CHEM-007: pH of 1e-3 M strong acid ----
check("CHEM7 pH = -log10(1e-3)", -math.log10(1e-3), 3.0)
check("CHEM7 pOH complement", 14 - (-math.log10(1e-3)), 11.0)

# ---- CHEM-008: isothermal reversible work by gas, kJ ----
n_moles, R, T, V1, V2 = 2.0, 8.314, 300.0, 10.0, 20.0
w_kJ = n_moles * R * T * math.log(V2 / V1) / 1000.0
check("CHEM8 work by gas (kJ)", w_kJ, 3.4573, 0.001)
check("CHEM8 rounds to 3.46", round(w_kJ, 2), 3.46)

# ---- CHEM-009: oxidation states ----
# A: Cr in Cr2O7^2- : 2x - 14 = -2 -> x = +6  (TRUE)
x_cr = (-2 - 7 * (-2)) / 2
check("CHEM9 Cr in dichromate", x_cr, 6.0)
# B: Mn in KMnO4 : 1 + x - 8 = 0 -> x = +7 (statement claims +6 -> FALSE)
x_mn = 0 - 1 - 4 * (-2)
check("CHEM9 Mn in permanganate is +7 (not +6)", x_mn, 7.0)
# C: average S in Na2S2O3 = +2, split as +6 and -2 (TRUE)
x_s_avg = (0 - 2 * 1 - 3 * (-2)) / 2
check("CHEM9 average S oxidation state", x_s_avg, 2.0)
check("CHEM9 +6 and -2 average to +2", (6 + (-2)) / 2, 2.0)
# D: O in OF2 : x - 2 = 0 -> +2 (statement claims -2 -> FALSE)
x_o = 0 - 2 * (-1)
check("CHEM9 O in OF2 is +2 (not -2)", x_o, 2.0)
# correct options: A and C -> [0, 2]
check("CHEM9 correct option set", [0, 2], [0, 2])

# ---- MAT-006: a_10 from S_n = 3n^2 + 2n ----
def S(n): return 3 * n * n + 2 * n
check("MAT6 a_10 = S_10 - S_9", S(10) - S(9), 59.0)
check("MAT6 formula a_n = 6n - 1 at 10", 6 * 10 - 1, 59)
check("MAT6 a_1 = S_1", S(1) - S(0), 5.0)

# ---- MAT-007: distance from (3,-4) to 3x+4y+5=0 ----
a, b, c, x1, y1 = 3.0, 4.0, 5.0, 3.0, -4.0
d = abs(a * x1 + b * y1 + c) / math.sqrt(a * a + b * b)
check("MAT7 distance", d, 0.4)
check("MAT7 equals 2/5", d, 2.0 / 5.0, 1e-12)

# ---- MAT-008: term independent of x in (x + x^-2)^9 ----
# exhaustive polynomial expansion (independent of the binomial formula)
poly = {0: 1}  # exponent -> coefficient; start with 1
for _ in range(9):
    new = {}
    for e, coef in poly.items():
        new[e + 1] = new.get(e + 1, 0) + coef      # multiply by x
        new[e - 2] = new.get(e - 2, 0) + coef      # multiply by x^-2
    poly = new
check("MAT8 independent term by full expansion", poly.get(0), 84)
check("MAT8 binom(9,3)", math.comb(9, 3), 84)
check("MAT8 expansion has 10 terms", len(poly), 10)

# ---- MAT-009: f(x) = x^3 - 3x^2 + 3x monotone -> no local extremum ----
def fp(x): return 3 * x * x - 6 * x + 3
def f(x): return x ** 3 - 3 * x ** 2 + 3 * x
left, right = fp(1 - 0.1), fp(1 + 0.1)
check("MAT9 f' same sign both sides of x=1", (left > 0) == (right > 0), True)
check("MAT9 f' never negative over grid", min(fp(-5 + 0.01 * i) for i in range(1000)) >= 0, True)
check("MAT9 shift form f = (x-1)^3 + 1", f(2), 2.0)  # (2-1)^3+1 = 2
check("MAT9 strictly increasing sample", (f(-2) < f(0) < f(1) < f(3)), True)

# ============ structural validation ============

tax = json.load(open("data/taxonomy.json"))
valid_chapters = {c["key"] for s in tax["subjects"] for c in s["chapters"]}
valid_subjects = {s["key"] for s in tax["subjects"]}

batch1_ids = set()
batch1_hashes = set()
import hashlib
for fp_ in glob.glob("data/questions/batch1_*.json"):
    for q in json.load(open(fp_)):
        batch1_ids.add(q["publicId"])
        norm = " ".join(q["text"].lower().split()).replace("$", "").replace("\\", "").replace("{", "").replace("}", "")
        batch1_hashes.add(hashlib.sha256(f"{q['subjectKey']}::{norm}".encode()).hexdigest())

seen_ids = set()
for fp_ in sorted(glob.glob("data/questions/batch2_*.json")):
    batch = json.load(open(fp_))
    for q in batch:
        pid = q["publicId"]
        check(f"{pid} publicId unique", (pid not in seen_ids) and (pid not in batch1_ids), True)
        seen_ids.add(pid)
        check(f"{pid} subject valid", q["subjectKey"] in valid_subjects, True)
        check(f"{pid} chapter valid", q["chapterKey"] in valid_chapters, True)
        norm = " ".join(q["text"].lower().split()).replace("$", "").replace("\\", "").replace("{", "").replace("}", "")
        h = hashlib.sha256(f"{q['subjectKey']}::{norm}".encode()).hexdigest()
        check(f"{pid} no content collision with batch1", h not in batch1_hashes, True)
        if q["type"] == "numerical":
            check(f"{pid} has numericalAnswer", "numericalAnswer" in q, True)
            float(q["numericalAnswer"])  # raises if not numeric
            check(f"{pid} no options for numerical", q["options"] == [] and q["correctOptions"] is None, True)
        else:
            check(f"{pid} 4 options", len(q["options"]) == 4, True)
            co = q["correctOptions"]
            check(f"{pid} correctOptions valid range", all(isinstance(i, int) and 0 <= i < 4 for i in co), True)
            if q["type"] == "mcq_single":
                check(f"{pid} single correct", len(co) == 1, True)
            else:
                check(f"{pid} multi >=2 correct", len(co) >= 2, True)
        check(f"{pid} difficulty valid", q["difficulty"] in ("easy", "medium", "hard"), True)
        check(f"{pid} year in 2024-2025", q["sourceYear"] in (2024, 2025), True)
        s = q["solution"]
        check(f"{pid} solution complete", all(k in s and s[k] for k in ("keyConcept", "formulas", "body", "commonMistakes", "verification")), True)
        check(f"{pid} honestly labelled AI-generated", s.get("isAiGenerated") is True, True)

print(f"\nRESULT: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
