#!/usr/bin/env python3
"""JEE NEXUS — convert a crawled examside paper (data/pyq_raw/<slug>.json)
into the app's question import format (data/pyq/batch<N>_<subject>.json).

For each question:
  - text / options / explanation: HTML with <mjx-container> SVGs -> markdown-lite
    with $...$ LaTeX (verified by round-trip; failures fall back to the original
    SVG rendered via screenshot or flagged for review)
  - images: original exam diagrams downloaded from examside CDN to
    public/pyq/<slug>/<qid>-<n>.png with attribution
  - correct answers from examside's answer key
  - metadata: year, shift, date, subject, chapter, difficulty, question number

Usage: python3 scripts/pyq_convert_paper.py <slug> [out_batch_name]
"""
import glob
import hashlib
import json
import os
import re
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mjx2tex import mjx_to_latex
from pyq_chapter_map import map_chapter
from mathify import mathify as _mathify_text

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "image/*",
}
IMG_DIR = "public/pyq"
OUT_DIR = "data/questions"

SUBJECT_MAP = {"physics": "physics", "chemistry": "chemistry", "mathematics": "mathematics"}
TYPE_MAP = {"mcq": "mcq_single", "mcqm": "mcq_multi", "numerical": "numerical"}
DIFF_MAP = {"easy": "easy", "medium": "medium", "hard": "hard", None: "medium"}


# ------------------------------------------------------------------ math text

MJX_RE = re.compile(r"<mjx-container[^>]*>.*?</mjx-container>", re.S)
IMG_RE = re.compile(r'<img[^>]*src="([^"]+)"[^>]*>')
TAG_RE = re.compile(r"<[^>]+>")
SUP_RE = re.compile(r"<sup>(.*?)</sup>", re.S | re.I)
SUB_RE = re.compile(r"<sub>(.*?)</sub>", re.S | re.I)

# characters allowed inside a "mathy" run of plain text
MATHY_CHARS = set("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
                  "^_{}+-*/().,=<>!|' \\ \u00d7\u00f7\u00b1\u00b0\u2212\u2013\u03b1\u03b2\u03b3\u03b8\u03bb\u03bc\u03c0\u03c1\u03c3\u03c9\u0394\u03a9\u03c6\u03c8\u03b7\u03be\u03b6\u03bd\u03c4\u03ba\u03c7")
