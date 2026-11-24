#!/usr/bin/env python3
"""JEE NEXUS — mathify: fold script markers (^ _ from HTML sup/sub) into proper
$...$ math regions so nothing renders literally in the app.

Rules:
 1. $X$ immediately followed by ^{..}/_{..} runs -> absorbed into the math
 2. plain runs containing ^ or _ (bounded by real English words, never inside
    existing math) -> wrapped in $...$
 3. directly-adjacent math regions merged ($A$$B$ -> $AB$)
 4. function names (sin cos ...) backslashed inside math
"""
import re

FUNC_WORDS = {"sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lim", "max",
              "min", "exp", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan",
              "deg", "det", "dim", "arg"}

MATHY_CHARS = set(
    "0123456789"
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "^_{}+-*/().,=<>!|' "
    "\u00d7\u00f7\u00b1\u00b0\u2212\u2013\u2014"
    "\u03b1\u03b2\u03b3\u03b4\u03b5\u03b6\u03b7\u03b8\u03ba\u03bb\u03bc\u03bd\u03be\u03bf"
    "\u03c0\u03c1\u03c2\u03c3\u03c4\u03c5\u03c6\u03c7\u03c8\u03c9"
    "\u0391\u0392\u0393\u0394\u0398\u039b\u039e\u03a0\u03a3\u03a5\u03a6\u03a8\u03a9"
)

_WORD_BARRIER = re.compile(r"[A-Za-z]{3,}")
STOP_BARRIERS = {"is", "in", "of", "to", "by", "at", "on", "or", "as",
                 "an", "be", "it", "if", "so", "no", "do", "we", "he", "up"}
_RUN_RE = re.compile(
    "[0-9A-Za-z^_{}+\\-*/().,=<>!|' \u00d7\u00f7\u00b1\u00b0\u2212"
    "\u03b1-\u03c9\u0391-\u03a9\u2013\u2014]+"
)


def _is_mathy_run(s):
    """Needs math wrapping: contains ^ or _, only mathy chars, no real words."""
    if "^" not in s and "_" not in s:
        return False
    for ch in s:
        if ch not in MATHY_CHARS:
            return False
    for word in re.split(r"[^A-Za-z]+", s):
        if len(word) >= 3 and word.lower() not in FUNC_WORDS:
            return False
    return True


def _wrap_plain(seg):
    """Wrap mathy runs in a plain (non-math) text segment."""
    def wrap(m):
        run = m.group(0)
        stripped = run.strip()
        if _is_mathy_run(stripped):
            # keep edge punctuation outside the math
            lead_ws = run[: len(run) - len(run.lstrip())]
            trail_ws = run[len(run.rstrip()):]
            core = stripped
            lead_p = ""
            trail_p = ""
            while core and core[0] in ",.;:! ":
                lead_p += core[0]
                core = core[1:]
            while core and core[-1] in ",.;:! ":
                trail_p = core[-1] + trail_p
                core = core[:-1]
            if not _is_mathy_run(core):
                return run
            return lead_ws + lead_p + "$" + core + "$" + trail_p + trail_ws
        return run
    return _RUN_RE.sub(wrap, seg)


def _process_text_segment(seg):
    """Barrier-aware processing of a non-math segment."""
    if not seg:
        return seg
    out = []
    pos = 0
    # barriers: real words (3+ letters, not functions) and stop words
    barriers = []
    for m in _WORD_BARRIER.finditer(seg):
        if m.group(0).lower() not in FUNC_WORDS:
            barriers.append((m.start(), m.end()))
    for m in re.finditer(r"\b[A-Za-z]{1,2}\b", seg):
        if m.group(0).lower() in STOP_BARRIERS:
            barriers.append((m.start(), m.end()))
    barriers.sort()
    for s, e in barriers:
        out.append(_wrap_plain(seg[pos:s]))
        out.append(seg[s:e])
        pos = e
    out.append(_wrap_plain(seg[pos:]))
    return "".join(out)


def _fix_funcs(inner):
    for f in sorted(FUNC_WORDS, key=len, reverse=True):
        pat = re.compile(r"(?<![\\A-Za-z])" + f + r"(?![A-Za-z])")
        inner = pat.sub(lambda _m: "\\" + f + " ", inner)
    return inner


def mathify(text):
    """(str) -> str with script-marker runs folded into $...$ math."""
    if "$" not in text and "^" not in text and "_" not in text:
        return text
    # 1) absorb script runs directly following math: $X$^{a}_{b} -> $X^{a}_{b}$
    text = re.sub(
        r"\$([^$]+)\$((?:[\^_]\{[^{}]*\})+)",
        lambda m: "$" + m.group(1) + m.group(2) + "$",
        text,
    )
    # 2) wrap mathy runs in NON-math segments only (never inside \commands)
    parts = text.split("$")
    for i in range(0, len(parts), 2):  # even indices are text
        parts[i] = _process_text_segment(parts[i])
    text = "$".join(parts)
    # 3) merge directly-adjacent math regions
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"\$([^$]*)\$\$([^$]*)\$",
                      lambda m: "$" + m.group(1) + m.group(2) + "$", text)
    # 4) backslash function names inside math
    text = re.sub(r"\$([^$]*)\$", lambda m: "$" + _fix_funcs(m.group(1)) + "$", text)
    return text


if __name__ == "__main__":
    tests = [
        "the equation x^{2} + 2x + 2 = 0 , then",
        "area 3.5 $\\times$ 10^{-3} m^{2} and resistance",
        "wavelength $\\lambda$_{1} = 350 nm and then",
        "B(t) = (0.4T)sin(50$\\pi$t) field is uniform",
        "The pH of the resultant mixture",
        "Li_{2}^{+} and Li_{2}^{-} ?",
        "variance 18 cm^2. A new student",
        "For n_{i} = 8 to n_{f} = n, the plot",
        "$\\times$ 10^{-3}",
        "Rydberg constant, R_{H} is in wave number unit",
        "20 mL of 0.1 M H_2SO_4 solution",
    ]
    for t in tests:
        print(repr(mathify(t)))
