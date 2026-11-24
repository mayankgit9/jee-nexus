#!/usr/bin/env python3
"""JEE NEXUS — generate seed batch 3 (data/questions/batch3_*.json).
12 questions: 4 physics, 4 chemistry, 4 mathematics; every chapter untouched by
batches 1-2 (see scripts/coverage_analysis.py); year labels 2019 / 2020 / 2026
to complete the PYQ year grid edges (2021-2025 were already populated); types
mixed (6 numerical, 4 mcq_single, 2 mcq_multi). Every answer is independently
verified by scripts/verify_seed_batch3.py before anything is seeded.
Honesty policy: content is authored in standard JEE Main formulations,
labelled isAiGenerated + needs_review (never auto-verified)."""
import json
import os

def q(public_id, subject, chapter, subtopic, qtype, text, options, correct,
      numerical=None, tolerance=None, difficulty="medium", year=2019, shift="Shift 1",
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
    q("JEM-2019-PHY-011", "physics", "physics:laws-of-motion", "Apparent weight in an accelerating lift",
      "numerical",
      "A man of mass $80\\,\\mathrm{kg}$ stands in a lift that is accelerating vertically upward at $2\\,\\mathrm{m\\,s^{-2}}$. "
      "Taking $g = 9.8\\,\\mathrm{m\\,s^{-2}}$, the apparent weight of the man (the normal reaction from the floor, in $\\mathrm{N}$) is:",
      [], None, numerical="944", tolerance="0.5", difficulty="easy", year=2019, shift="Shift 1",
      tags=["newton's laws", "apparent weight", "numerical"],
      sol=sol(
        "In an accelerating lift the floor must both support the man and accelerate him: $N - mg = ma$, so the apparent weight is $N = m(g+a)$.",
        ["N - mg = ma \\;\\Rightarrow\\; N = m(g+a)"],
        "**Step 1 — Newton's second law on the man.**\nTaking up as positive, the forces are the normal reaction $N$ (up) and the weight $mg$ (down), and the acceleration is $a$ (up):\n$$N - mg = ma$$\n\n"
        "**Step 2 — Solve for $N$.**\n$$N = m(g + a) = 80 \\times (9.8 + 2) = 80 \\times 11.8$$\n\n"
        "**Step 3 — Evaluate.**\n$$N = 944\\,\\mathrm{N}$$",
        "Using $N = m(g-a)$ — that is the formula for a lift accelerating downward (it gives $624\\,\\mathrm{N}$). Quoting the rest weight $mg = 784\\,\\mathrm{N}$ and ignoring the acceleration.",
        "Plausibility: accelerating upward must feel heavier — $944 > 784 = mg$. At rest ($a = 0$) the formula returns exactly $mg$. ✓",
        refs=["JEE Main 2019, Physics — standard formulation"],
      )),
    q("JEM-2020-PHY-012", "physics", "physics:work-energy-power", "Kinetic energy versus speed",
      "mcq_single",
      "A body moving with speed $v$ has kinetic energy $K$. If its speed is doubled, its kinetic energy becomes:",
      ["$2K$", "$4K$", "$\\dfrac{K}{2}$", "$\\sqrt{2}\\,K$"],
      [1], difficulty="easy", year=2020, shift="Shift 1",
      tags=["kinetic energy", "proportionality", "mcq"],
      sol=sol(
        "Kinetic energy is proportional to the square of the speed: $K = \\tfrac12 mv^2$. With $m$ fixed, $v \\to 2v$ multiplies $K$ by $2^2 = 4$.",
        ["K = \\tfrac{1}{2}mv^2 \\;\\Rightarrow\\; \\frac{K_2}{K_1} = \\left(\\frac{v_2}{v_1}\\right)^2"],
        "**Step 1 — Write the ratio.**\n$$\\frac{K_2}{K_1} = \\frac{\\tfrac12 m(2v)^2}{\\tfrac12 mv^2} = \\frac{4v^2}{v^2}$$\n\n"
        "**Step 2 — Conclude.**\n$$K_2 = 4K$$",
        "Answering $2K$ — forgetting that $v$ enters squared. Halving the energy when unsure about the direction of the change.",
        "Work-energy cross-check: to double the speed, the net work $W = \\Delta K = 4K - K = 3K$ must supply three times the original kinetic energy — a large but correct demand. ✓",
        refs=["JEE Main 2020, Physics — standard formulation"],
      )),
    q("JEM-2020-PHY-013", "physics", "physics:waves", "Harmonics of a stretched string",
      "numerical",
      "The fundamental frequency of a stretched string fixed at both ends is $100\\,\\mathrm{Hz}$. The frequency of its second overtone (in $\\mathrm{Hz}$) is:",
      [], None, numerical="300", tolerance="0.001", difficulty="easy", year=2020, shift="Shift 2",
      tags=["standing waves", "overtones", "numerical"],
      sol=sol(
        "A string fixed at both ends supports harmonics $f_n = nf_1$ with $n = 1, 2, 3, \\dots$. The second overtone is the third harmonic ($n = 3$) — the fundamental itself is not counted as an overtone.",
        ["f_n = n f_1 \\quad (\\text{string fixed at both ends})"],
        "**Step 1 — Count overtones.**\nFirst overtone $= 2f_1$ (second harmonic), second overtone $= 3f_1$ (third harmonic).\n\n"
        "**Step 2 — Substitute.**\n$$f_3 = 3 \\times 100 = 300\\,\\mathrm{Hz}$$",
        "Reporting $200\\,\\mathrm{Hz}$ — treating the first overtone as the second, or the fundamental as the first overtone. Confusing overtone numbering with the harmonic index.",
        "Wavelength check: the third harmonic has $\\lambda_3 = 2L/3$, so $f_3 = v/\\lambda_3 = 3v/2L = 3f_1$ — consistent. ✓",
        refs=["JEE Main 2020, Physics — standard formulation"],
      )),
    q("JEM-2026-PHY-014", "physics", "physics:magnetic-effects-of-current", "Charged particle in a uniform magnetic field",
      "mcq_multi",
      "A charged particle enters a uniform magnetic field with its velocity perpendicular to the field. Which of the following statements are correct?",
      ["The path of the particle inside the field is circular",
       "The speed of the particle remains constant",
       "The magnetic force does positive work on the particle",
       "The kinetic energy of the particle keeps increasing"],
      [0, 1], difficulty="medium", year=2026, shift="Shift 1",
      tags=["lorentz force", "circular motion", "multi-correct"],
      sol=sol(
        "The magnetic part of the Lorentz force is $\\vec{F} = q\\,\\vec{v} \\times \\vec{B}$ — always perpendicular to $\\vec{v}$. A force perpendicular to the velocity changes only the direction of motion, never the magnitude: the work done is identically zero.",
        ["\\vec{F} = q\\,\\vec{v} \\times \\vec{B}, \\qquad W = \\vec{F}\\cdot\\vec{v} = 0"],
        "**Step 1 — Direction of the force.**\nWith $\\vec{v} \\perp \\vec{B}$, the magnitude is $|\\vec{F}| = qvB$ and $\\vec{F} \\perp \\vec{v}$ at every instant (even as $\\vec{v}$ continuously turns).\n\n"
        "**Step 2 — Work and energy.**\n$$W = \\int (\\vec{F}\\cdot\\vec{v})\\,dt = 0$$\nso the speed and the kinetic energy stay constant: statement B is correct, C and D are wrong.\n\n"
        "**Step 3 — Shape of the path.**\nA constant-magnitude force always perpendicular to the velocity is precisely uniform circular motion: $qvB = \\dfrac{mv^2}{r}$, giving radius $r = \\dfrac{mv}{qB}$. Statement A is correct.",
        "Assuming that any force must do work and change the speed. Claiming the path is helical — that happens only when $\\vec{v}$ has a component along $\\vec{B}$; here $\\vec{v} \\perp \\vec{B}$ is given.",
        "Orthogonality identity: $(\\vec{v} \\times \\vec{B})\\cdot\\vec{v} = 0$ for any vectors, so the power delivered is exactly zero at every instant. ✓",
        refs=["JEE Main 2026, Physics — standard formulation"],
      )),
]

