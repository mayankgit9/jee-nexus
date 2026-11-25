#!/usr/bin/env python3
"""JEE NEXUS — compress newly crawled exam images (2024+ papers ship 1MB+ PNGs).

The 2019-2023 papers came as ~13KB JPGs; 2024+ papers ship high-res PNGs
(avg ~290KB, up to 1.2MB). Exam diagrams are displayed at <=700px in the app,
so: resize to max 1600px on the long edge and re-encode as WebP q85
(diagrams compress ~15-20x). Only papers NOT tracked in git (the new wave)
are touched; URLs in the corresponding data/questions batch files are
rewritten to the new filenames.
"""
import glob
import json
import os
import subprocess

from PIL import Image

MAX_EDGE = 1600
QUALITY = 85
SIZE_THRESHOLD = 60_000  # leave small files (<60KB) alone

# new papers = local public/pyq dirs not tracked in git
tracked = set(subprocess.run(
    ["git", "ls-files", "public/pyq"], capture_output=True, text=True
).stdout.split())

by_slug = {}
for p in glob.glob("public/pyq/*/*"):
    if p in tracked:
        continue
    slug = os.path.basename(os.path.dirname(p))
    by_slug.setdefault(slug, []).append(p)

total_before = total_after = n_conv = 0
url_map = {}  # old url -> new url

for slug, files in sorted(by_slug.items()):
    s_before = s_after = 0
    for p in files:
        sz = os.path.getsize(p)
        s_before += sz
        stem, ext = os.path.splitext(p)
        if ext.lower() == ".webp" or sz < SIZE_THRESHOLD:
            s_after += sz
            continue
        try:
            im = Image.open(p)
            if im.mode in ("P", "RGBA", "LA"):
                # flatten transparency onto white (exam paper look)
                bg = Image.new("RGB", im.size, (255, 255, 255))
                if im.mode in ("RGBA", "LA"):
                    im = im.convert("RGBA")
                    bg.paste(im, mask=im.split()[-1])
                else:
                    im = im.convert("RGB")
                    bg = im
                im = bg
            elif im.mode != "RGB":
                im = im.convert("RGB")
            w, h = im.size
            if max(w, h) > MAX_EDGE:
                r = MAX_EDGE / max(w, h)
                im = im.resize((max(1, int(w * r)), max(1, int(h * r))), Image.LANCZOS)
            out = stem + ".webp"
            im.save(out, "WEBP", quality=QUALITY, method=4)
            if os.path.getsize(out) < sz:
                os.remove(p)
                url_map[f"/{p.removeprefix('public/')}"] = f"/{out.removeprefix('public/')}"
                s_after += os.path.getsize(out)
                n_conv += 1
            else:
                os.remove(out)  # keep original
                s_after += sz
        except Exception as e:
            print(f"  FAIL {p}: {e}")
            s_after += sz
    total_before += s_before
    total_after += s_after
    print(f"{slug}: {s_before/1e6:.1f}MB -> {s_after/1e6:.1f}MB")

# rewrite URLs in the affected batch JSONs
slug_affixes = {s.removeprefix("jee-main-")[:40]: s for s in by_slug}
n_rewritten = 0
for jf in glob.glob("data/questions/pyq*.json"):
    txt = open(jf).read()
    if "/pyq/jee-main-" not in txt:
        continue
    changed = txt
    for old, new in url_map.items():
        if old in changed:
            changed = changed.replace(old, new)
    if changed != txt:
        open(jf, "w").write(changed)
        n_rewritten += 1

print(f"\nTOTAL: {total_before/1e6:.1f}MB -> {total_after/1e6:.1f}MB "
      f"({n_conv} images converted, {n_rewritten} batch files rewritten)")
