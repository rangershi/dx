#!/usr/bin/env python3
# PR context builder (deterministic).
# - Reads PR metadata + recent comments via gh
# - Reads changed files via git diff (no patch)
# - Writes Markdown context file to ~/.opencode/cache/
# - Prints exactly one JSON object to stdout

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


CACHE_DIR = Path.home() / ".opencode" / "cache"
MARKER_SUBSTR = "<!-- pr-review-loop-marker"


def _json_out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=True))
    sys.stdout.write("\n")


def _run_capture(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p.returncode, p.stdout, p.stderr


def _clip(s, n):
    if s is None:
        return ""
    s = str(s)
    return s if len(s) <= n else (s[:n] + "...")


def _safe_basename(name):
    if not name:
        return None
    base = os.path.basename(name.strip())
    if base != name.strip():
        return None
    if base in (".", ".."):
        return None
    return base


def _git_fetch_origin(ref):
    subprocess.run(["git", "fetch", "origin", ref], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _git_numstat(base_ref):
    # Prefer origin/<base>...HEAD; fallback to <base>...HEAD.
    for lhs in (f"origin/{base_ref}...HEAD", f"{base_ref}...HEAD"):
        rc, out, _ = _run_capture(["git", "diff", "--numstat", lhs])
        if rc == 0:
            return out
    return ""


def _parse_numstat(numstat_text):
    rows = []
    for line in (numstat_text or "").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        add_s, del_s, path = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if not path:
            continue
        rows.append((add_s, del_s, path))
    return rows


def main(argv):
    class _ArgParser(argparse.ArgumentParser):
        def error(self, message):
            raise ValueError(message)

    parser = _ArgParser(add_help=False)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--round", type=int, default=1)
    try:
        args = parser.parse_args(argv)
    except ValueError:
        _json_out({"error": "INVALID_ARGS"})
        return 2

    pr_number = int(args.pr)
    round_num = int(args.round)

    # Preconditions: be in a git repo and gh is authenticated.
    rc, out, _ = _run_capture(["git", "rev-parse", "--is-inside-work-tree"])
    if rc != 0 or out.strip() != "true":
        _json_out({"error": "NOT_A_GIT_REPO"})
        return 1

    if subprocess.run(["gh", "auth", "status"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
        _json_out({"error": "GH_NOT_AUTHENTICATED"})
        return 1

    rc, owner_repo, _ = _run_capture(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
    owner_repo = owner_repo.strip() if rc == 0 else ""
    if not owner_repo:
        _json_out({"error": "REPO_NOT_FOUND"})
        return 1

    fields = "number,url,title,body,isDraft,labels,baseRefName,headRefName,baseRefOid,headRefOid,comments"
    rc, pr_json, _ = _run_capture(["gh", "pr", "view", str(pr_number), "--repo", owner_repo, "--json", fields])
    if rc != 0:
        _json_out({"error": "PR_NOT_FOUND_OR_NO_ACCESS"})
        return 1
    try:
        pr = json.loads(pr_json)
    except Exception:
        _json_out({"error": "PR_NOT_FOUND_OR_NO_ACCESS"})
        return 1

    head_oid = (pr.get("headRefOid") or "").strip()
    base_ref = (pr.get("baseRefName") or "").strip() or "main"
    head_ref = (pr.get("headRefName") or "").strip()
    url = (pr.get("url") or "").strip()

    seed = f"{pr_number}:{round_num}:{head_oid}".encode("utf-8")
    run_id = hashlib.sha1(seed).hexdigest()[:12]

    _git_fetch_origin(base_ref)
    file_rows = _parse_numstat(_git_numstat(base_ref))

    labels = []
    for l in (pr.get("labels") or []):
        if isinstance(l, dict) and l.get("name"):
            labels.append(str(l.get("name")))

    comments = pr.get("comments") or []
    recent = comments[-10:] if isinstance(comments, list) else []
    marker_count = 0
    for c in recent:
        if not isinstance(c, dict):
            continue
        body = c.get("body") or ""
        if isinstance(body, str) and MARKER_SUBSTR in body:
            marker_count += 1

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    context_file = f"pr-context-pr{pr_number}-r{round_num}-{run_id}.md"
    context_path = CACHE_DIR / context_file

    with open(context_path, "w", encoding="utf-8", newline="\n") as fp:
        fp.write("# PR Context\n\n")
        fp.write(f"- Repo: {owner_repo}\n")
        fp.write(f"- PR: #{pr_number} {url}\n")
        fp.write(f"- Round: {round_num}\n")
        fp.write(f"- RunId: {run_id}\n")
        fp.write(f"- Base: {base_ref}\n")
        fp.write(f"- Head: {head_ref}\n")
        fp.write(f"- HeadOid: {head_oid}\n")
        fp.write(f"- Draft: {pr.get('isDraft')}\n")
        fp.write(f"- Labels: {', '.join(labels) if labels else '(none)'}\n")
        fp.write(f"- ExistingLoopMarkers: {marker_count}\n\n")

        fp.write("## Title\n\n")
        fp.write(_clip(pr.get("title") or "", 200) + "\n\n")

        fp.write("## Body (excerpt)\n\n")
        fp.write(_clip(pr.get("body") or "", 2000) or "(empty)")
        fp.write("\n\n")

        fp.write(f"## Changed Files ({len(file_rows)})\n\n")
        if file_rows:
            for add_s, del_s, path in file_rows:
                fp.write(f"- +{add_s} -{del_s} {path}\n")
        else:
            fp.write("(none)\n")
        fp.write("\n")

        fp.write("## Recent Comments (excerpt)\n\n")
        if recent:
            for c in recent:
                if not isinstance(c, dict):
                    continue
                author = None
                if isinstance(c.get("author"), dict):
                    author = (c.get("author") or {}).get("login")
                fp.write(f"- {author or 'unknown'}: {_clip(c.get('body') or '', 300)}\n")
        else:
            fp.write("(none)\n")

    _json_out(
        {
            "agent": "pr-context",
            "prNumber": pr_number,
            "round": round_num,
            "runId": run_id,
            "repo": {"nameWithOwner": owner_repo},
            "headOid": head_oid,
            "existingMarkerCount": marker_count,
            "contextFile": context_file,
        }
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception:
        _json_out({"error": "PR_CONTEXT_SCRIPT_FAILED"})
        raise SystemExit(1)
