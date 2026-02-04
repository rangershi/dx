#!/usr/bin/env python3
"""
Unit tests for pr_review_aggregate.py decision log parsing and filtering.

Tests cover:
1. _parse_decision_log() - parsing markdown decision logs
2. _filter_by_decision_log() - filtering findings based on prior decisions
3. Edge cases: empty input, malformed data, cross-reviewer matching
"""

import pytest
from unittest.mock import patch, MagicMock
import sys
from pathlib import Path

# Add parent directory to path for importing pr_review_aggregate
sys.path.insert(0, str(Path(__file__).parent))

# Import functions under test
from pr_review_aggregate import (
    _parse_decision_log,
    _filter_by_decision_log,
    _parse_escalation_groups_json,
    _parse_escalation_groups_b64,
)


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def empty_decision_log():
    """Empty decision log markdown."""
    return ""


@pytest.fixture
def valid_decision_log():
    """Valid decision log with Fixed and Rejected entries."""
    return """# Decision Log

PR: 123

## Round 1

### Fixed
- id: CDX-001
  commit: abc123
  essence: JSON.parse 未捕获异常

- id: GMN-002
  commit: def456
  essence: 缺少错误边界处理

### Rejected
- id: GMN-004
  priority: P2
  reason: 需要产品决策，超出 PR 范围
  essence: 组件拆分建议

- id: CLD-003
  priority: P3
  reason: 性能优化非当前优先级
  essence: 批量查询优化
"""


