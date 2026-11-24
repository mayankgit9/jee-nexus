#!/usr/bin/env python3
"""JEE NEXUS — MathJax v3 SVG -> LaTeX converter.

Reverse-engineers the deterministic SVG output of MathJax 3 (as served by
questions.examside.com) back into LaTeX source. Every conversion is meant to
be round-trip verified by scripts/mjx_verify.py (render back with the same
MathJax, compare glyph/transform structure).

Structural rules (from MathJax 3 SVG output):
  - outer <g transform="scale(1,-1)"> flips y: positive y = UP
  - horizontal sequence: sibling groups with translate(x, ~0), x increasing
  - fraction: [num-group y>0, den-group y<0, <rect height=60>] inside one <g>
  - sqrt: <g>[glyph 221A, <g>[content, <rect y high>]]</g>
  - sub/superscript: scale(0.707) groups; y<0 = sub, y>0 = sup
  - accents: single glyph (2192 vec, 2C6 hat, ...) in group with y>0, scale=1
  - mtable: data-mml-node="mtable" with row groups at descending y
  - stretched delimiters: S4-23A1..23AA pieces (+ nested svg with scaled 23AA)
"""
import re
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------- glyph tables

# Upright operators & symbols (TEX-N + a few others) -> LaTeX
N_OPS = {
    0x2D: r"\text{-}",  # ASCII hyphen only appears via \text (math '-' is 2212)
    0x2013: "\u2013", 0x2014: "\u2014", 0x2018: "`", 0x2019: "'",
    0x2192: r"\to ", 0x21D2: r"\Rightarrow ", 0x2190: r"\leftarrow ",
    0x2194: r"\leftrightarrow ", 0x2208: r"\in ", 0x2209: r"\notin ",
    0x2212: "-", 0x2213: r"\mp ", 0x2215: "/", 0x2216: r"\setminus ",
    0x2217: r"\ast ", 0x2218: r"\circ ", 0x2219: r"\bullet ",
    0x221D: r"\propto ", 0x221E: r"\infty ", 0x2220: r"\angle ",
    0x2223: "|", 0x2225: r"\| ", 0x2227: r"\wedge ", 0x2228: r"\vee ",
    0x2229: r"\cap ", 0x222A: r"\cup ", 0x222B: r"\int ",
    0x2234: r"\therefore ", 0x2235: r"\because ",
    0x223C: r"\sim ", 0x2243: r"\simeq ", 0x2245: r"\cong ",
    0x2248: r"\approx ", 0x2260: r"\neq ", 0x2261: r"\equiv ",
    0x2264: r"\leq ", 0x2265: r"\geq ", 0x226A: r"\ll ", 0x226B: r"\gg ",
    0x22C5: r"\cdot ", 0x22C6: r"\star ", 0x22EE: r"\vdots ",
    0x22EF: r"\ddots ", 0x22F1: r"\ddots ",
    0xB1: r"\pm ", 0xD7: r"\times ", 0xF7: r"\div ",
    0xB0: r"^\circ", 0x2032: "'", 0x2033: "''",
    0x210F: r"\hbar ", 0x2113: r"\ell ",
    0x2202: r"\partial ", 0x2207: r"\nabla ",
    0x2205: r"\emptyset ", 0x2200: r"\forall ", 0x2203: r"\exists ",
    0x2282: r"\subset ", 0x2283: r"\supset ", 0x2286: r"\subseteq ",
    0x2211: r"\sum ", 0x220F: r"\prod ", 0x2210: r"\coprod ",
    0x2026: r"\ldots ", 0x22EF: r"\cdots ",
    0x20: " ", 0xA0: "~",
}
# Upright Greek capitals (TEX-N)
N_GREEK_UPPER = {
    0x393: r"\Gamma ", 0x394: r"\Delta ", 0x398: r"\Theta ", 0x39B: r"\Lambda ",
    0x39E: r"\Xi ", 0x3A0: r"\Pi ", 0x3A3: r"\Sigma ", 0x3A5: r"\Upsilon ",
    0x3A6: r"\Phi ", 0x3A8: r"\Psi ", 0x3A9: r"\Omega ",
}
# Known function names rendered as consecutive upright letters
FUNCTIONS = ["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lim",
             "max", "min", "exp", "det", "gcd", "lcm", "sinh", "cosh", "tanh",
             "arcsin", "arccos", "arctan", "arg", "deg", "dim", "ker", "sup", "inf"]
# Italic -> plain char (math alphanumeric block)
def _italic_map(cp):
    # Mathematical Italic Capital A (1D434) .. Z (1D44D)
    if 0x1D434 <= cp <= 0x1D44D:
        return chr(cp - 0x1D434 + ord("A"))
    # Mathematical Italic Small a (1D44E) .. z (1D467)  (1D455 reserved -> h is 210E)
    if 0x1D44E <= cp <= 0x1D467:
        return chr(cp - 0x1D44E + ord("a"))
    # Mathematical Italic Small Greek alpha (1D6FC) .. omega (1D714)
    if 0x1D6FC <= cp <= 0x1D714:
        return chr(cp - 0x1D6FC + 0x3B1)  # α..ω
    # Capital Greek alpha (1D6E2)..omega (1D6F9)
    if 0x1D6E2 <= cp <= 0x1D6F9:
        return chr(cp - 0x1D6E2 + 0x391)
    return None

