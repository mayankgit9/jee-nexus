#!/usr/bin/env python3
"""JEE NEXUS — plumb the Supabase DB password into BOTH places production
needs it, via APIs (no interactive wrangler prompt):

  1. GitHub Actions secret DATABASE_URL  (repo mayankgit9/jee-nexus)
     → used by the import-pyq workflow to mass-import all real PYQ batches
  2. Cloudflare Worker secret DATABASE_URL (worker jee-nexus-app)
     → used by the live app for every DB-backed endpoint

Reads credentials from .secrets/:
  .secrets/tokens.env       GH_PAT=<github PAT, repo scope>
  .secrets/cloudflare.env   CLOUDFLARE_API_TOKEN=<workers scripts:edit>
  .secrets/supabase_db.env  SUPABASE_DB_PASSWORD=<the password>

Usage:
  python3 scripts/set_secrets.py --check     # show what is ready, no changes
  python3 scripts/set_secrets.py             # set both secrets
"""
import base64
import json
import os
import sys
import urllib.request

REPO = "mayankgit9/jee-nexus"
CF_ACCOUNT = "d847f3e3bffdd74a6df0ecfbf150df31"
WORKER = "jee-nexus-app"
# session pooler (port 5432, transaction-safe for Workers direct TCP)
# project: preparena (ref mxfiazcjcgqzqynmsefp, ap-south-1, aws-0 cluster)
DB_URL_TMPL = ("postgresql://jee_app.mxfiazcjcgqzqynmsefp:{pw}"
               "@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require")


def load_secrets():
    vals = {}
    for f, keys in [(".secrets/tokens.env", ["GH_PAT"]),
                    (".secrets/cloudflare.env", ["CLOUDFLARE_API_TOKEN"]),
                    (".secrets/supabase_db.env", ["SUPABASE_DB_PASSWORD"])]:
        try:
            for line in open(f):
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    if k in keys:
                        vals[k] = v.strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    return vals


def api(method, url, token, body=None, accept="application/vnd.github+json"):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", accept)
    data = None
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def set_github_secret(pw):
    from nacl import encoding, public
    base = f"https://api.github.com/repos/{REPO}"
    st, key = api("GET", f"{base}/actions/secrets/public-key", GH_PAT)
    if st != 200:
        return f"public-key fetch failed: HTTP {st} {key.get('message', '')}"
    pk = public.PublicKey(key["key"].encode(), encoding.Base64Encoder())
    sealed = public.SealedBox(pk).encrypt(DB_URL_TMPL.format(pw=pw).encode())
    body = {"encrypted_value": base64.b64encode(sealed).decode(),
            "key_id": key["key_id"]}
    st, resp = api("PUT", f"{base}/actions/secrets/DATABASE_URL", GH_PAT, body)
    return "OK" if st in (201, 204) else f"PUT failed: HTTP {st} {resp.get('message', '')}"


def set_worker_secret(pw, cf_token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}"
           f"/workers/scripts/{WORKER}/secrets")
    body = {"name": "DATABASE_URL", "text": DB_URL_TMPL.format(pw=pw),
            "type": "secret_text"}
    st, resp = api("PUT", url, cf_token, body, accept="application/json")
    if st in (200, 201) and resp.get("success"):
        return "OK"
    return f"PUT failed: HTTP {st} {json.dumps(resp)[:200]}"


if __name__ == "__main__":
    os.chdir("/home/z/my-project")
    vals = load_secrets()
    GH_PAT = vals.get("GH_PAT")
    CF = vals.get("CLOUDFLARE_API_TOKEN")
    PW = vals.get("SUPABASE_DB_PASSWORD")

    print(f"GH_PAT:                {'present' if GH_PAT else 'MISSING'}")
    print(f"CLOUDFLARE_API_TOKEN:  {'present' if CF else 'MISSING'}")
    print(f"SUPABASE_DB_PASSWORD:  {'present' if PW else 'MISSING'}")
    if "--check" in sys.argv or not (GH_PAT and CF and PW):
        print("\n(set_secrets: nothing done — pass all three files to execute)")
        sys.exit(0 if (GH_PAT and CF and PW) else 1)

    print("\n1/2 GitHub Actions secret DATABASE_URL ...")
    print("   ", set_github_secret(PW))
    print("2/2 Cloudflare Worker secret DATABASE_URL ...")
    print("   ", set_worker_secret(PW, CF))
