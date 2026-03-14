#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


NEST_EXCEPTION_NAMES = (
    "BadRequestException",
    "UnauthorizedException",
    "ForbiddenException",
    "NotFoundException",
    "HttpException",
    "InternalServerErrorException",
)

BUSINESS_HINTS = {
    "balance": "InsufficientBalanceException",
    "wallet": "WalletException",
    "permission": "PermissionDeniedException",
    "forbidden": "PermissionDeniedException",
    "unauthorized": "UnauthorizedOperationException",
    "not found": "ResourceNotFoundException",
    "duplicate": "DuplicateResourceException",
    "conflict": "ConflictException",
    "quota": "QuotaExceededException",
    "limit": "LimitExceededException",
    "expired": "ExpiredException",
    "invalid": "InvalidOperationException",
}

CHINESE_PATTERN = re.compile(r"[\u4e00-\u9fff]")


@dataclass
class Finding:
    kind: str
    path: str
    line: int
    symbol: str
    message: str
    suggestion: str
    suggested_exception: str | None = None


@dataclass
class FoundationStatus:
    has_domain_exception: bool
    has_error_code: bool
    has_exception_filters: bool
    has_module_exceptions_dir: bool
    has_structured_request_id_signal: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="审计后端错误处理是否绕过 DomainException / ErrorCode 体系")
    parser.add_argument("--workspace", required=True, help="仓库根目录")
    parser.add_argument(
        "--include-glob",
        action="append",
        default=None,
        help="附加扫描 glob，可重复传入",
    )
    parser.add_argument(
        "--scope",
        choices=["all", "src", "e2e"],
        default="all",
        help="预设扫描范围：all=src+e2e，src=仅生产代码，e2e=仅测试代码",
    )
    parser.add_argument("--output-json", help="输出 JSON 文件路径")
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="输出格式，默认 text",
    )
    return parser.parse_args()


def iter_files(workspace: Path, globs: Iterable[str]) -> list[Path]:
    seen: set[Path] = set()
    files: list[Path] = []
    for pattern in globs:
        for path in workspace.glob(pattern):
            if not path.is_file():
                continue
            if path in seen:
                continue
            seen.add(path)
            files.append(path)
    return sorted(files)


def should_skip(path: Path) -> bool:
    path_text = path.as_posix()
    if path_text.endswith(".spec.ts"):
        return True
    if path_text.endswith(".exception.ts"):
        return True
    if path_text == "apps/backend/src/main.ts":
        return True
    if path_text.startswith("apps/backend/src/common/filters/"):
        return True
    if path_text.startswith("apps/backend/src/common/exceptions/"):
        return True
    return False


def line_no(content: str, index: int) -> int:
    return content.count("\n", 0, index) + 1


def default_globs_for_scope(scope: str) -> list[str]:
    if scope == "src":
        return ["apps/backend/src/**/*.ts"]
    if scope == "e2e":
        return ["apps/backend/e2e/**/*.ts"]
    return ["apps/backend/src/**/*.ts", "apps/backend/e2e/**/*.ts"]


def safe_read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ""