PURE_ACCENTS = {0x2C6, 0x5E, 0x2C7, 0x2DC, 0x7E, 0x2D9, 0x2DA, 0x2DD,
               0x00AF, 0x203E, 0x20D7}  # glyphs that ONLY appear as accents
ACCENTS = {  # combining glyph codepoints -> LaTeX accent command
    0x2192: r"\vec",       # -> arrow above (vec)
    0x2C6: r"\hat", 0x5E: r"\hat",
    0x2C7: r"\check", 0x2DC: r"\tilde", 0x7E: r"\tilde",
    0x2D9: r"\dot", 0x2DA: r"\mathring", 0x2DD: r"\dddot",
    0x00AF: r"\bar", 0x203E: r"\overline",
}
DELIMS = {0x28: "(", 0x29: ")", 0x5B: "[", 0x5D: "]", 0x7B: r"\{", 0x7D: r"\}",
          0x2223: "|", 0x2016: r"\|", 0x221A: r"\sqrt", 0x27E8: r"\langle ",
          0x27E9: r"\rangle "}
OPEN_DELIMS = {0x28, 0x5B, 0x7B, 0x27E8}
CLOSE_DELIMS = {0x29, 0x5D, 0x7D, 0x27E9}
# examside's newer MathJax/mhchem uses a custom MHC font for chemistry arrows.
# Map MHC glyphs to the closest standard LaTeX (round-trip masked in verifier).
MHC_MAP = {
    0xE429: r"\longrightarrow ",  # long right arrow (curved head)
}
# S4 bracket-piece codepoints -> the single delimiter they build
BRACKET_PIECES = {
    0x23A1: "[", 0x23A2: "[", 0x23A3: "[",
    0x23A4: "]", 0x23A5: "]", 0x23A6: "]",
    0x23A7: r"\{", 0x23A8: r"\{", 0x23A9: r"\{", 0x23AA: r"\{",
    0x23AB: r"\}", 0x23AC: r"\}", 0x23AD: r"\}",
    0x23B0: r"\}", 0x23B1: r"\}",
}
SIZE_FONTS = {"SO", "S3", "S4", "LO", "S1", "S2"}

XLINK_HREF = "{http://www.w3.org/1999/xlink}href"


def parse_glyph_id(gid):
    """MJX-TEX-<FONT>-<HEXCP> -> (font, codepoint) or None.
    Reconstructs the full variant name: TEX-N -> N, TEX-SO -> SO, TEX-MHC-M -> MHC-M.
    Skips optional numeric local-cache segments (MJX-1-TEX-I-...)."""
    if not gid or not gid.startswith("MJX-"):
        return None
    parts = gid.split("-")
    if len(parts) < 3:
        return None
    cp_hex = parts[-1]
    segs = [p for p in parts[1:-1] if p and not p.isdigit() and p != "TEX"]
    font = "-".join(segs)
    try:
        return font, int(cp_hex, 16)
    except ValueError:
        return None


def compose_transforms(s):
    """Parse an SVG transform attribute into (dx, dy, sx, sy) accumulated.
    Handles translate(a,b) / translate(a b) / scale(s) / scale(sx,sy), composed."""
    dx = dy = 0.0
    sx = sy = 1.0
    if not s:
        return dx, dy, sx, sy
    for name, args in re.findall(r"(translate|scale|matrix)\(([^)]*)\)", s):
        vals = [float(v) for v in re.split(r"[,\s]+", args.strip()) if v != ""]
        if name == "translate":
            tx = vals[0] if vals else 0.0
            ty = vals[1] if len(vals) > 1 else 0.0
            dx += tx * sx
            dy += ty * sy
        elif name == "scale":
            if len(vals) == 1:
                sx *= vals[0]; sy *= vals[0]
            else:
                sx *= vals[0]; sy *= vals[1]
        elif name == "matrix":
            # (a,b,c,d,e,f): x' = a*x + c*y + e ; assume no rotation in MJX output
            sx *= vals[0]; sy *= vals[3]
            dx += vals[4]; dy += vals[5]
    return dx, dy, sx, sy