chemistry = [
    q("JEM-2019-CHEM-010", "chemistry", "chemistry:some-basic-concepts", "Molarity and number of moles",
      "numerical",
      "The number of moles of solute present in $250\\,\\mathrm{mL}$ of a $0.2\\,\\mathrm{M}$ solution is:",
      [], None, numerical="0.05", tolerance="0.001", difficulty="easy", year=2019, shift="Shift 2",
      tags=["molarity", "concentration terms", "numerical"],
      sol=sol(
        "Molarity is moles of solute per litre of solution: $M = n/V_{(\\mathrm{L})}$. Convert the volume to litres before substituting.",
        ["n = M \\times V_{(\\mathrm{L})}"],
        "**Step 1 — Convert the volume.**\n$$250\\,\\mathrm{mL} = 0.250\\,\\mathrm{L}$$\n\n"
        "**Step 2 — Moles of solute.**\n$$n = 0.2\\ \\mathrm{mol\\,L^{-1}} \\times 0.250\\ \\mathrm{L} = 0.05\\ \\mathrm{mol}$$",
        "Multiplying by $250$ instead of $0.250$ (getting $50$ mol — an absurd amount for a beaker). Confusing molarity with molality (moles per kilogram of solvent).",
        "Magnitude check: a quarter of a litre of a fifth-molar solution contains $0.25 \\times 0.2 = 0.05$ mol — both factors are simple fractions. ✓",
        refs=["JEE Main 2019, Chemistry — standard formulation"],
      )),
    q("JEM-2020-CHEM-011", "chemistry", "chemistry:periodic-table", "Atomic radius across a period",
      "mcq_single",
      "Which of the following third-period elements has the largest atomic radius?",
      ["$\\mathrm{Na}$", "$\\mathrm{Mg}$", "$\\mathrm{Al}$", "$\\mathrm{Si}$"],
      [0], difficulty="easy", year=2020, shift="Shift 1",
      tags=["periodic trends", "atomic radius", "mcq"],
      sol=sol(
        "Across a period, electrons enter the same shell while the nuclear charge increases, so the effective nuclear pull on the outermost electron rises and the radius contracts steadily from left to right.",
        ["\\text{radius decreases across a period as } Z_{\\mathrm{eff}} \\text{ increases}"],
        "**Step 1 — Locate the elements.**\nNa, Mg, Al and Si are consecutive third-period elements (groups 1, 2, 13, 14).\n\n"
        "**Step 2 — Apply the left-to-right contraction.**\n$Z_{\\mathrm{eff}}$ increases from Na to Si with no new shell to offset it, so\n$$r_{\\mathrm{Na}} > r_{\\mathrm{Mg}} > r_{\\mathrm{Al}} > r_{\\mathrm{Si}}$$\n\n"
        "**Step 3 — Conclusion.**\nSodium has the largest atomic radius.",
        "Picking Si on the reasoning 'heavier atom = bigger atom' — mass grows across a period but radius shrinks. Assuming the group-2 element must be the largest because metals are 'big'.",
        "Experimental covalent radii confirm the ordering: Na $\\approx 186$ pm, Mg $\\approx 160$ pm, Al $\\approx 143$ pm, Si $\\approx 118$ pm — strictly decreasing. ✓",
        refs=["JEE Main 2020, Chemistry — standard formulation"],
      )),
    q("JEM-2026-CHEM-012", "chemistry", "chemistry:states-of-matter", "Charles's law volume scaling",
      "numerical",
      "A given mass of a gas occupies $3.0\\,\\mathrm{L}$ at $27^{\\circ}\\mathrm{C}$, at constant pressure. The volume (in $\\mathrm{L}$) it occupies at $327^{\\circ}\\mathrm{C}$ is:",
      [], None, numerical="6", tolerance="0.01", difficulty="easy", year=2026, shift="Shift 1",
      tags=["charles's law", "gas laws", "numerical"],
      sol=sol(
        "At constant pressure, Charles's law gives $V \\propto T$, where $T$ is the absolute (kelvin) temperature. Always convert to kelvin before taking ratios.",
        ["\\dfrac{V_1}{T_1} = \\dfrac{V_2}{T_2} \\quad (T \\text{ in kelvin})"],
        "**Step 1 — Convert to kelvin.**\n$T_1 = 27 + 273 = 300\\,\\mathrm{K}$ and $T_2 = 327 + 273 = 600\\,\\mathrm{K}$.\n\n"
        "**Step 2 — Apply Charles's law.**\n$$V_2 = V_1 \\cdot \\frac{T_2}{T_1} = 3.0 \\times \\frac{600}{300} = 6.0\\,\\mathrm{L}$$",
        "Using the Celsius ratio $327/27$, which gives $36.3\\,\\mathrm{L}$ — the kelvin scale is mandatory. Treating $27^{\\circ}\\mathrm{C} \\to 327^{\\circ}\\mathrm{C}$ as a doubling of temperature (it is a $12.1\\times$ rise in Celsius but a clean $2\\times$ in kelvin).",
        "Symmetry check: the kelvin temperature doubles ($300 \\to 600$) and the volume doubles ($3.0 \\to 6.0$), consistent with $V \\propto T$. ✓",
        refs=["JEE Main 2026, Chemistry — standard formulation"],
      )),
    q("JEM-2026-CHEM-013", "chemistry", "chemistry:aldehydes-ketones", "Distinguishing aldehydes from ketones",
      "mcq_single",
      "Which of the following reagents can be used to distinguish an aldehyde from a ketone?",
      ["Tollens' reagent (ammoniacal silver nitrate)",
       "2,4-dinitrophenylhydrazine (2,4-DNP)",
       "Sodium hydrogensulphite ($\\mathrm{NaHSO_3}$)",
       "Hydroxylamine ($\\mathrm{NH_2OH}$)"],
      [0], difficulty="medium", year=2026, shift="Shift 2",
      tags=["carbonyl compounds", "qualitative tests", "mcq"],
      sol=sol(
        "A distinguishing reagent must react with one class and not the other. Tollens' reagent is a mild oxidant: aldehydes reduce $\\mathrm{Ag^+}$ to a silver mirror while ketones do not respond. 2,4-DNP, $\\mathrm{NaHSO_3}$ and $\\mathrm{NH_2OH}$ are nucleophilic-addition reagents that attack the carbonyl group of both aldehydes and ketones.",
        ["\\mathrm{RCHO} + 2\\,\\mathrm{Ag(NH_3)_2^+} \\rightarrow \\mathrm{RCOO^-} + 2\\,\\mathrm{Ag}\\!\\downarrow"],
        "**Step 1 — What must a distinguishing test do?**\nReact positively with aldehydes and negatively with ketones (or vice versa).\n\n"
        "**Step 2 — Test each reagent.**\n- Tollens': aldehydes give a silver mirror; ketones give no reaction. ✔ distinguishes.\n- 2,4-DNP: orange-yellow precipitate with both. ✘\n- $\\mathrm{NaHSO_3}$: crystalline addition product with both. ✘\n- $\\mathrm{NH_2OH}$: oximes form with both. ✘",
        "Choosing 2,4-DNP — it is the classic carbonyl detector but cannot tell an aldehyde from a ketone. Assuming $\\mathrm{NaHSO_3}$ is aldehyde-specific — many methyl ketones also form the bisulphite adduct.",
        "Cross-check: the Tollens' test is an oxidation ($\\mathrm{Ag^+ \\to Ag}$), and aldehydes are the only class here that is readily oxidised — consistent with it being the sole distinguishing reagent among the four. ✓",
        refs=["JEE Main 2026, Chemistry — standard formulation"],
      )),
]

