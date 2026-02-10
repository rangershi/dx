#!/usr/bin/env python3
# PR precheck workflow (all handled by this script):
# - Verify running inside a git repo
# - Verify GitHub auth (gh)
# - Read PR info (headRefName/baseRefName/mergeable)
# - Checkout PR branch (gh pr checkout) if needed
# - Fetch base branch (origin/<base>)
# - If mergeable == CONFLICTING: return {"error":"PR_MERGE_CONFLICTS_UNRESOLVED"}
# - Run dx cache clear
# - Run dx lint and dx build all concurrently
# - On failure, write fixFile to project cache: ./.cache/
#   and return {"ok":false,"fixFile":"./.cache/..."}
# - On success, return {"ok":true}
#
# Stdout contract: print exactly one JSON object and nothing else.

import json
import re
import subprocess
import sys
from urllib.parse import urlparse
from pathlib import Path


_last_pr_number = None
_last_round = None


def emit_json(obj):
    # Stdout contract: exactly one JSON line.
    _ = sys.stdout.write(json.dumps(obj, separators=(",", ":"), ensure_ascii=True) + "\n")


def parse_args(argv):
    pr = None
    round_n = 1

    positional = []
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--pr":
            i += 1
            if i >= len(argv):
                return None, None, "PR_NUMBER_NOT_PROVIDED"
            pr = argv[i]
        elif a.startswith("--pr="):
            pr = a.split("=", 1)[1]
        elif a == "--round":
            i += 1
            if i >= len(argv):
                return None, None, "ROUND_INVALID"
            round_n = argv[i]
        elif a.startswith("--round="):
            round_n = a.split("=", 1)[1]
        elif a.startswith("-"):
            return None, None, "INVALID_ARGS"
        else:
            positional.append(a)
        i += 1

    if pr is None and positional:
        pr = positional[0]

    pr = (pr or "").strip()
    if not pr.isdigit():
        return None, None, "PR_NUMBER_NOT_PROVIDED"

    try:
        round_int = int(str(round_n).strip())
    except Exception:
        return int(pr), None, "ROUND_INVALID"
    if round_int < 1:
        return int(pr), None, "ROUND_INVALID"

    return int(pr), round_int, None

def run(cmd, *, cwd=None, stdout_path=None, stderr_path=None):
    try:
        return _run(cmd, cwd=cwd, stdout_path=stdout_path, stderr_path=stderr_path)
    except FileNotFoundError:
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


def repo_root():
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


def cache_dir(repo_root_path):
    return (repo_root_path / ".cache").resolve()


def repo_relpath(repo_root_path, p):
    try:
        rel = p.resolve().relative_to(repo_root_path.resolve())
        return "./" + rel.as_posix()
    except Exception:
        return str(p)


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
    _ = p.write_text("\n".join(out) + "\n")