class MjxNode:
    """A parsed SVG element with resolved geometry."""
    __slots__ = ("tag", "attrib", "children", "dx", "dy", "sx", "sy", "text")

    def __init__(self, el, dx=0.0, dy=0.0, sx=1.0, sy=1.0):
        self.tag = el.tag
        self.attrib = dict(el.attrib)
        self.dx, self.dy, self.sx, self.sy = dx, dy, sx, sy
        self.text = (el.text or "").strip() if el.tag.endswith("text") else None
        self.children = []
        for child in el:
            self.children.append(MjxNode.build(child, dx, dy, sx, sy))

    @classmethod
    def build(cls, el, pdx=0.0, pdy=0.0, psx=1.0, psy=1.0):
        tdx, tdy, tsx, tsy = compose_transforms(el.attrib.get("transform", ""))
        # MathJax's root wrapper uses scale(1,-1) to flip y for SVG. For layout
        # analysis we want MATH-frame coords (up positive), so treat the root
        # flip as identity — it is a rendering detail, not geometry.
        if abs(tsx - 1.0) < 1e-9 and abs(tsy + 1.0) < 1e-9:
            tsx, tsy = 1.0, 1.0
        # nested <svg x= y= width= height= viewBox> behaves like translate+scale
        if el.tag.endswith("svg") and "viewBox" in el.attrib and ("width" in el.attrib or "height" in el.attrib):
            vb = [float(v) for v in re.split(r"[,\s]+", el.attrib["viewBox"])]
            w = el.attrib.get("width", "").rstrip("px")
            try:
                w = float(re.sub(r"(ex|em|px)$", "", w))
                sx_n = tsx * (w / (vb[2] / 1000.0)) if vb[2] else 1.0
                # width given in ex units: 1ex=... MJX nested svg width is in ex? use ratio heuristic
                tsx = tsx  # keep; scale handled via viewBox on use below
            except ValueError:
                pass
        node = cls(el, pdx + tdx * psx, pdy + tdy * psy, psx * tsx, psy * tsy)
        if el.tag.endswith("svg"):
            # nested svg x/y attributes shift origin (y flipped already)
            x = float(el.attrib.get("x", "0").rstrip("px") or 0)
            y = float(el.attrib.get("y", "0").rstrip("px") or 0)
            node.dx += x * node.sx
            node.dy -= y * node.sy  # svg y is downward; our frame is flipped
            # apply viewBox scale if children positioned in viewBox units
            if "viewBox" in node.attrib:
                vb = [float(v) for v in re.split(r"[,\s]+", node.attrib["viewBox"])]
                w = node.attrib.get("width", "").strip()
                m = re.match(r"^([\d.]+)", w)
                if m and vb[2]:
                    try:
                        wv = float(m.group(1))
                        sc = wv / vb[2]
                        node.sx *= sc
                        node.sy *= sc
                    except ValueError:
                        pass
        return node

    # -- helpers ---------------------------------------------------------
    def glyph(self):
        h = self.attrib.get("href") or self.attrib.get(XLINK_HREF)
        return h[1:] if h and h.startswith("#") else h

    def is_use(self):
        return self.tag.endswith("use") and self.glyph()

    def text_width(self):
        try:
            return float(self.attrib.get("width", "0"))
        except ValueError:
            return 0.0


def svg_to_tree(svg_html):
    """Extract the <svg> root from an mjx-container fragment -> MjxNode tree."""
    m = re.search(r"<svg\b.*</svg>", svg_html, re.S)
    if not m:
        return None
    frag = m.group(0)
    frag = frag.replace("xlink:href=", "href=")
    try:
        root = ET.fromstring(frag)
    except ET.ParseError:
        return None
    return MjxNode.build(root)


def _glyph_latex(font, cp):
    """Glyph (font, codepoint) -> (latex, kind) where kind flags special roles."""
    if cp == 0x2061:  # function application (invisible)
        return "", "invisible"
    if cp == 0xA0 or cp == 0x20:
        return " ", "space"
    if font.startswith("MHC"):
        if cp in MHC_MAP:
            return MHC_MAP[cp], "op"
        return "", "mhc-unknown"
    if font in ("N", "MI"):  # upright
        if cp in N_OPS:
            return N_OPS[cp], "op"
        if cp in N_GREEK_UPPER:
            return N_GREEK_UPPER[cp], "op"
        if 0x30 <= cp <= 0x39 or 0x41 <= cp <= 0x5A or 0x61 <= cp <= 0x7A or cp == 0x2E:
            return chr(cp), "upright"
        if cp in DELIMS:
            return DELIMS[cp], "delim"
        if cp in ACCENTS:
            return ACCENTS[cp], "accent"
        if cp == 0x2013:
            return "-", "upright"
        return chr(cp), "upright"
    if font == "I":
        if cp in (0x210E,):
            return "h", "italic"
        if cp in (0x2113,):
            return r"\ell ", "italic"
        c = _italic_map(cp)
        if c:
            return c, "italic"
        if cp in N_OPS:
            return N_OPS[cp], "op"
        return chr(cp), "italic"
    if font == "B":
        base = _italic_map(cp) or (chr(cp) if cp < 0x1D400 else "?")
        if base and base != "?":
            return r"\mathbf{" + base + "}", "upright"
    if font == "C":
        base = _italic_map(cp) or (chr(cp) if cp < 0x1D400 else "?")
        if base and base != "?":
            return r"\mathcal{" + base + "}", "upright"
    if font in ("F", "BF"):
        base = _italic_map(cp) or (chr(cp) if cp < 0x1D400 else "?")
        if base and base != "?":
            return (r"\mathfrak{" if font == "F" else r"\mathbf{\mathcal{") + base + ("}" if font == "F" else "}}"), "upright"
    if font in ("SS", "SSB", "SSI", "SSBI"):
        base = _italic_map(cp) or (chr(cp) if cp < 0x1D400 else "?")
        if base and base != "?":
            return r"\mathsf{" + base + "}", "upright"
    if font == "M":
        return r"\mathtt{" + chr(cp) + "}", "upright" if cp < 0x10000 else "?"
    if font == "D":
        base = _italic_map(cp) or (chr(cp) if cp < 0x1D400 else "?")
        if base and base != "?":
            return r"\mathbb{" + base + "}", "upright"
    # size variants: delimiters / radicals / big operators
    if font in SIZE_FONTS:
        if cp == 0x221A:
            return r"\sqrt", "radical"
        if cp in (0x2211, 0x220F, 0x2210, 0x22C2, 0x22C3):
            return {0x2211: r"\sum ", 0x220F: r"\prod ", 0x2210: r"\coprod ",
                    0x22C2: r"\bigcap ", 0x22C3: r"\bigcup "}[cp], "bigop"
        if cp == 0x222B or 0x222C <= cp <= 0x222F:
            return r"\int ", "bigop"
        if cp == 0x2C6:
            return r"\widehat", "accent"
        if cp in BRACKET_PIECES:
            return BRACKET_PIECES[cp], "delim"
        if cp in DELIMS:
            return DELIMS[cp], "delim"
        if cp in ACCENTS:
            return ACCENTS[cp], "accent"
        if cp in N_OPS:
            return N_OPS[cp], "op"
    # last resort
    try:
        ch = chr(cp)
    except ValueError:
        ch = "?"
    if cp in N_OPS:
        return N_OPS[cp], "op"
    return ch, "upright"


