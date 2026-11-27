#!/usr/bin/env python3
"""JEE NEXUS — pin the top-3 of the most recently CLOSED leaderboard week.

Runs in GitHub Actions (weekly-winners.yml) shortly after the Monday
00:00 UTC boundary: computes windowEnd = most recent Monday 00:00 UTC and
windowStart = windowEnd - 7d, then POSTs both to the live snapshot endpoint
with the SNAPSHOT_TOKEN repo secret. The window derivation is deterministic
(no matter how late the runner starts) and the endpoint is idempotent
(unique (window_start, window_end, rank) + skipDuplicates), so retries and
manual dispatches can never duplicate or overwrite a pinned podium.

Never prints the token. Exits non-zero on any HTTP error so the Actions
run shows red and the failure is visible in the repo's badge/mail.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

LIVE_URL = os.environ.get("LIVE_URL", "https://jee-nexus-app.jee-nexus.workers.dev").rstrip("/")
TOKEN = os.environ.get("SNAPSHOT_TOKEN", "")

UA = "jee-nexus-weekly-winners-cron/1.0 (github-actions)"


def most_recent_monday_utc(now: datetime) -> datetime:
    """Truncate to 00:00:00 UTC of the current week's Monday."""
    midnight = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    return midnight - timedelta(days=now.weekday())


def main() -> None:
    if not TOKEN:
        print("SNAPSHOT_TOKEN missing from environment")
        sys.exit(1)

    now = datetime.now(timezone.utc)
    end = most_recent_monday_utc(now)
    start = end - timedelta(days=7)
    payload = json.dumps(
        {
            "windowStart": start.isoformat().replace("+00:00", "Z"),
            "windowEnd": end.isoformat().replace("+00:00", "Z"),
        }
    ).encode()

    req = urllib.request.Request(
        f"{LIVE_URL}/api/leaderboard/snapshot",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {TOKEN}",
            "User-Agent": UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = json.load(r)
            print(
                f"HTTP {r.status}: pinned {body.get('inserted')} winners for "
                f"{body.get('windowStart')} .. {body.get('windowEnd')}"
            )
            for w in body.get("winners", []):
                print(f"  #{w['rank']} {w['userName']} — {w['attempts']} attempts · {w['accuracy']}% correct")
            if body.get("inserted") == 0 and not body.get("winners"):
                print("  (window already pinned or no attempts — nothing new)")
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}")
        sys.exit(1)
    except Exception as e:  # noqa: BLE001 — cron must fail loudly
        print(f"error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
