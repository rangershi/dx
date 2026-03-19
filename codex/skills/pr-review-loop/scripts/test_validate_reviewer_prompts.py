#!/usr/bin/env python3
"""
Unit tests for validate_reviewer_prompts.py.
"""

import importlib.util
from pathlib import Path
from typing import Callable, cast


def _load_module():
    module_path = Path(__file__).with_name("validate_reviewer_prompts.py")
    spec = importlib.util.spec_from_file_location("validate_reviewer_prompts", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module spec: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_module = _load_module()
_validate_prompt_text = cast(Callable[[str], list[str]], getattr(_module, "_validate_prompt_text"))


def test_validate_prompt_text_accepts_complete_contract() -> None:
    text = """
# PR Reviewer (Security)

## 角色码（强制）

- `ROLE_CODE = SEC`
- `reviewFile`: `./.cache/review-SEC-pr<PR_NUMBER>-r<ROUND>-<RUN_ID>.md`
- findings id 前缀：`SEC-`

## 输出格式（强制）

- 必须写入 `reviewFile`，禁止只在 stdout 输出审查结果。
- 若无问题，文件内容必须严格为以下模板：

```md
# Review (SEC)
PR: 123
Round: 1
RunId: 123-1-abcdef0

## Findings
None
```

- 若有问题，每个 finding 必须使用如下块格式，字段名必须逐字一致：

```md
# Review (SEC)
PR: 123
Round: 1
RunId: 123-1-abcdef0

## Findings
id: SEC-001
priority: P1
category: bug
file: apps/api/src/service.ts
line: 10
title: 标题
description: 描述
suggestion: 建议
```

- `priority` 只能是 `P0`、`P1`、`P2`、`P3`。
- `category` 只允许使用英文小写单词或短语。
- `line` 必须是单个行号数字；未知时写 `null`。
- 多个 finding 之间必须空一行；禁止额外嵌套列表、表格、代码块或总结性 prose。
- 输出前必须自检：字段齐全、非空、前缀与 `ROLE_CODE` 一致。
"""

    assert _validate_prompt_text(text) == []


def test_validate_prompt_text_reports_missing_contract_sections() -> None:
    text = """
# PR Reviewer (Style)

## 角色码（强制）

- `ROLE_CODE = STY`
- `reviewFile`: `./.cache/review-STY-pr<PR_NUMBER>-r<ROUND>-<RUN_ID>.md`
"""

    errors = _validate_prompt_text(text)
    assert any("输出格式（强制）" in err for err in errors)
    assert any("None" in err for err in errors)
    assert any("priority" in err for err in errors)
