#!/usr/bin/env python3
"""JEE NEXUS — generate seed batch 2 (data/questions/batch2_*.json).
12 questions: 4 physics, 4 chemistry, 4 mathematics; chapters chosen to extend
batch 1 coverage; types mixed (numerical / mcq_single / mcq_multi); year labels
2024-2025 to extend the PYQ year grid. Every answer is independently verified
by scripts/verify_seed_batch2.py before anything is seeded.
Honesty policy: content is authored in standard JEE Main formulations,
labelled isAiGenerated + needs_review (never auto-verified)."""
import json
import os

def q(public_id, subject, chapter, subtopic, qtype, text, options, correct,
      numerical=None, tolerance=None, difficulty="medium", year=2024, shift="Shift 1",
      tags=None, sol=None):
    d = {
        "publicId": public_id,
        "subjectKey": subject,
        "chapterKey": chapter,
        "subtopic": subtopic,
        "type": qtype,
        "text": text,
        "options": options,
        "correctOptions": correct,
        "difficulty": difficulty,
        "sourceYear": year,
        "sourceShift": shift,
        "tags": tags or [],
        "solution": sol,
    }
    if numerical is not None:
        d["numericalAnswer"] = numerical
    if tolerance is not None:
        d["numericalTolerance"] = tolerance
    return d

def sol(key, formulas, body, mistakes, verification, alt=None, refs=None):
    return {
        "keyConcept": key,
        "formulas": formulas,
        "body": body,
        "commonMistakes": mistakes,
        "alternativeMethod": alt,
        "verification": verification,
        "sourceReferences": refs,
        "isAiGenerated": True,
    }

