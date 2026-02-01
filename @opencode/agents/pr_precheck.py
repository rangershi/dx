#!/usr/bin/env python3
# PR precheck workflow (all handled by this script):
# - Verify running inside a git repo
# - Verify GitHub auth (gh)
# - Read PR info (headRefName/baseRefName/mergeable)
# - Checkout PR branch (gh pr checkout) if needed
# - Fetch base branch (origin/<base>, fallback main/master)
# - If mergeable == CONFLICTING: return {"error":"PR_MERGE_CONFLICTS_UNRESOLVED"}
# - Run dx cache clear
# - Run dx lint and dx build all concurrently
# - On failure, write fixFile to ~/.opencode/cache/ and return {"ok":false,"fixFile":"..."}
# - On success, return {"ok":true}
#
# Stdout contract: print exactly one JSON object and nothing else.

import json
import re
import secrets
import subprocess
import sys
from urllib.parse import urlparse
from pathlib import Path


def run(cmd, *, cwd=None, stdout_path=None, stderr_path=None):
    try:
        return _run(cmd, cwd=cwd, stdout_path=stdout_path, stderr_path=stderr_path)
    except FileNotFoundError as e:
        # Match common shell semantics for "command not found".
        return 127


def _run(cmd, *, cwd=None, stdout_path=None, stderr_path=None):
    if stdout_path and stderr_path and stdout_path == stderr_path:
        with open(stdout_path, "wb") as f:
            p = subprocess.run(cmd, cwd=cwd, stdout=f, stderr=f)
            return p.returncode

    if stdout_path and stderr_path:
        with open(stdout_path, "wb") as stdout_f, open(stderr_path, "wb") as stderr_f:
            p = subprocess.run(cmd, cwd=cwd, stdout=stdout_f, stderr=stderr_f)
            return p.returncode
    elif stdout_path:
        with open(stdout_path, "wb") as stdout_f:
            p = subprocess.run(cmd, cwd=cwd, stdout=stdout_f, stderr=subprocess.DEVNULL)
            return p.returncode
    elif stderr_path:
        with open(stderr_path, "wb") as stderr_f:
            p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=stderr_f)
            return p.returncode
    else:
        p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return p.returncode


def run_capture(cmd, *, cwd=None):
    try:
        p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError as e:
        return 127, "", str(e)


def _detect_git_remote_host():
    # Best-effort parse from origin remote.
    rc, origin_url, _ = run_capture(["git", "remote", "get-url", "origin"])
    if rc != 0:
        rc, origin_url, _ = run_capture(["git", "config", "--get", "remote.origin.url"])
    if rc != 0:
        return None

    url = (origin_url or "").strip()
    if not url:
        return None

    # Examples:
    # - git@github.com:owner/repo.git
    # - ssh://git@github.company.com/owner/repo.git
    # - https://github.com/owner/repo.git
    if url.startswith("git@"):  # SCP-like syntax
        # git@host:owner/repo(.git)
        m = re.match(r"^git@([^:]+):", url)
        return m.group(1) if m else None

    if url.startswith("ssh://") or url.startswith("https://") or url.startswith("http://"):
        try:
            parsed = urlparse(url)
            return parsed.hostname
        except Exception:
            return None

    return None


def tail_text(path, max_lines=200, max_chars=12000):
    try:
        data = Path(path).read_text(errors="replace")
    except Exception:
        return "(failed to read log)"
    lines = data.splitlines()
    tail = "\n".join(lines[-max_lines:])
    if len(tail) > max_chars:
        tail = tail[-max_chars:]
    return tail


def first_file_line(text):
    for m in re.finditer(r"^([^\s:]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?\b", text, flags=re.M):
        file = m.group(1)
        line = int(m.group(2))
        return file, line
    return None, None


