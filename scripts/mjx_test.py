#!/usr/bin/env python3
"""JEE NEXUS — batch-test the SVG->LaTeX converter against a crawled paper.
Converts every <mjx-container>, round-trips through local MathJax, reports
pass rate and failure diagnostics. Usage:
  python3 scripts/mjx_test.py data/pyq_raw/<paper>.json [limit]
"""
import json
import re
import subprocess
import sys

sys.path.insert(0, "scripts")
from mjx2tex import mjx_to_latex


def iter_fragments(paper_path):
    d = json.load(open(paper_path))
    n = 0
    for q in d["questions"]:
        en = q["question"]["en"]
        fields = [("content", en.get("content")), ("expl", en.get("explanation"))]
        for i, o in enumerate(en.get("options", [])):
            fields.append((f"opt{i}", o.get("content")))
        for field, f in fields:
            if not isinstance(f, str):
                continue
            for m in re.finditer(r"<mjx-container[^>]*>.*?</mjx-container>", f, re.S):
                n += 1
                yield f"{q['question_id']}:{field}:{n}", m.group(0)


def main():
    paper = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10 ** 9
    cases = []
    conv_fail = 0
    for cid, frag in iter_fragments(paper):
        if len(cases) >= limit:
            break
        try:
            latex = mjx_to_latex(frag)
        except Exception as e:
            latex = None
            conv_fail += 1
            print(f"CONV ERROR {cid}: {e}", file=sys.stderr)
        if latex:
            cases.append({"id": cid, "svg": frag, "latex": latex})
    print(f"converted {len(cases)} fragments ({conv_fail} converter errors)", file=sys.stderr)

    # verify in chunks
    results = []
    CHUNK = 200
    for i in range(0, len(cases), CHUNK):
        chunk = cases[i:i + CHUNK]
        p = subprocess.run(
            ["bun", "run", "scripts/mjx_verify.ts"],
            input=json.dumps(chunk), capture_output=True, text=True, timeout=600)
        if p.returncode != 0:
            print("verify subprocess failed:", p.stderr[:500], file=sys.stderr)
            break
        results.extend(json.loads(p.stdout))

    ok = sum(1 for r in results if r["ok"])
    print(f"\nROUND-TRIP: {ok}/{len(results)} pass ({100*ok/max(len(results),1):.1f}%)")
    fails = [r for r in results if not r["ok"]]
    # save failures for inspection
    with open("/tmp/mjx_fails.json", "w") as f:
        json.dump({"fails": fails, "cases": {c["id"]: c for c in cases}}, f, indent=1)
    for r in fails[:15]:
        c = next(c for c in cases if c["id"] == r["id"])
        print(f"\nFAIL {r['id']}")
        print("  latex:", c["latex"][:180])
        print("  want :", r.get("want", "")[:160])
        print("  got  :", r.get("got", "")[:160])


if __name__ == "__main__":
    main()