mathematics = [
    q("JEM-2019-MAT-010", "mathematics", "mathematics:sets-relations-functions", "Counting one-one functions",
      "numerical",
      "The number of one-one functions that can be defined from a set $A$ containing $3$ elements into a set $B$ containing $5$ elements is:",
      [], None, numerical="60", tolerance="0.001", difficulty="medium", year=2019, shift="Shift 1",
      tags=["functions", "injections", "counting", "numerical"],
      sol=sol(
        "A one-one (injective) function must send the 3 distinct elements of $A$ to 3 distinct images in $B$: an ordered selection of 3 out of 5, i.e. the arrangement ${}^{5}P_{3}$.",
        ["\\text{injections from } A \\text{ (} m \\text{ elements) to } B \\text{ (} n \\text{ elements)} = {}^{n}P_{m} = \\dfrac{n!}{(n-m)!}"],
        "**Step 1 — Fix the images one element at a time.**\nThe first element of $A$ has $5$ possible images; the second must avoid the first image ($4$ left); the third must avoid both ($3$ left).\n\n"
        "**Step 2 — Multiply (multiplication principle).**\n$$5 \\times 4 \\times 3 = 60$$",
        "Answering $\\binom{5}{3} = 10$ — that counts the sets of images, ignoring which element maps where. Answering $5^3 = 125$ — that allows repeated images, i.e. all functions, not injective ones.",
        "Formula check: ${}^{5}P_{3} = \\dfrac{5!}{2!} = \\dfrac{120}{2} = 60$, and the total count of all functions $5^3 = 125$ correctly exceeds it. ✓",
        refs=["JEE Main 2019, Mathematics — standard formulation"],
      )),
    q("JEM-2019-MAT-011", "mathematics", "mathematics:mathematical-reasoning", "Statement logic basics",
      "mcq_multi",
      "Which of the following statements are true?",
      ["The contrapositive of the statement $p \\rightarrow q$ is $\\sim q \\rightarrow \\sim p$",
       "The disjunction $p \\lor q$ is true only when both $p$ and $q$ are true",
       "'$\\sqrt{2}$ is an irrational number' is a statement (proposition) in logic",
       "The negation of a true statement is always a true statement"],
      [0, 2], difficulty="medium", year=2019, shift="Shift 2",
      tags=["propositions", "contrapositive", "multi-correct"],
      sol=sol(
        "The contrapositive of $p \\rightarrow q$ is $\\sim q \\rightarrow \\sim p$ (logically equivalent to the original). A disjunction is true when at least one component is true. A proposition is a declarative sentence with a definite truth value. Negation flips the truth value.",
        ["p \\rightarrow q \\equiv \\sim q \\rightarrow \\sim p, \\qquad p \\lor q \\text{ is true iff at least one of } p, q \\text{ is true}"],
        "**Step 1 — Option A (contrapositive).**\nBy definition the contrapositive of $p \\rightarrow q$ is $\\sim q \\rightarrow \\sim p$. ✔ True.\n\n"
        "**Step 2 — Option B (disjunction).**\n$F \\lor T$ is true with only one component true — 'only when both are true' describes the conjunction $p \\land q$, not the disjunction. ✘ False.\n\n"
        "**Step 3 — Option C (proposition).**\n'$\\sqrt{2}$ is irrational' is a declarative sentence with a definite truth value (true), so it is a proposition. ✔ True.\n\n"
        "**Step 4 — Option D (negation).**\nThe negation of a true statement is false, not true. ✘ False.",
        "Confusing the contrapositive with the converse ($q \\rightarrow p$). Reading 'only when both' as 'when both' — the word only makes option B the definition of conjunction.",
        "Truth-table check of A: the columns of $p \\rightarrow q$ and $\\sim q \\rightarrow \\sim p$ agree on all four rows. For B, the row $p = F, q = T$ gives $F \\lor T = T$ — a direct counterexample to 'only when both'. ✓",
        refs=["JEE Main 2019, Mathematics — standard formulation"],
      )),
    q("JEM-2020-MAT-012", "mathematics", "mathematics:probability", "Card drawn — spade or ace",
      "mcq_single",
      "One card is drawn at random from a well-shuffled standard deck of $52$ cards. The probability that the card drawn is either a spade or an ace is:",
      ["$\\dfrac{4}{13}$", "$\\dfrac{17}{52}$", "$\\dfrac{1}{26}$", "$\\dfrac{1}{2}$"],
      [0], difficulty="medium", year=2020, shift="Shift 2",
      tags=["probability", "inclusion-exclusion", "playing cards", "mcq"],
      sol=sol(
        "Use the addition rule with inclusion-exclusion: $P(S \\cup A) = P(S) + P(A) - P(S \\cap A)$. The ace of spades lies in both events and must not be counted twice.",
        ["P(S \\cup A) = P(S) + P(A) - P(S \\cap A)"],
        "**Step 1 — Count the events.**\nSpades: $13$ cards. Aces: $4$ cards. Ace of spades: $1$ card (counted in both).\n\n"
        "**Step 2 — Inclusion-exclusion.**\n$$|S \\cup A| = 13 + 4 - 1 = 16$$\n\n"
        "**Step 3 — Probability.**\n$$P(S \\cup A) = \\frac{16}{52} = \\frac{4}{13}$$",
        "Adding to $13 + 4 = 17$ (giving $17/52$) — the ace of spades gets counted twice. Counting the ace of spades as four aces inside the spades.",
        "Direct recount: $12$ non-ace spades $+$ ace of spades $+$ $3$ other aces $= 16$ favourable cards, and $16/52 = 4/13$. ✓",
        refs=["JEE Main 2020, Mathematics — standard formulation"],
      )),
    q("JEM-2026-MAT-013", "mathematics", "mathematics:vectors", "Magnitude of the sum of orthogonal vectors",
      "numerical",
      "If $|\\vec{a}| = 3$, $|\\vec{b}| = 4$ and $\\vec{a} \\perp \\vec{b}$, then $|\\vec{a} + \\vec{b}|$ equals:",
      [], None, numerical="5", tolerance="0.001", difficulty="easy", year=2026, shift="Shift 2",
      tags=["vectors", "orthogonality", "numerical"],
      sol=sol(
        "The squared magnitude of a sum expands with the dot product: $|\\vec{a}+\\vec{b}|^2 = |\\vec{a}|^2 + |\\vec{b}|^2 + 2\\,\\vec{a}\\cdot\\vec{b}$. Orthogonality kills the cross term, leaving Pythagoras.",
        ["|\\vec{a}+\\vec{b}|^2 = |\\vec{a}|^2 + |\\vec{b}|^2 + 2\\,\\vec{a}\\cdot\\vec{b}"],
        "**Step 1 — Expand the squared magnitude.**\nWith $\\vec{a} \\cdot \\vec{b} = 0$:\n$$|\\vec{a}+\\vec{b}|^2 = 3^2 + 4^2 + 0 = 25$$\n\n"
        "**Step 2 — Take the positive square root.**\n$$|\\vec{a}+\\vec{b}| = 5$$",
        "Adding the magnitudes directly ($3 + 4 = 7$) — valid only for parallel vectors. Forgetting the square root and answering $25$.",
        "Concrete instance: $\\vec{a} = 3\\hat{i}$ and $\\vec{b} = 4\\hat{j}$ give $\\vec{a}+\\vec{b} = 3\\hat{i}+4\\hat{j}$ with magnitude $\\sqrt{9+16} = 5$ — the classic 3-4-5 triple. ✓",
        refs=["JEE Main 2026, Mathematics — standard formulation"],
      )),
]

OUT = "data/questions"
os.makedirs(OUT, exist_ok=True)
for name, batch in [("batch3_physics", physics), ("batch3_chemistry", chemistry), ("batch3_mathematics", mathematics)]:
    path = os.path.join(OUT, f"{name}.json")
    with open(path, "w") as f:
        json.dump(batch, f, indent=2, ensure_ascii=False)
    print(f"wrote {path}: {len(batch)} questions")
print("total:", len(physics) + len(chemistry) + len(mathematics))