def write_fixfile(path, issues):
    p = Path(path)
    out = ["## IssuesToFix", ""]
    for it in issues:
        out.append(f"- id: {it['id']}")
        out.append(f"  priority: {it['priority']}")
        out.append(f"  category: {it['category']}")
        out.append(f"  file: {it['file']}")
        out.append(f"  line: {it['line'] if it['line'] is not None else 'null'}")
        out.append(f"  title: {it['title']}")
        desc = it["description"].replace("\n", "\\n")
        sugg = it["suggestion"].replace("\n", "\\n")
        out.append(f"  description: {desc}")
        out.append(f"  suggestion: {sugg}")
    p.write_text("\n".join(out) + "\n")


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "PR_NUMBER_NOT_PROVIDED"}))
        return 1

    pr = sys.argv[1].strip()
    if not pr.isdigit():
        print(json.dumps({"error": "PR_NUMBER_NOT_PROVIDED"}))
        return 1

    rc, out, _ = run_capture(["git", "rev-parse", "--is-inside-work-tree"])
    if rc != 0 or out.strip() != "true":
        print(json.dumps({"error": "NOT_A_GIT_REPO"}))
        return 1

    host = _detect_git_remote_host() or "github.com"
    rc, gh_out, gh_err = run_capture(["gh", "auth", "status", "--hostname", host])
    if rc == 127:
        print(json.dumps({
            "error": "GH_CLI_NOT_FOUND",
            "detail": "gh not found in PATH",
            "suggestion": "Install GitHub CLI: https://cli.github.com/",
        }))
        return 1
    if rc != 0:
        detail = (gh_err or gh_out or "").strip()
        if len(detail) > 4000:
            detail = detail[-4000:]
        print(json.dumps({
            "error": "GH_NOT_AUTHENTICATED",
            "host": host,
            "detail": detail,
            "suggestion": f"Run: gh auth login --hostname {host}",
        }))
        return 1

    rc, pr_json, _ = run_capture(["gh", "pr", "view", pr, "--json", "headRefName,baseRefName,mergeable"])
    if rc != 0:
        print(json.dumps({"error": "PR_NOT_FOUND_OR_NO_ACCESS"}))
        return 1
    try:
        pr_info = json.loads(pr_json)
    except Exception:
        print(json.dumps({"error": "PR_NOT_FOUND_OR_NO_ACCESS"}))
        return 1

    head = (pr_info.get("headRefName") or "").strip()
    base = (pr_info.get("baseRefName") or "").strip()
    mergeable = (pr_info.get("mergeable") or "").strip()

    rc, cur_branch, _ = run_capture(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        print(json.dumps({"error": "PR_CHECKOUT_FAILED"}))
        return 1
    if head and cur_branch.strip() != head:
        if run(["gh", "pr", "checkout", pr]) != 0:
            print(json.dumps({"error": "PR_CHECKOUT_FAILED"}))
            return 1

    if not base:
        rc, out, _ = run_capture(["gh", "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])
        if rc == 0:
            base = out.strip()
    if not base:
        print(json.dumps({"error": "PR_BASE_REF_NOT_FOUND"}))
        return 1

    if run(["git", "fetch", "origin", base]) != 0:
        ok = False
        for fallback in ("main", "master"):
            if fallback == base:
                continue
            if run(["git", "fetch", "origin", fallback]) == 0:
                base = fallback
                ok = True
                break
        if not ok:
            print(json.dumps({"error": "PR_BASE_REF_FETCH_FAILED"}))
            return 1

    if mergeable == "CONFLICTING":
        print(json.dumps({"error": "PR_MERGE_CONFLICTS_UNRESOLVED"}))
        return 1

    run_id = secrets.token_hex(4)
    cache = Path.home() / ".opencode" / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    
    cache_clear_log = cache / f"precheck-pr{pr}-{run_id}-cache-clear.log"
    lint_log = cache / f"precheck-pr{pr}-{run_id}-lint.log"
    build_log = cache / f"precheck-pr{pr}-{run_id}-build.log"
    meta_log = cache / f"precheck-pr{pr}-{run_id}-meta.json"

    meta_log.write_text(json.dumps({
        "pr": int(pr),
        "headRefName": head,
        "baseRefName": base,
        "mergeable": mergeable,
        "cacheClearLog": str(cache_clear_log),
        "lintLog": str(lint_log),
        "buildLog": str(build_log),
    }, indent=2) + "\n")

    cache_rc = run(["dx", "cache", "clear"], stdout_path=str(cache_clear_log), stderr_path=str(cache_clear_log))
    if cache_rc != 0:
        fix_file = f"precheck-fix-pr{pr}-{run_id}.md"
        fix_path = cache / fix_file
        log_tail = tail_text(cache_clear_log)
        issues = [{
            "id": "PRE-001",
            "priority": "P1",
            "category": "quality",
            "file": "<unknown>",
            "line": None,
            "title": "dx cache clear failed",
            "description": log_tail,
            "suggestion": f"Open log: {cache_clear_log}",
        }]
        write_fixfile(str(fix_path), issues)
        print(json.dumps({"ok": False, "fixFile": fix_file}))
        return 1

    import threading

    results = {}

    def worker(name, cmd, log_path):
        results[name] = run(cmd, stdout_path=str(log_path), stderr_path=str(log_path))

    t1 = threading.Thread(target=worker, args=("lint", ["dx", "lint"], lint_log))
    t2 = threading.Thread(target=worker, args=("build", ["dx", "build", "all"], build_log))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    if results.get("lint", 1) == 0 and results.get("build", 1) == 0:
        print(json.dumps({"ok": True}))
        return 0

    fix_file = f"precheck-fix-pr{pr}-{run_id}.md"
    fix_path = cache / fix_file

    issues = []
    i = 1
    if results.get("lint", 1) != 0:
        log_tail = tail_text(lint_log)
        file, line = first_file_line(log_tail)
        issues.append({
            "id": f"PRE-{i:03d}",
            "priority": "P1",
            "category": "lint",
            "file": file or "<unknown>",
            "line": line,
            "title": "dx lint failed",
            "description": log_tail,
            "suggestion": f"Open log: {lint_log}",
        })
        i += 1
    if results.get("build", 1) != 0:
        log_tail = tail_text(build_log)
        file, line = first_file_line(log_tail)
        issues.append({
            "id": f"PRE-{i:03d}",
            "priority": "P0",
            "category": "build",
            "file": file or "<unknown>",
            "line": line,
            "title": "dx build all failed",
            "description": log_tail,
            "suggestion": f"Open log: {build_log}",
        })

    write_fixfile(str(fix_path), issues)
    print(json.dumps({"ok": False, "fixFile": fix_file}))
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(json.dumps({"error": "PRECHECK_SCRIPT_FAILED"}))
        sys.exit(1)