def mask_comments_and_strings(content: str) -> str:
    chars = list(content)
    i = 0
    length = len(chars)
    state = "normal"
    template_depth = 0

    while i < length:
      ch = chars[i]
      nxt = chars[i + 1] if i + 1 < length else ""

      if state == "normal":
          if ch == "/" and nxt == "/":
              chars[i] = " "
              chars[i + 1] = " "
              i += 2
              state = "line_comment"
              continue
          if ch == "/" and nxt == "*":
              chars[i] = " "
              chars[i + 1] = " "
              i += 2
              state = "block_comment"
              continue
          if ch == "'":
              chars[i] = " "
              i += 1
              state = "single_quote"
              continue
          if ch == '"':
              chars[i] = " "
              i += 1
              state = "double_quote"
              continue
          if ch == "`":
              chars[i] = " "
              i += 1
              state = "template"
              template_depth = 0
              continue
          i += 1
          continue

      if state == "line_comment":
          if ch != "\n":
              chars[i] = " "
          else:
              state = "normal"
          i += 1
          continue

      if state == "block_comment":
          if ch == "*" and nxt == "/":
              chars[i] = " "
              chars[i + 1] = " "
              i += 2
              state = "normal"
              continue
          if ch != "\n":
              chars[i] = " "
          i += 1
          continue

      if state == "single_quote":
          if ch == "\\" and i + 1 < length:
              chars[i] = " "
              if chars[i + 1] != "\n":
                  chars[i + 1] = " "
              i += 2
              continue
          if ch == "'":
              chars[i] = " "
              i += 1
              state = "normal"
              continue
          if ch != "\n":
              chars[i] = " "
          i += 1
          continue

      if state == "double_quote":
          if ch == "\\" and i + 1 < length:
              chars[i] = " "
              if chars[i + 1] != "\n":
                  chars[i + 1] = " "
              i += 2
              continue
          if ch == '"':
              chars[i] = " "
              i += 1
              state = "normal"
              continue
          if ch != "\n":
              chars[i] = " "
          i += 1
          continue

      if state == "template":
          if ch == "\\" and i + 1 < length:
              chars[i] = " "
              if chars[i + 1] != "\n":
                  chars[i + 1] = " "
              i += 2
              continue
          if ch == "`" and template_depth == 0:
              chars[i] = " "
              i += 1
              state = "normal"
              continue
          if ch == "$" and nxt == "{":
              chars[i] = " "
              chars[i + 1] = "{"
              template_depth += 1
              i += 2
              continue
          if ch == "}" and template_depth > 0:
              template_depth -= 1
              i += 1
              continue
          if ch != "\n":
              chars[i] = " "
          i += 1
          continue

    return "".join(chars)


def find_balanced_call_end(masked_content: str, open_paren_index: int) -> int | None:
    depth = 0
    for index in range(open_paren_index, len(masked_content)):
        ch = masked_content[index]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return index
    return None


def find_constructor_calls(content: str, constructor_name: str) -> list[tuple[int, int]]:
    masked_content = mask_comments_and_strings(content)
    pattern = re.compile(rf"new\s+{re.escape(constructor_name)}\s*\(")
    matches: list[tuple[int, int]] = []
    for match in pattern.finditer(masked_content):
        open_paren_index = masked_content.find("(", match.start())
        if open_paren_index == -1:
            continue
        end_index = find_balanced_call_end(masked_content, open_paren_index)
        if end_index is None:
            continue
        matches.append((match.start(), end_index + 1))
    return matches


def collect_foundation_status(workspace: Path) -> FoundationStatus:
    backend_root = workspace / "apps/backend/src"
    all_ts_files = sorted(backend_root.glob("**/*.ts"))
    has_domain_exception = False
    has_error_code = False
    has_exception_filters = False
    has_module_exceptions_dir = False
    has_structured_request_id_signal = False

    for path in all_ts_files:
        path_text = path.as_posix()
        content = safe_read_text(path)
        if not content:
            continue
        if re.search(r"\bclass\s+DomainException\b", content):
            has_domain_exception = True
        if re.search(r"\b(enum|const)\s+ErrorCode\b", content) or re.search(r"\bErrorCode\.[A-Z0-9_]+\b", content):
            has_error_code = True
        if "/filters/" in path_text and re.search(r"ExceptionFilter|Catch\s*\(", content):
            has_exception_filters = True
        if "/exceptions/" in path_text and not path_text.startswith("apps/backend/src/common/exceptions/"):
            has_module_exceptions_dir = True
        if "requestId" in content and re.search(r"\b(args|code)\b", content):
            has_structured_request_id_signal = True

    return FoundationStatus(
        has_domain_exception=has_domain_exception,
        has_error_code=has_error_code,
        has_exception_filters=has_exception_filters,
        has_module_exceptions_dir=has_module_exceptions_dir,
        has_structured_request_id_signal=has_structured_request_id_signal,
    )


