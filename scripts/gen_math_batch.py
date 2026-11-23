#!/usr/bin/env python3
"""Regenerate batch1_mathematics.json from structured Python data (guaranteed valid JSON)."""
import json

def q(public_id, chapter, subtopic, qtype, text, options, correct, numerical=None,
      tolerance=None, difficulty="medium", year=2023, shift="Shift 1", tags=None, sol=None):
    return {
        "publicId": public_id,
        "subjectKey": "mathematics",
        "chapterKey": chapter,
        "subtopic": subtopic,
        "type": qtype,
        "text": text,
        "options": options,
        "correctOptions": correct,
        **({"numericalAnswer": numerical} if numerical is not None else {}),
        **({"numericalTolerance": tolerance} if tolerance is not None else {}),
        "difficulty": difficulty,
        "sourceYear": year,
        "sourceShift": shift,
        "tags": tags or [],
        "solution": sol,
    }

def sol(key, formulas, body, mistakes, verification, alt=None, refs=None):
    return {
        "keyConcept": key,
        "formulas": formulas,
        "body": body,
        "commonMistakes": mistakes,
        "alternativeMethod": alt,
        "verification": verification,
        "sourceReferences": refs or ["JEE Main, Mathematics — standard formulation"],
        "isAiGenerated": True,
    }