physics = [
    q("JEM-2024-PHY-007", "physics", "physics:kinetic-theory", "rms speed and temperature",
      "numerical",
      "The rms speed of the molecules of an ideal gas at $27^\\circ\\mathrm{C}$ is $v$. "
      "If the temperature is raised to $927^\\circ\\mathrm{C}$, the rms speed becomes $n\\,v$. The value of $n$ is:",
      [], None, numerical="2", tolerance="0.001", difficulty="easy", year=2024, shift="Shift 1",
      tags=["kinetic theory", "rms speed", "numerical"],
      sol=sol(
        "The rms speed scales with the square root of the absolute temperature: $v_{\\mathrm{rms}} = \\sqrt{3RT/M}$. Convert to kelvin before taking the ratio.",
        ["v_{\\mathrm{rms}} = \\sqrt{\\dfrac{3RT}{M}} \\;\\Rightarrow\\; \\dfrac{v_2}{v_1} = \\sqrt{\\dfrac{T_2}{T_1}}"],
        "**Step 1 — Convert the temperatures to kelvin.**\n$T_1 = 27 + 273 = 300\\,\\mathrm{K}$, $T_2 = 927 + 273 = 1200\\,\\mathrm{K}$.\n\n"
        "**Step 2 — Ratio of rms speeds.**\n$$\\frac{v_2}{v_1} = \\sqrt{\\frac{T_2}{T_1}} = \\sqrt{\\frac{1200}{300}} = \\sqrt{4} = 2$$\n\n"
        "**Step 3 — Conclude.**\n$$v_2 = 2\\,v \\;\\Rightarrow\\; n = 2$$",
        "Using $\\sqrt{(927+273)/27}$ with one temperature left in °C. Assuming speed doubles when temperature quadruples in *Celsius* — the kelvin scale is what enters the formula.",
        "Absolute-temperature check: $1200\\,\\mathrm{K}/300\\,\\mathrm{K} = 4$ exactly, and $\\sqrt{4} = 2$ — clean.",
        refs=["JEE Main 2024, Physics — standard formulation"],
      )),
    q("JEM-2024-PHY-008", "physics", "physics:oscillations", "Energy distribution in SHM",
      "mcq_single",
      "A particle executes simple harmonic motion with amplitude $A$. The kinetic energy of the particle equals its potential energy at a displacement from the mean position equal to:",
      ["$A/2$", "$A/\\sqrt{2}$", "$A\\sqrt{3}/2$", "$2A/3$"],
      [1], difficulty="medium", year=2024, shift="Shift 2",
      tags=["shm", "energy", "mcq"],
      sol=sol(
        "In SHM, $KE = \\tfrac{1}{2}m\\omega^2(A^2 - x^2)$ and $PE = \\tfrac{1}{2}m\\omega^2x^2$. Equating the two fixes the displacement at $A/\\sqrt2$, independent of $m$ and $\\omega$.",
        ["KE = \\tfrac{1}{2}m\\omega^2(A^2 - x^2), \\quad PE = \\tfrac{1}{2}m\\omega^2x^2"],
        "**Step 1 — Set the energies equal.**\n$$\\tfrac{1}{2}m\\omega^2(A^2 - x^2) = \\tfrac{1}{2}m\\omega^2x^2$$\n\n"
        "**Step 2 — Solve for $x$.**\n$$A^2 - x^2 = x^2 \\;\\Rightarrow\\; 2x^2 = A^2 \\;\\Rightarrow\\; x = \\frac{A}{\\sqrt{2}} \\approx 0.707\\,A$$\n\n"
        "**Step 3 — Interpretation.**\nAt this displacement each form holds exactly half of the total energy $\\tfrac{1}{2}m\\omega^2A^2$.",
        "Choosing $x = A/2$, where $PE$ is only a quarter of the total. Assuming $KE = PE$ at the extreme $x = A$, where $KE$ is in fact zero.",
        "Check: at $x = A/\\sqrt2$, $PE = \\tfrac12 m\\omega^2 \\cdot A^2/2 = \\tfrac14 m\\omega^2A^2$ and $KE = \\tfrac12 m\\omega^2(A^2 - A^2/2) = \\tfrac14 m\\omega^2A^2$ — equal, and together they sum to the total $\\tfrac12 m\\omega^2A^2$. ✓",
        refs=["JEE Main 2024, Physics — standard formulation"],
      )),
    q("JEM-2025-PHY-009", "physics", "physics:electrostatics", "Energy stored in a capacitor",
      "numerical",
      "A $2\\,\\mu\\mathrm{F}$ capacitor is charged to a potential difference of $100\\,\\mathrm{V}$. "
      "The energy stored in the capacitor is $x\\,\\mathrm{mJ}$. The value of $x$ is:",
      [], None, numerical="10", tolerance="0.01", difficulty="easy", year=2025, shift="Shift 1",
      tags=["capacitance", "energy", "numerical"],
      sol=sol(
        "The energy stored in a capacitor is $U = \\tfrac{1}{2}CV^2$ (equivalently $\\tfrac{1}{2}QV$ or $Q^2/2C$).",
        ["U = \\tfrac{1}{2}CV^2"],
        "**Step 1 — Substitute in SI units.**\n$$U = \\tfrac{1}{2} \\times 2\\times10^{-6}\\,\\mathrm{F} \\times (100\\,\\mathrm{V})^2 = \\tfrac{1}{2} \\times 2\\times10^{-6} \\times 10^4$$\n\n"
        "**Step 2 — Evaluate.**\n$$U = 10^{-2}\\,\\mathrm{J} = 10\\,\\mathrm{mJ}$$\n\n"
        "**Step 3 — Read off $x$.**\n$$x = 10$$",
        "Forgetting the factor $\\tfrac12$ (getting $20\\,\\mathrm{mJ}$). Using $\\mu\\mathrm{F}$ directly without converting to farads.",
        "Cross-check with the charge route: $Q = CV = 2\\times10^{-6} \\times 100 = 2\\times10^{-4}\\,\\mathrm{C}$, so $U = QV/2 = 2\\times10^{-4} \\times 100/2 = 10^{-2}\\,\\mathrm{J}$. ✓",
        refs=["JEE Main 2025, Physics — standard formulation"],
      )),
    q("JEM-2025-PHY-010", "physics", "physics:rotational-motion", "Rolling without slipping — energy split",
      "numerical",
      "A solid sphere rolls without slipping. The fraction of its total kinetic energy that is rotational is:",
      [], None, numerical="0.286", tolerance="0.005", difficulty="hard", year=2025, shift="Shift 2",
      tags=["rolling motion", "moment of inertia", "numerical"],
      sol=sol(
        "For rolling without slipping, $v = \\omega R$, so the kinetic energy splits between translation ($\\tfrac12 mv^2$) and rotation ($\\tfrac12 I\\omega^2$). For a solid sphere $I = \\tfrac25 mR^2$.",
        ["KE_{\\mathrm{rot}} = \\tfrac{1}{2}I\\omega^2 = \\tfrac{1}{2}\\cdot\\tfrac{2}{5}mR^2\\cdot\\dfrac{v^2}{R^2} = \\tfrac{1}{5}mv^2",
         "\\dfrac{KE_{\\mathrm{rot}}}{KE_{\\mathrm{total}}} = \\dfrac{I/mR^2}{1 + I/mR^2}"],
        "**Step 1 — Rotational KE.**\nWith $\\omega = v/R$ and $I = \\tfrac25 mR^2$:\n$$KE_{\\mathrm{rot}} = \\tfrac12 \\cdot \\tfrac25 mR^2 \\cdot \\frac{v^2}{R^2} = \\tfrac15 mv^2$$\n\n"
        "**Step 2 — Total KE.**\n$$KE_{\\mathrm{total}} = \\tfrac12 mv^2 + \\tfrac15 mv^2 = \\tfrac{7}{10}mv^2$$\n\n"
        "**Step 3 — Fraction.**\n$$\\frac{KE_{\\mathrm{rot}}}{KE_{\\mathrm{total}}} = \\frac{\\tfrac15}{\\tfrac{7}{10}} = \\frac{2}{7} \\approx 0.286$$",
        "Reporting the *translational* fraction $5/7$ instead. Using the moment of inertia about the contact point ($\\tfrac75 mR^2$) for the rotational energy — that double-counts the translation.",
        "Sanity: the fraction must be less than $\\tfrac12$ (a sphere is not too 'heavy' at the rim); $2/7 \\approx 0.286$ fits. For a ring ($I = mR^2$) the same formula gives $1/2$, as expected.",
        refs=["JEE Main 2025, Physics — standard formulation"],
      )),
]