def infer_exception_name(snippet: str) -> str | None:
    lowered = snippet.lower()
    for keyword, name in BUSINESS_HINTS.items():
        if keyword in lowered:
            return name
    if CHINESE_PATTERN.search(snippet):
        if "余额" in snippet:
            return "InsufficientBalanceException"
        if "权限" in snippet:
            return "PermissionDeniedException"
        if "不存在" in snippet or "未找到" in snippet:
            return "ResourceNotFoundException"
        if "过期" in snippet:
            return "ExpiredException"
        if "重复" in snippet:
            return "DuplicateResourceException"
    return None


def build_suggestion(kind: str, snippet: str, inferred_exception: str | None) -> str:
    if kind == "nest-standard-exception":
        if inferred_exception:
            return f"优先检查模块 exceptions/ 是否已有同义异常；若无，建议改为新增或复用 {inferred_exception}"
        return "优先复用模块 exceptions/ 中已有领域异常；若无，再新增专用异常类，不要继续直接抛 Nest 标准异常"
    if kind == "raw-error":
        if inferred_exception:
            return f"建议改为抛出领域异常，如 {inferred_exception}；若暂时无法抽类，至少改为带 code 的 DomainException"
        return "建议改为模块领域异常；若暂时无法抽类，至少改为带 code 与 args 的 DomainException"
    if kind == "domain-exception-missing-code":
        return "补齐 ErrorCode，并把必要上下文放入 args；若该语义重复出现，建议抽专用异常类"
    if kind == "domain-exception-chinese-message":
        return "避免直接返回中文 message，优先改为稳定 message key 或内部标识，并通过 ErrorCode + args 透出语义"
    return f"建议复核该写法：{snippet.strip()}"


def scan_nest_standard_exceptions(path: Path, content: str) -> list[Finding]:
    findings: list[Finding] = []
    masked_content = mask_comments_and_strings(content)
    pattern = re.compile(
        rf"new\s+(?P<name>{'|'.join(NEST_EXCEPTION_NAMES)})\s*\(",
        re.MULTILINE,
    )
    for match in pattern.finditer(masked_content):
        snippet = content[match.start() : min(len(content), match.start() + 220)]
        inferred_exception = infer_exception_name(snippet)
        findings.append(
            Finding(
                kind="nest-standard-exception",
                path=str(path),
                line=line_no(content, match.start()),
                symbol=match.group("name"),
                message="检测到业务代码直接实例化 Nest 标准异常，疑似绕过 DomainException / ErrorCode 体系",
                suggestion=build_suggestion("nest-standard-exception", snippet, inferred_exception),
                suggested_exception=inferred_exception,
            )
        )
    return findings


def scan_raw_error(path: Path, content: str) -> list[Finding]:
    findings: list[Finding] = []
    masked_content = mask_comments_and_strings(content)
    pattern = re.compile(r"new\s+Error\s*\(", re.MULTILINE)
    for match in pattern.finditer(masked_content):
        snippet = content[max(0, match.start() - 40) : min(len(content), match.start() + 220)]
        inferred_exception = infer_exception_name(snippet)
        findings.append(
            Finding(
                kind="raw-error",
                path=str(path),
                line=line_no(content, match.start()),
                symbol="Error",
                message="检测到直接创建 Error，缺少稳定 ErrorCode 和结构化上下文",
                suggestion=build_suggestion("raw-error", snippet, inferred_exception),
                suggested_exception=inferred_exception,
            )
        )
    return findings


def scan_domain_exception_missing_code(path: Path, content: str) -> list[Finding]:
    findings: list[Finding] = []
    for start, end in find_constructor_calls(content, "DomainException"):
        snippet = content[start:end]
        body = snippet[snippet.find("(") + 1 : snippet.rfind(")")]
        if "code:" in body or "code :" in body:
            continue
        findings.append(
            Finding(
                kind="domain-exception-missing-code",
                path=str(path),
                line=line_no(content, start),
                symbol="DomainException",
                message="检测到 DomainException 未显式提供 ErrorCode",
                suggestion=build_suggestion("domain-exception-missing-code", snippet[:240], None),
                suggested_exception=None,
            )
        )
    return findings


