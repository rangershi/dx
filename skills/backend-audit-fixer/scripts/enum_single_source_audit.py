#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_SCAN_GLOBS = (
    "apps/backend/src/**/*.ts",
    "packages/shared/src/**/*.ts",
)

EXCLUDED_PARTS = (
    "/generated/",
    ".spec.ts",
    ".test.ts",
    ".e2e-spec.ts",
    ".d.ts",
)

ALLOWED_GENERATED_ENUM_FILE = "packages/shared/src/generated/prisma-enums.ts"


@dataclass
class PrismaEnum:
    name: str
    values: list[str]
    source_file: str
    line: int


@dataclass
class Finding:
    rule: str
    file: str
    line: int
    symbol: str
    prisma_enum: str
    verdict: str
    note: str
    snippet: str


def line_no(content: str, index: int) -> int:
    return content.count("\n", 0, index) + 1


def parse_prisma_enums(schema_dir: Path) -> dict[str, PrismaEnum]:
    enums: dict[str, PrismaEnum] = {}
    enum_pattern = re.compile(r"^enum\s+(\w+)\s*\{(?P<body>[\s\S]*?)^\}", re.MULTILINE)
    for path in sorted(schema_dir.glob("*.prisma")):
        content = path.read_text(encoding="utf-8")
        for match in enum_pattern.finditer(content):
            name = match.group(1)
            values: list[str] = []
            for raw_line in match.group("body").splitlines():
                line = raw_line.split("//", 1)[0].strip()
                if not line or line.startswith("@@") or line.startswith("@"):
                    continue
                value = re.sub(r"\s+@.*$", "", line).strip()
                if value:
                    values.append(value)
            enums[name] = PrismaEnum(
                name=name,
                values=values,
                source_file=str(path),
                line=line_no(content, match.start()),
            )
    return enums


def iter_scan_files(workspace: Path, globs: Iterable[str]) -> list[Path]:
    seen: set[Path] = set()
    files: list[Path] = []
    for pattern in globs:
        for path in workspace.glob(pattern):
            if not path.is_file() or path in seen:
                continue
            rel = path.relative_to(workspace).as_posix()
            if any(part in rel for part in EXCLUDED_PARTS):
                continue
            seen.add(path)
            files.append(path)
    return sorted(files)


def parse_ts_enum_values(body: str) -> list[str]:
    values: list[str] = []
    for raw_line in body.splitlines():
        line = raw_line.split("//", 1)[0].strip().rstrip(",")
        if not line:
            continue
        literal_match = re.search(r"=\s*['\"]([^'\"]+)['\"]", line)
        if literal_match:
            values.append(literal_match.group(1))
            continue
        name_match = re.match(r"([A-Za-z_]\w*)", line)
        if name_match:
            values.append(name_match.group(1))
    return values


