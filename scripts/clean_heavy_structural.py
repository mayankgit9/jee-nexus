#!/usr/bin/env python3
"""Structural watermark remover for ExamGOAL 'heavy' re-rendered exam figures.

Calibrated against the corpus (2019-2026 samples):
- palette is flattened: content strokes, tile text, giant stamp text are all
  the same bright blue (64,104,208); canvas is dark teal (72,104,112)
- separation is purely STRUCTURAL: tile stamps repeat on a fixed grid, the
  giant stamp does not, content strokes never repeat

Pipeline:
  1. ink = bright blue pixels (canvas/white excluded by construction)
  2. per-image tile period via autocorrelation on the ink mask
  3. tile-vote: pixel is watermark if it matches >=2 shifted tile copies
  4. giant-stamp text via distance-transform thickness (content <=12px)
  5. frame border only if matching long runs exist at BOTH opposite edges
  6. inpaint masked pixels, remap canvas->white, ink->clean blue
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import cv2
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT = os.path.join(BASE, "scripts", "watermark_report.json")
BACKUP = os.path.join(BASE, "pyq_originals")
FAIL_QUEUE = os.path.join(BASE, "scripts", "heavy_ai_queue.txt")

INK_AFTER_MIN = 0.006
INK_AFTER_MAX = 0.35
THICK_STROKE_PX = 16
TEMPLATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stamp_template.png")
TEMPLATE_SCALES = (0.4, 0.55, 0.7, 0.85, 1.0, 1.15, 1.3, 1.5)
TEMPLATE_THRESHOLD = 0.60


def ink_mask(a: np.ndarray) -> np.ndarray:
    """Bright-blue strokes only — teal canvas and white margins excluded."""
    r = a[..., 0].astype(int)
    g = a[..., 1].astype(int)
    b = a[..., 2].astype(int)
    return (b >= 150) & (b - r >= 40) & (b - g >= 15)


_TEMPLATE_CACHE: dict[str, np.ndarray] = {}


def load_template() -> np.ndarray:
    if "tpl" not in _TEMPLATE_CACHE:
        tpl = np.asarray(Image.open(TEMPLATE_PATH).convert("RGB")).astype(int)
        _TEMPLATE_CACHE["tpl"] = ink_mask(tpl).astype(np.float32)
    return _TEMPLATE_CACHE["tpl"]


def stamp_template_mask(ink: np.ndarray) -> np.ndarray:
    """Locate single-occurrence 'ExamGOAL.COM' boxed stamps via multi-scale
    template matching on the binarized ink mask (color-independent)."""
    h, w = ink.shape
    tpl0 = load_template()
    if h < 90 or w < 500:
        return np.zeros((h, w), bool)
    inkf = ink.astype(np.float32)
    out = np.zeros((h, w), bool)
    for s in TEMPLATE_SCALES:
        tw, th = int(tpl0.shape[1] * s), int(tpl0.shape[0] * s)
        if tw < 60 or tw > w or th > h:
            continue
        tpl = cv2.resize(tpl0, (tw, th), interpolation=cv2.INTER_AREA)
        if tpl.max() < 0.5:
            continue
        res = cv2.matchTemplate(inkf, tpl, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(res >= TEMPLATE_THRESHOLD)
        for y, x in zip(ys, xs):
            out[y:y + th + 8, x:x + tw + 8] = True
    return out


def find_period(ink: np.ndarray, axis: int, lo: int, hi: int) -> int | None:
    n = ink.shape[axis]
    best, best_s = None, 0.30
    for d in range(lo, min(hi, n - 30)):
        if axis == 0:
            inter = (ink[:-d, :] & ink[d:, :]).sum()
            base = max(ink[:-d, :].sum(), 1)
        else:
            inter = (ink[:, :-d] & ink[:, d:]).sum()
            base = max(ink[:, :-d].sum(), 1)
        s = inter / base
        if s > best_s:
            best, best_s = d, s
    return best


def tile_vote(ink: np.ndarray, dx: int, dy: int) -> np.ndarray:
    h, w = ink.shape
    votes = np.zeros((h, w), dtype=np.int8)
    for sx, sy in ((dx, 0), (-dx, 0), (0, dy), (0, -dy)):
        shifted = np.zeros_like(ink)
        x0, x1 = max(sx, 0), w + min(sx, 0)
        y0, y1 = max(sy, 0), h + min(sy, 0)
        shifted[y0:y1, x0:x1] = ink[y0 - sy:y1 - sy, x0 - sx:x1 - sx]
        votes += (ink & shifted).astype(np.int8)
    return votes >= 2


def border_mask(ink: np.ndarray) -> np.ndarray:
    """Frame border only when long runs appear at BOTH opposite edges."""
    h, w = ink.shape
    out = np.zeros_like(ink)
    band = max(4, h // 100)
    top, bot = ink[: band * 4, :].mean(), ink[-band * 4:, :].mean()
    if top > 0.5 and bot > 0.5:
        for row in list(range(band * 4)) + list(range(h - band * 4, h)):
            if ink[row, :].mean() > 0.4:
                out[row, :] = True
    bandx = max(4, w // 100)
    left, right = ink[:, : bandx * 4].mean(), ink[:, -bandx * 4:].mean()
    if left > 0.5 and right > 0.5:
        for col in list(range(bandx * 4)) + list(range(w - bandx * 4, w)):
            if ink[:, col].mean() > 0.4:
                out[:, col] = True
    return out


def build_wm_mask(a: np.ndarray) -> tuple[np.ndarray, dict]:
    ink = ink_mask(a)
    stats = {"ink": float(ink.mean())}
    if ink.mean() < 0.002:
        return np.zeros(ink.shape, bool), stats

    mask = np.zeros(ink.shape, bool)

    # 2 FIRST — giant one-off stamp text via ADAPTIVE thickness on the FULL
    # ink mask. Must run BEFORE tile-vote: tiles partially erase the giant
    # glyphs, fragmenting them below any thickness threshold.
    ink_u8 = ink.astype(np.uint8)
    dt = cv2.distanceTransform(ink_u8, cv2.DIST_L2, 5)
    widths = dt[ink_u8 > 0] * 2
    if widths.size > 500:
        p75, p99 = np.percentile(widths, 75), np.percentile(widths, 99)
        # giant-stamp test: several SEPARATE tall thick cores (glyphs) — a
        # thick chemistry ring is one connected loop, giant text is 5+ glyphs
        thick_u8 = (dt > 4).astype(np.uint8)
        n_tall = 0
        if thick_u8.any():
            _, _, cst, _ = cv2.connectedComponentsWithStats(thick_u8, 8)
            for i in range(1, cst.shape[0]):
                if cst[i, cv2.CC_STAT_HEIGHT] >= 60 and cst[i, cv2.CC_STAT_WIDTH] >= 40:
                    n_tall += 1
        stats["tallThick"] = n_tall
        stats["hasGiant"] = bool(n_tall >= 4 and p99 > 15)
        if stats["hasGiant"]:
            cut = max(5.0, min(float(np.percentile(widths, 86)) / 2, p99 / 2.2))
            mask |= dt > cut
            stats["thickCut"] = round(float(cut), 1)

    # 1) tile stamps (repeating) — on the ink minus already-masked giant text
    rest_ink = ink & ~mask
    dx = find_period(rest_ink, axis=1, lo=140, hi=460)
    dy = find_period(rest_ink, axis=0, lo=35, hi=220)
    stats["dx"], stats["dy"] = dx, dy
    if dx is not None:
        mask |= tile_vote(ink, dx, dy or 61)
    if dy is not None and dx is None:
        mask |= tile_vote(ink, 268, dy)

    # 1b) single-occurrence stamps via template matching — ONLY when the
    # tile-vote did NOT already cover the canvas (dense-tile images are fully
    # handled above; skipping template here cuts per-image time ~4x)
    if mask.mean() < 0.08:
        mask |= stamp_template_mask(ink)

    # 3) frame border (both edges required)
    mask |= border_mask(ink)
    stats["mask"] = float(mask.mean())
    return mask, stats


def residual_giant_text(arr_rgb: np.ndarray) -> bool:
    """True if a GIANT glyph (thick-stroke component with bbox >= 90px tall
    and >= 60px wide) survived the clean — the one-off big stamp text.
    Genuine thick content (dots, arrowheads, bold labels) never reaches a
    90px-tall thick core, and thin long curves (circles/axes) have no thick
    core at all, so neither false-positives."""
    r, g, b = arr_rgb[..., 0], arr_rgb[..., 1], arr_rgb[..., 2]
    ink = ((b >= 150) & (b - r >= 40) & (b - g >= 15)).astype(np.uint8)
    if ink.sum() == 0:
        return False
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    thick = (dt > 4).astype(np.uint8)
    n, labels, st, _ = cv2.connectedComponentsWithStats(thick, 8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_HEIGHT] >= 90 and st[i, cv2.CC_STAT_WIDTH] >= 60:
            return True
    return False


def process(rel: str):
    path = os.path.join(BASE, "public", rel)
    # re-runnable: prefer the pristine backup when one exists (audit re-cleans)
    src = os.path.join(BACKUP, rel)
    source = src if os.path.exists(src) else path
    try:
        img = Image.open(source).convert("RGB")
        orig = np.asarray(img)
        mask, stats = build_wm_mask(orig.astype(int))
        # Giant one-off stamp text cannot be recovered deterministically — the
        # cleaned output (remnants possible) still saves as a big visible
        # upgrade over the dark watermarked original, and the file is ALSO
        # queued for the AI remake pass which replaces it when it completes.
        if mask.mean() > 0.55:
            return rel, "ai"  # masked almost everything -> AI only
        bgr = cv2.cvtColor(orig, cv2.COLOR_RGB2BGR)
        inpainted = cv2.inpaint(bgr, (mask * 255).astype(np.uint8), 5, cv2.INPAINT_TELEA)
        # remap: canvas -> white; remaining bright-blue strokes -> clean blue
        arr = cv2.cvtColor(inpainted, cv2.COLOR_BGR2RGB).astype(int)
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        ink_after = (b >= 150) & (b - r >= 40) & (b - g >= 15)
        out = np.full(arr.shape, 255, dtype=np.uint8)
        out[ink_after] = (15, 70, 190)
        # despeckle: drop tiny components (tile-dot remnants < 40px); genuine
        # point-masses and arrowheads are far larger
        u8 = ink_after.astype(np.uint8)
        n, labels, st, _ = cv2.connectedComponentsWithStats(u8, 8)
        if n > 0:
            small = np.zeros_like(u8)
            for i in range(1, n):
                if st[i, cv2.CC_STAT_AREA] < 40:
                    small[labels == i] = 1
            out[small > 0] = (255, 255, 255)
        frac = float((out[..., 2] == 190).mean())
        if frac < INK_AFTER_MIN or frac > INK_AFTER_MAX:
            return rel, "ai"
        dst = os.path.join(BACKUP, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            img.save(dst, quality=95)
        Image.fromarray(out).save(path, quality=92)
        # giant text remnants? still saved (visible upgrade), but flagged for AI
        return rel, ("giant" if stats.get("hasGiant") else "ok")
    except Exception as e:
        return rel, f"error:{type(e).__name__}:{e}"


def _year_of(rel: str) -> int:
    try:
        return int(rel.split("jee-main-")[1][:4])
    except Exception:
        return 0


def main():
    with open(REPORT) as f:
        data = json.load(f)
    targets = [rel for rel, info in data["images"].items() if info.get("class") == "heavy"]
    # newest exams first — 2026/2025 figures are what aspirants hit most
    targets.sort(key=lambda rel: -_year_of(rel))
    print(f"structural clean on {len(targets)} heavy images...", flush=True)
    os.makedirs(BACKUP, exist_ok=True)
    counts: dict[str, int] = {}
    fails = []
    with ProcessPoolExecutor(max_workers=2) as ex:
        for i, (rel, status) in enumerate(ex.map(process, targets, chunksize=4)):
            key = status.split(":")[0]
            counts[key] = counts.get(key, 0) + 1
            if key in ("ai", "error", "giant"):
                fails.append(rel)
            if (i + 1) % 400 == 0:
                print(f"  {i + 1}/{len(targets)} {counts}", flush=True)
    with open(FAIL_QUEUE, "w") as f:
        f.write("\n".join(fails))
    print("done:", counts)
    print(f"AI fallback queue: {len(fails)} -> {FAIL_QUEUE}")


if __name__ == "__main__":
    sys.exit(main())
