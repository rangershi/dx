#!/usr/bin/env python3
import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


PAGINATION_KEYS = (
    "items",
    "data",
    "total",
    "page",
    "limit",
    "pageSize",
    "currentPage",
)

RESPONSE_HINTS = (
    "Pagination",
    "Paginated",
    "ListResponse",
    "PageResult",
)


@dataclass
class Finding:
    kind: str
    path: str
    line: int
    symbol: str
    message: str


@dataclass
class ClassBlock:
    name: str
    extends_name: str
    body: str
    start: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="审计 backend 分页 DTO 规范")
    parser.add_argument("--workspace", required=True, help="仓库根目录")
    parser.add_argument(
        "--include-glob",
        action="append",
        default=["apps/backend/src/**/*.ts"],
        help="附加扫描 glob，可重复传入",
    )
    parser.add_argument("--output-json", help="输出 JSON 文件路径")
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


def has_pagination_signal(block: str) -> bool:
    hit_count = sum(1 for key in PAGINATION_KEYS if re.search(rf"\b{re.escape(key)}\b", block))
    has_total = re.search(r"\btotal\b", block) is not None
    has_items_or_data = re.search(r"\b(items|data)\b", block) is not None
    has_page_signal = re.search(r"\b(page|limit|pageSize|currentPage)\b", block) is not None
    return hit_count >= 3 and has_total and has_items_or_data and has_page_signal


def line_no(content: str, index: int) -> int:
    return content.count("\n", 0, index) + 1


def iter_export_classes(content: str) -> list[ClassBlock]:
    header_pattern = re.compile(
        r"export\s+class\s+(?P<name>\w+)\s*(?:extends\s+(?P<extends>[^{\n]+))?\s*{",
        re.MULTILINE,
    )
    classes: list[ClassBlock] = []
    for match in header_pattern.finditer(content):
        brace_start = match.end() - 1
        depth = 0
        index = brace_start
        while index < len(content):
            char = content[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    body = content[brace_start + 1 : index]
                    classes.append(
                        ClassBlock(
                            name=match.group("name"),
                            extends_name=(match.group("extends") or "").strip(),
                            body=body,
                            start=match.start(),
                        )
                    )
                    break
            index += 1
    return classes


def scan_request_dtos(path: Path, content: str) -> list[Finding]:
    findings: list[Finding] = []
    path_text = str(path)
    is_dto_file = "/dto/" in path_text or path.name.endswith(".dto.ts")
    for class_block in iter_export_classes(content):
        name = class_block.name
        extends_name = class_block.extends_name
        body = class_block.body
        if not is_dto_file:
            continue
        if "/responses/" in path_text or ".response." in path.name or "Response" in name:
            continue
        if not name.endswith("Dto"):
            continue
        if name == "BasePaginationRequestDto":
            continue
        if extends_name == "BasePaginationRequestDto":
            continue
        if not re.search(r"\b(page|limit|pageSize|currentPage)\b", body):
            continue
        findings.append(
            Finding(
                kind="request-dto-not-standard",
                path=str(path),
                line=line_no(content, class_block.start),
                symbol=name,
                message="请求 DTO 包含分页字段，但未继承 BasePaginationRequestDto",
            )
        )
    return findings


def scan_response_dtos(path: Path, content: str) -> list[Finding]:
    findings: list[Finding] = []
    path_text = str(path)
    is_dto_file = "/dto/" in path_text or path.name.endswith(".dto.ts")
    for class_block in iter_export_classes(content):
        name = class_block.name
        extends_name = class_block.extends_name
        body = class_block.body
        if not is_dto_file:
            continue
        if (
            "/requests/" in path_text
            or ".request." in path.name
            or "Request" in name
            or name == "BasePaginationRequestDto"
        ):
            continue
        if "BasePaginationResponseDto" in extends_name:
            continue
        if not (has_pagination_signal(body) or any(hint in name for hint in RESPONSE_HINTS)):
            continue
        findings.append(
            Finding(
                kind="response-dto-not-standard",
                path=str(path),
                line=line_no(content, class_block.start),
                symbol=name,
                message="响应 DTO 命中分页信号，但未继承 BasePaginationResponseDto",
            )
        )
    return findings


def scan_manual_returns(path: Path, content: str) -> list[Finding]:
    findings: list[Finding] = []
    return_pattern = re.compile(r"return\s*{(?P<body>[\s\S]*?)}", re.MULTILINE)
    for match in return_pattern.finditer(content):
        body = match.group("body")
        if not has_pagination_signal(body):
            continue
        findings.append(
            Finding(
                kind="manual-pagination-return",
                path=str(path),
                line=line_no(content, match.start()),
                symbol="return",
                message="检测到手工拼装分页返回结构，建议改为统一分页 DTO",
            )
        )
    return findings


def scan_file(path: Path) -> list[Finding]:
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    findings: list[Finding] = []
    findings.extend(scan_request_dtos(path, content))
    findings.extend(scan_response_dtos(path, content))
    findings.extend(scan_manual_returns(path, content))
    return findings


def print_report(findings: list[Finding]) -> None:
    if not findings:
        print("未发现疑似非标准分页 DTO 或手工分页返回结构。")
        return
    grouped: dict[str, list[Finding]] = {}
    for finding in findings:
        grouped.setdefault(finding.kind, []).append(finding)
    print(f"共发现 {len(findings)} 个问题：")
    for kind in sorted(grouped):
        print(f"\n[{kind}] {len(grouped[kind])} 个")
        for finding in grouped[kind]:
            print(f"- {finding.path}:{finding.line} {finding.symbol} -> {finding.message}")


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    files = iter_files(workspace, args.include_glob)
    findings: list[Finding] = []
    for path in files:
        findings.extend(scan_file(path))
    print_report(findings)
    if args.output_json:
        output = Path(args.output_json)
        output.write_text(
            json.dumps([asdict(finding) for finding in findings], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"\nJSON 已输出到 {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