# ------------------------------------------------------------------ converter

class Atom:
    """A layout atom at one <g> level."""
    __slots__ = ("kind", "latex", "node", "dx", "dy", "scale", "cp", "font", "h", "wrapped")

    def __init__(self, kind, latex, node, dx, dy, scale):
        self.kind = kind      # glyph | group | rect | empty
        self.latex = latex    # resolved glyph latex (for glyph atoms)
        self.node = node      # MjxNode (for group atoms)
        self.dx = dx
        self.dy = dy
        self.scale = scale
        self.cp = 0
        self.font = ""
        self.h = 0.0
        self.wrapped = False


def _space_for_advance(adv):
    """Empty-group advance -> LaTeX spacing command (or None if unrecognized)."""
    if 130 <= adv <= 200:
        return r"\, "
    if 200 < adv <= 240:
        return r"\: "
    if 240 < adv <= 320:
        return r"\; "
    if 900 <= adv <= 1100:
        return r"\quad "
    if 1900 <= adv <= 2100:
        return r"\qquad "
    if 300 < adv <= 500:
        return "~"
    return None


def _join_tokens(parts):
    """Join latex tokens with command-boundary awareness."""
    out = ""
    for p in parts:
        if not p:
            continue
        if out:
            # command token followed by letter needs a separator
            m = re.search(r"\\[a-zA-Z]+$", out)
            if m and p[0].isalpha():
                out += " "
        out += p
    return out


def _is_bracket_piece_group(node):
    """Group made only of S4/S3 bracket-piece glyphs (+ stretched 23AA) -> delim char or None."""
    if node.tag.endswith("g") and node.children:
        delim = None
        for c in node.children:
            if c.tag.endswith("rect"):
                continue
            if c.is_use():
                gid = parse_glyph_id(c.glyph())
                if not gid:
                    return None
                font, cp = gid
                if cp not in BRACKET_PIECES:
                    return None
                delim = BRACKET_PIECES[cp]
            elif c.tag.endswith("svg"):
                for cc in c.children:
                    if cc.is_use():
                        gid = parse_glyph_id(cc.glyph())
                        if not gid or gid[1] not in BRACKET_PIECES:
                            return None
                        delim = BRACKET_PIECES[gid[1]]
                    elif cc.tag.endswith("rect"):
                        continue
                    else:
                        return None
            else:
                return None
        return delim
    return None


def _glyph_atoms_from_uses(uses):
    """Convert a run of <use> children (same baseline) to latex parts."""
    parts = []
    for u in uses:
        gid = parse_glyph_id(u.glyph())
        if gid is None:
            continue
        font, cp = gid
        latex, kind = _glyph_latex(font, cp)
        if kind == "invisible":
            continue
        parts.append((latex, kind, cp, font))
    return parts


def _emit_upright_runs(parts):
    """Merge upright letter runs: function names, mathrm, digits, delimiters."""
    out = []
    buf = []       # current run of upright chars
    bufkinds = []

    def flush():
        nonlocal buf
        if not buf:
            return
        word = "".join(buf)
        if word in FUNCTIONS:
            out.append("\\" + word + " ")
        elif len(word) == 1:
            out.append(word)
        else:
            # mixed digits/letters handled: single digits pass through
            if word.isdigit():
                out.append(word)
            elif all(ch.isdigit() or ch == "." for ch in word):
                out.append(word)
            else:
                out.append(r"\mathrm{" + word + "}")
        buf = []

    for latex, kind, cp, font in parts:
        if kind == "upright" and len(latex) == 1 and (latex.isalnum() or latex == "."):
            buf.append(latex)
        else:
            flush()
            out.append(latex)
    flush()
    return out


def _single_glyph_rule(font, cp, latex):
    """Emit rule shared by run-merging and bare-use conversion:
    upright single letters -> \\mathrm{X}; digits stay bare."""
    if font in ("N", "MI") and len(latex) == 1 and latex.isalpha():
        return r"\mathrm{" + latex + "}"
    return latex


