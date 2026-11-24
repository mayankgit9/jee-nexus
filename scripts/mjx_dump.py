#!/usr/bin/env python3
"""JEE NEXUS — dump the structure tree of an <mjx-container> for converter development."""
import re
import sys

def parse_transform(s):
    if not s:
        return ("", [])
    m = re.match(r"(translate|scale|matrix)\(([^)]*)\)", s)
    if not m:
        return (s, [])
    nums = [float(x) for x in re.split(r"[,\s]+", m.group(2).strip()) if x]
    return (m.group(1), nums)

def walk(el, depth=0, out=None):
    if out is None:
        out = []
    tag = el.tag.split("}")[-1]
    attrs = dict(el.attrib)
    t = attrs.pop("transform", None)
    info = tag
    if t:
        info += f" transform={t}"
    use = attrs.get("href") or attrs.get("{http://www.w3.org/1999/xlink}href") or ""
    if use:
        info += f" USE={use}"
    if tag == "rect":
        keep = {k: attrs[k] for k in ("width", "height", "x", "y") if k in attrs}
        info += f" rect={keep}"
    if "data-mjx-texclass" in attrs:
        info += f" texclass={attrs['data-mjx-texclass']}"
    out.append("  " * depth + info)
    for child in el:
        walk(child, depth + 1, out)
    return out

def dump(svg_html):
    import xml.etree.ElementTree as ET
    # extract the <svg> element
    m = re.search(r"<svg\b.*</svg>", svg_html, re.S)
    if not m:
        return ["NO SVG FOUND: " + svg_html[:100]]
    svg = m.group(0)
    # svg fragments may contain hrefs without xlink ns; wrap with ns declarations
    try:
        root = ET.fromstring(svg)
    except ET.ParseError:
        svg = svg.replace('xlink:href=', 'href=')
        root = ET.fromstring(svg)
    return walk(root)

if __name__ == "__main__":
    html = sys.stdin.read()
    lines = dump(html)
    print("\n".join(lines))
