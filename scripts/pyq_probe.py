#!/usr/bin/env python3
"""JEE NEXUS — probe questions.examside.com structure: get real hrefs for
all JEE Main papers 2019-2026 (year-wise listing)."""
import re
import sys
import time

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-IN,en;q=0.9",
}

def fetch(url, tries=3):
    for i in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            return r.text
        except Exception as e:
            print(f"  retry {i+1}: {e}", file=sys.stderr)
            time.sleep(2 + i * 2)
    return None

if __name__ == "__main__":
    html = fetch("https://questions.examside.com/past-years/year-wise/jee/jee-main")
    if not html:
        sys.exit("FETCH FAILED")
    print(f"page bytes: {len(html)}")
    # collect hrefs that look like paper links
    hrefs = sorted(set(re.findall(r'href="(/past-years/[^"]+)"', html)))
    print(f"paper links found: {len(hrefs)}")
    for h in hrefs:
        print(h)