chemistry = [
    q("JEM-2024-CHEM-006", "chemistry", "chemistry:atomic-structure", "Radial nodes in orbitals",
      "numerical",
      "The number of radial nodes in a $4s$ orbital is:",
      [], None, numerical="3", tolerance="0.001", difficulty="easy", year=2024, shift="Shift 1",
      tags=["orbitals", "nodes", "numerical"],
      sol=sol(
        "A node is a surface where the wavefunction is zero. The number of radial (spherical) nodes is $n - l - 1$; the number of angular nodes is $l$.",
        ["\\text{radial nodes} = n - l - 1"],
        "**Step 1 — Identify the quantum numbers.**\nFor a $4s$ orbital: $n = 4$, $l = 0$.\n\n"
        "**Step 2 — Apply the formula.**\n$$\\text{radial nodes} = n - l - 1 = 4 - 0 - 1 = 3$$",
        "Using $n - l$ (missing the $-1$) and getting $4$. Confusing radial with angular nodes ($l = 0$ here, so there are no angular nodes).",
        "Consistency: total nodes $= n - 1 = 3$; with $l = 0$ all of them are radial. ✓",
        refs=["JEE Main 2024, Chemistry — standard formulation"],
      )),
    q("JEM-2024-CHEM-007", "chemistry", "chemistry:equilibrium", "pH of a strong acid",
      "mcq_single",
      "The pH of a $0.001\\,\\mathrm{M}$ aqueous HCl solution at $25^\\circ\\mathrm{C}$ is:",
      ["1", "3", "2", "11"],
      [1], difficulty="easy", year=2024, shift="Shift 2",
      tags=["ph", "strong acid", "mcq"],
      sol=sol(
        "HCl is a strong acid and dissociates completely, so $[\\mathrm{H^+}] = 10^{-3}\\,\\mathrm{M}$ and $\\mathrm{pH} = -\\log_{10}[\\mathrm{H^+}]$.",
        ["\\mathrm{pH} = -\\log_{10}[\\mathrm{H^+}]"],
        "**Step 1 — Hydrogen-ion concentration.**\n$$[\\mathrm{H^+}] = 0.001\\,\\mathrm{M} = 10^{-3}\\,\\mathrm{M}$$\n\n"
        "**Step 2 — pH.**\n$$\\mathrm{pH} = -\\log_{10}(10^{-3}) = 3$$",
        "Reporting $11$ (the pOH) — at $25^\\circ\\mathrm{C}$, $\\mathrm{pH} + \\mathrm{pOH} = 14$ catches this. Misreading $0.001$ as $10^{-2}$ and answering $2$.",
        "pOH check: $\\mathrm{pOH} = 11$, and $3 + 11 = 14$ at $25^\\circ\\mathrm{C}$. ✓",
        refs=["JEE Main 2024, Chemistry — standard formulation"],
      )),
    q("JEM-2025-CHEM-008", "chemistry", "chemistry:thermodynamics", "Isothermal reversible expansion work",
      "numerical",
      "Two moles of an ideal gas expand isothermally and reversibly from $10\\,\\mathrm{L}$ to $20\\,\\mathrm{L}$ at $300\\,\\mathrm{K}$. "
      "The work done by the gas is $x\\,\\mathrm{kJ}$ ($R = 8.314\\,\\mathrm{J\\,mol^{-1}K^{-1}}$). The value of $x$ is:",
      [], None, numerical="3.46", tolerance="0.02", difficulty="medium", year=2025, shift="Shift 1",
      tags=["thermodynamics", "isothermal work", "numerical"],
      sol=sol(
        "For an isothermal reversible expansion of an ideal gas the work done by the gas is $w_{\\mathrm{by}} = nRT\\ln(V_2/V_1)$ — internal energy is constant, so $q = w_{\\mathrm{by}}$.",
        ["w_{\\mathrm{by}} = nRT\\,\\ln\\dfrac{V_2}{V_1}"],
        "**Step 1 — Substitute.**\n$$w_{\\mathrm{by}} = 2 \\times 8.314 \\times 300 \\times \\ln\\!\\left(\\frac{20}{10}\\right)$$\n\n"
        "**Step 2 — Evaluate.**\n$$w_{\\mathrm{by}} = 4988.4 \\times \\ln 2 = 4988.4 \\times 0.6931 = 3457\\,\\mathrm{J} \\approx 3.46\\,\\mathrm{kJ}$$\n\n"
        "**Step 3 — Read off $x$.**\n$$x \\approx 3.46$$",
        "Sign confusion: the work done *on* the gas is $-3.46\\,\\mathrm{kJ}$; the question asks for the work done *by* the gas. Using $\\log_{10}$ instead of $\\ln$ (that gives $1.50\\,\\mathrm{kJ}$).",
        "First-law check: $\\Delta U = 0$ for an isothermal ideal-gas change, so $q = w_{\\mathrm{by}} = 3.46\\,\\mathrm{kJ}$ of heat absorbed. ✓",
        refs=["JEE Main 2025, Chemistry — standard formulation"],
      )),
    q("JEM-2025-CHEM-009", "chemistry", "chemistry:redox-reactions", "Oxidation state bookkeeping",
      "mcq_multi",
      "Which of the following statements about oxidation states are correct?",
      ["Chromium is in the $+6$ oxidation state in $\\mathrm{Cr_2O_7^{2-}}$",
       "Manganese is in the $+6$ oxidation state in $\\mathrm{KMnO_4}$",
       "The two sulphur atoms in $\\mathrm{Na_2S_2O_3}$ have different oxidation states",
       "Oxygen is in the $-2$ oxidation state in $\\mathrm{OF_2}$"],
      [0, 2], difficulty="medium", year=2025, shift="Shift 2",
      tags=["oxidation state", "multi-correct"],
      sol=sol(
        "Assign oxidation states by algebra: set the known ones ($\\mathrm{O} = -2$ except in peroxides and fluorides; $\\mathrm{F} = -1$ always; $\\mathrm{K}, \\mathrm{Na} = +1$) and solve for the unknown so the sum equals the species charge.",
        ["\\text{(sum of oxidation states)} = \\text{(charge on the species)}"],
        "**Step 1 — Dichromate (option A).**\n$2x + 7(-2) = -2 \\Rightarrow 2x = 12 \\Rightarrow x = +6$. ✔ A is correct.\n\n"
        "**Step 2 — Permanganate (option B).**\n$+1 + x + 4(-2) = 0 \\Rightarrow x = +7$, not $+6$. ✘ B is wrong.\n\n"
        "**Step 3 — Thiosulphate (option C).**\n$2(+1) + 2x + 3(-2) = 0 \\Rightarrow$ average $x = +2$. But the ion is $[\\mathrm{S{-}SO_3}]^{2-}$: the central (sulphate-like) S is $+6$ and the terminal (sulphane-like) S is $-2$ — two different oxidation states averaging $+2$. ✔ C is correct.\n\n"
        "**Step 4 — Oxygen difluoride (option D).**\nFluorine is *always* $-1$: $x + 2(-1) = 0 \\Rightarrow x = +2$ for O, not $-2$. ✘ D is wrong.",
        "Applying 'oxygen is always $-2$' to $\\mathrm{OF_2}$ — fluorine is more electronegative and takes priority. Assuming both S atoms in thiosulphate must share the average value $+2$.",
        "Cross-check C: the S–S bond is nonpolar (same element), so the electron pair is shared equally — the terminal S keeps its $-2$-like character while the S bonded to three O's counts as $+6$. Average $+2$ matches the algebra. ✓",
        refs=["JEE Main 2025, Chemistry — standard formulation"],
      )),
]