def scan_domain_exception_chinese_message(path: Path, content: str) -> list[Finding]:
    findings: list[Finding] = []
    for start, end in find_constructor_calls(content, "DomainException"):
        snippet = content[start:end]
        body = snippet[snippet.find("(") + 1 : snippet.rfind(")")]
        if not CHINESE_PATTERN.search(body):
            continue
        findings.append(
            Finding(
                kind="domain-exception-chinese-message",
                path=str(path),
                line=line_no(content, start),
                symbol="DomainException",
                message="检测到 DomainException 直接携带中文 message，后端可能在决定展示文案",
                suggestion=build_suggestion("domain-exception-chinese-message", snippet[:240], None),
                suggested_exception=None,
            )
        )
    return findings


def scan_file(path: Path) -> list[Finding]:
    content = safe_read_text(path)
    if not content:
        return []
    findings: list[Finding] = []
    findings.extend(scan_nest_standard_exceptions(path, content))
    findings.extend(scan_raw_error(path, content))
    findings.extend(scan_domain_exception_missing_code(path, content))
    findings.extend(scan_domain_exception_chinese_message(path, content))
    return findings


def build_summary(foundations: FoundationStatus) -> list[str]:
    summary: list[str] = []
    if not foundations.has_domain_exception:
        summary.append("缺少 DomainException")
    if not foundations.has_error_code:
        summary.append("缺少 ErrorCode")
    if not foundations.has_exception_filters:
        summary.append("缺少可识别的异常过滤器")
    if not foundations.has_module_exceptions_dir:
        summary.append("缺少模块 exceptions/ 目录信号")
    if not foundations.has_structured_request_id_signal:
        summary.append("缺少 requestId + 结构化错误字段信号")
    return summary


def print_report(foundations: FoundationStatus, findings: list[Finding]) -> None:
    foundation_gaps = build_summary(foundations)
    print("基础设施状态：")
    print(f"- DomainException: {'是' if foundations.has_domain_exception else '否'}")
    print(f"- ErrorCode: {'是' if foundations.has_error_code else '否'}")
    print(f"- 异常过滤器: {'是' if foundations.has_exception_filters else '否'}")
    print(f"- 模块 exceptions 目录: {'是' if foundations.has_module_exceptions_dir else '否'}")
    print(f"- requestId 结构化信号: {'是' if foundations.has_structured_request_id_signal else '否'}")

    if foundation_gaps:
        print("\n基础设施缺口：")
        for item in foundation_gaps:
            print(f"- {item}")
        print("- 结论：建议先补齐基础设施，再决定是否批量修复业务代码")
    else:
        print("\n基础设施结论：已检测到基础设施信号，可继续推进违规抛错治理")

    if not findings:
        print("\n未发现命中项。")
        return

    grouped: dict[str, list[Finding]] = {}
    for finding in findings:
        grouped.setdefault(finding.kind, []).append(finding)

    print(f"\n共发现 {len(findings)} 个问题：")
    for kind in sorted(grouped):
        print(f"\n[{kind}] {len(grouped[kind])} 个")
        for finding in grouped[kind]:
            suggestion = finding.suggestion
            if finding.suggested_exception:
                suggestion = f"{suggestion}（推断异常：{finding.suggested_exception}）"
            print(f"- {finding.path}:{finding.line} {finding.symbol} -> {finding.message}")
            print(f"  建议：{suggestion}")


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    globs = args.include_glob or default_globs_for_scope(args.scope)
    files = [path for path in iter_files(workspace, globs) if not should_skip(path.relative_to(workspace))]
    foundations = collect_foundation_status(workspace)

    findings: list[Finding] = []
    for path in files:
        findings.extend(scan_file(path))

    payload = {
        "foundation": asdict(foundations),
        "foundation_gaps": build_summary(foundations),
        "findings": [asdict(finding) for finding in findings],
    }

    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_report(foundations, findings)

    if args.output_json:
        output = Path(args.output_json)
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.format != "json":
            print(f"\nJSON 已输出到 {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
