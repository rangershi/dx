#!/usr/bin/env python3

# Deterministic GitHub PR review harvester.
#
# - Fetches inline review threads via GraphQL (reviewThreads) with pagination.
# - Fetches PR reviews and PR issue comments via REST (gh api) with pagination.
# - Writes a raw JSON file into project cache: ./.cache/
# - Prints exactly one JSON object to stdout: {"rawFile":"./.cache/...json"}

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


MARKER_SUBSTR = "<!-- pr-review-loop-marker"

def _repo_root():
    try:
        p = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        out = (p.stdout or "").strip()
        if p.returncode == 0 and out:
            return Path(out)
    except Exception:
        pass
    return Path.cwd()


def _cache_dir(repo_root):
    return (repo_root / ".cache").resolve()


def _repo_relpath(repo_root, p):
    try:
        rel = p.resolve().relative_to(repo_root.resolve())
        return "./" + rel.as_posix()
    except Exception:
        return os.path.basename(str(p))


REPO_ROOT = _repo_root()
CACHE_DIR = _cache_dir(REPO_ROOT)


def _json_out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=True))
    sys.stdout.write("\n")


def _run_capture(cmd):
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError as e:
        return 127, "", str(e)


def _has_loop_marker(text):
    if not text:
        return False
    try:
        return MARKER_SUBSTR in str(text)
    except Exception:
        return False


def _require_gh_auth():
    rc, out, err = _run_capture(["gh", "auth", "status"])
    if rc == 127:
        return False, "GH_CLI_NOT_FOUND", "gh not found in PATH"
    if rc != 0:
        detail = (err or out or "").strip()
        if len(detail) > 4000:
            detail = detail[-4000:]
        return False, "GH_NOT_AUTHENTICATED", detail
    return True, None, None


