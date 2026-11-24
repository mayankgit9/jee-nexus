#!/usr/bin/env python3
"""JEE NEXUS — probe one examside paper page: dump structure around questions."""
import re
import sys

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-IN,en;q=0.9",
}

url = sys.argv[1] if len(sys.argv) > 1 else \
    "https://questions.examside.com/past-years/year-wise/jee/jee-main/jee-main-2019-online-9th-january-morning-slot"
r = requests.get(url, headers=HEADERS, timeout=30)
print("status:", r.status_code, "bytes:", len(r.text))
html = r.text
open("/tmp/paper_raw.html", "w").write(html)

# what does the page look like? find the main content markers
for marker in ["question", "Question", "mcq", "MCQ", "numerical", "Numerical",
               "img", "solution", "Solution", "answer", "Answer", "latex", "katex"]:
    n = html.count(marker)
    print(f"count {marker!r}: {n}")

# image URLs
imgs = sorted(set(re.findall(r'<img[^>]+src="([^"]+)"', html)))
print(f"\nunique img srcs: {len(imgs)}")
for i in imgs[:15]:
    print(" ", i)

# scripts that might hold JSON data
m = re.findall(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.S)
print(f"\njson scripts: {len(m)}")
for s in m[:3]:
    print("  len:", len(s), "head:", s[:200].replace("\n", " "))
