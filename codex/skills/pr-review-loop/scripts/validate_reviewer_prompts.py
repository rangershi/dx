#!/usr/bin/env python3
"""
Validate reviewer prompt files contain the required output contract.
"""

import argparse
import json
import re
import sys
from pathlib import Path


REQUIRED_SNIPPETS = [
    "## 输出格式（强制）",
    "## Findings",
    "None",
    "id:",
    "priority:",
    "category:",
    "file:",
    "line:",
    "title:",
    "description:",
    "suggestion:",
]


def _validate_prompt_text(text: str) -> list[str]:
    errors: list[str] = []
    for snippet in REQUIRED_SNIPPETS:
        if snippet not in text:
            errors.append(f"缺少必需片段: {snippet}")

    role_match = re.search(r"ROLE_CODE\s*=\s*([A-Z0-9]+)", text)
    if not role_match:
        errors.append("缺少 ROLE_CODE = <CODE>")
        return errors

    role_code = role_match.group(1)
    if f"id: {role_code}-001" not in text:
        errors.append(f"缺少与 ROLE_CODE 匹配的 finding id 示例: id: {role_code}-001")

    review_file_pattern = rf"review-{role_code}-pr<PR_NUMBER>-r<ROUND>-<RUN_ID>\.md"
    if not re.search(review_file_pattern, text):
        errors.append(f"reviewFile 模板未与 ROLE_CODE 对齐: {role_code}")

    return errors


def _validate_file(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        return [f"文件不可读: {exc}"]
    return _validate_prompt_text(text)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args(argv)

    invalid: dict[str, list[str]] = {}
    checked: list[str] = []
    for raw in args.paths:
        path = Path(raw)
        checked.append(str(path))
        errors = _validate_file(path)
        if errors:
            invalid[str(path)] = errors

    if invalid:
        sys.stdout.write(
            json.dumps(
                {"ok": False, "checked": checked, "invalid": invalid},
                ensure_ascii=False,
            )
            + "\n"
        )
        return 1

    sys.stdout.write(json.dumps({"ok": True, "checked": checked}, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