def normalized_name(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def best_matching_prisma_enum(
    symbol: str,
    values: list[str],
    prisma_enums: dict[str, PrismaEnum],
) -> tuple[str, str] | None:
    value_set = set(values)
    symbol_norm = normalized_name(symbol)
    for enum in prisma_enums.values():
        enum_values = set(enum.values)
        if value_set and value_set == enum_values:
            return enum.name, "exact-values"
        if value_set and len(value_set) >= 2 and value_set.issubset(enum_values):
            return enum.name, "subset-values"
        if symbol_norm == normalized_name(enum.name):
            return enum.name, "name-match"
    return None


def redeclared_enum_note(enum_name: str, reason: str) -> str:
    if reason == "name-match":
        return (
            f"TypeScript enum has the same name as Prisma enum {enum_name}; open the source and compare values/semantics "
            "before deciding whether to replace it with the generated @ai/shared enum."
        )
    return f"TypeScript enum matches Prisma enum by {reason}; import generated @ai/shared enum instead."


def collect_string_literals(text: str) -> list[str]:
    return re.findall(r"['\"]([A-Za-z0-9_:-]+)['\"]", text)


def scan_ts_enum_declarations(
    rel: str,
    content: str,
    prisma_enums: dict[str, PrismaEnum],
) -> list[Finding]:
    findings: list[Finding] = []
    pattern = re.compile(r"(?:export\s+)?enum\s+(\w+)\s*\{(?P<body>[\s\S]*?)\}", re.MULTILINE)
    for match in pattern.finditer(content):
        symbol = match.group(1)
        values = parse_ts_enum_values(match.group("body"))
        matched = best_matching_prisma_enum(symbol, values, prisma_enums)
        if not matched:
            continue
        enum_name, reason = matched
        findings.append(
            Finding(
                rule="db-enum-redeclared",
                file=rel,
                line=line_no(content, match.start()),
                symbol=symbol,
                prisma_enum=enum_name,
                verdict="candidate",
                note=redeclared_enum_note(enum_name, reason),
                snippet=content[match.start() : match.end()].splitlines()[0].strip(),
            )
        )
    return findings


def scan_literal_enum_arrays(
    rel: str,
    content: str,
    prisma_enums: dict[str, PrismaEnum],
) -> list[Finding]:
    findings: list[Finding] = []
    pattern = re.compile(
        r"(?:export\s+)?const\s+(\w+)\s*=\s*\[(?P<body>[\s\S]*?)\]\s*(?:as\s+const)?",
        re.MULTILINE,
    )
    for match in pattern.finditer(content):
        symbol = match.group(1)
        body = match.group("body")
        if "Object.values(" in body:
            continue
        values = collect_string_literals(body)
        matched = best_matching_prisma_enum(symbol, values, prisma_enums)
        if not matched:
            continue
        enum_name, reason = matched
        findings.append(
            Finding(
                rule="db-enum-values-duplicated",
                file=rel,
                line=line_no(content, match.start()),
                symbol=symbol,
                prisma_enum=enum_name,
                verdict="candidate",
                note=f"Literal value array matches Prisma enum by {reason}; derive with Object.values({enum_name}) from generated shared enum.",
                snippet=content[match.start() : match.end()].splitlines()[0].strip(),
            )
        )
    return findings


def scan_swagger_literal_enums(
    rel: str,
    content: str,
    prisma_enums: dict[str, PrismaEnum],
) -> list[Finding]:
    findings: list[Finding] = []
    pattern = re.compile(r"enum\s*:\s*\[(?P<body>[^\]]+)\]", re.MULTILINE)
    for match in pattern.finditer(content):
        values = collect_string_literals(match.group("body"))
        matched = best_matching_prisma_enum("swagger-enum", values, prisma_enums)
        if not matched:
            continue
        enum_name, reason = matched
        findings.append(
            Finding(
                rule="swagger-db-enum-literal",
                file=rel,
                line=line_no(content, match.start()),
                symbol="ApiProperty.enum",
                prisma_enum=enum_name,
                verdict="candidate",
                note=f"Swagger literal enum matches Prisma enum by {reason}; reference generated enum or derived values instead.",
                snippet=content[match.start() : match.end()].replace("\n", " ").strip(),
            )
        )
    return findings


def scan_prisma_client_enum_imports(
    rel: str,
    content: str,
    prisma_enums: dict[str, PrismaEnum],
) -> list[Finding]:
    findings: list[Finding] = []
    pattern = re.compile(r"import\s*\{(?P<body>[^}]+)\}\s*from\s*['\"]@prisma/client['\"]")
    for match in pattern.finditer(content):
        imported = [part.strip().split(" as ", 1)[0].strip() for part in match.group("body").split(",")]
        for symbol in imported:
            if symbol not in prisma_enums:
                continue
            findings.append(
                Finding(
                    rule="db-enum-imported-from-prisma-client",
                    file=rel,
                    line=line_no(content, match.start()),
                    symbol=symbol,
                    prisma_enum=symbol,
                    verdict="candidate",
                    note="DB enum should flow through generated @ai/shared prisma-enums, not direct @prisma/client imports.",
                    snippet=content[match.start() : match.end()].strip(),
                )
            )
    return findings


def check_generated_file(workspace: Path, prisma_enums: dict[str, PrismaEnum]) -> list[Finding]:
    generated = workspace / ALLOWED_GENERATED_ENUM_FILE
    if not generated.exists():
        return [
            Finding(
                rule="generated-prisma-enums-missing",
                file=ALLOWED_GENERATED_ENUM_FILE,
                line=0,
                symbol="generated-prisma-enums",
                prisma_enum="*",
                verdict="real",
                note="Generated Prisma enum file is missing; run the project enum generation command.",
                snippet="",
            )
        ]

    content = generated.read_text(encoding="utf-8")
    findings: list[Finding] = []
    for enum in prisma_enums.values():
        object_match = re.search(
            rf"export\s+const\s+{re.escape(enum.name)}\s*=\s*\{{(?P<body>[\s\S]*?)\}}\s*as\s+const",
            content,
        )
        if not object_match:
            findings.append(
                Finding(
                    rule="generated-prisma-enum-missing",
                    file=ALLOWED_GENERATED_ENUM_FILE,
                    line=0,
                    symbol=enum.name,
                    prisma_enum=enum.name,
                    verdict="real",
                    note="Prisma enum is not present in generated shared output; regenerate enums.",
                    snippet="",
                )
            )
            continue
        generated_values = collect_string_literals(object_match.group("body"))
        if set(generated_values) != set(enum.values):
            findings.append(
                Finding(
                    rule="generated-prisma-enum-stale",
                    file=ALLOWED_GENERATED_ENUM_FILE,
                    line=line_no(content, object_match.start()),
                    symbol=enum.name,
                    prisma_enum=enum.name,
                    verdict="real",
                    note="Generated shared enum values differ from Prisma schema; regenerate enums.",
                    snippet=f"generated={generated_values} prisma={enum.values}",
                )
            )
    return findings


def scan_file(path: Path, workspace: Path, prisma_enums: dict[str, PrismaEnum]) -> list[Finding]:
    rel = path.relative_to(workspace).as_posix()
    if rel == ALLOWED_GENERATED_ENUM_FILE:
        return []
    content = path.read_text(encoding="utf-8")
    findings: list[Finding] = []
    findings.extend(scan_ts_enum_declarations(rel, content, prisma_enums))
    findings.extend(scan_literal_enum_arrays(rel, content, prisma_enums))
    findings.extend(scan_swagger_literal_enums(rel, content, prisma_enums))
    findings.extend(scan_prisma_client_enum_imports(rel, content, prisma_enums))
    return findings


def summarize(findings: list[Finding]) -> dict[str, int]:
    by_rule: dict[str, int] = {}
    for finding in findings:
        by_rule[finding.rule] = by_rule.get(finding.rule, 0) + 1
    return by_rule


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="审计 Prisma/业务枚举唯一真源约束")
    parser.add_argument("--workspace", required=True, help="仓库根目录")
    parser.add_argument(
        "--schema-dir",
        default="apps/backend/prisma/schema",
        help="Prisma schema 目录，默认 apps/backend/prisma/schema",
    )
    parser.add_argument(
        "--include-glob",
        action="append",
        help="附加扫描 glob；默认扫描 apps/backend/src/**/*.ts 与 packages/shared/src/**/*.ts",
    )
    parser.add_argument("--output-json", help="输出 JSON 文件路径")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    schema_dir = (workspace / args.schema_dir).resolve()
    scan_globs = tuple(args.include_glob) if args.include_glob else DEFAULT_SCAN_GLOBS

    prisma_enums = parse_prisma_enums(schema_dir)
    findings = check_generated_file(workspace, prisma_enums)
    for path in iter_scan_files(workspace, scan_globs):
        findings.extend(scan_file(path, workspace, prisma_enums))

    report = {
        "dimension": "enum-single-source",
        "workspace": str(workspace),
        "schema_dir": str(schema_dir),
        "scan_globs": list(scan_globs),
        "prisma_enum_count": len(prisma_enums),
        "total": len(findings),
        "by_rule": summarize(findings),
        "violations": [asdict(finding) for finding in findings],
    }

    if findings:
        print(f"共发现 {len(findings)} 个枚举唯一真源候选问题：")
        for finding in findings:
            print(f"- {finding.file}:{finding.line} [{finding.rule}] {finding.symbol} -> {finding.note}")
    else:
        print("未发现枚举唯一真源候选问题。")

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\nJSON 已输出到 {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