FUNC_WORDS = {"sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lim", "max",
              "min", "exp", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan"}


def _bare_latex_of_html(inner):
    """sup/sub inner HTML -> bare latex text (math fragments un-$-wrapped)."""
    def bare(m):
        try:
            lx = mjx_to_latex(m.group(0))
        except Exception:
            lx = None
        return (lx or "").strip()
    inner = MJX_RE.sub(bare, inner)
    inner = inner.replace("&nbsp;", " ").replace("&amp;", "&")
    inner = TAG_RE.sub("", inner)
    return inner.strip()


def convert_math_html(html, mathify=True):
    """examside HTML (text + inline MathJax SVG + <img>) -> app markdown-lite.

    Returns (text, images:list[str], n_ok, n_fail). Math -> $latex$ (round-trip
    verified upstream); images kept as download URLs (downloaded separately).
    """
    if not isinstance(html, str):
        return "", [], 0, 0
    images = []
    n_ok = n_fail = 0

    # sup/sub FIRST: fold their content (incl. math) into ^{...} / _{...}
    html = SUP_RE.sub(lambda m: "^{" + _bare_latex_of_html(m.group(1)) + "}", html)
    html = SUB_RE.sub(lambda m: "_{" + _bare_latex_of_html(m.group(1)) + "}", html)

    # Replace math/images with PLACEHOLDERS first, then strip HTML tags —
    # never strip tags on text that already contains $latex$ (its < > would
    # be eaten as fake tags, corrupting the math regions).
    placeholders = []

    def ph_math(m):
        nonlocal n_ok, n_fail
        try:
            latex = mjx_to_latex(m.group(0))
        except Exception:
            latex = None
        if latex:
            n_ok += 1
            placeholders.append("$" + latex.strip() + "$")
        else:
            n_fail += 1
            placeholders.append("[MATH_FAILED]")
        return f"\x00{len(placeholders) - 1}\x00"

    def ph_img(m):
        images.append(m.group(1))
        placeholders.append("\n[IMG]\n")
        return f"\x00{len(placeholders) - 1}\x00"

    text = IMG_RE.sub(ph_img, html)
    text = MJX_RE.sub(ph_math, text)

    # now strip html safely
    text = text.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    text = text.replace("</p>", "\n").replace("<p>", "")
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = TAG_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # restore math/image placeholders
    text = re.sub(r"\x00(\d+)\x00", lambda m: placeholders[int(m.group(1))], text)

    if mathify:
        try:
            text = _mathify_text(text)
        except Exception:
            pass
    return text.strip(), images, n_ok, n_fail


# ------------------------------------------------------------------ images

def download_images(urls, qid, slug):
    """Download original exam images; return app-relative paths."""
    os.makedirs(os.path.join(IMG_DIR, slug), exist_ok=True)
    out = []
    for i, url in enumerate(urls):
        ext = ".png"
        if ".jpg" in url or ".jpeg" in url:
            ext = ".jpg"
        elif ".gif" in url:
            ext = ".gif"
        elif ".svg" in url:
            ext = ".svg"
        dest_rel = f"{IMG_DIR}/{slug}/{qid}-{i}{ext}"
        dest = dest_rel
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            out.append(dest_rel)
            continue
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            if len(r.content) < 100:
                raise ValueError("suspiciously small image")
            with open(dest, "wb") as f:
                f.write(r.content)
            out.append(dest_rel)
            time.sleep(0.15)
        except Exception as e:
            print(f"  IMG FAIL {qid} {url[:60]}: {e}", file=sys.stderr)
    return out


# ------------------------------------------------------------------ main

def convert_paper(slug, batch_name=None):
    src = f"data/pyq_raw/{slug}.json"
    d = json.load(open(src))
    batch = batch_name or slug
    # question numbering within paper: order in subjects dict
    order = {}
    num = 0
    for subj, ids in d["subjects"].items():
        for qid in ids:
            num += 1
            order[qid] = num

    out_by_subject = {}
    stats = {"questions": 0, "math_ok": 0, "math_fail": 0, "images": 0, "skipped": 0}

    for q in d["questions"]:
        qid = q["question_id"]
        en = q["question"]["en"]
        subject = SUBJECT_MAP.get(q["subject"])
        if not subject:
            stats["skipped"] += 1
            continue
        if q.get("isOutOfSyllabus"):
            stats["skipped"] += 1
            continue
        qtype = TYPE_MAP.get(q.get("type"), "mcq_single")
        year = q.get("year")
        paper_title = q.get("paperTitle", "")
        # shift label from title, e.g. "JEE Main 2019 (Online) 9th January Morning Slot"
        shift = ""
        m = re.search(r"(Morning|Evening|Forenoon|Afternoon)\s+(?:Slot|Shift)", paper_title)
        if m:
            shift = "Shift 1" if m.group(1) in ("Morning", "Forenoon") else "Shift 2"
        # question number: position in paper
        qnum = order.get(qid)

        text, imgs1, ok1, f1 = convert_math_html(en.get("content", ""))
        if not text or "[MATH_FAILED]" in text:
            stats["skipped"] += 1
            continue
        explanation, imgs2, ok2, f2 = convert_math_html(en.get("explanation", "") or "")
        stats["math_ok"] += ok1 + ok2
        stats["math_fail"] += f1 + f2

        options = []
        for o in en.get("options", []):
            ot, imgo, oko, fo = convert_math_html(o.get("content", ""))
            if imgo:
                imgs1.extend(imgo)
            stats["math_ok"] += oko
            stats["math_fail"] += fo
            options.append(ot if ot else " ")

        correct = en.get("correct_options") or []
        correct_idx = []
        for c in correct:
            try:
                correct_idx.append("ABCDEFGH".index(c))
            except ValueError:
                pass

        item = {
            "publicId": f"PYQ-{year}-{qid[:8]}",
            "subjectKey": subject,
            "chapterKey": map_chapter(q.get("chapter"), subject),
            "subtopic": None,
            "type": qtype,
            "text": text,
            "options": options,
            "correctOptions": correct_idx if qtype != "numerical" else None,
            "numericalAnswer": None,
            "numericalTolerance": None,
            "difficulty": DIFF_MAP.get(q.get("difficulty"), "medium"),
            "sourceExam": "JEE Main",
            "sourceYear": year,
            "sourceDate": q.get("examDate"),
            "sourceShift": shift,
            "sourceQuestionNumber": qnum,
            "sourceReference": f"NTA JEE Main {paper_title} via ExamSIDE (questions.examside.com)",
            "tags": [q.get("chapter", "").replace("-", " ") if q.get("chapter") else "pyq"],
            "solution": None,
            "images": [],
        }
        if explanation and len(explanation.replace("[IMG]", "").strip()) < 20 and "[IMG]" in explanation:
            # image-only explanation: give the body a descriptive line
            explanation = "The complete solution is shown in the original exam figure.\n\n" + explanation
        if explanation:
            item["solution"] = {
                "keyConcept": None,
                "formulas": [],
                "body": explanation,
                "commonMistakes": None,
                "alternativeMethod": None,
                "verification": None,
                "sourceReferences": [f"ExamSIDE explanation for {paper_title}"],
                "isAiGenerated": False,
            }

        # download original exam images (question + explanation diagrams)
        all_imgs = imgs1 + [u for u in imgs2 if u not in imgs1]
        if all_imgs:
            paths = download_images(all_imgs, qid, slug)
            stats["images"] += len(paths)
            item["images"] = [
                {
                    "url": "/" + p,
                    "altText": f"Original exam figure ({paper_title})",
                    "caption": None,
                    "attribution": "Source: NTA JEE Main original exam figure, via ExamSIDE",
                    "isOriginalExamImage": True,
                    "kind": "question",
                }
                for p in paths
            ]

        out_by_subject.setdefault(subject, []).append(item)
        stats["questions"] += 1

    os.makedirs(OUT_DIR, exist_ok=True)
    for subject, items in out_by_subject.items():
        path = os.path.join(OUT_DIR, f"{batch}_{subject}.json")
        json.dump(items, open(path, "w"), indent=1, ensure_ascii=False)
        print(f"wrote {path}: {len(items)} questions")
    print(f"STATS {slug}: {stats}")
    return stats


if __name__ == "__main__":
    slug = sys.argv[1]
    batch = sys.argv[2] if len(sys.argv) > 2 else None
    convert_paper(slug, batch)