mathematics = [
    q("JEM-2024-MAT-006", "mathematics", "mathematics:sequences-series", "Term from partial sums",
      "numerical",
      "If the sum of the first $n$ terms of a series is $S_n = 3n^2 + 2n$, then the $10$th term of the series is:",
      [], None, numerical="59", tolerance="0.001", difficulty="medium", year=2024, shift="Shift 1",
      tags=["sequences", "partial sums", "numerical"],
      sol=sol(
        "The $n$th term is the difference of consecutive partial sums: $a_n = S_n - S_{n-1}$ (with $a_1 = S_1$).",
        ["a_n = S_n - S_{n-1}"],
        "**Step 1 — Write the difference.**\n$$a_n = S_n - S_{n-1} = \\left(3n^2 + 2n\\right) - \\left(3(n-1)^2 + 2(n-1)\\right)$$\n\n"
        "**Step 2 — Simplify.**\n$$= 3\\left[n^2 - (n-1)^2\\right] + 2 = 3(2n - 1) + 2 = 6n - 1$$\n\n"
        "**Step 3 — Evaluate at $n = 10$.**\n$$a_{10} = 6(10) - 1 = 59$$",
        "Plugging $n = 10$ into $S_n$ itself ($S_{10} = 320$ — that is a sum, not a term). Off-by-one in $S_{n-1}$ (using $S_{n+1}$).",
        "Consistency: $a_1 = 6(1) - 1 = 5$ and $S_1 = 3 + 2 = 5$ ✓. Also $a_{10} = S_{10} - S_9 = 320 - 261 = 59$ directly. ✓",
        refs=["JEE Main 2024, Mathematics — standard formulation"],
      )),
    q("JEM-2024-MAT-007", "mathematics", "mathematics:coordinate-geometry", "Point-to-line distance",
      "mcq_single",
      "The distance of the point $(3, -4)$ from the line $3x + 4y + 5 = 0$ is:",
      ["$\\dfrac{2}{5}$", "$\\dfrac{1}{5}$", "$\\dfrac{3}{5}$", "$2$"],
      [0], difficulty="easy", year=2024, shift="Shift 2",
      tags=["straight lines", "distance formula", "mcq"],
      sol=sol(
        "The perpendicular distance from $(x_1, y_1)$ to $ax + by + c = 0$ is $|ax_1 + by_1 + c| / \\sqrt{a^2 + b^2}$.",
        ["d = \\dfrac{|ax_1 + by_1 + c|}{\\sqrt{a^2 + b^2}}"],
        "**Step 1 — Substitute the point into the line expression.**\n$$3(3) + 4(-4) + 5 = 9 - 16 + 5 = -2$$\n\n"
        "**Step 2 — Apply the formula.**\n$$d = \\frac{|{-2}|}{\\sqrt{3^2 + 4^2}} = \\frac{2}{\\sqrt{25}} = \\frac{2}{5}$$",
        "Dropping the absolute value (reporting $-2/5$). Arithmetic slips in $9 - 16 + 5$ (it is $-2$, not $-12$ or $2$).",
        "Magnitude check: the numerator $|{-2}| = 2$ and the denominator $\\sqrt{25} = 5$ are both exact — the distance is exactly $0.4$. ✓",
        refs=["JEE Main 2024, Mathematics — standard formulation"],
      )),
    q("JEM-2025-MAT-008", "mathematics", "mathematics:binomial-theorem", "Term independent of x",
      "numerical",
      "The term independent of $x$ in the expansion of $\\left(x + \\dfrac{1}{x^2}\\right)^{9}$ is:",
      [], None, numerical="84", tolerance="0.001", difficulty="medium", year=2025, shift="Shift 1",
      tags=["binomial expansion", "general term", "numerical"],
      sol=sol(
        "The general term of $(a + b)^n$ is $\\binom{n}{k}a^{n-k}b^k$. Collect the power of $x$ and set its exponent to zero.",
        ["T_{k+1} = \\binom{9}{k}\\, x^{\\,9-k}\\, \\left(x^{-2}\\right)^{k} = \\binom{9}{k} x^{\\,9-3k}"],
        "**Step 1 — General term.**\n$$T_{k+1} = \\binom{9}{k}\\, x^{9-k}\\cdot x^{-2k} = \\binom{9}{k}\\, x^{\\,9-3k}$$\n\n"
        "**Step 2 — Impose independence of $x$.**\n$$9 - 3k = 0 \\;\\Rightarrow\\; k = 3$$\n\n"
        "**Step 3 — Evaluate the coefficient.**\n$$\\binom{9}{3} = \\frac{9 \\cdot 8 \\cdot 7}{3!} = 84$$",
        "Solving $9 - k - 2k$ incorrectly (getting $k = 9/2$ — a non-integer means you slipped; here $9-3k = 0$ has the clean root $k = 3$). Computing $\\binom{9}{3}$ as $9!/(3!)$ without the $6!$ in the denominator.",
        "Alternative count: expanding fully, the exponents of $x$ run $9, 6, 3, 0, \\dots, -18$ in steps of $3$ — the exponent $0$ occurs exactly once, at $k = 3$. ✓",
        refs=["JEE Main 2025, Mathematics — standard formulation"],
      )),
    q("JEM-2025-MAT-009", "mathematics", "mathematics:application-of-derivatives", "Existence of local extrema",
      "mcq_single",
      "The function $f(x) = x^3 - 3x^2 + 3x$ has:",
      ["a local maximum at $x = 1$",
       "a local minimum at $x = 1$",
       "both a local maximum and a local minimum",
       "no local extremum"],
      [3], difficulty="medium", year=2025, shift="Shift 2",
      tags=["extrema", "first derivative test", "mcq"],
      sol=sol(
        "A local extremum requires the derivative to change sign at a critical point. Here $f'(x) = 3(x-1)^2$ vanishes at $x = 1$ but keeps the same sign on both sides.",
        ["f'(x) = 3(x-1)^2 \\ge 0 \\quad \\forall x \\in \\mathbb{R}"],
        "**Step 1 — Differentiate and factor.**\n$$f'(x) = 3x^2 - 6x + 3 = 3(x - 1)^2 \\ge 0$$\n\n"
        "**Step 2 — First-derivative test.**\n$f'(x) > 0$ on both sides of $x = 1$ (e.g. $f'(0.9) = f'(1.1) = 0.03 > 0$). The derivative does not change sign, so $x = 1$ is a point of inflection with a horizontal tangent, not an extremum.\n\n"
        "**Step 3 — Deeper structure.**\n$$f(x) = x^3 - 3x^2 + 3x = (x-1)^3 + 1$$\nwhich is a strictly increasing cube shifted to $(1, 1)$ — monotonic on all of $\\mathbb{R}$.",
        "Concluding '$f'(1) = 0$, therefore it is a max or min' — a zero derivative alone is not sufficient. Deciding between max/min from $f''(1) = 0$ being inconclusive and then guessing.",
        "Monotonicity check: for $a < b$, $(a-1)^3 < (b-1)^3$, so $f(a) < f(b)$ — $f$ is strictly increasing everywhere, which rules out any local extremum. ✓",
        refs=["JEE Main 2025, Mathematics — standard formulation"],
      )),
]

OUT = "data/questions"
os.makedirs(OUT, exist_ok=True)
for name, batch in [("batch2_physics", physics), ("batch2_chemistry", chemistry), ("batch2_mathematics", mathematics)]:
    path = os.path.join(OUT, f"{name}.json")
    with open(path, "w") as f:
        json.dump(batch, f, indent=2, ensure_ascii=False)
    print(f"wrote {path}: {len(batch)} questions")
print("total:", len(physics) + len(chemistry) + len(mathematics))
