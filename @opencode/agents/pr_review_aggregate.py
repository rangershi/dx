#!/usr/bin/env python3
# Deterministic PR review aggregation (script owns all rules).
#
# Workflow:
# - Mode A: read contextFile + reviewFile(s) from ~/.opencode/cache/, parse findings, merge duplicates,
#   post a single PR comment, and optionally generate a fixFile for pr-fix.
# - Mode B: read fixReportFile from cache and post it as a PR comment.
#
# Input rules:
# - Callers pass only basenames (no paths). This script reads/writes under ~/.opencode/cache/.
# - Duplicate groups come from LLM but are passed as an argument (NOT written to disk).
#   - Prefer: --duplicate-groups-b64 <base64(json)>
#   - Also supported: --duplicate-groups-json '<json>'
#   - Invalid/missing duplicate groups => treated as no dedupe (do not fail).
#
# Output rules:
# - Stdout must print exactly ONE JSON object and nothing else.
#   - Mode A: {"stop":true} OR {"stop":false,"fixFile":"..."}
#   - Mode B: {"ok":true}
#
# PR comment rules:
# - Every comment must include marker: <!-- pr-review-loop-marker -->
# - Comment body must NOT contain local filesystem paths (this script scrubs ~/.opencode/cache and $HOME).
#
# fixFile rules:
# - fixFile includes ONLY P0/P1/P2 findings.
# - Each merged duplicate group keeps ONE canonical id; merged IDs are appended into canonical description.
# - Do NOT rewrite id prefixes (CDX-/CLD-/GMN-); preserve reviewer-provided finding IDs.

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path


MARKER = "<!-- pr-review-loop-marker -->"
CACHE_DIR = Path.home() / ".opencode" / "cache"


def _json_out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=True))
    sys.stdout.write("\n")


def _safe_basename(name):
    if not name:
        return None
    base = os.path.basename(name.strip())
    if base != name.strip():
        return None
    if base in (".", ".."):
        return None
    return base


def _read_cache_text(basename):
    p = CACHE_DIR / basename
    return p.read_text(encoding="utf-8", errors="replace")


def _write_cache_text(basename, content):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / basename
    p.write_text(content, encoding="utf-8", newline="\n")


def _priority_rank(p):
    if not isinstance(p, str):
        return 99
    p = p.strip().upper()
    if p == "P0":
        return 0
    if p == "P1":
        return 1
    if p == "P2":
        return 2
    if p == "P3":
        return 3
    return 99


def _sanitize_for_comment(text):
    if not isinstance(text, str):
        text = str(text)

    home = str(Path.home())
    cache_abs = str(CACHE_DIR)

    text = text.replace("~/.opencode/cache/", "[cache]/")
    text = text.replace(cache_abs + "/", "[cache]/")
    if home:
        text = text.replace(home + "/.opencode/cache/", "[cache]/")

    return text


def _parse_duplicate_groups_json(s):
    if not s:
        return []
    try:
        data = json.loads(s)
    except Exception:
        return []

    groups = []
    if isinstance(data, dict) and isinstance(data.get("duplicateGroups"), list):
        groups = data.get("duplicateGroups")
    elif isinstance(data, list):
        groups = data
    else:
        return []

    out = []
    for g in (groups or []):
        if not isinstance(g, list):
            continue
        ids = []
        for it in g:
            if isinstance(it, str) and it.strip():
                ids.append(it.strip())
        ids = list(dict.fromkeys(ids))
        if len(ids) >= 2:
            out.append(ids)
    return out


def _parse_duplicate_groups_b64(s):
    if not s:
        return []
    try:
        raw = base64.b64decode(s.encode("ascii"), validate=True)
        return _parse_duplicate_groups_json(raw.decode("utf-8", errors="replace"))
    except Exception:
        return []


