#!/usr/bin/env python3
"""JEE NEXUS — finish + repair the new-image compression.

Part 1 compresses any remaining oversized images (same policy as
compress_new_pyq_images.py: untracked files only, >60KB, max edge 1600,
WebP q85, keep original when no win).
Part 2 repairs URL refs: any /pyq/.../<stem>.png|.jpg ref whose file is
missing but whose .webp sibling exists is rewritten to the .webp URL.
Verifies zero missing refs at the end. Resumable.
"""
import glob
import json
import os
import subprocess

from PIL import Image

MAX_EDGE, QUALITY, SIZE_THRESHOLD = 1600, 85, 60_000

tracked = set(subprocess.run(["git", "ls-files", "public/pyq"],
                             capture_output=True, text=True).stdout.split())

# ---- part 1: compress remaining oversized untracked images ----
n_conv = 0
for p in glob.glob("public/pyq/*/*"):
    if p in tracked:
        continue
    sz = os.path.getsize(p)
    stem, ext = os.path.splitext(p)
    if ext.lower() == ".webp" or sz < SIZE_THRESHOLD:
        continue
    try:
        im = Image.open(p)
        if im.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            if im.mode in ("RGBA", "LA"):
                im = im.convert("RGBA")
                bg.paste(im, mask=im.split()[-1])
            else:
                bg = im.convert("RGB")
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
            n_conv += 1
        else:
            os.remove(out)
    except Exception as e:
        print(f"  FAIL {p}: {e}")
print(f"part1: {n_conv} images compressed this pass")

# ---- part 2: repair refs (extension swap where the file is missing) ----
n_fix = n_files = 0
for jf in glob.glob("data/questions/pyq*.json"):
    txt = open(jf).read()
    if "/pyq/" not in txt:
        continue
    changed = False
    qs = json.loads(txt)
    for q in qs:
        for im in q.get("images") or []:
            url = im.get("url", "")
            p = "public" + url
            if url and not os.path.exists(p):
                stem, _ = os.path.splitext(p)
                if os.path.exists(stem + ".webp"):
                    im["url"] = "/" + (stem + ".webp").removeprefix("public/")
                    changed = True
                    n_fix += 1
    if changed:
        json.dump(qs, open(jf, "w"), indent=1, ensure_ascii=False)
        n_files += 1
print(f"part2: {n_fix} refs rewritten across {n_files} files")

# ---- verify ----
missing = 0
for jf in glob.glob("data/questions/pyq*.json"):
    for q in json.load(open(jf)):
        for im in q.get("images") or []:
            if not os.path.exists("public" + im["url"]):
                missing += 1
print(f"verify: {missing} missing refs (must be 0)")