def convert_node(node, ctx=None):
    """Recursively convert an MjxNode subtree to LaTeX."""
    if node is None:
        return ""
    # strip wrapper g's that only contain one child group
    el = node
    while (el.tag.endswith("g") and len(el.children) == 1
           and not el.attrib.get("data-mml-node")):
        el = el.children[0]
    # bare <use> after unwrapping
    if el.is_use():
        gid = parse_glyph_id(el.glyph())
        if gid is None:
            return ""
        font, cp = gid
        latex, kind = _glyph_latex(font, cp)
        if kind == "invisible":
            return ""
        if cp == 0x2192 and (el.dy - node.dy) > 250:
            latex = r"\vec"
        base = _single_glyph_rule(font, cp, latex)
        pre = _delim_prefix_for(el)
        return (pre + base) if pre else base
    # mtable: only delegate if this node IS the mtable (after unwrap), not a
    # parent that merely CONTAINS one (siblings like delimiters must survive)
    el2 = el
    while el2.tag.endswith("g") and len(el2.children) == 1 and not el2.attrib.get("data-mml-node"):
        el2 = el2.children[0]
    if el2.attrib.get("data-mml-node") == "mtable":
        return _convert_mtable(el2)

    atoms = _collect_atoms(node)
    return _assemble(atoms, node)


def _has_mtable(node):
    if node.attrib.get("data-mml-node") == "mtable":
        return True
    return any(_has_mtable(c) for c in node.children)


def _unwrap_single_use(n):
    """If a <g> subtree contains exactly ONE <use> (no rects, no other content),
    return that use element, else None. Descends through single-child wrappers."""
    kids = list(n)
    if len(kids) == 0:
        return None
    if len(kids) == 1 and kids[0].tag.endswith("g"):
        return _unwrap_single_use(kids[0])
    if len(kids) == 1 and kids[0].is_use() if hasattr(kids[0], "is_use") else False:
        return kids[0]
    return None


def _iter_uses(n):
    if n.is_use():
        yield n
    for c in n.children:
        yield from _iter_uses(c)


def _single_use_of(mjx_node):
    """MjxNode version: g-wrapped single use -> (font, cp, use_node) or None."""
    if not mjx_node.tag.endswith("g"):
        return None
    uses = []
    groups = []
    def scan(nd):
        for c in nd.children:
            if c.is_use():
                uses.append(c)
            elif c.tag.endswith("g"):
                groups.append(c)
                scan(c)
            elif c.tag.endswith("rect") or c.tag.endswith("svg"):
                uses.append(None)  # disqualifier
    scan(mjx_node)
    if len(uses) == 1 and uses[0] is not None and not groups:
        gid = parse_glyph_id(uses[0].glyph())
        return (gid[0], gid[1], uses[0]) if gid else None
    return None


def _collect_atoms(node):
    """Children of this node -> atoms with geometry RELATIVE to this node."""
    atoms = []
    for c in node.children:
        if c.tag.endswith("text"):
            # examside's custom <text> optimization (plain word runs)
            content = (c.text or "").replace("\xa0", " ").strip()
            if not content:
                continue  # nbsp-only spacer: renders nothing (space was in <text>)
            rel = (c.sx / node.sx) if node.sx else c.sx
            a = Atom("glyph", r"\text{" + content + "}", c, c.dx - node.dx, c.dy - node.dy, rel)
            a.font = "N"
            a.cp = 0
            atoms.append(a)
            continue
        if c.tag.endswith("rect"):
            try:
                rx = float(c.attrib.get("x", 0)); ry = float(c.attrib.get("y", 0))
                rh = float(c.attrib.get("height", 60))
            except ValueError:
                continue
            a = Atom("rect", "", c, rx, ry, 1)
            a.h = rh
            atoms.append(a)
            continue
        if c.is_use():
            gid = parse_glyph_id(c.glyph())
            if gid is None:
                continue
            font, cp = gid
            latex, kind = _glyph_latex(font, cp)
            if kind == "invisible":
                atoms.append(Atom("invisible", "", c, c.dx - node.dx, c.dy - node.dy, c.sx))
                continue
            rel = (c.sx / node.sx) if node.sx else c.sx
            dy_rel = c.dy - node.dy
            # ambiguous glyphs: arrow can be \to (baseline) or \vec (raised)
            if cp == 0x2192 and dy_rel > 250:
                latex = r"\vec"
            a = Atom("glyph", latex, c, c.dx - node.dx, dy_rel, rel)
            a.cp = cp
            a.font = font
            atoms.append(a)
            continue
        if c.tag.endswith("g") or c.tag.endswith("svg"):
            rel = (c.sx / node.sx) if node.sx else c.sx
            if not c.children:
                atoms.append(Atom("empty", "", c, c.dx - node.dx, c.dy - node.dy, rel))
                continue
            bd = _is_bracket_piece_group(c)
            if bd is not None:
                # prefix from the first piece that has a registry entry
                piece_node = next((u for ch in _iter_uses(c)
                                   for u in [ch] if id(u) in DELIM_ASSIGN), c)
                a = Atom("glyph", bd, piece_node, c.dx - node.dx, c.dy - node.dy, rel)
                a.cp = 0x28; a.font = "S4"
                atoms.append(a)
                continue
            # g-wrapped single use -> glyph atom (keeps font info for sizing)
            su = _single_use_of(c)
            if su is not None:
                sfont, scp, suse = su
                latex, kind = _glyph_latex(sfont, scp)
                if kind != "invisible":
                    dy_rel = c.dy - node.dy
                    if scp == 0x2192 and dy_rel > 250:
                        latex = r"\vec"
                    a = Atom("glyph", latex, suse, c.dx - node.dx, dy_rel, rel)
                    a.cp = scp
                    a.font = sfont
                    a.wrapped = True
                    atoms.append(a)
                    continue
            atoms.append(Atom("group", "", c, c.dx - node.dx, c.dy - node.dy, rel))
            continue
    return atoms