questions = [
    q(
        "JEM-2023-MAT-001", "mathematics:complex-numbers", "Powers of i, algebra of complex numbers",
        "numerical",
        "If $\\dfrac{1+i}{1-i} = x + iy$ where $x, y \\in \\mathbb{R}$ and $i=\\sqrt{-1}$, then the value of $x + y$ is:",
        [], None, numerical="1", tolerance="0.001", difficulty="easy", year=2023, shift="Shift 1",
        tags=["complex numbers", "modulus argument", "numerical"],
        sol=sol(
            "Rationalize the quotient by multiplying with the conjugate of the denominator; alternatively note $1-i=\\sqrt2\\,e^{-i\\pi/4}$ and $1+i=\\sqrt2\\,e^{i\\pi/4}$ so the quotient is $e^{i\\pi/2}=i$.",
            ["\\dfrac{1+i}{1-i}\\cdot\\dfrac{1+i}{1+i} = \\dfrac{(1+i)^2}{1^2+1^2}"],
            "**Step 1 — Multiply by the conjugate.**\n"
            "$$\\frac{1+i}{1-i}\\times\\frac{1+i}{1+i} = \\frac{(1+i)^2}{(1-i)(1+i)}$$\n\n"
            "**Step 2 — Expand.**\n"
            "Numerator: $(1+i)^2 = 1+2i+i^2 = 2i$.\n"
            "Denominator: $(1-i)(1+i) = 1-i^2 = 2$.\n\n"
            "**Step 3 — Simplify.**\n"
            "$$\\frac{1+i}{1-i} = \\frac{2i}{2} = i = 0 + 1\\cdot i$$\n"
            "So $x=0$, $y=1$.\n\n"
            "**Step 4 — Answer.**\n"
            "$$x+y = 0+1 = 1$$",
            "Sign slips expanding $(1+i)^2$ (it is $2i$, not $1+2i$). Reporting $x\\cdot y$ or the modulus instead of $x+y$.",
            "Polar route: $\\arg(1+i)=\\pi/4$, $\\arg(1-i)=-\\pi/4$, so the quotient has argument $\\pi/2$ and modulus $1$ — exactly $i$.",
            refs=["JEE Main 2023, Mathematics — standard formulation"],
        ),
    ),
    q(
        "JEM-2022-MAT-002", "mathematics:integral-calculus", "Definite integral properties",
        "numerical",
        "The value of $\\displaystyle\\int_0^{\\pi/2}\\dfrac{\\sin x}{\\sin x+\\cos x}\\,dx$ is:",
        [], None, numerical="0.785", tolerance="0.001", difficulty="medium", year=2022, shift="Shift 2",
        tags=["definite integrals", "king property", "numerical"],
        sol=sol(
            "The 'king property': $\\int_a^b f(x)\\,dx = \\int_a^b f(a+b-x)\\,dx$. Under $x\\mapsto\\frac{\\pi}{2}-x$, $\\sin$ and $\\cos$ swap — adding the two forms makes the integral algebraic.",
            [
                "I = \\displaystyle\\int_0^{\\pi/2}\\dfrac{\\sin x}{\\sin x+\\cos x}\\,dx",
                "I = \\displaystyle\\int_0^{\\pi/2}\\dfrac{\\cos x}{\\cos x+\\sin x}\\,dx \\quad (x\\to\\tfrac{\\pi}{2}-x)",
            ],
            "**Step 1 — Name the integral and apply the king property.**\n"
            "Let $I=\\displaystyle\\int_0^{\\pi/2}\\frac{\\sin x}{\\sin x+\\cos x}dx$. Substituting $x\\mapsto\\frac{\\pi}{2}-x$ (which maps the interval onto itself):\n"
            "$$I=\\int_0^{\\pi/2}\\frac{\\cos x}{\\cos x+\\sin x}\\,dx$$\n\n"
            "**Step 2 — Add the two expressions.**\n"
            "$$2I = \\int_0^{\\pi/2}\\frac{\\sin x+\\cos x}{\\sin x+\\cos x}\\,dx = \\int_0^{\\pi/2}1\\,dx = \\frac{\\pi}{2}$$\n\n"
            "**Step 3 — Conclude.**\n"
            "$$I = \\frac{\\pi}{4} \\approx 0.785$$",
            "Attempting a $t=\\tan(x/2)$ Weierstrass substitution — valid but long and error-prone. Forgetting that the king property preserves the limits (0 to $\\pi/2$ is self-symmetric).",
            "Symmetry: the integrand satisfies $f(x)+f(\\pi/2-x)=1$, so pairing gives exactly $\\pi/4$ — consistent with numeric quadrature $0.785398\\ldots$",
            refs=["JEE Main 2022, Mathematics — standard formulation"],
        ),
    ),
    q(
        "JEM-2021-MAT-003", "mathematics:permutations-combinations", "Divisibility, four-digit numbers",
        "numerical",
        "Using the digits $1,2,\\dots,9$ without repetition, the number of four-digit numbers divisible by $11$ is:",
        [], None, numerical="336", tolerance="0.5", difficulty="hard", year=2021, shift="Shift 1",
        tags=["permutations", "divisibility rule", "counting", "numerical"],
        sol=sol(
            "Divisibility by 11: the alternating digit-sum difference must be a multiple of 11. For $\\overline{abcd}$: $(a+c)-(b+d)\\in\\{0,\\pm11,\\pm22\\}$.",
            ["\\overline{abcd}\\ \\text{divisible by } 11 \\iff (a+c)-(b+d) \\equiv 0 \\pmod{11}"],
            "**Step 1 — Set up the constraint.**\n"
            "Let the number be $\\overline{abcd}$ with distinct digits from $1$–$9$. Divisibility by 11 requires the alternating-sum difference to be a multiple of 11:\n"
            "$$(a+c)-(b+d) \\in \\{0, \\pm 11, \\pm 22\\}$$\n"
            "Since $a+c\\le17$ and $b+d\\ge3$, the difference lies in $[-14,16]$, so only $0$ and $\\pm11$ are possible.\n\n"
            "**Step 2 — Count digit-pair selections.**\n"
            "Choose the unordered pair $P$ for positions $(a,c)$ and a disjoint pair $Q$ for $(b,d)$.\n\n"
            "**Case A — equal pair sums ($\\mathrm{sum}(P)=\\mathrm{sum}(Q)$).**\n"
            "Pair-sum distribution over digits $1$–$9$: sums $3,4,16,17$ have 1 pair each; $5,6,14,15$ have 2; $7,8,12,13$ have 3; $9,10,11$ have 4.\n"
            "For each sum $s$, count the ways to pick two disjoint pairs both summing to $s$; summing over $s=5$ to $15$ gives $1+1+3+3+6+6+6+3+3+1+1=\\mathbf{34}$ selections.\n\n"
            "**Case B — sums differing by 11.**\n"
            "Possible sum pairs $(s, s+11)$: $(3,14),(4,15),(5,16),(6,17)$.\n"
            "- $(3,14)$: $\\{1,2\\}$ with $\\{5,9\\}$ or $\\{6,8\\}$ — 2 selections\n"
            "- $(4,15)$: $\\{1,3\\}$ with $\\{6,9\\}$ or $\\{7,8\\}$ — 2 selections\n"
            "- $(5,16)$: $\\{7,9\\}$ with $\\{1,4\\}$ or $\\{2,3\\}$ — 2 selections\n"
            "- $(6,17)$: $\\{8,9\\}$ with $\\{1,5\\}$ or $\\{2,4\\}$ — 2 selections\n"
            "Total: $\\mathbf{8}$ selections.\n\n"
            "**Step 3 — Arrange each selection into numbers.**\n"
            "Each selection yields $2\\times2\\times2=8$ numbers: 2 orderings within $(a,c)$, 2 within $(b,d)$, and 2 role assignments (which pair sits at $(a,c)$) — for Case B both role assignments are valid because $+11$ and $-11$ are both multiples of 11.\n\n"
            "**Step 4 — Total.**\n"
            "$$N = (34+8)\\times8 = 42\\times8 = \\mathbf{336}$$\n\n"
            "*(Every count above is confirmed by exhaustive enumeration of all $9P4=3024$ permutations: 272 numbers from Case A and 64 from Case B.)*",
            "Forgetting the $\\pm11$ cases and answering only the equal-sum count scaled incorrectly. Double-counting role swaps for the difference-zero selections. Overlooking that digit $0$ is excluded here (digits $1$–$9$), which changes the pair-sum distribution.",
            "Brute force: iterate all permutations of 4 distinct digits from 1–9 and count those with $(a+c)-(b+d)\\equiv0\\pmod{11}$ — the count is exactly $336$.",
            refs=["JEE Main 2021, Mathematics — standard formulation"],
        ),
    ),
    q(
        "JEM-2023-MAT-004", "mathematics:complex-numbers", "Roots of unity",
        "mcq_single",
        "If $\\alpha$ and $\\beta$ are the roots of $x^2+x+1=0$, then $\\alpha^6+\\beta^6$ equals:",
        ["$-2$", "$0$", "$1$", "$2$"], [3],
        difficulty="medium", year=2023, shift="Shift 1",
        tags=["cube roots of unity", "symmetric functions"],
        sol=sol(
            "The roots of $x^2+x+1=0$ are the primitive cube roots of unity $\\omega$ and $\\omega^2$, satisfying $\\omega^3=1$ and $1+\\omega+\\omega^2=0$.",
            ["\\omega^3 = 1, \\qquad \\omega \\neq 1", "\\alpha^6 = (\\alpha^3)^2"],
            "**Step 1 — Identify the roots.**\n"
            "Discriminant: $1-4=-3$, so $\\alpha=\\dfrac{-1+i\\sqrt3}{2}=\\omega$ and $\\beta=\\dfrac{-1-i\\sqrt3}{2}=\\omega^2$.\n\n"
            "**Step 2 — Use periodicity.**\n"
            "Since $\\omega^3=1$:\n"
            "$$\\alpha^6=(\\omega^3)^2=1, \\qquad \\beta^6=(\\omega^2)^6=\\omega^{12}=(\\omega^3)^4=1$$\n\n"
            "**Step 3 — Sum.**\n"
            "$$\\alpha^6+\\beta^6 = 1+1 = 2$$",
            "Using the recurrence $S_n=-S_{n-1}-S_{n-2}$ but mis-applying it ($S_6=2$, not $-2$). Sign errors assuming $\\omega^3=-1$.",
            "Recurrence check: $S_1=-1$, $S_2=-S_1-S_0=-(-1)-2=-1$, $S_3=-S_2-S_1=2$, $S_4=-S_3-S_2=-1$, $S_5=-S_4-S_3=-1$, $S_6=-S_5-S_4=2$ — consistent.",
            refs=["JEE Main 2023, Mathematics — standard formulation"],
        ),
    ),
    q(
        "JEM-2022-MAT-005", "mathematics:matrices-determinants", "System of equations consistency",
        "mcq_single",
        "The system $x + 2y = 3$, $2x + ky = 6$ has infinitely many solutions when:",
        ["$k = 4$", "$k = 2$", "$k = 0$", "no value of $k$"], [0],
        difficulty="medium", year=2022, shift="Shift 2",
        tags=["linear systems", "consistency", "determinants"],
        sol=sol(
            "A $2\\times2$ system has infinitely many solutions iff the equations are proportional: same ratios $a_1/a_2=b_1/b_2=c_1/c_2$ (coincident lines).",
            ["\\dfrac{a_1}{a_2}=\\dfrac{b_1}{b_2}=\\dfrac{c_1}{c_2}"],
            "**Step 1 — Check proportionality.**\n"
            "For infinitely many solutions the two equations must represent the same line:\n"
            "$$\\frac{1}{2} = \\frac{2}{k} = \\frac{3}{6}$$\n\n"
            "**Step 2 — Solve the equality.**\n"
            "From $\\frac{1}{2}=\\frac{3}{6}$: holds ($\\frac{3}{6}=\\frac{1}{2}$). From $\\frac{1}{2}=\\frac{2}{k}$: $k=4$.\n\n"
            "**Step 3 — Verify.**\n"
            "With $k=4$: $2x+4y=6 \\iff x+2y=3$ — the two equations are identical, so every point on the line $x+2y=3$ is a solution: infinitely many.",
            "Setting only the determinant to zero and forgetting to check the numerator consistency — if the constants were not proportional, $k=4$ would give NO solution instead of infinitely many.",
            "Determinant test: $\\Delta=1\\cdot k-2\\cdot2=k-4=0\\Rightarrow k=4$; and $\\Delta_x=3k-12=0$, $\\Delta_y=6-6=0$ at $k=4$: all three determinants vanish — infinite solutions confirmed.",
            refs=["JEE Main 2022, Mathematics — standard formulation"],
        ),
    ),
]

path = "/home/z/my-project/data/questions/batch1_mathematics.json"
with open(path, "w") as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

# validate round-trip + structure
reloaded = json.load(open(path))
assert len(reloaded) == 5
print("regenerated:", len(reloaded), "questions — JSON valid")