def _parse_review_findings(md_text):
    lines = md_text.splitlines()
    items = []

    cur = None
    for raw in lines:
        line = raw.rstrip("\n")
        if line.startswith("- id:"):
            if cur:
                items.append(cur)
            cur = {"id": line.split(":", 1)[1].strip()}
            continue
        if cur and line.startswith("  "):
            m = re.match(r"^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*(.*)$", line)
            if not m:
                continue
            k = m.group(1).strip()
            v = m.group(2)
            cur[k] = v.strip()

    if cur:
        items.append(cur)

    normalized = []
    for it in items:
        fid = (it.get("id") or "").strip()
        if not fid:
            continue
        normalized.append(
            {
                "id": fid,
                "priority": (it.get("priority") or "P3").strip(),
                "category": (it.get("category") or "quality").strip(),
                "file": (it.get("file") or "<unknown>").strip(),
                "line": (it.get("line") or "null").strip(),
                "title": (it.get("title") or "").strip(),
                "description": (it.get("description") or "").strip(),
                "suggestion": (it.get("suggestion") or "(no suggestion provided)").strip(),
            }
        )
    return normalized


def _merge_duplicates(findings, duplicate_groups):
    by_id = {f["id"]: dict(f) for f in findings}
    merged_map = {}
    seen = set()

    for group in duplicate_groups:
        ids = [i for i in group if i in by_id]
        ids = list(dict.fromkeys(ids))
        if len(ids) < 2:
            continue

        def sort_key(fid):
            f = by_id[fid]
            return (_priority_rank(f.get("priority")), fid)

        canonical = sorted(ids, key=sort_key)[0]
        merged = [i for i in ids if i != canonical]
        if not merged:
            continue

        merged_map[canonical] = merged
        for mid in merged:
            seen.add(mid)

    out = []
    for fid, f in by_id.items():
        if fid in seen:
            continue

        if fid in merged_map:
            also = ", ".join(merged_map[fid])
            desc = (f.get("description") or "")
            suffix = f"Also reported as: {also}"
            if desc:
                desc = desc + "\n" + suffix
            else:
                desc = suffix
            f = dict(f)
            f["description"] = desc

        out.append(f)

    out.sort(key=lambda x: (_priority_rank(x.get("priority")), x.get("id") or ""))
    return out, merged_map


def _counts(findings):
    c = {"P0": 0, "P1": 0, "P2": 0, "P3": 0}
    for f in findings:
        p = (f.get("priority") or "").strip().upper()
        if p in c:
            c[p] += 1
    return c