ACCENT_CMDS = set(ACCENTS.values()) | {r"\widehat", r"\vec"}


def _merge_upright_runs(atoms):
    """Merge consecutive baseline upright glyph atoms into runs:
    function names (\\cos), numbers (20), \\mathrm{word}, \\mathrm{X}.
    Runs are broken by scripts/accents (those atoms are separate items)."""
    out = []
    run = []  # list of glyph atoms on the baseline

    def flush():
        nonlocal run
        if not run:
            return
        word = "".join(a.latex for a in run)
        if word in FUNCTIONS:
            merged = "\\" + word + " "
        elif all(ch.isdigit() or ch == "." for ch in word):
            merged = word
        elif len(word) == 1:
            merged = r"\mathrm{" + word + "}"
        else:
            merged = r"\mathrm{" + word + "}"
        a = Atom("glyph", merged, run[0].node, run[0].dx, run[0].dy, 1.0)
        a.cp = run[-1].cp
        a.font = run[-1].font
        out.append(a)
        run = []

    for a in atoms:
        if (a.kind == "glyph" and len(a.latex) == 1 and a.scale >= 0.85
                and abs(a.dy) < 40 and a.latex.isalnum()
                and a.font in ("N", "MI") and not a.wrapped):
            run.append(a)
        else:
            flush()
            out.append(a)
    flush()
    # function runs: an upright word run followed by an invisible 2061 marker
    # means the original was an operator (\cos); without it \mathrm{cos}
    out2 = []
    i = 0
    while i < len(out):
        a = out[i]
        nxt = out[i + 1] if i + 1 < len(out) else None
        if (a.kind == "glyph" and a.font == "N" and nxt is not None
                and nxt.kind == "invisible" and a.latex.startswith("\\")):
            # operator name (e.g. \mathrm{cos}) followed by 2061 -> \cos
            word = a.latex[len("\\mathrm{"):-1] if a.latex.startswith("\\mathrm{") else None
            if word and word in FUNCTIONS:
                a.latex = "\\" + word + " "
            out2.append(a)
            i += 2  # skip the invisible marker
            continue
        out2.append(a)
        i += 1
    return out2


def _fix_digit_adjacency(parts):
    """Insert a space between consecutive all-digit parts so TeX keeps them
    as separate mns (matches original tokenization: '5'+'4' vs '54')."""
    out = []
    for p in parts:
        if (out and out[-1] and out[-1][-1].isdigit() and p
                and p[0].isdigit() and not out[-1].endswith(" ")
                and not out[-1].rstrip().endswith("}")):
            out.append(" " + p)
        else:
            out.append(p)
    return out


def _delim_prefix_for(node):
    """\\left/\\right prefix from the doc-order registry (id-keyed)."""
    return DELIM_ASSIGN.get(id(node), "")