def main():
    global _last_pr_number
    global _last_round

    pr_number, round_n, arg_err = parse_args(sys.argv)
    if arg_err:
        err_obj: dict[str, object] = {"error": arg_err}
        if pr_number is not None:
            err_obj["prNumber"] = pr_number
        if round_n is not None:
            err_obj["round"] = round_n
        emit_json(err_obj)
        return 1

    _last_pr_number = pr_number
    _last_round = round_n

    pr = str(pr_number)
    base_payload: dict[str, object] = {
        "prNumber": pr_number,
        "round": round_n,
    }

    rc, git_out, _ = run_capture(["git", "rev-parse", "--is-inside-work-tree"])
    if rc != 0 or git_out.strip() != "true":
        emit_json({
            **base_payload,
            "error": "NOT_A_GIT_REPO",
        })
        return 1

    host = _detect_git_remote_host() or "github.com"

    auth_host_used = None
    rc, gh_out, gh_err = run_capture(["gh", "auth", "status", "--hostname", host])
    if rc == 127:
        emit_json({
            **base_payload,
            "error": "GH_CLI_NOT_FOUND",
            "detail": "gh not found in PATH",
            "suggestion": "Install GitHub CLI: https://cli.github.com/",
        })
        return 1

    if rc == 0:
        auth_host_used = host
    else:
        # If hostname auth fails (e.g. SSH host alias), fall back to default host.
        rc_default, gh_out_default, gh_err_default = run_capture(["gh", "auth", "status"])
        if rc_default == 0:
            # Proceed using default gh auth context; avoid false GH_NOT_AUTHENTICATED.
            auth_host_used = "default"
            rc, gh_out, gh_err = rc_default, gh_out_default, gh_err_default

    if rc != 0:
        detail = (gh_err or gh_out or "").strip()
        if len(detail) > 4000:
            detail = detail[-4000:]
        emit_json({
            **base_payload,
            "error": "GH_NOT_AUTHENTICATED",
            "host": host,
            "detail": detail,
            "suggestion": f"Run: gh auth login --hostname {host}",
        })
        return 1

    if auth_host_used == "default":
        base_payload["authHostUsed"] = auth_host_used

    rc, pr_json, _ = run_capture([
        "gh",
        "pr",
        "view",
        pr,
        "--json",
        "headRefName,baseRefName,mergeable,headRefOid",
    ])
    if rc != 0:
        emit_json({
            **base_payload,
            "error": "PR_NOT_FOUND_OR_NO_ACCESS",
        })
        return 1
    try:
        pr_info = json.loads(pr_json)
    except Exception:
        emit_json({
            **base_payload,
            "error": "PR_NOT_FOUND_OR_NO_ACCESS",
        })
        return 1

    head = (pr_info.get("headRefName") or "").strip()
    base = (pr_info.get("baseRefName") or "").strip()
    mergeable = (pr_info.get("mergeable") or "").strip()

    head_oid = (pr_info.get("headRefOid") or "").strip()
    if not head_oid:
        emit_json({
            **base_payload,
            "error": "PR_HEAD_OID_NOT_FOUND",
            "headRefName": head,
            "baseRefName": base,
            "mergeable": mergeable,
        })
        return 1

    head_short = head_oid[:7]
    run_id = f"{pr_number}-{round_n}-{head_short}"

    payload: dict[str, object] = {
        **base_payload,
        "runId": run_id,
        "headOid": head_oid,
        "headShort": head_short,
        "headRefName": head,
        "baseRefName": base,
        "mergeable": mergeable,
    }

    rc, cur_branch, _ = run_capture(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        emit_json({
            **payload,
            "error": "PR_CHECKOUT_FAILED",
        })
        return 1
    if head and cur_branch.strip() != head:
        if run(["gh", "pr", "checkout", pr]) != 0:
            emit_json({
                **payload,
                "error": "PR_CHECKOUT_FAILED",
            })
            return 1

    if not base:
        rc, default_branch_out, _ = run_capture([
            "gh",
            "repo",
            "view",
            "--json",
            "defaultBranchRef",
            "--jq",
            ".defaultBranchRef.name",
        ])
        if rc == 0:
            base = default_branch_out.strip()
    if not base:
        emit_json({
            **payload,
            "error": "PR_BASE_REF_NOT_FOUND",
        })
        return 1

    # baseRefName can be resolved from default branch; keep payload in sync.
    payload["baseRefName"] = base

    if run(["git", "fetch", "origin", base]) != 0:
        emit_json({
            **payload,
            "error": "PR_BASE_REF_FETCH_FAILED",
            "baseRefName": base,
        })
        return 1

    if mergeable == "CONFLICTING":
        emit_json({
            **payload,
            "error": "PR_MERGE_CONFLICTS_UNRESOLVED",
        })
        return 1

    root = repo_root()
    cache = cache_dir(root)
    cache.mkdir(parents=True, exist_ok=True)
    
    cache_clear_log = cache / f"precheck-{run_id}-cache-clear.log"
    lint_log = cache / f"precheck-{run_id}-lint.log"
    build_log = cache / f"precheck-{run_id}-build.log"
    meta_log = cache / f"precheck-{run_id}-meta.json"

    _ = meta_log.write_text(json.dumps({
        "prNumber": pr_number,
        "round": round_n,
        "runId": run_id,
        "headOid": head_oid,
        "headShort": head_short,
        "headRefName": head,
        "baseRefName": base,
        "mergeable": mergeable,
        "cacheClearLog": repo_relpath(root, cache_clear_log),
        "lintLog": repo_relpath(root, lint_log),
        "buildLog": repo_relpath(root, build_log),
    }, indent=2) + "\n")

    cache_rc = run(["dx", "cache", "clear"], stdout_path=str(cache_clear_log), stderr_path=str(cache_clear_log))
    if cache_rc != 0:
        fix_file = f"precheck-fix-{run_id}.md"
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
            "suggestion": f"Open log: {repo_relpath(root, cache_clear_log)}",
        }]
        write_fixfile(str(fix_path), issues)
        emit_json({
            **payload,
            "ok": False,
            "fixFile": repo_relpath(root, fix_path),
        })
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
        emit_json({
            **payload,
            "ok": True,
        })
        return 0

    fix_file = f"precheck-fix-{run_id}.md"
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
            "suggestion": f"Open log: {repo_relpath(root, lint_log)}",
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
            "suggestion": f"Open log: {repo_relpath(root, build_log)}",
        })

    write_fixfile(str(fix_path), issues)
    emit_json({
        **payload,
        "ok": False,
        "fixFile": repo_relpath(root, fix_path),
    })
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        err_obj: dict[str, object] = {"error": "PRECHECK_SCRIPT_FAILED"}
        if _last_pr_number is not None:
            err_obj["prNumber"] = _last_pr_number
        if _last_round is not None:
            err_obj["round"] = _last_round
        emit_json(err_obj)
        sys.exit(1)
