# pr-review-loop 技能目录说明

本目录用于在当前仓库内运行 PR 审核闭环，不依赖历史外置目录。

## 目录结构

- `SKILL.md`：技能入口 + 主编排（唯一真值源）
- `agents/openai.yaml`：技能 UI 元数据
- `references/agents/*.md`：子代理输入输出契约
- `scripts/*.py`：确定性脚本（context/harvest/aggregate）

## 快速验证

```bash
python3 -m pytest -q "${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/scripts/test_pr_review_aggregate.py"
```

## 核心约束

- 缓存统一使用 `./.cache/`
- `runId` 必须透传，禁止下游重算
- reviewer 可并行，其它步骤严格串行
- 修复阶段必须调用 `fixer`，编排器不得直接修代码
- 错误处理采用“分级重试优先”，不是“见 error 立刻终止”
- 需要联网步骤的角色显式配置 `network_access = true`
