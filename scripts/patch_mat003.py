#!/usr/bin/env python3
"""Fix MAT-003 solution body with code-verified counts (272 + 64 = 336)."""
import json

path = "/home/z/my-project/data/questions/batch1_mathematics.json"
with open(path) as f:
    data = json.load(f)

new_body = (
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
    "*(Every count above is confirmed by exhaustive enumeration of all $9P4=3024$ permutations: 272 numbers from Case A and 64 from Case B.)*"
)

for q in data:
    if q["publicId"] == "JEM-2021-MAT-003":
        q["solution"]["body"] = new_body
        print("patched", q["publicId"])

with open(path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

# validate round-trip
with open(path) as f:
    reloaded = json.load(f)
print("JSON valid, questions:", len(reloaded))
for q in reloaded:
    assert q["solution"]["body"], q["publicId"]
print("all bodies present")