@pytest.fixture
def malformed_decision_log():
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
def sample_findings():
    """Sample findings list for filter tests."""
    return [
        {
            "id": "CDX-001",
            "priority": "P1",
            "category": "bug",
            "file": "api.ts",
            "line": "42",
            "title": "JSON parse error",
            "description": "JSON.parse 未捕获异常",
            "suggestion": "Add try-catch"
        },
        {
            "id": "GMN-004",
            "priority": "P2",
            "category": "quality",
            "file": "Component.tsx",
            "line": "100",
            "title": "Component split",
            "description": "组件拆分建议",
            "suggestion": "Split into smaller components"
        },
        {
            "id": "CLD-007",
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
def prior_decisions():
    """Sample prior decisions from _parse_decision_log."""
    return [
        {
            "id": "CDX-001",
            "status": "fixed",
            "commit": "abc123",
            "essence": "JSON.parse 未捕获异常"
        },
        {
            "id": "GMN-004",
            "status": "rejected",
            "priority": "P2",
            "reason": "需要产品决策，超出 PR 范围",
            "essence": "组件拆分建议"
        }
    ]


# ============================================================
# Test: _parse_decision_log() - Empty Input
# ============================================================

def test_parse_decision_log_empty(empty_decision_log):
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

def test_parse_decision_log_valid(valid_decision_log):
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
    assert fixed_1["id"] == "CDX-001"
    assert fixed_1["status"] == "fixed"
    assert fixed_1["commit"] == "abc123"
    assert fixed_1["essence"] == "JSON.parse 未捕获异常"
    
    # Verify second Fixed entry
    fixed_2 = result[1]
    assert fixed_2["id"] == "GMN-002"
    assert fixed_2["status"] == "fixed"
    assert fixed_2["commit"] == "def456"
    assert fixed_2["essence"] == "缺少错误边界处理"
    
    # Verify first Rejected entry
    rejected_1 = result[2]
    assert rejected_1["id"] == "GMN-004"
    assert rejected_1["status"] == "rejected"
    assert rejected_1["priority"] == "P2"
    assert rejected_1["reason"] == "需要产品决策，超出 PR 范围"
    assert rejected_1["essence"] == "组件拆分建议"
    
    # Verify second Rejected entry
    rejected_2 = result[3]
    assert rejected_2["id"] == "CLD-003"
    assert rejected_2["status"] == "rejected"
    assert rejected_2["priority"] == "P3"


# ============================================================
# Test: _parse_decision_log() - Malformed Input
# ============================================================

def test_parse_decision_log_malformed(malformed_decision_log):
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

def test_filter_fixed_issues(sample_findings, prior_decisions):
    """
    Test that findings matching Fixed decisions are filtered out.
    
    Given: findings containing CDX-001 which is in Fixed decisions
    When: _filter_by_decision_log() is called with empty escalation_groups
    Then: CDX-001 is filtered out
    """
    escalation_groups = []
    
    result = _filter_by_decision_log(sample_findings, prior_decisions, escalation_groups)
    
    # CDX-001 should be filtered (it's in Fixed decisions)
    result_ids = [f["id"] for f in result]
    assert "CDX-001" not in result_ids
    
    # Other findings should remain
    assert "GMN-004" in result_ids or "CLD-007" in result_ids or "NEW-001" in result_ids


# ============================================================
# Test: _filter_by_decision_log() - Rejected Without Escalation
# ============================================================

def test_filter_rejected_without_escalation(sample_findings, prior_decisions):
    """
    Test that findings matching Rejected decisions are filtered out when NOT in escalation_groups.
    
    Given: findings containing GMN-004 which is in Rejected decisions
          and escalation_groups is empty
    When: _filter_by_decision_log() is called
    Then: GMN-004 is filtered out
    """
    escalation_groups = []
    
    result = _filter_by_decision_log(sample_findings, prior_decisions, escalation_groups)
    
    # GMN-004 should be filtered (it's Rejected and not escalated)
    result_ids = [f["id"] for f in result]
    assert "GMN-004" not in result_ids
    
    # New findings should remain
    assert "NEW-001" in result_ids


# ============================================================
# Test: _filter_by_decision_log() - Rejected With Escalation
# ============================================================

def test_filter_rejected_with_escalation(sample_findings, prior_decisions):
    """
    Test that findings matching Rejected decisions are kept when in escalation_groups.
    
    Given: findings containing CLD-007 which is an escalation of GMN-004
          and escalation_groups contains ["GMN-004", "CLD-007"]
    When: _filter_by_decision_log() is called
    Then: CLD-007 is NOT filtered (it's an escalation)
    """
    # GMN-004 (Rejected P2) -> CLD-007 (escalated to P0, ≥2 level jump)
    escalation_groups = [["GMN-004", "CLD-007"]]
    
    result = _filter_by_decision_log(sample_findings, prior_decisions, escalation_groups)
    
    # CLD-007 should NOT be filtered (it's an escalation)
    result_ids = [f["id"] for f in result]
    assert "CLD-007" in result_ids
    
    # GMN-004 itself (P2) should still be filtered
    assert "GMN-004" not in result_ids


# ============================================================
# Test: _filter_by_decision_log() - Cross-Reviewer Match
# ============================================================

def test_filter_cross_reviewer_match():
    """
    Test that findings with different reviewer IDs but same essence are filtered.
    
    Given: findings containing GMN-005 (different ID from CDX-001)
          but prior decisions contain CDX-001 as Fixed
          and escalation_groups links them: ["CDX-001", "GMN-005"]
    When: _filter_by_decision_log() is called
    Then: GMN-005 is filtered (matched via escalation group to Fixed decision)
    """
    findings = [
        {
            "id": "GMN-005",
            "priority": "P1",
            "category": "bug",
            "file": "api.ts",
            "line": "42",
            "title": "JSON parse error",
            "description": "JSON.parse 未捕获异常 (same essence as CDX-001)",
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
            "id": "CDX-001",
            "status": "fixed",
            "commit": "abc123",
            "essence": "JSON.parse 未捕获异常"
        }
    ]
    
    # Escalation group indicates GMN-005 is related to CDX-001
    escalation_groups = [["CDX-001", "GMN-005"]]
    
    result = _filter_by_decision_log(findings, prior_decisions, escalation_groups)
    
    # GMN-005 should be filtered (linked to Fixed CDX-001 via escalation group)
    result_ids = [f["id"] for f in result]
    assert "GMN-005" not in result_ids
    
    # NEW-002 should remain
    assert "NEW-002" in result_ids


# ============================================================
# Test: _parse_escalation_groups_json()
# ============================================================

def test_parse_escalation_groups_json_valid():
    """Test parsing valid escalation groups JSON."""
    json_str = '{"escalationGroups": [["GMN-004", "CLD-007"], ["CDX-001", "GMN-005"]]}'
    result = _parse_escalation_groups_json(json_str)
    
    assert len(result) == 2
    assert ["GMN-004", "CLD-007"] in result
    assert ["CDX-001", "GMN-005"] in result


def test_parse_escalation_groups_json_empty():
    """Test parsing empty escalation groups JSON."""
    result = _parse_escalation_groups_json("")
    assert result == []


def test_parse_escalation_groups_json_malformed():
    """Test parsing malformed JSON returns empty list."""
    result = _parse_escalation_groups_json("not valid json {{{")
    assert result == []


# ============================================================
# Test: _parse_escalation_groups_b64()
# ============================================================

def test_parse_escalation_groups_b64_valid():
    """Test parsing valid base64-encoded escalation groups."""
    import base64
    json_str = '{"escalationGroups": [["GMN-004", "CLD-007"]]}'
    b64_str = base64.b64encode(json_str.encode("utf-8")).decode("ascii")
    
    result = _parse_escalation_groups_b64(b64_str)
    
    assert len(result) == 1
    assert ["GMN-004", "CLD-007"] in result


def test_parse_escalation_groups_b64_empty():
    """Test parsing empty base64 string."""
    result = _parse_escalation_groups_b64("")
    assert result == []


def test_parse_escalation_groups_b64_invalid():
    """Test parsing invalid base64 returns empty list."""
    result = _parse_escalation_groups_b64("not-valid-base64!!!")
    assert result == []


# ============================================================
# Test: Integration - Full Workflow
# ============================================================

def test_integration_full_filter_workflow():
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
- id: CDX-010
  commit: sha1
  essence: 类型错误修复

### Rejected
- id: GMN-020
  priority: P3
  reason: 低优先级优化
  essence: 性能优化建议
"""
    
    findings = [
        {"id": "CDX-010", "priority": "P1", "category": "bug", "file": "a.ts", "line": "1", "title": "Type error", "description": "类型错误修复", "suggestion": "Fix"},
        {"id": "GMN-020", "priority": "P3", "category": "perf", "file": "b.ts", "line": "2", "title": "Perf opt", "description": "性能优化建议", "suggestion": "Optimize"},
        {"id": "CLD-030", "priority": "P1", "category": "perf", "file": "b.ts", "line": "2", "title": "Perf opt escalated", "description": "性能优化建议 - 升级", "suggestion": "Optimize now"},
        {"id": "NEW-100", "priority": "P2", "category": "quality", "file": "c.ts", "line": "3", "title": "New", "description": "新问题", "suggestion": "Fix new"},
    ]
    
    # Parse decision log
    prior_decisions = _parse_decision_log(decision_log_md)
    assert len(prior_decisions) == 2
    
    # Escalation: GMN-020 (P3) -> CLD-030 (P1, ≥2 level jump)
    escalation_groups = [["GMN-020", "CLD-030"]]
    
    # Filter findings
    result = _filter_by_decision_log(findings, prior_decisions, escalation_groups)
    result_ids = [f["id"] for f in result]
    
    # CDX-010 should be filtered (Fixed)
    assert "CDX-010" not in result_ids
    
    # GMN-020 should be filtered (Rejected, not escalated)
    assert "GMN-020" not in result_ids
    
    # CLD-030 should remain (escalation of Rejected)
    assert "CLD-030" in result_ids
    
    # NEW-100 should remain (new issue)
    assert "NEW-100" in result_ids
    
    # Final count: 2 findings remain
    assert len(result) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
