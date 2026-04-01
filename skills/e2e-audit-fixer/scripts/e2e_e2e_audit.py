#!/usr/bin/env python3
"""
E2E 检查与修复脚本（中文测试名 + fixtures 重复实现模式）
默认扫描 backend e2e 用例文件，可通过参数传入扫描路径与 fixtures 路径。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Optional


CHINESE = re.compile(r"[\u4e00-\u9fff]")
TITLE_PATTERN = re.compile(
    r"\b(?P<kind>describe|it|test|context)\s*\(\s*(?P<quote>[`'\"])(?P<name>(?:(?!(?P=quote)).)*?[\u4e00-\u9fff].*?)(?P=quote)",
    re.IGNORECASE,
)
PRISMA_PATTERN = re.compile(r"\bprisma\.(?P<model>\w+)\.(?P<method>create|createMany|createManyAndReturn|upsert)\s*\(")
JWT_PATTERN = re.compile(r"\b(?:jwtService|jwt)\.sign\s*\(")
AUTH_REQUEST_PATTERN = re.compile(r"\b(?:request|supertest)\s*\(\s*app\.getHttpServer\(\)\s*\)")
API_URL_PATTERN = re.compile(r"[`'\"]([^`'\"]*/api/[^`'\"]*)[`'\"]")
REQUEST_CALL_PATTERN = re.compile(r"\b(?:request|supertest|axios|fetch|got)\s*\(")
MANUAL_REQUEST_PATTERN = re.compile(r"\.(?:get|post|put|patch|delete|head)\(\s*[`'\"]")
TOP_LEVEL_HELPER_PATTERN = re.compile(
    r"^\s*(?:export\s+)?(?:(?:async\s+)?function\s+(?P<fn>[A-Za-z_][A-Za-z0-9_]*)\s*\(|const\s+(?P<const>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)"
)
TOP_LEVEL_HELPER_START_PATTERN = re.compile(
    r"^\s*(?:export\s+)?const\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\("
)
TOP_LEVEL_FUNCTION_START_PATTERN = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\b"
)
HELPER_NAME_PREFIXES = ("create", "ensure", "seed", "build", "find", "get", "reset", "wait", "pick")


KNOWN_FIXTURE_TOOLS: Dict[str, str] = {
    "user": "createUserRecord",
    "usercredential": "createUserCredentialRecord",
}

ISSUE_TYPES = {
    "e2e-chinese": "E2E 测试名称包含中文字符",
    "prisma-create": "直接操作 prisma.create 族接口",
    "e2e-local-helper": "重复造数更适合抽成本地 helper",
    "jwt-sign": "手动创建 JWT Token",
    "manual-api-url": "手工拼接 API URL（未使用 buildApiUrl）",
    "manual-auth-request": "手工创建 HTTP 请求（未使用 createAuthRequest 系列）",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="E2E 规则扫描与可控修复")
    parser.add_argument("--workspace", default=".", help="扫描根目录（默认当前目录）")
    parser.add_argument(
        "--e2e-glob",
        default="apps/backend/e2e/**/*.e2e-spec.ts",
        help="扫描 glob 模式，默认 apps/backend/e2e/**/*.e2e-spec.ts",
    )
    parser.add_argument(
        "--fixtures",
        default=None,
        help="fixtures 文件路径（默认 workspace/apps/backend/e2e/fixtures/fixtures.ts）",
    )
    parser.add_argument("--output-json", default=None, help="导出结果路径（JSON）")
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="输出格式（默认 text）",
    )
    parser.add_argument("--apply", action="store_true", help="启用可控修复（中文名称替换、TODO 注入）")
    parser.add_argument("--translation-map", default=None, help="中文->英文 JSON 映射文件路径")
    parser.add_argument(
        "--translate-service",
        choices=["none", "openai"],
        default="none",
        help="无映射时可用 openai 进行批量翻译",
    )
    parser.add_argument("--openai-key", default=None, help="OPENAI API Key（默认读取环境变量 OPENAI_API_KEY）")
    parser.add_argument(
        "--openai-model",
        default="gpt-4o-mini",
        help="OpenAI Chat Completions model，默认 gpt-4o-mini",
    )
    parser.add_argument(
        "--openai-endpoint",
        default="https://api.openai.com/v1/chat/completions",
        help="OpenAI 兼容端点",
    )
    parser.add_argument("--dry-run", action="store_true", help="应用修复时仅预览")
    return parser.parse_args()


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str, dry_run: bool) -> None:
    if dry_run:
        return
    path.write_text(text, encoding="utf-8")


def has_chinese(text: str) -> bool:
    return CHINESE.search(text) is not None


def parse_fixture_exports(path: Optional[Path]) -> List[str]:
    if not path or not path.exists():
        return []
    text = load_text(path)
    pattern = re.compile(r"\bexport\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_][A-Za-z0-9_]*)")
    return sorted(set(pattern.findall(text)))


def build_issue(path: Path, line: int, kind: str, detail: str, suggestion: str, snippet: str = "") -> Dict:
    return {
        "path": str(path),
        "line": line,
        "type": kind,
        "kind_cn": ISSUE_TYPES.get(kind, kind),
        "detail": detail,
        "suggestion": suggestion,
        "snippet": snippet,
    }


def suggest_for_model(model: str, fixtures: List[str]) -> str:
    key = model.replace("_", "").lower()
    exact_match = KNOWN_FIXTURE_TOOLS.get(key)
    if exact_match:
        if exact_match in fixtures:
            return f"建议替换为 {exact_match}()"
        return f"建议在 fixtures.ts 新增并复用 {exact_match}()"
    return "建议在当前测试文件内抽成本地 helper；不要默认上收为全局 fixture"


def scan_file(path: Path, fixtures: List[str]) -> List[Dict]:
    text = load_text(path)
    lines = text.splitlines()
    issues: List[Dict] = []
    helper_lines = collect_local_helper_lines(lines)

    for i, line in enumerate(lines, start=1):
        for match in TITLE_PATTERN.finditer(line):
            name = match.group("name")
            if has_chinese(name):
                issues.append(
                    build_issue(
                        path=path,
                        line=i,
                        kind="e2e-chinese",
                        detail=f"检测到含中文标题: {name}",
                        suggestion="将中文标题翻译为英文（如 should ...）。",
                        snippet=match.group(0),
                    )
                )

        for match in PRISMA_PATTERN.finditer(line):
            if i in helper_lines:
                continue
            model = match.group("model")
            suggestion = suggest_for_model(model, fixtures)
            issue_type = "prisma-create" if model.replace("_", "").lower() in KNOWN_FIXTURE_TOOLS else "e2e-local-helper"
            issues.append(
                build_issue(
                    path=path,
                    line=i,
                    kind=issue_type,
                    detail=f"发现直接调用 prisma.{model}.create 族实现",
                    suggestion=suggestion,
                    snippet=line.strip(),
                )
            )

        if JWT_PATTERN.search(line):
            issues.append(
                build_issue(
                    path=path,
                    line=i,
                    kind="jwt-sign",
                    detail="发现手工调用 jwt.sign",
                    suggestion="建议使用 generateTestJwtToken(app, ...) 替代。",
                    snippet=line.strip(),
                )
            )

        if API_URL_PATTERN.search(line):
            if ("buildApiUrl(" not in line) and (REQUEST_CALL_PATTERN.search(line) or MANUAL_REQUEST_PATTERN.search(line)):
                issues.append(
                    build_issue(
                        path=path,
                        line=i,
                        kind="manual-api-url",
                        detail="发现 /api/ 片段未经过 buildApiUrl",
                        suggestion="建议使用 buildApiUrl(path) 统一拼接。",
                        snippet=line.strip(),
                    )
                )

        if "app.getHttpServer()" in line and REQUEST_CALL_PATTERN.search(line):
            issues.append(
                build_issue(
                    path=path,
                    line=i,
                    kind="manual-auth-request",
                    detail="发现 app.getHttpServer() 直接请求调用",
                    suggestion="建议优先使用 createAuthRequest(app, ...)、createAdminAuthRequest(app, ...) 或 createPublicRequest(app)。",
                    snippet=line.strip(),
                )
            )

    return issues


def collect_local_helper_lines(lines: List[str]) -> set[int]:
    helper_lines: set[int] = set()
    idx = 0
    total = len(lines)

    while idx < total:
        line = lines[idx]
        match = TOP_LEVEL_HELPER_PATTERN.match(line)
        multiline_match = TOP_LEVEL_HELPER_START_PATTERN.match(line)
        function_start_match = TOP_LEVEL_FUNCTION_START_PATTERN.match(line)
        if not match:
            if multiline_match:
                name = multiline_match.group("name") or ""
                if not name.startswith(HELPER_NAME_PREFIXES):
                    idx += 1
                    continue

                probe = idx
                arrow_line = line
                while probe + 1 < total and "=>" not in arrow_line:
                    probe += 1
                    arrow_line = lines[probe]

                if "=>" not in arrow_line:
                    idx += 1
                    continue

                block_start = probe
                end = probe + 1

                if "{" not in arrow_line:
                    while end <= total and not lines[end - 1].strip().endswith((")", "})", "})", ");", "),")):
                        end += 1
                    for lineno in range(idx + 1, min(end, total) + 1):
                        helper_lines.add(lineno)
                    idx = end
                    continue

                brace_depth = arrow_line.count("{") - arrow_line.count("}")
                while end < total and brace_depth > 0:
                    brace_depth += lines[end].count("{") - lines[end].count("}")
                    end += 1

                for lineno in range(idx + 1, min(end, total) + 1):
                    helper_lines.add(lineno)
                idx = end
                continue
            if function_start_match:
                name = function_start_match.group("name") or ""
                if not name.startswith(HELPER_NAME_PREFIXES):
                    idx += 1
                    continue

                probe = idx
                signature_line = line
                while probe + 1 < total and "{" not in signature_line:
                    probe += 1
                    signature_line = lines[probe]

                if "{" not in signature_line:
                    idx += 1
                    continue

                brace_depth = signature_line.count("{") - signature_line.count("}")
                end = probe + 1
                while end < total and brace_depth > 0:
                    brace_depth += lines[end].count("{") - lines[end].count("}")
                    end += 1

                for lineno in range(idx + 1, min(end, total) + 1):
                    helper_lines.add(lineno)
                idx = end
                continue
            idx += 1
            continue

        name = match.group("fn") or match.group("const") or ""
        if not name.startswith(HELPER_NAME_PREFIXES):
            idx += 1
            continue

        brace_depth = line.count("{") - line.count("}")
        start = idx + 1
        end = start
        probe = idx

        while probe + 1 < total and brace_depth > 0:
            probe += 1
            brace_depth += lines[probe].count("{") - lines[probe].count("}")
            end = probe + 1

        for lineno in range(start, end + 1):
            helper_lines.add(lineno)

        idx = probe + 1

    return helper_lines


def load_translation_map(path: Optional[str]) -> Dict[str, str]:
    if not path:
        return {}
    map_path = Path(path)
    if not map_path.exists():
        return {}
    data = json.loads(map_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def translate_batch_openai(texts: Iterable[str], api_key: str, model: str, endpoint: str) -> Dict[str, str]:
    items = list(dict.fromkeys([t for t in texts if t.strip()]))
    if not items:
        return {}

    prompt = (
        "You are a strict technical translator for test titles.\n"
        "Translate each input string to concise English test-case style.\n"
        "Only output JSON object: {\"translations\": {\"原文\": \"译文\", ...}}."
    )
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(items, ensure_ascii=False)},
        ],
    }

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        return parsed.get("translations", {})
    except (urllib.error.URLError, KeyError, ValueError):
        return {}


def infer_translation_map(issues: List[Dict], translation_map: Dict[str, str], use_openai: bool, args: argparse.Namespace) -> Dict[str, str]:
    if translation_map:
        return translation_map
    if not use_openai:
        return {}

    need = sorted(
        {
            i["detail"].split(": ", 1)[1]
            for i in issues
            if i["type"] == "e2e-chinese" and ": " in i["detail"]
        }
    )
    api_key = args.openai_key or os.environ.get("OPENAI_API_KEY")
    if not api_key or not need:
        return {}
    remote = translate_batch_openai(need, api_key=api_key, model=args.openai_model, endpoint=args.openai_endpoint)
    return remote


def apply_fixes(path: Path, issues: List[Dict], translations: Dict[str, str], dry_run: bool) -> Dict[str, int]:
    if not issues:
        return {"changed": 0, "title_fixed": 0, "todo_injected": 0}

    lines = path.read_text(encoding="utf-8").splitlines()
    added = {"changed": 0, "title_fixed": 0, "todo_injected": 0}
    issue_lines = sorted(issues, key=lambda i: i["line"], reverse=True)
    for issue in issue_lines:
        idx = issue["line"] - 1
        if idx < 0 or idx >= len(lines):
            continue
        line = lines[idx]
        if issue["type"] == "e2e-chinese" and "检测到含中文标题" in issue["detail"]:
            name = issue["detail"].replace("检测到含中文标题: ", "")
            target = translations.get(name)
            if not target:
                comment = f"{line}\n// TODO(e2e-chinese): 当前无翻译映射，后续替换为英文。"
                if "e2e-chinese" not in lines[max(0, idx - 1)]:
                    lines[idx] = comment
                    added["changed"] += 1
                    added["todo_injected"] += 1
                continue
            replaced = TITLE_PATTERN.sub(
                lambda m: (
                    f"{m.group('kind')}({m.group('quote')}{target}{m.group('quote')}"
                    if m.group("name") == name
                    else m.group(0)
                ),
                line,
                count=1,
            )
            if replaced != line:
                lines[idx] = replaced
                added["changed"] += 1
                added["title_fixed"] += 1
            continue

        if issue["type"] in {"prisma-create", "jwt-sign", "manual-api-url", "manual-auth-request"}:
            prefix = " " * (len(line) - len(line.lstrip(" ")))
            todo = f"{prefix}// TODO(e2e-fixtures): {issue['suggestion']}"
            if idx > 0 and todo.strip() == lines[idx - 1].strip():
                continue
            lines.insert(idx, todo)
            added["changed"] += 1
            added["todo_injected"] += 1

    if added["changed"] > 0:
        write_text(path, "\n".join(lines) + "\n", dry_run)
    return added


def main() -> None:
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    fixtures_path = Path(args.fixtures or (workspace / "apps" / "backend" / "e2e" / "fixtures" / "fixtures.ts"))
    fixture_exports = parse_fixture_exports(fixtures_path)

    glob_pattern = str(workspace / args.e2e_glob)
    files = sorted(glob.glob(glob_pattern, recursive=True))
    if not files:
        print("未发现匹配文件，请检查 workspace/e2e-glob 参数。")
        return

    total: List[Dict] = []
    for item in files:
        total.extend(scan_file(Path(item), fixture_exports))

    total = sorted(total, key=lambda x: (x["path"], x["line"], x["type"]))
    translation_map = load_translation_map(args.translation_map)
    remote_translations = infer_translation_map(total, translation_map, args.translate_service == "openai", args)
    if not translation_map:
        translation_map = remote_translations

    output = {
        "summary": {
            "count": len(total),
            "by_type": {t: sum(1 for i in total if i["type"] == t) for t in sorted({i["type"] for i in total})},
            "fixtures_file": str(fixtures_path),
            "fixtures_exports": fixture_exports,
        },
        "issues": total,
    }

    if args.output_json:
        Path(args.output_json).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.format == "json":
        if args.output_json:
            print(f"已导出: {args.output_json}")
        else:
            print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(f"扫描根目录: {workspace}")
        print(f"扫描范围: {args.e2e_glob}")
        print(f"fixtures 文件: {fixtures_path}")
        print(f"问题总数: {len(total)}")
        for t in sorted({i["type"] for i in total}):
            print(f"- {t}: {sum(1 for i in total if i['type'] == t)}")
        print("")
        for issue in total[:300]:
            print(f"{issue['path']}:{issue['line']} [{issue['type']}]")
            print(f"  {issue['detail']}")
            print(f"  建议: {issue['suggestion']}")
            if issue["snippet"]:
                print(f"  片段: {issue['snippet']}")
        if len(total) > 300:
            print(f"... 省略其余 {len(total) - 300} 条，建议加参数 output-json 落盘复核")

    if args.apply:
        by_path: Dict[str, List[Dict]] = {}
        for issue in total:
            by_path.setdefault(issue["path"], []).append(issue)

        stats = {"changed_files": 0, "changed": 0, "title_fixed": 0, "todo_injected": 0}
        for path_str, issues in by_path.items():
            rst = apply_fixes(Path(path_str), issues, translation_map, args.dry_run)
            if rst["changed"] > 0:
                stats["changed_files"] += 1
            stats["changed"] += rst["changed"]
            stats["title_fixed"] += rst["title_fixed"]
            stats["todo_injected"] += rst["todo_injected"]

        if args.dry_run:
            print(f"\n预演完成（未落盘）: {stats}")
        else:
            print(f"\n已应用修复: {stats}")


if __name__ == "__main__":
    main()