def _assemble(atoms, node):
    if not atoms:
        return ""
    if len(atoms) == 1:
        a = atoms[0]
        if a.kind == "glyph":
            return a.latex
        if a.kind == "group":
            return convert_node(a.node)
        return ""

    # --- fraction: two groups straddling a thin rect ---
    rects = [a for a in atoms if a.kind == "rect"]
    groups = [a for a in atoms if a.kind in ("group", "glyph")]
    if len(rects) == 1 and len(groups) == 2:
        a, b = groups
        ra = rects[0]
        try:
            h = float(ra.node.attrib.get("height", 60))
        except ValueError:
            h = 60
        # full-size num/den (rel scale ~1) => \dfrac; 0.707 => \frac
        cmd = r"\dfrac" if min(a.scale, b.scale) > 0.85 else r"\frac"
        if h <= 90 and a.dy > 120 and b.dy < -120:
            num = convert_node(a.node) if a.kind == "group" else a.latex
            den = convert_node(b.node) if b.kind == "group" else b.latex
            return cmd + "{" + num + "}{" + den + "}"
        if h <= 90 and b.dy > 120 and a.dy < -120:
            num = convert_node(b.node) if b.kind == "group" else b.latex
            den = convert_node(a.node) if a.kind == "group" else a.latex
            return cmd + "{" + num + "}{" + den + "}"

    # --- sqrt: radical glyph, then content, then (or wrapped with) a high rect ---
    if atoms and atoms[0].kind == "glyph" and atoms[0].latex == r"\sqrt":
        # wrapped form: [radical, group(content+rect)]
        if len(atoms) == 2:
            content = _sqrt_content(atoms[1])
            if content is not None:
                return r"\sqrt{" + content + "}"
        # flat form: [radical, content..., rect(vinculum high)]
        hi_rects = [i for i, a in enumerate(atoms)
                    if a.kind == "rect" and a.dy > 300]
        if hi_rects:
            last = hi_rects[-1]
            inner = atoms[1:last]
            if inner:
                content = _convert_sibling_nodes([a.node for a in inner], node)
                if content:
                    return r"\sqrt{" + content + "}"

    # --- general: build item list, then attach scripts & accents ---
    atoms = _merge_upright_runs(atoms)
    delim_state = {"depth": 0, "bar": 0}

    # re-check fast paths after unwrapping/merging (with delimiter prefixes)
    if len(atoms) == 1:
        a = atoms[0]
        if a.kind == "glyph":
            pre = _delim_prefix_for(a.node)
            return (pre + a.latex) if pre else a.latex
        if a.kind == "group":
            return convert_node(a.node)
        return ""

    items = []
    for a in atoms:
        if a.kind == "invisible":
            continue  # 2061 markers consumed by run-merge; no output
        if a.kind == "empty":
            items.append({"t": "space", "adv": a.dx, "a": a})
        elif a.kind == "rect":
            items.append({"t": "rect", "a": a})
        elif (a.kind == "glyph" and a.cp in PURE_ACCENTS and a.scale >= 0.85) or \
                (a.kind == "glyph" and a.cp == 0x2192 and a.latex == "\\vec"):
            # pure accent glyphs (hat/tilde/dot/bar) and the raised \vec arrow
            # always decorate the preceding base in doc order
            items.append({"t": "accent", "a": a})
        elif a.kind == "invisible":
            items.append({"t": "invisible", "a": a})
        elif a.scale < 0.85 and abs(a.dy) > 40 and a.kind in ("group", "glyph"):
            # scripts: scaled + vertically offset (works for wrapped groups AND
            # unwrapped single-use glyphs like the sup-2 in n^2)
            items.append({"t": "script", "a": a})
        else:
            items.append({"t": "base", "a": a})

    # empty-base pre-pass: a near-zero-advance 'space' followed by scripts is
    # the X{}_{a}{}^{b} pattern (empty group as script base), not spacing
    for k in range(len(items) - 1):
        if items[k]["t"] == "space" and abs(items[k]["adv"]) < 120:
            nxt = items[k + 1]
            if nxt["t"] == "script":
                items[k] = {"t": "base", "a": items[k]["a"], "empty": True}

    out = []
    i = 0
    while i < len(items):
        it = items[i]
        if it["t"] == "space":
            sp = _space_for_advance(abs(it["adv"]))
            if sp:
                out.append(sp)
            i += 1
            continue
        if it["t"] == "rect" or it["t"] == "accent" and not out:
            # orphan rect/accent (shouldn't happen) — skip rect; accent without base skip
            i += 1
            continue
        if it["t"] == "accent":
            # accent over the PREVIOUS emitted base: wrap it
            if out:
                prev = out.pop()
                if isinstance(prev, dict):
                    prev["latex"] = it["a"].latex + "{" + prev["latex"] + "}"
                    out.append(prev)
                else:
                    out.append(it["a"].latex + "{" + prev + "}")
            i += 1
            continue
        if it["t"] == "script":
            # stray script without base: emit anyway
            out.append({"latex": convert_node(it["a"].node) or "{}", "sub": None, "sup": None})
            i += 1
            continue
        # base
        a = it["a"]
        base = a.latex if a.kind == "glyph" else convert_node(a.node)
        if it.get("empty") or (not base and (it["a"].kind == "empty")):
            base = "{}"
        elif a.kind == "glyph" and a.wrapped and a.font in ("N", "MI") and len(base or "") == 1 and (base or "").isalpha():
            base = r"\mathrm{" + base + "}"
        # sized delimiter -> \left/\right (registry-assigned); bracket pieces
        # (23A1-23AD) are sized delimiters too
        if (a.kind == "glyph" and a.cp != 0x221A
                and (a.cp in DELIMS or a.cp in BRACKET_PIECES)):
            pre = _delim_prefix_for(a.node)
            if pre:
                base = pre + base
        sub = sup = None
        max_script_dy = 0.0
        j = i + 1
        while j < len(items) and items[j]["t"] == "script":
            s = items[j]
            max_script_dy = max(max_script_dy, abs(s["a"].dy))
            if s["a"].dy < 0:
                sub = sub if sub is not None else convert_node(s["a"].node)
            else:
                sup = sup if sup is not None else convert_node(s["a"].node)
            j += 1
        # stacked limits (\int\limits_0^\pi): scripts far above/below the op
        BIGOPS = (r"\int ", r"\sum ", r"\prod ", r"\coprod ", r"\bigcap ", r"\bigcup ")
        if max_script_dy > 400 and any(base.startswith(b) for b in BIGOPS):
            base = base.rstrip() + r"\limits "
        if not base and (sub is None and sup is None):
            i = j
            continue  # empty wrapper, no scripts: skip entirely
        if not base:
            base = "{}"  # empty group base: X_4{}^+ pattern
        entry = {"latex": base, "sub": sub, "sup": sup}
        # accent directly after this base (doc order) over it
        if j < len(items) and items[j]["t"] == "accent":
            entry["latex"] = items[j]["a"].latex + "{" + base + "}"
            j += 1
        out.append(entry)
        i = j

    parts = []
    for e in out:
        if isinstance(e, dict):
            parts.append(_apply_scripts(e))
        else:
            parts.append(e)
    return _join_tokens(_fix_digit_adjacency(parts))


