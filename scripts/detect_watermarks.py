#!/usr/bin/env python3
"""Detect watermarked images across public/pyq.

Classification per image (downscaled analysis, ~100x speedup):
- clean:  white-ish background, no pale-blue watermark band -> leave untouched
- light:  white background but pale-blue watermark fraction above threshold
          (ExamSIDE diagonal / ExamGOAL light tiles)
- heavy:  canvas is NOT white at all (ExamGOAL dark theme + tiled logo)

Writes scripts/watermark_report.json with per-file classification + stats.
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "pyq")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "watermark_report.json")

WHITE_MIN_FRACTION_CLEAN = 0.55   # clean diagrams are >55% near-white
WHITE_HEAVY_MAX = 0.10            # <10% white -> dark themed canvas (heavy watermark)
PALE_WATERMARK_THRESHOLD = 0.012  # >1.2% pale-blue band on a white canvas -> watermarked


def analyze(path: str):
    try:
        img = Image.open(path).convert("RGB")
    except Exception as e:
        return path, {"status": "error", "error": str(e)}
    w, h = img.size
    # downscale for speed
    img.thumbnail((160, 160))
    a = np.asarray(img).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    sat = (mx - mn).astype(np.int16)

    white = (mn >= 225).mean()
    pale_blue = ((b >= r) & (b >= g) & (sat >= 8) & (sat <= 55) & (b >= 150) & (mx >= 170) & (mx < 250)).mean()
    dark_unsat = ((mx < 200) & (sat < 45)).mean()

    if white <= WHITE_HEAVY_MAX:
        cls = "heavy"
    elif white >= WHITE_MIN_FRACTION_CLEAN:
        cls = "light" if pale_blue >= PALE_WATERMARK_THRESHOLD else "clean"
    else:
        # mid-toned canvas — tinted background = watermarked (ExamGOAL),
        # genuine light-shaded diagrams are still >55% white
        cls = "light" if pale_blue >= PALE_WATERMARK_THRESHOLD else "suspicious"
    return path, {
        "status": "ok", "class": cls, "w": w, "h": h,
        "white": round(float(white), 4), "paleBlue": round(float(pale_blue), 4),
        "darkUnsat": round(float(dark_unsat), 4),
    }


def main():
    files = []
    for dirpath, _, filenames in os.walk(ROOT):
        for f in filenames:
            if f.lower().endswith((".webp", ".png", ".jpg", ".jpeg")):
                files.append(os.path.join(dirpath, f))
    print(f"analyzing {len(files)} images...", flush=True)

    results = {}
    counts = {"clean": 0, "light": 0, "heavy": 0, "suspicious": 0, "error": 0}
    with ProcessPoolExecutor(max_workers=8) as ex:
        for i, (path, info) in enumerate(ex.map(analyze, files, chunksize=32)):
            results[os.path.relpath(path, os.path.dirname(ROOT))] = info
            counts[info.get("class", "error")] += 1
            if (i + 1) % 1000 == 0:
                print(f"  {i + 1}/{len(files)}", flush=True)

    with open(OUT, "w") as f:
        json.dump({"counts": counts, "images": results}, f)
    print("counts:", counts)
    print("report ->", OUT)


if __name__ == "__main__":
    sys.exit(main())
