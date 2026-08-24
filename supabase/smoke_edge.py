#!/usr/bin/env python3
"""Reusable LIVE smoke for a Supabase Edge Function — as a real authenticated user.

Health Hub's edge functions (recognize-pantry, estimate-nutrition, plan-week) are
per-user + JWT-gated, so a real check needs a real signed-in user. This does the
whole dance so verifying a function is a one-liner:

  1. fetch the service_role key via the Management API (PAT from .supabase-admin.local),
  2. admin-create a confirmed throwaway user,
  3. sign in → a real user JWT,
  4. invoke the function with that JWT + a body,
  5. print status + response,
  6. delete the throwaway user.

Usage (from repo root):
  python supabase/smoke_edge.py <function-name> '<json-body>'
  python supabase/smoke_edge.py plan-week @scripts/plan_body.json     # body from a file
  python supabase/smoke_edge.py estimate-nutrition '{"text":"2 eggs and toast"}'

Never prints secrets. The throwaway user is always deleted (even on error).
Exit code 0 iff the function returned 2xx.
"""
import json, sys, urllib.request, urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

REF = "eazwtlqieizvsqvbbknj"
BASE = f"https://{REF}.supabase.co"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}  # beats Cloudflare 1010


def _read_admin_token():
    for line in open(".supabase-admin.local", encoding="utf-8"):
        if line.startswith("SUPABASE_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("SUPABASE_ACCESS_TOKEN not found in .supabase-admin.local")


def _anon():
    return json.load(open("app/env.local.json"))["SUPABASE_PUBLISHABLE_KEY"]


def _req(url, data=None, headers=None, method=None):
    h = {"Content-Type": "application/json", **UA, **(headers or {})}
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r) as x:
            raw = x.read()
            try:
                return x.status, json.loads(raw or "{}")
            except Exception:
                return x.status, raw.decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:500]


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    fn = sys.argv[1]
    body_arg = sys.argv[2] if len(sys.argv) > 2 else "{}"
    if body_arg.startswith("@"):
        body = json.load(open(body_arg[1:], encoding="utf-8"))
    else:
        body = json.loads(body_arg)

    pat = _read_admin_token()
    anon = _anon()
    s, keys = _req(f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true",
                   headers={"Authorization": f"Bearer {pat}"})
    if s != 200:
        raise SystemExit(f"management api-keys failed: {s} {keys}")
    sr = next(k["api_key"] for k in keys if k["name"] == "service_role")
    adm = {"apikey": sr, "Authorization": f"Bearer {sr}"}

    email, pw = "edge-smoke@example.com", "Smoke!23456"
    s, u = _req(f"{BASE}/auth/v1/admin/users",
                {"email": email, "password": pw, "email_confirm": True}, adm)
    uid = u.get("id") if isinstance(u, dict) else None
    try:
        s, tok = _req(f"{BASE}/auth/v1/token?grant_type=password",
                      {"email": email, "password": pw}, {"apikey": anon})
        at = tok.get("access_token") if isinstance(tok, dict) else None
        if not at:
            raise SystemExit(f"sign-in failed: {s} {tok}")
        status, resp = _req(f"{BASE}/functions/v1/{fn}", body,
                            {"apikey": anon, "Authorization": f"Bearer {at}"})
        print(f"[{fn}] HTTP {status}")
        print(json.dumps(resp, indent=2)[:6000] if isinstance(resp, (dict, list)) else resp)
        sys.exit(0 if 200 <= status < 300 else 1)
    finally:
        if uid:
            _req(f"{BASE}/auth/v1/admin/users/{uid}", None, adm, method="DELETE")


if __name__ == "__main__":
    main()
