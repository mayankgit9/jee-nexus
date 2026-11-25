#!/usr/bin/env python3
"""JEE NEXUS — sync data/taxonomy.json chemistry chapters with prod (0005+0006).

The live DB gained chemistry:electrochemistry (sort 9) and chemistry:salt-analysis
(sort 16) via supabase migrations, but data/taxonomy.json (verifier + CI + local
seed source) never caught up — verify_pyq_batch failed questions mapped to those
chapters. This inserts both at the prod positions and renumbers 1..N to match
the live /api/taxonomy order exactly. Idempotent.
"""
import json

PATH = "data/taxonomy.json"
INSERT_AFTER = {  # insert after this chapter key
    "chemistry:electrochemistry": ("chemistry:redox-reactions",
                                    "Electrochemistry", "Physical Chemistry"),
    "chemistry:salt-analysis": ("chemistry:coordination-compounds",
                                "Salt Analysis", "Inorganic Chemistry"),
}

tax = json.load(open(PATH))
chem = next(s for s in tax["subjects"] if s["key"] == "chemistry")
chapters = chem["chapters"]

out = []
for c in chapters:
    out.append(c)
    for key, (after, name, unit) in list(INSERT_AFTER.items()):
        if c["key"] == after and not any(x["key"] == key for x in chapters):
            out.append({"key": key, "name": name, "unit": unit})
            print("inserted", key, "after", after)

for i, c in enumerate(out, start=1):
    c["order"] = i
chem["chapters"] = out

with open(PATH, "w") as f:
    json.dump(tax, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"chemistry chapters: {len(out)}")
