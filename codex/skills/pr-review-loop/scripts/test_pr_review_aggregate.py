#!/usr/bin/env python3
"""
Unit tests for pr_review_aggregate.py decision log parsing and filtering.

Tests cover:
1. _parse_decision_log() - parsing markdown decision logs
2. _filter_by_decision_log() - filtering findings based on prior decisions
3. Edge cases: empty input, malformed data, cross-reviewer matching
"""

import importlib.util
import json
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, cast

import pytest


def _load_pr_review_aggregate_module():
    module_path = Path(__file__).with_name("pr_review_aggregate.py")
    spec = importlib.util.spec_from_file_location("pr_review_aggregate", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module spec: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_pr_review_aggregate = _load_pr_review_aggregate_module()

_parse_decision_log = cast(Callable[[str], list[dict[str, object]]], getattr(_pr_review_aggregate, "_parse_decision_log"))
_filter_by_decision_log = cast(
    Callable[[Sequence[Mapping[str, object]], Sequence[Mapping[str, object]], list[list[str]]], list[dict[str, object]]],
    getattr(_pr_review_aggregate, "_filter_by_decision_log"),
)
_parse_escalation_groups_json = cast(
    Callable[[str], list[list[str]]],
    getattr(_pr_review_aggregate, "_parse_escalation_groups_json"),
)
_parse_escalation_groups_b64 = cast(
    Callable[[str], list[list[str]]],
    getattr(_pr_review_aggregate, "_parse_escalation_groups_b64"),
)
_parse_review_findings = cast(
    Callable[[str], list[dict[str, object]]],
    getattr(_pr_review_aggregate, "_parse_review_findings"),
)
_check_existing_comment = cast(
    Callable[[int, str, int, str], bool],
    getattr(_pr_review_aggregate, "_check_existing_comment"),
)
_MARKER = cast(str, getattr(_pr_review_aggregate, "MARKER"))


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def empty_decision_log() -> str:
    """Empty decision log markdown."""
    return ""


@pytest.fixture
def valid_decision_log() -> str:
    """Valid decision log with Fixed and Rejected entries."""
    return """# Decision Log

PR: 123

## Round 1

### Fixed
- id: SEC-001
  file: apps/backend/src/api.ts
  commit: abc123
  essence: JSON.parse 未捕获异常

- id: STY-002
  file: apps/front/src/ErrorBoundary.tsx
  commit: def456
  essence: 缺少错误边界处理

### Rejected
- id: STY-004
  file: apps/front/src/Component.tsx
  priority: P2
  reason: 需要产品决策，超出 PR 范围
  essence: 组件拆分建议

- id: LOG-003
  file: apps/backend/src/db.ts
  priority: P3
  reason: 性能优化非当前优先级
  essence: 批量查询优化
"""


@pytest.fixture
def valid_decision_log_legacy_no_file() -> str:
    """Legacy decision log fixture without the file: field (backward compat)."""
    return """# Decision Log

PR: 123

## Round 1

### Fixed
- id: SEC-001
  commit: abc123
  essence: JSON.parse 未捕获异常

- id: STY-002
  commit: def456
  essence: 缺少错误边界处理

### Rejected
- id: STY-004
  priority: P2
  reason: 需要产品决策，超出 PR 范围
  essence: 组件拆分建议

- id: LOG-003
  priority: P3
  reason: 性能优化非当前优先级
  essence: 批量查询优化
"""


@pytest.fixture
def malformed_decision_log() -> str:
    """Malformed decision log with missing fields and bad formatting."""
    return """# Decision Log

PR: 123

### Fixed
- id: BROKEN-001
  # Missing essence field

### Rejected
- id: BROKEN-002
  priority: P2
  # Missing essence and reason

Some random text that should be ignored

- id: BROKEN-003
  this is not a valid field format
"""


@pytest.fixture
def sample_findings() -> list[dict[str, object]]:
    """Sample findings list for filter tests."""
    return [
        {
            "id": "SEC-001",
            "priority": "P1",
            "category": "bug",
            "file": "api.ts",
            "line": "42",
            "title": "JSON parse error",
            "description": "JSON.parse 未捕获异常",
            "suggestion": "Add try-catch"
        },
        {
            "id": "STY-004",
            "priority": "P2",
            "category": "quality",
            "file": "Component.tsx",
            "line": "100",
            "title": "Component split",
            "description": "组件拆分建议",
            "suggestion": "Split into smaller components"
        },
        {
            "id": "LOG-007",
            "priority": "P0",
            "category": "bug",
            "file": "Component.tsx",
            "line": "100",
            "title": "Component split (escalated)",
            "description": "组件拆分建议 - 升级为 P0",
            "suggestion": "Split into smaller components - critical"
        },
        {
            "id": "NEW-001",
            "priority": "P1",
            "category": "bug",
            "file": "utils.ts",
            "line": "20",
            "title": "New issue",
            "description": "This is a new issue",
            "suggestion": "Fix it"
        }
    ]


@pytest.fixture
def prior_decisions() -> list[dict[str, object]]:
    """Sample prior decisions from _parse_decision_log."""
    return [
        {
            "id": "SEC-001",
            "status": "fixed",
            "commit": "abc123",
            "essence": "JSON.parse 未捕获异常"
        },
        {
            "id": "STY-004",
            "status": "rejected",
            "priority": "P2",
            "reason": "需要产品决策，超出 PR 范围",
            "essence": "组件拆分建议"
        }
    ]


# ============================================================
# Test: _parse_decision_log() - Empty Input
# ============================================================

def test_parse_decision_log_empty(empty_decision_log: str) -> None:
    """
    Test that empty decision log returns empty list.
    
    Given: empty string
    When: _parse_decision_log() is called
    Then: returns []
    """
    result = _parse_decision_log(empty_decision_log)
    assert result == []
    assert isinstance(result, list)


# ============================================================
# Test: _parse_decision_log() - Valid Input
# ============================================================

def test_parse_decision_log_valid(valid_decision_log: str) -> None:
    """
    Test that valid decision log is parsed into structured data.
    
    Given: valid markdown with Fixed and Rejected sections
    When: _parse_decision_log() is called
    Then: returns list of dicts with id, status, essence, and optional fields
    """
    result = _parse_decision_log(valid_decision_log)
    
    # Should have 4 entries (2 Fixed, 2 Rejected)
    assert len(result) == 4
    
    # Verify first Fixed entry
    fixed_1 = result[0]
    assert fixed_1["id"] == "SEC-001"
    assert fixed_1["status"] == "fixed"
    assert fixed_1["file"] == "apps/backend/src/api.ts"
    assert fixed_1["commit"] == "abc123"
    assert fixed_1["essence"] == "JSON.parse 未捕获异常"
    
    # Verify second Fixed entry
    fixed_2 = result[1]
    assert fixed_2["id"] == "STY-002"
    assert fixed_2["status"] == "fixed"
    assert fixed_2["file"] == "apps/front/src/ErrorBoundary.tsx"
    assert fixed_2["commit"] == "def456"
    assert fixed_2["essence"] == "缺少错误边界处理"
    
    # Verify first Rejected entry
    rejected_1 = result[2]
    assert rejected_1["id"] == "STY-004"
    assert rejected_1["status"] == "rejected"
    assert rejected_1["file"] == "apps/front/src/Component.tsx"
    assert rejected_1["priority"] == "P2"
    assert rejected_1["reason"] == "需要产品决策，超出 PR 范围"
    assert rejected_1["essence"] == "组件拆分建议"
    
    # Verify second Rejected entry
    rejected_2 = result[3]
    assert rejected_2["id"] == "LOG-003"
    assert rejected_2["status"] == "rejected"
    assert rejected_2["file"] == "apps/backend/src/db.ts"
    assert rejected_2["priority"] == "P3"


def test_parse_decision_log_legacy_without_file(valid_decision_log_legacy_no_file: str) -> None:
    """Decision log entries without file: should still parse (backward compat)."""
    result = _parse_decision_log(valid_decision_log_legacy_no_file)

    # Should have 4 entries (2 Fixed, 2 Rejected)
    assert len(result) == 4

    # Basic shape should still be present
    for entry in result:
        assert "id" in entry
        assert "status" in entry

    # And file should be optional
    assert all(("file" not in e) or (e["file"] in (None, "")) for e in result)


# ============================================================
# Test: _parse_decision_log() - Malformed Input
# ============================================================

def test_parse_decision_log_malformed(malformed_decision_log: str) -> None:
    """
    Test that malformed decision log degrades gracefully.
    
    Given: decision log with missing required fields
    When: _parse_decision_log() is called
    Then: returns partial data without raising exceptions
    """
    # Should not raise exception
    result = _parse_decision_log(malformed_decision_log)
    
    # Should return some data (even if incomplete)
    assert isinstance(result, list)
    
    # Entries should have at least id and status
    for entry in result:
        assert "id" in entry
        assert "status" in entry


# ============================================================
# Test: _filter_by_decision_log() - Fixed Issues
# ============================================================

def test_filter_fixed_issues(sample_findings: list[dict[str, object]], prior_decisions: list[dict[str, object]]) -> None:
    """
    Test that findings matching Fixed decisions are filtered out.
    
    Given: findings containing SEC-001 which is in Fixed decisions
    When: _filter_by_decision_log() is called with empty escalation_groups
    Then: SEC-001 is filtered out
    """
    escalation_groups: list[list[str]] = []
    
    result = _filter_by_decision_log(sample_findings, prior_decisions, escalation_groups)
    
    # SEC-001 should be filtered (it's in Fixed decisions)
    result_ids = [f["id"] for f in result]
    assert "SEC-001" not in result_ids
    
    # Other findings should remain
    assert "STY-004" in result_ids or "LOG-007" in result_ids or "NEW-001" in result_ids


# ============================================================
# Test: _filter_by_decision_log() - Rejected Without Escalation
# ============================================================

def test_filter_rejected_without_escalation(sample_findings: list[dict[str, object]], prior_decisions: list[dict[str, object]]) -> None:
    """
    Test that findings matching Rejected decisions are filtered out when NOT in escalation_groups.
    
    Given: findings containing STY-004 which is in Rejected decisions
          and escalation_groups is empty
    When: _filter_by_decision_log() is called
    Then: STY-004 is filtered out
    """
    escalation_groups: list[list[str]] = []
    
    result = _filter_by_decision_log(sample_findings, prior_decisions, escalation_groups)
    
    # STY-004 should be filtered (it's Rejected and not escalated)
    result_ids = [f["id"] for f in result]
    assert "STY-004" not in result_ids
    
    # New findings should remain
    assert "NEW-001" in result_ids


# ============================================================
# Test: _filter_by_decision_log() - Rejected With Escalation
# ============================================================

def test_filter_rejected_with_escalation(sample_findings: list[dict[str, object]], prior_decisions: list[dict[str, object]]) -> None:
    """
    Test that findings matching Rejected decisions are kept when in escalation_groups.
    
    Given: findings containing LOG-007 which is an escalation of STY-004
          and escalation_groups contains ["STY-004", "LOG-007"]
    When: _filter_by_decision_log() is called
    Then: LOG-007 is NOT filtered (it's an escalation)
    """
    # STY-004 (Rejected P2) -> LOG-007 (escalated to P0, ≥2 level jump)
    escalation_groups = [["STY-004", "LOG-007"]]
    
    result = _filter_by_decision_log(sample_findings, prior_decisions, escalation_groups)
    
    # LOG-007 should NOT be filtered (it's an escalation)
    result_ids = [f["id"] for f in result]
    assert "LOG-007" in result_ids
    
    # STY-004 itself (P2) should still be filtered
    assert "STY-004" not in result_ids


# ============================================================
# Test: _filter_by_decision_log() - Cross-Reviewer Match
# ============================================================

def test_filter_cross_reviewer_match() -> None:
    """
    Test that findings with different reviewer IDs but same essence are filtered.
    
    Given: findings containing STY-005 (different ID from SEC-001)
          but prior decisions contain SEC-001 as Fixed
          and escalation_groups links them: ["SEC-001", "STY-005"]
    When: _filter_by_decision_log() is called
    Then: STY-005 is filtered (matched via escalation group to Fixed decision)
    """
    findings = [
        {
            "id": "STY-005",
            "priority": "P1",
            "category": "bug",
            "file": "api.ts",
            "line": "42",
            "title": "JSON parse error",
            "description": "JSON.parse 未捕获异常 (same essence as SEC-001)",
            "suggestion": "Add try-catch"
        },
        {
            "id": "NEW-002",
            "priority": "P2",
            "category": "quality",
            "file": "utils.ts",
            "line": "10",
            "title": "Different issue",
            "description": "Completely different",
            "suggestion": "Fix differently"
        }
    ]
    
    prior_decisions = [
        {
            "id": "SEC-001",
            "status": "fixed",
            "commit": "abc123",
            "essence": "JSON.parse 未捕获异常"
        }
    ]
    
    # Escalation group indicates STY-005 is related to SEC-001
    escalation_groups = [["SEC-001", "STY-005"]]
    
    result = _filter_by_decision_log(findings, prior_decisions, escalation_groups)
    
    # STY-005 should be filtered (linked to Fixed SEC-001 via escalation group)
    result_ids = [f["id"] for f in result]
    assert "STY-005" not in result_ids
    
    # NEW-002 should remain
    assert "NEW-002" in result_ids


# ============================================================
# Test: _parse_escalation_groups_json()
# ============================================================

def test_parse_escalation_groups_json_valid() -> None:
    """Test parsing valid escalation groups JSON."""
    json_str = '{"escalationGroups": [["STY-004", "LOG-007"], ["SEC-001", "STY-005"]]}'
    result = _parse_escalation_groups_json(json_str)
    
    assert len(result) == 2
    assert ["STY-004", "LOG-007"] in result
    assert ["SEC-001", "STY-005"] in result


def test_parse_escalation_groups_json_empty() -> None:
    """Test parsing empty escalation groups JSON."""
    result = _parse_escalation_groups_json("")
    assert result == []


def test_parse_escalation_groups_json_malformed() -> None:
    """Test parsing malformed JSON returns empty list."""
    result = _parse_escalation_groups_json("not valid json {{{")
    assert result == []


# ============================================================
# Test: _parse_escalation_groups_b64()
# ============================================================

def test_parse_escalation_groups_b64_valid() -> None:
    """Test parsing valid base64-encoded escalation groups."""
    import base64
    json_str = '{"escalationGroups": [["STY-004", "LOG-007"]]}'
    b64_str = base64.b64encode(json_str.encode("utf-8")).decode("ascii")
    
    result = _parse_escalation_groups_b64(b64_str)
    
    assert len(result) == 1
    assert ["STY-004", "LOG-007"] in result


def test_parse_escalation_groups_b64_empty() -> None:
    """Test parsing empty base64 string."""
    result = _parse_escalation_groups_b64("")
    assert result == []


def test_parse_escalation_groups_b64_invalid() -> None:
    """Test parsing invalid base64 returns empty list."""
    result = _parse_escalation_groups_b64("not-valid-base64!!!")
    assert result == []


# ============================================================
# Test: _parse_review_findings()
# ============================================================

def test_parse_review_findings_supports_current_reviewer_format() -> None:
    """Current reviewer output uses plain key-value finding blocks."""
    review_md = """# Review (SEC)
PR: 2934
Round: 1

## Findings
### SEC-001
id: SEC-001
priority: P1
category: Path Traversal
file: scripts/release/backend-deploy-release.sh
line: 128
title: 发布目录名未校验导致路径穿越与高危删除
description: 说明文本
suggestion: 修复建议
"""
    result = _parse_review_findings(review_md)
    assert len(result) == 1
    assert result[0]["id"] == "SEC-001"
    assert result[0]["priority"] == "P1"
    assert result[0]["file"] == "scripts/release/backend-deploy-release.sh"


def test_parse_review_findings_keeps_legacy_list_format() -> None:
    """Legacy list-style findings should remain parseable."""
    review_md = """## Findings
- id: LOG-001
  priority: P1
  category: logic
  file: apps/api/src/service.ts
  line: 10
  title: 标题
  description: 描述
  suggestion: 建议
"""
    result = _parse_review_findings(review_md)
    assert len(result) == 1
    assert result[0]["id"] == "LOG-001"
    assert result[0]["priority"] == "P1"


# ============================================================
# Test: Integration - Full Workflow
# ============================================================

def test_integration_full_filter_workflow() -> None:
    """
    Integration test: parse decision log and filter findings.
    
    Simulates real workflow:
    1. Parse decision log markdown
    2. Parse escalation groups
    3. Filter findings based on decisions and escalations
    """
    decision_log_md = """# Decision Log

PR: 456

## Round 1

### Fixed
- id: SEC-010
  commit: sha1
  essence: 类型错误修复

### Rejected
- id: STY-020
  priority: P3
  reason: 低优先级优化
  essence: 性能优化建议
"""
    
    findings = [
        {"id": "SEC-010", "priority": "P1", "category": "bug", "file": "a.ts", "line": "1", "title": "Type error", "description": "类型错误修复", "suggestion": "Fix"},
        {"id": "STY-020", "priority": "P3", "category": "perf", "file": "b.ts", "line": "2", "title": "Perf opt", "description": "性能优化建议", "suggestion": "Optimize"},
        {"id": "LOG-030", "priority": "P1", "category": "perf", "file": "b.ts", "line": "2", "title": "Perf opt escalated", "description": "性能优化建议 - 升级", "suggestion": "Optimize now"},
        {"id": "NEW-100", "priority": "P2", "category": "quality", "file": "c.ts", "line": "3", "title": "New", "description": "新问题", "suggestion": "Fix new"},
    ]
    
    # Parse decision log
    prior_decisions = _parse_decision_log(decision_log_md)
    assert len(prior_decisions) == 2
    
    # Escalation: STY-020 (P3) -> LOG-030 (P1, ≥2 level jump)
    escalation_groups = [["STY-020", "LOG-030"]]
    
    # Filter findings
    result = _filter_by_decision_log(findings, prior_decisions, escalation_groups)
    result_ids = [f["id"] for f in result]
    
    # SEC-010 should be filtered (Fixed)
    assert "SEC-010" not in result_ids
    
    # STY-020 should be filtered (Rejected, not escalated)
    assert "STY-020" not in result_ids
    
    # LOG-030 should remain (escalation of Rejected)
    assert "LOG-030" in result_ids
    
    # NEW-100 should remain (new issue)
    assert "NEW-100" in result_ids
    
    # Final count: 2 findings remain
    assert len(result) == 2


# ============================================================
# Test: _check_existing_comment() - PR comment idempotency
# ============================================================


def _patch_subprocess_run_for_gh_comments(monkeypatch: pytest.MonkeyPatch, comments: list[dict[str, object]], returncode: int = 0) -> None:
    stdout = json.dumps(comments, ensure_ascii=True)

    def _fake_run(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(returncode=returncode, stdout=stdout)

    monkeypatch.setattr(subprocess, "run", _fake_run)


@pytest.mark.parametrize(
    "comment_type,round_num,expected_header",
    [
        ("review-summary", 2, "## Review Summary (Round 2)"),
        ("fix-report", 2, "## Fix Report (Round 2)"),
        ("final-report", 2, "## Final Report"),
    ],
)
def test_check_existing_comment_true_when_marker_header_and_runid_match(
    monkeypatch: pytest.MonkeyPatch, comment_type: str, round_num: int, expected_header: str
) -> None:
    pr_number = 123
    run_id = "run-abc"
    body = "\n".join([_MARKER, "", expected_header, "", f"RunId: {run_id}"])
    _patch_subprocess_run_for_gh_comments(monkeypatch, [{"body": body}])

    assert _check_existing_comment(pr_number, run_id, round_num, comment_type) is True


@pytest.mark.parametrize(
    "comment_type,round_num,expected_header",
    [
        ("review-summary", 3, "## Review Summary (Round 3)"),
        ("fix-report", 3, "## Fix Report (Round 3)"),
        ("final-report", 3, "## Final Report"),
    ],
)
def test_check_existing_comment_false_when_marker_missing(
    monkeypatch: pytest.MonkeyPatch, comment_type: str, round_num: int, expected_header: str
) -> None:
    pr_number = 456
    run_id = "run-xyz"
    body = "\n".join(["", expected_header, "", f"RunId: {run_id}"])
    _patch_subprocess_run_for_gh_comments(monkeypatch, [{"body": body}])

    assert _check_existing_comment(pr_number, run_id, round_num, comment_type) is False


@pytest.mark.parametrize(
    "comment_type,round_num,expected_header,wrong_header",
    [
        (
            "review-summary",
            2,
            "## Review Summary (Round 2)",
            "## Fix Report (Round 2)",
        ),
        (
            "fix-report",
            2,
            "## Fix Report (Round 2)",
            "## Review Summary (Round 2)",
        ),
        (
            "final-report",
            2,
            "## Final Report",
            "## Review Summary (Round 2)",
        ),
    ],
)
def test_check_existing_comment_false_when_header_mismatched(
    monkeypatch: pytest.MonkeyPatch, comment_type: str, round_num: int, expected_header: str, wrong_header: str
) -> None:
    pr_number = 789
    run_id = "run-123"

    body = "\n".join([_MARKER, "", wrong_header, "", f"RunId: {run_id}"])
    _patch_subprocess_run_for_gh_comments(monkeypatch, [{"body": body}])

    assert expected_header not in body
    assert _check_existing_comment(pr_number, run_id, round_num, comment_type) is False


@pytest.mark.parametrize(
    "comment_type,round_num,expected_header",
    [
        ("review-summary", 1, "## Review Summary (Round 1)"),
        ("fix-report", 1, "## Fix Report (Round 1)"),
        ("final-report", 1, "## Final Report"),
    ],
)
def test_check_existing_comment_false_when_runid_mismatched(
    monkeypatch: pytest.MonkeyPatch, comment_type: str, round_num: int, expected_header: str
) -> None:
    pr_number = 101
    run_id = "run-a"
    other_run_id = "run-b"

    body = "\n".join([_MARKER, "", expected_header, "", f"RunId: {other_run_id}"])
    _patch_subprocess_run_for_gh_comments(monkeypatch, [{"body": body}])

    assert _check_existing_comment(pr_number, run_id, round_num, comment_type) is False


def test_check_existing_comment_false_when_subprocess_run_nonzero(monkeypatch: pytest.MonkeyPatch) -> None:
    pr_number = 999
    run_id = "run-nonzero"
    round_num = 2
    comment_type = "review-summary"
    body = "\n".join([_MARKER, "", "## Review Summary (Round 2)", "", f"RunId: {run_id}"])

    _patch_subprocess_run_for_gh_comments(monkeypatch, [{"body": body}], returncode=1)
    assert _check_existing_comment(pr_number, run_id, round_num, comment_type) is False


if __name__ == "__main__":
    _ = pytest.main([__file__, "-v"])
