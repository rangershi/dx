#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_SCAN_DIRS = ["apps/backend/src", "apps/backend/e2e"]
EXCLUDED_GLOBS = ["!*env.accessor.ts", "!*env.service.ts"]


def run_rg(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        ["rg", *args],
        cwd=str(cwd),
        text=True,
        capture_output=True,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or "rg failed")
    return result.stdout


def rg_has_matches(pattern: str, paths: list[str], cwd: Path) -> bool:
    output = run_rg(["-l", pattern, *paths], cwd)
    return bool(output.strip())


def detect_foundation(workspace: Path) -> dict[str, Any]:
    search_paths = ["apps/backend/src", "apps/backend/e2e"]
    file_hits = {
        "env_accessor_file": run_rg(["-l", r"export function createEnvAccessor", *search_paths], workspace)
        .strip()
        .splitlines(),
        "default_accessor_usage": run_rg(["-l", r"defaultEnvAccessor", *search_paths], workspace)
        .strip()
        .splitlines(),
        "env_service_file": run_rg(["-l", r"export class EnvService", *search_paths], workspace)
        .strip()
        .splitlines(),
        "env_service_usage": run_rg(["-l", r"\bEnvService\b", *search_paths], workspace)
        .strip()
        .splitlines(),
        "config_registeras_usage": run_rg(["-l", r"registerAs\(", "apps/backend/src"], workspace)
        .strip()
        .splitlines(),
    }
    file_hits = {key: [line for line in value if line] for key, value in file_hits.items()}

    foundation = {
        "has_create_env_accessor": bool(file_hits["env_accessor_file"]),
        "has_default_env_accessor": bool(file_hits["default_accessor_usage"]),
        "has_env_service": bool(file_hits["env_service_file"]),
        "has_register_as_config": bool(file_hits["config_registeras_usage"]),
        "recommended_mode": "reuse-existing-foundation"
        if (
            bool(file_hits["env_accessor_file"])
            or bool(file_hits["default_accessor_usage"])
            or bool(file_hits["env_service_file"])
        )
        else "bootstrap-foundation",
        "evidence": file_hits,
    }
    return foundation


def collect_process_env_findings(workspace: Path, scan_dirs: list[str]) -> list[dict[str, Any]]:
    args = ["-n", "--column", "process\\.env", *scan_dirs]
    for glob in EXCLUDED_GLOBS:
        args.extend(["--glob", glob])
    output = run_rg(args, workspace)

    findings: list[dict[str, Any]] = []
    for line in output.strip().splitlines():
        if not line:
            continue
        parts = line.split(":", 3)
        if len(parts) != 4:
            continue
        file_path, line_no, column_no, snippet = parts
        if is_allowed_process_env_usage(file_path, snippet):
            continue
        findings.append(
            {
                "file": file_path,
                "line": int(line_no),
                "column": int(column_no),
                "snippet": snippet.strip(),
                "kind": classify_finding(file_path),
                "recommended_fix": recommend_fix(file_path),
            }
        )
    return findings


def is_allowed_process_env_usage(file_path: str, snippet: str) -> bool:
    normalized = snippet.replace(" ", "")
    if file_path.endswith("test-env.helper.ts"):
        return True
    if file_path.endswith("load-environment.ts"):
        return True
    if file_path.endswith("export-openapi.ts"):
        return True
    if file_path.endswith("setup-e2e.ts"):
        return True
    if file_path.endswith("fixtures.ts"):
        return True
    if file_path.endswith("stream-session.guard.e2e-spec.ts") and "{process.env." in snippet:
        return True
    if "createEnvAccessor(process.env)" in normalized:
        return True
    if "defaultEnvAccessor=createEnvAccessor(process.env)" in normalized:
        return True
    return False


def classify_finding(file_path: str) -> str:
    if "/e2e/" in file_path or file_path.endswith(".spec.ts"):
        return "test-or-e2e"
    if "/config/" in file_path or file_path.endswith(".config.ts"):
        return "config"
    if file_path.endswith(".ts"):
        return "runtime"
    return "unknown"


def recommend_fix(file_path: str) -> str:
    kind = classify_finding(file_path)
    if kind == "config":
        return "使用 defaultEnvAccessor 或 createEnvAccessor(process.env)"
    if kind == "runtime":
        return "注入 EnvService 并改用 getString/getInt/getBoolean/isProd 等方法"
    if kind == "test-or-e2e":
        return "优先收敛到公共 fixture/helper；若属于测试注入，可保留为受控例外并说明原因"
    return "根据上下文改为 EnvService 或 EnvAccessor"


def summarize_findings(findings: list[dict[str, Any]]) -> dict[str, Any]:
    by_kind: dict[str, int] = {}
    by_file: dict[str, int] = {}
    for item in findings:
        by_kind[item["kind"]] = by_kind.get(item["kind"], 0) + 1
        by_file[item["file"]] = by_file.get(item["file"], 0) + 1
    return {
        "total_findings": len(findings),
        "by_kind": by_kind,
        "files": sorted(
            [{"file": file_path, "count": count} for file_path, count in by_file.items()],
            key=lambda item: (-item["count"], item["file"]),
        ),
    }


def build_report(workspace: Path, scan_dirs: list[str]) -> dict[str, Any]:
    foundation = detect_foundation(workspace)
    findings = collect_process_env_findings(workspace, scan_dirs)
    return {
        "workspace": str(workspace),
        "scan_dirs": scan_dirs,
        "excluded_globs": EXCLUDED_GLOBS,
        "foundation": foundation,
        "summary": summarize_findings(findings),
        "findings": findings,
    }


def print_text_report(report: dict[str, Any]) -> None:
    foundation = report["foundation"]
    summary = report["summary"]

    print("== env-accessor-audit-fixer ==")
    print(f"workspace: {report['workspace']}")
    print(f"scan dirs: {', '.join(report['scan_dirs'])}")
    print(f"recommended mode: {foundation['recommended_mode']}")
    print("")
    print("foundation:")
    print(f"- has createEnvAccessor: {foundation['has_create_env_accessor']}")
    print(f"- has defaultEnvAccessor: {foundation['has_default_env_accessor']}")
    print(f"- has EnvService: {foundation['has_env_service']}")
    print(f"- has registerAs config: {foundation['has_register_as_config']}")
    print("")
    print("summary:")
    print(f"- total findings: {summary['total_findings']}")
    for kind, count in sorted(summary["by_kind"].items()):
        print(f"- {kind}: {count}")

    if not report["findings"]:
        return

    print("")
    print("findings:")
    for item in report["findings"]:
        print(
            f"- {item['file']}:{item['line']}:{item['column']} "
            f"[{item['kind']}] {item['recommended_fix']}"
        )
        print(f"  {item['snippet']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="审计项目中的 process.env 直读，并判断是否缺少统一 env 访问基础设施。"
    )
    parser.add_argument(
        "--workspace",
        default=".",
        help="仓库根目录，默认当前目录",
    )
    parser.add_argument(
        "--scan-dir",
        dest="scan_dirs",
        action="append",
        help="附加扫描目录；默认扫描 apps/backend/src 与 apps/backend/e2e",
    )
    parser.add_argument(
        "--output-json",
        help="将结构化结果输出到指定文件",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    scan_dirs = args.scan_dirs or DEFAULT_SCAN_DIRS

    try:
        report = build_report(workspace, scan_dirs)
    except FileNotFoundError:
        print("未找到 rg，请先安装 ripgrep", file=sys.stderr)
        return 2
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print_text_report(report)

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
