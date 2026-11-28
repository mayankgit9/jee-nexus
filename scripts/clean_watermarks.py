#!/usr/bin/env python3
"""Clean watermarked exam figures.

light  (pale watermark on white canvas): keep dark / saturated strokes, erase
        pale-blue watermark pixels to white. Deterministic, geometry-safe.
heavy  (ExamGOAL dark canvas): keep bright saturated blue strokes (the
        re-rendered content), map everything else to white. If the result
        looks degenerate (too few / too many strokes) the file is queued for
        AI remake in heavy_ai_queue.txt instead of being overwritten.

Clean images are never touched. Originals are backed up to pyq_originals/
only for the files actually modified (restore script included).
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(BASE, "public")
REPORT = os.path.join(BASE, "scripts", "watermark_report.json")
BACKUP = os.path.join(BASE, "pyq_originals")
AI_QUEUE = os.path.join(BASE, "scripts", "heavy_ai_queue.txt")

MIN_STROKE_AFTER = 0.015  # <1.5% ink after cleanup -> something broke
MAX_STROKE_AFTER = 0.45   # >45% ink -> threshold too loose


def clean_light(a: np.ndarray) -> np.ndarray:
    """Erase watermark (pale blue + neutral gray fills), keep ink.

    Keep-rule (calibrated on 2019-2025 corpus samples):
    - saturated content colors survive (blue/red/green strokes, labels)
    - unsaturated pixels survive only when essentially black (content
      strokes are pure 0,0,0; the ExamSIDE gray watermark starts ~64)
    Everything else (gray diagonal text, pale tile fills, AA haze) -> white.
    """
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    sat = (mx - mn).astype(np.int16)
    keep = ((sat >= 40) & (mx < 240)) | ((sat < 40) & (mx < 55))
    out = np.full_like(a, 255)
    out[keep] = a[keep]
    return out


def clean_heavy(a: np.ndarray):
    """Keep bright saturated blue content; white-out dark canvas + tiles."""
    mx = a.max(axis=2)
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    ink = (b >= 165) & (b - r >= 55) & (b - g >= 25)
    out = np.full_like(a, 255)
    out[ink] = (15, 60, 180)  # unified clean blue
    return out, float(ink.mean())


def process(rel: str):
    path = os.path.join(BASE, "public", rel)
    info = report["images"][rel]
    cls = info["class"]
    if cls not in ("light", "heavy"):
        return rel, "skip"

    try:
        img = Image.open(path).convert("RGB")
    except Exception as e:
        return rel, f"error:{type(e).__name__}"

    orig = np.asarray(img).astype(np.int16)

    if cls == "light":
        out = clean_light(orig)
        # ink check on grayscale: dark pixels
        ink_after = float((out.min(axis=2) < 200).mean())
        if ink_after < 0.002:
            return rel, "fail-low"
    else:
        out, ink_after = clean_heavy(orig)
        if ink_after < MIN_STROKE_AFTER or ink_after > MAX_STROKE_AFTER:
            return rel, "ai"

    # backup original once
    dst = os.path.join(BACKUP, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not os.path.exists(dst):
        img.save(dst, quality=95)

    Image.fromarray(out.astype(np.uint8)).save(path, quality=92)
    return rel, cls


def main():
    global report
    with open(REPORT) as f:
        data = json.load(f)
    report = data
    # only 'light' here — heavy images go through clean_heavy_structural.py
    targets = [rel for rel, info in data["images"].items() if info.get("class") == "light"]
    print(f"cleaning {len(targets)} light images...", flush=True)

    os.makedirs(BACKUP, exist_ok=True)
    results = {"light": 0, "heavy": 0, "skip": 0, "fail-low": 0, "ai": 0}
    ai_queue = []
    with ProcessPoolExecutor(max_workers=3) as ex:
        for i, (rel, status) in enumerate(ex.map(process, targets, chunksize=16)):
            results[status] = results.get(status, 0) + 1
            if status == "ai":
                ai_queue.append(rel)
            if (i + 1) % 500 == 0:
                print(f"  {i + 1}/{len(targets)} {dict(results)}", flush=True)

    with open(AI_QUEUE, "w") as f:
        f.write("\n".join(ai_queue))
    print("done:", results)
    print(f"AI remake queue: {len(ai_queue)} -> {AI_QUEUE}")


if __name__ == "__main__":
    sys.exit(main())