def _post_pr_comment(pr_number, body_basename):
    body_path = str(CACHE_DIR / body_basename)
    rc = subprocess.run(
        ["gh", "pr", "comment", str(pr_number), "--body-file", body_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode
    return rc == 0


def _render_mode_a_comment(pr_number, round_num, run_id, counts, must_fix, merged_map, raw_reviews):
    lines = []
    lines.append(MARKER)
    lines.append("")
    lines.append(f"## Review Summary (Round {round_num})")
    lines.append("")
    lines.append(f"- PR: #{pr_number}")
    lines.append(f"- RunId: {run_id}")
    lines.append(f"- P0: {counts['P0']}  P1: {counts['P1']}  P2: {counts['P2']}  P3: {counts['P3']}")
    lines.append("")

    if must_fix:
        lines.append("## Must Fix (P0/P1/P2)")
        lines.append("")
        for f in must_fix:
            fid = f.get("id") or ""
            title = f.get("title") or ""
            pri = (f.get("priority") or "").strip()
            file = f.get("file") or "<unknown>"
            line = f.get("line") or "null"
            sugg = f.get("suggestion") or ""
            lines.append(f"- {fid} ({pri}) {title}")
            lines.append(f"  - {file}:{line}")
            if fid in merged_map:
                lines.append(f"  - merged: {', '.join(merged_map[fid])}")
            if sugg:
                lines.append(f"  - suggestion: {_sanitize_for_comment(sugg)}")
        lines.append("")
    else:
        lines.append("## Result")
        lines.append("")
        lines.append("No P0/P1/P2 issues found.")
        lines.append("")

    lines.append("<details>")
    lines.append("<summary>Raw Reviews</summary>")
    lines.append("")
    for name, content in raw_reviews:
        lines.append(f"### {name}")
        lines.append("")
        lines.append("```md")
        lines.append(_sanitize_for_comment(content))
        lines.append("```")
        lines.append("")
    lines.append("</details>")
    lines.append("")
    return "\n".join(lines)


def _render_mode_b_comment(pr_number, round_num, run_id, fix_report_md):
    body = []
    body.append(MARKER)
    body.append("")
    body.append(f"## Fix Report (Round {round_num})")
    body.append("")
    body.append(f"- PR: #{pr_number}")
    body.append(f"- RunId: {run_id}")
    body.append("")
    body.append(_sanitize_for_comment(fix_report_md))
    body.append("")
    return "\n".join(body)


def main(argv):
    class _ArgParser(argparse.ArgumentParser):
        def error(self, message):
            raise ValueError(message)

    parser = _ArgParser(add_help=False)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--round", type=int, default=1)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--context-file")
    parser.add_argument("--review-file", action="append", default=[])
    parser.add_argument("--fix-report-file")
    parser.add_argument("--duplicate-groups-json")
    parser.add_argument("--duplicate-groups-b64")

    try:
        args = parser.parse_args(argv)
    except ValueError:
        _json_out({"error": "INVALID_ARGS"})
        return 2

    pr_number = args.pr
    round_num = args.round
    run_id = str(args.run_id)

    fix_report_file = _safe_basename(args.fix_report_file) if args.fix_report_file else None
    context_file = _safe_basename(args.context_file) if args.context_file else None
    review_files = []
    for rf in args.review_file or []:
        b = _safe_basename(rf)
        if b:
            review_files.append(b)

    if fix_report_file:
        fix_md = _read_cache_text(fix_report_file)
        body = _render_mode_b_comment(pr_number, round_num, run_id, fix_md)
        body_file = f"review-aggregate-fix-comment-pr{pr_number}-r{round_num}-{run_id}.md"
        _write_cache_text(body_file, body)
        if not _post_pr_comment(pr_number, body_file):
            _json_out({"error": "GH_PR_COMMENT_FAILED"})
            return 1
        _json_out({"ok": True})
        return 0

    if not context_file:
        _json_out({"error": "MISSING_CONTEXT_FILE"})
        return 1
    if not review_files:
        _json_out({"error": "MISSING_REVIEW_FILES"})
        return 1

    raw_reviews = []
    all_findings = []
    for rf in review_files:
        md = _read_cache_text(rf)
        raw_reviews.append((rf, md))
        all_findings.extend(_parse_review_findings(md))

    duplicate_groups = _parse_duplicate_groups_json(args.duplicate_groups_json or "")
    if not duplicate_groups:
        duplicate_groups = _parse_duplicate_groups_b64(args.duplicate_groups_b64 or "")
    merged_findings, merged_map = _merge_duplicates(all_findings, duplicate_groups)
    counts = _counts(merged_findings)

    must_fix = [f for f in merged_findings if _priority_rank(f.get("priority")) <= 2]
    stop = len(must_fix) == 0

    body = _render_mode_a_comment(pr_number, round_num, run_id, counts, must_fix, merged_map, raw_reviews)
    body_file = f"review-aggregate-comment-pr{pr_number}-r{round_num}-{run_id}.md"
    _write_cache_text(body_file, body)
    if not _post_pr_comment(pr_number, body_file):
        _json_out({"error": "GH_PR_COMMENT_FAILED"})
        return 1

    if stop:
        _json_out({"stop": True})
        return 0

    fix_file = f"fix-pr{pr_number}-r{round_num}-{run_id}.md"
    lines = []
    lines.append("# Fix File")
    lines.append("")
    lines.append(f"PR: {pr_number}")
    lines.append(f"Round: {round_num}")
    lines.append("")
    lines.append("## IssuesToFix")
    lines.append("")
    for f in must_fix:
        fid = f.get("id") or ""
        pri = (f.get("priority") or "P3").strip()
        cat = (f.get("category") or "quality").strip()
        file = (f.get("file") or "<unknown>").strip()
        line = (f.get("line") or "null").strip()
        title = (f.get("title") or "").strip()
        desc = (f.get("description") or "").replace("\n", "\\n").strip()
        sugg = (f.get("suggestion") or "(no suggestion provided)").replace("\n", "\\n").strip()

        lines.append(f"- id: {fid}")
        lines.append(f"  priority: {pri}")
        lines.append(f"  category: {cat}")
        lines.append(f"  file: {file}")
        lines.append(f"  line: {line}")
        lines.append(f"  title: {title}")
        lines.append(f"  description: {desc}")
        lines.append(f"  suggestion: {sugg}")

    _write_cache_text(fix_file, "\n".join(lines) + "\n")
    _json_out({"stop": False, "fixFile": fix_file})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception:
        _json_out({"error": "AGGREGATE_SCRIPT_FAILED"})
        raise SystemExit(1)
