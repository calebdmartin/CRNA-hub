"""Supabase Management API helper for CRNA Hub (deploy + secrets).

Uses the registered custom.supabase-management credential only via its
hsurr: surrogate (dynamic_credentials.py); the real token is never read,
printed, or stored here. All requests go to api.supabase.com only.
"""
import json
import sys
import urllib.request
import uuid

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request  # noqa: E402

BASE = "https://api.supabase.com"
REF = "xgoghgihfhtnyevgapyp"
ALLOWED = ["api.supabase.com"]
# ROOT is THIS tree's functions directory, resolved from the
# script's own location (Nov 11, 2026, v135): it used to be a
# hardcoded path to a shared snapshot tree
# (crnahub-neutrality) whose sources lag the rounds — no
# mode "rules" in its extract-contract, QGENDA_PARSER_VERSION
# 6, no v130/v134 calendar code — so any deploy run through
# the old helper would silently ship THAT tree instead of
# the round being built. (Verified Nov 11, 2026: the live
# extract-contract does carry mode "rules", so this hazard
# is stated as what the helper WOULD ship, not as the cause
# of the Nov 11 CAMC read failure.) A deploy must ship the
# tree the script sits in, never a snapshot that happens to
# share the name.
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "supabase", "functions") + os.sep


def _req(method, path, body=None, headers=None):
    # Try the likely registered credential names in order.
    last_err = None
    for name in ("supabase-management", "custom.supabase-management"):
        r = urllib.request.Request(BASE + path, method=method)
        if body is not None:
            r.data = body
        for k, v in (headers or {}).items():
            r.add_header(k, v)
        try:
            add_surrogate_to_request(r, name, allowed_hosts=ALLOWED)
        except Exception as e:  # noqa: BLE001 - try next name
            last_err = e
            continue
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
    raise RuntimeError(f"no usable supabase-management credential: {last_err}")


def get_function(slug):
    return _req("GET", f"/v1/projects/{REF}/functions/{slug}")


def list_secrets():
    return _req("GET", f"/v1/projects/{REF}/secrets")


def set_secret(name, value):
    body = json.dumps([{"name": name, "value": value}]).encode()
    return _req("POST", f"/v1/projects/{REF}/secrets", body,
                {"Content-Type": "application/json"})


def deploy_function(slug, files):
    """files: list of (filename, bytes). metadata + file parts, multipart."""
    boundary = "----crnahub-" + uuid.uuid4().hex
    parts = []
    meta = json.dumps({"entrypoint_path": "index.ts", "name": slug,
                       "verify_jwt": True})
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n"
        f"Content-Type: application/json\r\n\r\n{meta}\r\n".encode())
    for filename, content in files:
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{filename}\"\r\n"
            f"Content-Type: application/typescript\r\n\r\n".encode()
            + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return _req("POST",
                f"/v1/projects/{REF}/functions/deploy?slug={slug}",
                body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "get-function":
        print(_req("GET", f"/v1/projects/{REF}/functions/{sys.argv[2]}"))
    elif cmd == "list-secrets":
        print(list_secrets())
    elif cmd == "deploy-sync-calendar":
        files = [
            ("index.ts", open(ROOT + "sync-calendar/index.ts", "rb").read()),
            ("../_shared/calendar.ts", open(ROOT + "_shared/calendar.ts", "rb").read()),
            ("../_shared/google.ts", open(ROOT + "_shared/google.ts", "rb").read()),
            ("../_shared/outlook.ts", open(ROOT + "_shared/outlook.ts", "rb").read()),
            ("../_shared/caldav.ts", open(ROOT + "_shared/caldav.ts", "rb").read()),
        ]
        status, text = deploy_function("sync-calendar", files)
        print("STATUS:", status)
        print(text[:3000])
    elif cmd == "deploy-qgenda-feed":
        files = [
            ("index.ts", open(ROOT + "qgenda-feed/index.ts", "rb").read()),
            ("./parse.ts", open(ROOT + "qgenda-feed/parse.ts", "rb").read()),
            ("../_shared/calendar.ts", open(ROOT + "_shared/calendar.ts", "rb").read()),
        ]
        status, text = deploy_function("qgenda-feed", files)
        print("STATUS:", status)
        print(text[:3000])
    elif cmd == "deploy-ics-feed":
        files = [
            ("index.ts", open(ROOT + "ics-feed/index.ts", "rb").read()),
            ("./parse.ts", open(ROOT + "ics-feed/parse.ts", "rb").read()),
            ("../_shared/calendar.ts", open(ROOT + "_shared/calendar.ts", "rb").read()),
        ]
        status, text = deploy_function("ics-feed", files)
        print("STATUS:", status)
        print(text[:3000])
    elif cmd == "deploy-extract-contract":
        files = [
            ("index.ts", open(ROOT + "extract-contract/index.ts", "rb").read()),
            ("./normalize.ts", open(ROOT + "extract-contract/normalize.ts", "rb").read()),
            ("../_shared/calendar.ts", open(ROOT + "_shared/calendar.ts", "rb").read()),
        ]
        status, text = deploy_function("extract-contract", files)
        print("STATUS:", status)
        print(text[:3000])
    elif cmd == "deploy-push-watchdog":
        files = [
            ("index.ts", open(ROOT + "push-watchdog/index.ts", "rb").read()),
            ("./evaluate.ts", open(ROOT + "push-watchdog/evaluate.ts", "rb").read()),
            ("./webpush.ts", open(ROOT + "push-watchdog/webpush.ts", "rb").read()),
            ("../_shared/calendar.ts", open(ROOT + "_shared/calendar.ts", "rb").read()),
        ]
        status, text = deploy_function("push-watchdog", files)
        print("STATUS:", status)
        print(text[:3000])
    elif cmd == "deploy-assistant-chat":
        files = [
            ("index.ts", open(ROOT + "assistant-chat/index.ts", "rb").read()),
            ("../_shared/calendar.ts", open(ROOT + "_shared/calendar.ts", "rb").read()),
        ]
        status, text = deploy_function("assistant-chat", files)
        print("STATUS:", status)
        print(text[:3000])
    elif cmd == "set-app-url":
        status, text = set_secret("APP_URL", sys.argv[2])
        print("STATUS:", status)
        print(text[:1000])
