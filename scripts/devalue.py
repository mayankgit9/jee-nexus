#!/usr/bin/env python3
"""JEE NEXUS — SvelteKit __data.json (devalue) decoder.

The `data` array format from the `devalue` package:
  - data[0] is the root object: {field: index, ...}
  - data[i] for i>0 can be:
      * primitive (str/int/float/bool/None)
      * {key: index, ...}  -> nested object
      * [index, index, ...] -> array of references
      * ["Date", "iso"] etc. -> special typed values (handled: Date)
  - Negative indices (-1 - n) refer to data[n] again (referenced repeats)
"""
import json
import sys

sys.setrecursionlimit(100000)


class DevalueDecoder:
    def __init__(self, data):
        self.data = data
        self._memo = {}
        self._in_progress = set()
        self._depth = 0

    def resolve(self, idx):
        """Resolve a reference (index) to a concrete Python value. Cycle-safe."""
        if idx is None:
            return None
        if isinstance(idx, bool):  # bool is int subclass; keep as-is
            return idx
        if isinstance(idx, (int, float)) and not isinstance(idx, bool):
            if idx >= 0:
                key = ("i", idx)
            else:
                key = ("i", -1 - idx)
                idx = -1 - idx
            if key in self._memo:
                return self._memo[key]
            if key in self._in_progress:
                # cycle: emit placeholder (nav menus may back-reference parents)
                return {"__cycle__": idx}
            if self._depth > 60:
                # overly deep shape — resolve lazily as raw
                return {"__deep__": idx}
            self._in_progress.add(key)
            self._depth += 1
            try:
                v = self._decode(self.data[idx])
            finally:
                self._depth -= 1
                self._in_progress.discard(key)
            self._memo[key] = v
            return v
        return idx  # already concrete

    def _decode(self, raw):
        if isinstance(raw, dict):
            out = {}
            for k, v in raw.items():
                out[k] = self.resolve(v)
            # devalue special forms are arrays — handled below.
            return out
        if isinstance(raw, list):
            # typed value? e.g. ["Date", "2020-01-01"], ["RegExp", "...", "flags"],
            # ["Map", ...], ["Set", ...], ["Object", ...], ["Promise"], ["Infinity"], ["NaN"]
            if raw and isinstance(raw[0], str):
                t = raw[0]
                if t == "Date":
                    return raw[1]
                if t == "RegExp":
                    return f"/{raw[1]}/{raw[2]}"
                if t == "Infinity":
                    return float("inf")
                if t == "-Infinity":
                    return float("-inf")
                if t == "NaN":
                    return float("nan")
                if t == "Map":
                    pairs = raw[1]
                    return {self.resolve(p[0]): self.resolve(p[1]) for p in pairs}
                if t == "Set":
                    return {self.resolve(x): None for x in raw[1]}
                if t == "Object" and len(raw) == 1:
                    return {}
                if t in ("Promise", "undefined", "hole"):
                    return None
                if t == "bigint":
                    return int(raw[1])
            return [self.resolve(x) for x in raw]
        return raw


def load_data_json(path_or_text):
    """Load a SvelteKit __data.json file -> list of decoded node data."""
    if isinstance(path_or_text, str) and path_or_text.strip().startswith("{"):
        doc = json.loads(path_or_text)
    else:
        with open(path_or_text) as f:
            doc = json.load(f)
    nodes = []
    for node in doc.get("nodes", []):
        if node is None or "data" not in node or node["data"] is None:
            nodes.append(None)
            continue
        dec = DevalueDecoder(node["data"])
        nodes.append(dec.resolve(0))
    return nodes


if __name__ == "__main__":
    import sys
    nodes = load_data_json(sys.argv[1] if len(sys.argv) > 1 else "/tmp/q_data.json")
    print("nodes:", len(nodes))
    for i, n in enumerate(nodes):
        if n is None:
            continue
        keys = list(n.keys()) if isinstance(n, dict) else type(n)
        print(f"node {i}: {keys}")
    # question node deep-dive
    qn = nodes[2]
    if isinstance(qn, dict) and "questions" in qn:
        q = qn["questions"][0]
        print("\nquestion fields:", list(q.keys()))
        for k in ("subject", "chapter", "year", "difficulty", "type", "marks"):
            print(f"  {k} = {q.get(k)}")
        print("  content.en =", str(q["content"]["en"])[:200])
        print("  content.hi =", str(q["content"]["hi"])[:120])
        print("  correct_options =", q.get("correct_options"))
        print("  options count =", len(q.get("options", [])))
        if q.get("options"):
            print("  option[0] =", {k: str(v)[:80] for k, v in q["options"][0].items()})
        print("  explanation keys =", list(q["content"].keys()) if isinstance(q["content"], dict) else "?")