def _apply_scripts(e):
    s = e["latex"]
    if e.get("sub") is not None:
        s += "_{" + e["sub"] + "}"
    if e.get("sup") is not None:
        s += "^{" + e["sup"] + "}"
    return s


def _convert_sibling_nodes(nodes, parent):
    """Convert a list of sibling MjxNodes as if they shared parent geometry."""
    wrapper = MjxNode(ET.Element("g"))
    wrapper.dx, wrapper.dy, wrapper.sx, wrapper.sy = parent.dx, parent.dy, parent.sx, parent.sy
    wrapper.children = nodes
    return convert_node(wrapper)


def _convert_mtable(node):
    """mtable -> array/matrix/cases latex (best effort; verified by round-trip)."""
    # find the mtable node
    tbl = node if node.attrib.get("data-mml-node") == "mtable" else _find_mtable(node)
    if tbl is None:
        return convert_node(node)
    # rows = child groups at distinct dy
    rows = []
    for c in tbl.children:
        if c.tag.endswith("g") and c.children:
            rows.append(c)
    row_latex = []
    for r in rows:
        # cells = groups at distinct dx
        cells = _split_row_cells(r)
        row_latex.append(" & ".join(convert_node(c) if isinstance(c, MjxNode) else c for c in cells))
    ncols = max((len(r.split(" & ")) for r in row_latex), default=0)
    body = r" \\ ".join(row_latex)
    return r"\begin{array}{" + "l" * max(ncols, 1) + "} " + body + r" \end{array}"


def _find_mtable(node):
    if node.attrib.get("data-mml-node") == "mtable":
        return node
    for c in node.children:
        t = _find_mtable(c)
        if t is not None:
            return t
    return None


def _split_row_cells(row):
    """Row group -> list of cell nodes (split by dx of top-level groups)."""
    cells = []
    current = None
    last_x = None
    for c in row.children:
        x = c.dx
        if c.tag.endswith("rect"):
            continue
        if last_x is None or abs(x - last_x) < 50:
            if current is None:
                current = []
            current.append(c)
            last_x = x
        else:
            cells.append(current)
            current = [c]
            last_x = x
    if current:
        cells.append(current)
    out = []
    for cell in cells:
        w = MjxNode(ET.Element("g"))
        w.children = cell
        out.append(w)
    return out


DELIM_ASSIGN = {}  # id(use-node) -> "\\left " / "\\right " prefix

OPEN_DELIM_CPS = {0x28, 0x5B, 0x7B, 0x27E8}
CLOSE_DELIM_CPS = {0x29, 0x5D, 0x7D, 0x27E9}
AMBIG_DELIM_CPS = {0x2223, 0x2016}


def _assign_delimiters(tree):
    """Walk the tree in doc order; assign \\left/\\right to every sized
    delimiter use so the final latex is balanced regardless of nesting."""
    DELIM_ASSIGN.clear()
    flip = False  # for ambiguous | : alternate left/right

    def walk(n):
        nonlocal flip
        if n.is_use():
            gid = parse_glyph_id(n.glyph())
            if gid:
                font, cp = gid
                if cp in OPEN_DELIM_CPS:
                    if font in SIZE_FONTS:
                        DELIM_ASSIGN[id(n)] = "\\left "
                elif cp in CLOSE_DELIM_CPS:
                    if font in SIZE_FONTS:
                        DELIM_ASSIGN[id(n)] = "\\right "
                elif cp in AMBIG_DELIM_CPS:
                    if font in SIZE_FONTS:
                        DELIM_ASSIGN[id(n)] = "\\left " if not flip else "\\right "
                        flip = not flip
                elif cp in BRACKET_PIECES and font in SIZE_FONTS:
                    opening = cp in (0x23A1, 0x23A2, 0x23A3, 0x23A7, 0x23A8, 0x23A9, 0x23AA)
                    DELIM_ASSIGN[id(n)] = "\\left " if opening else "\\right "
        for c in n.children:
            walk(c)

    walk(tree)


def mjx_to_latex(fragment_html):
    """Full <mjx-container>..</mjx-container> fragment -> LaTeX string."""
    tree = svg_to_tree(fragment_html)
    if tree is None:
        return None
    _assign_delimiters(tree)
    # find the inner content: skip outer scale(1,-1) g wrapper
    n = tree
    # tree is the svg root; its child g is the content
    content = None
    def find_content(nd):
        nonlocal content
        if nd.tag.endswith("g") and nd.attrib.get("transform", "").startswith("scale(1,-1)"):
            content = nd
            return True
        for c in nd.children:
            if find_content(c):
                return True
        return False
    find_content(n)
    target = content if content is not None else n
    latex = convert_node(target)
    if not latex:
        return None
    latex = latex.strip()
    # balance \left/\right with invisible delimiters (cases: only left brace)
    n_left = latex.count(r"\left ")
    n_right = latex.count(r"\right ")
    if n_left > n_right:
        latex = latex + r" \right. " * (n_left - n_right)
    elif n_right > n_left:
        latex = r" \left. " * (n_right - n_left) + latex
    return latex or None