def _resolve_owner_repo(explicit_repo):
    if explicit_repo:
        s = str(explicit_repo).strip()
        if s and "/" in s:
            return s
    rc, out, _ = _run_capture(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
    owner_repo = out.strip() if rc == 0 else ""
    return owner_repo or None


def _gh_api_json(args):
    rc, out, err = _run_capture(["gh", "api"] + args)
    if rc != 0:
        raise RuntimeError(f"GH_API_FAILED: {(err or out or '').strip()}")
    try:
        return json.loads(out or "null")
    except Exception:
        raise RuntimeError("GH_API_JSON_PARSE_FAILED")


def _gh_api_graphql(query, variables):
    cmd = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in (variables or {}).items():
        if isinstance(v, int):
            cmd.extend(["-F", f"{k}={v}"])
        elif v is None:
            cmd.extend(["-f", f"{k}="])
        else:
            cmd.extend(["-f", f"{k}={v}"])

    rc, out, err = _run_capture(cmd)
    if rc != 0:
        raise RuntimeError(f"GH_GRAPHQL_FAILED: {(err or out or '').strip()}")
    try:
        return json.loads(out or "null")
    except Exception:
        raise RuntimeError("GH_GRAPHQL_JSON_PARSE_FAILED")


def _flatten_threads(gql_data):
    threads = []
    pr = (((gql_data or {}).get("data") or {}).get("repository") or {}).get("pullRequest") or {}
    conn = pr.get("reviewThreads") or {}
    nodes = conn.get("nodes") or []
    for t in nodes:
        is_resolved = bool((t or {}).get("isResolved"))
        is_outdated = bool((t or {}).get("isOutdated"))
        if is_resolved or is_outdated:
            continue
        comments_conn = (t or {}).get("comments") or {}
        comments_nodes = comments_conn.get("nodes") or []
        comments = []
        for c in comments_nodes:
            body = (c or {}).get("body") or ""
            body_text = (c or {}).get("bodyText") or ""
            if _has_loop_marker(body) or _has_loop_marker(body_text):
                continue
            author = (c or {}).get("author") or {}
            comments.append(
                {
                    "id": (c or {}).get("id"),
                    "databaseId": (c or {}).get("databaseId"),
                    "url": (c or {}).get("url"),
                    "author": {
                        "login": author.get("login"),
                        "type": author.get("__typename"),
                    },
                    "body": body,
                    "bodyText": body_text,
                    "createdAt": (c or {}).get("createdAt"),
                    "updatedAt": (c or {}).get("updatedAt"),
                }
            )

        if not comments:
            continue
        threads.append(
            {
                "id": (t or {}).get("id"),
                "isResolved": False,
                "isOutdated": False,
                "path": (t or {}).get("path"),
                "line": (t or {}).get("line"),
                "originalLine": (t or {}).get("originalLine"),
                "startLine": (t or {}).get("startLine"),
                "originalStartLine": (t or {}).get("originalStartLine"),
                "comments": comments,
            }
        )

    page_info = conn.get("pageInfo") or {}
    return threads, {
        "hasNextPage": bool(page_info.get("hasNextPage")),
        "endCursor": page_info.get("endCursor"),
    }


def _fetch_all_review_threads(owner, repo, pr_number):
    query = (
        "query($owner:String!,$repo:String!,$prNumber:Int!,$after:String){"
        "repository(owner:$owner,name:$repo){"
        "pullRequest(number:$prNumber){"
        "reviewThreads(first:100,after:$after){"
        "pageInfo{hasNextPage endCursor}"
        "nodes{"
        "id isResolved isOutdated path line originalLine startLine originalStartLine "
        "comments(first:100){nodes{"
        "id databaseId url body bodyText createdAt updatedAt author{login __typename}"
        "}}"
        "}"
        "}"
        "}"
        "}"
        "}"
    )

    after = None
    all_threads = []
    while True:
        data = _gh_api_graphql(query, {"owner": owner, "repo": repo, "prNumber": pr_number, "after": after})
        threads, page = _flatten_threads(data)
        all_threads.extend(threads)
        if not page.get("hasNextPage"):
            break
        after = page.get("endCursor")
        if not after:
            break
    return all_threads


def main(argv):
    class _ArgParser(argparse.ArgumentParser):
        def error(self, message):
            raise ValueError(message)

    parser = _ArgParser(add_help=False)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--round", type=int, default=1)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--repo")

    try:
        args = parser.parse_args(argv)
    except ValueError:
        _json_out({"error": "INVALID_ARGS"})
        return 2

    ok, code, detail = _require_gh_auth()
    if not ok:
        _json_out({"error": code, "detail": detail})
        return 1

    owner_repo = _resolve_owner_repo(args.repo)
    if not owner_repo:
        _json_out({"error": "REPO_NOT_FOUND"})
        return 1
    if "/" not in owner_repo:
        _json_out({"error": "INVALID_REPO"})
        return 1

    owner, repo = owner_repo.split("/", 1)
    pr_number = int(args.pr)
    round_num = int(args.round)
    run_id = str(args.run_id).strip()
    if not run_id:
        _json_out({"error": "MISSING_RUN_ID"})
        return 1

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    raw_basename = f"gh-review-raw-pr{pr_number}-r{round_num}-{run_id}.json"
    raw_path = CACHE_DIR / raw_basename

    try:
        threads = _fetch_all_review_threads(owner, repo, pr_number)

        reviews = _gh_api_json([f"repos/{owner_repo}/pulls/{pr_number}/reviews", "--paginate"])
        issue_comments = _gh_api_json([f"repos/{owner_repo}/issues/{pr_number}/comments", "--paginate"])

        if isinstance(reviews, list):
            reviews = [r for r in reviews if not _has_loop_marker((r or {}).get("body") or "")]
        if isinstance(issue_comments, list):
            issue_comments = [c for c in issue_comments if not _has_loop_marker((c or {}).get("body") or "")]

        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "repo": owner_repo,
            "pr": pr_number,
            "round": round_num,
            "runId": run_id,
            "generatedAt": now,
            "reviewThreads": threads,
            "reviews": reviews if isinstance(reviews, list) else [],
            "issueComments": issue_comments if isinstance(issue_comments, list) else [],
        }

        raw_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8", newline="\n")
    except Exception as e:
        _json_out({"error": "HARVEST_FAILED", "detail": str(e)[:800]})
        return 1

    _json_out({"rawFile": _repo_relpath(REPO_ROOT, raw_path)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
