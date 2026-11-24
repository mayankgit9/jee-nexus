#!/usr/bin/env python3
"""JEE NEXUS — verify a converted PYQ batch (data/questions/pyq*.json).
Validates the app import contract + data integrity + image files.
Usage: python3 scripts/verify_pyq_batch.py <batch-prefix>   e.g. pyq2019s1
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ok = fail = 0
issues = []


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        issues.append(f"{name}: {detail}")


def main():
    prefix = sys.argv[1]
    files = sorted(glob.glob(f"data/questions/{prefix}_*.json"))
    if not files:
        print(f"no files for prefix {prefix}")
        sys.exit(1)

    tax = json.load(open("data/taxonomy.json"))
    chapters = {c["key"] for s in tax["subjects"] for c in s["chapters"]}
    subjects = {s["key"] for s in tax["subjects"]}

    all_public_ids = set()
    n_questions = 0
    n_images = 0
    n_with_solution = 0
    years = set()

    for fp in files:
        qs = json.load(open(fp))
        for q in qs:
            n_questions += 1
            qid = q.get("publicId", "?")
            check(f"{qid} publicId unique", qid not in all_public_ids, qid)
            all_public_ids.add(qid)
            check(f"{qid} subjectKey", q.get("subjectKey") in subjects, str(q.get("subjectKey")))
            check(f"{qid} chapterKey", q.get("chapterKey") in chapters, str(q.get("chapterKey")))
            check(f"{qid} type", q.get("type") in ("mcq_single", "mcq_multi", "numerical"), str(q.get("type")))
            check(f"{qid} text len", isinstance(q.get("text"), str) and len(q["text"]) >= 10, "")
            check(f"{qid} no MATH_FAILED", "[MATH_FAILED]" not in q.get("text", ""), "")
            check(f"{qid} no raw svg", "<mjx" not in q.get("text", "") and "<svg" not in q.get("text", ""), "")
            check(f"{qid} no html tags", not re.search(r"<[a-z][^>]*>", q.get("text", ""), re.I), "")
            check(f"{qid} balanced math $", q.get("text", "").count("$") % 2 == 0,
                  q.get("text", "")[:80])
            if q.get("type") == "numerical":
                check(f"{qid} numericalAnswer", q.get("numericalAnswer") is not None, "")
            else:
                opts = q.get("options") or []
                check(f"{qid} options>=2", len(opts) >= 2, str(len(opts)))
                check(f"{qid} options nonempty", all(isinstance(o, str) and o.strip() for o in opts), "")
                co = q.get("correctOptions") or []
                check(f"{qid} correctOptions nonempty", len(co) >= 1, str(co))
                check(f"{qid} correctOptions range", all(isinstance(c, int) and 0 <= c < len(opts) for c in co), str(co))
                if q.get("type") == "mcq_single":
                    check(f"{qid} single has 1 correct", len(co) == 1, str(co))
                if q.get("type") == "mcq_multi":
                    check(f"{qid} multi >=2 correct", len(co) >= 2, str(co))
                for i, o in enumerate(opts):
                    check(f"{qid} opt{i} balanced $", o.count("$") % 2 == 0, o[:60])
            sol = q.get("solution")
            if sol:
                n_with_solution += 1
                check(f"{qid} solution body", isinstance(sol.get("body"), str) and len(sol["body"]) >= 20, "")
                check(f"{qid} solution balanced $", sol.get("body", "").count("$") % 2 == 0, "")
            imgs = q.get("images") or []
            for im in imgs:
                n_images += 1
                url = im.get("url", "")
                # URLs are root-relative (/pyq/...); files live in public/pyq/...
                path = os.path.join("public", url.lstrip("/"))
                check(f"{qid} img exists", os.path.exists(path) and os.path.getsize(path) > 100, path)
                check(f"{qid} img altText", bool(im.get("altText")), "")
                check(f"{qid} img original", im.get("isOriginalExamImage") is True, "")
            # [IMG] placeholders must have corresponding image entries
            n_img_place = q.get("text", "").count("[IMG]") + (sol.get("body", "").count("[IMG]") if sol else 0)
            check(f"{qid} IMG placeholders <= images", n_img_place <= len(imgs) or n_img_place == 0,
                  f"{n_img_place} placeholders vs {len(imgs)} images")
            if q.get("sourceYear"):
                years.add(q["sourceYear"])
            check(f"{qid} year 2019-2026", q.get("sourceYear") in list(range(2019, 2027)), str(q.get("sourceYear")))
            check(f"{qid} difficulty", q.get("difficulty") in ("easy", "medium", "hard"), str(q.get("difficulty")))

    print(f"files: {[os.path.basename(f) for f in files]}")
    print(f"questions: {n_questions} | with solution: {n_with_solution} | images: {n_images}")
    print(f"years: {sorted(years)}")
    print(f"RESULT: {ok} passed, {fail} failed")
    if issues:
        print("\nISSUES:")
        for i in issues[:40]:
            print("  -", i)
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
