---
allowed-tools: [Bash, Read, Glob, TodoWrite, Edit, Grep, Task]
description: '循环审核修复'
agent: sisyphus
---

# PR Review Loop

## 输入

- `{{PR_NUMBER}}`

## 固定 subagent_type（直接用 Task 调用，不要反复确认）

- `pr-precheck`
- `pr-context`
- `codex-reviewer`
- `claude-reviewer`
- `gemini-reviewer`
- `pr-review-aggregate`
- `pr-fix`

## 循环（最多 2 轮）

每轮按顺序执行：

0. Task: `pr-precheck`（强制 gate：编译/预检必须先通过）

- prompt 必须包含：`PR #{{PR_NUMBER}}`
- 若返回 `{"error":"..."}`：立即终止本轮并回传错误（不再调用 reviewers）
- 若返回 `{"ok":false,"fixFile":"..."}`：
  - 最多修复 2 次（防止无限循环）：
    - 第 1 次：Task `pr-fix`（使用该 fixFile）→ 再 Task `pr-precheck`
    - 若仍返回 `{"ok":false,"fixFile":"..."}`：第 2 次 Task `pr-fix` → 再 Task `pr-precheck`
  - 若仍不是 `{"ok":true}`：终止并回传错误（建议：`{"error":"PRECHECK_NOT_CLEAN_AFTER_FIX"}`）

1. Task: `pr-context`

- prompt 必须包含：`PR #{{PR_NUMBER}}`、`round: <ROUND>`
- 若返回 `{"error":"..."}`：立即终止本轮并回传错误（不再调用 reviewers）
- 取出：`contextFile`、`runId`、`headOid`（如有）

2. Task（并行）: `codex-reviewer` + `claude-reviewer` + `gemini-reviewer`

- 每个 reviewer prompt 必须包含：
  - `PR #{{PR_NUMBER}}`
  - `round: <ROUND>`
  - `contextFile: <path>`
- reviewer 默认读 `contextFile`；必要时允许用 `git/gh` 只读命令拿 diff
- 忽略问题：1.格式化代码引起的噪音 2.已经lint检查以外的格式问题
- 特别关注: 逻辑、安全、性能、可维护性
- 每个 reviewer 输出：`reviewFile: <path>`（Markdown）

3. Task: `pr-review-aggregate`

- prompt 必须包含：`PR #{{PR_NUMBER}}`、`round: <ROUND>`、`runId: <RUN_ID>`、`contextFile: <path>`、三条 `reviewFile: <path>`
- 输出：`{"stop":true}` 或 `{"stop":false,"fixFile":"..."}`
- 若 `stop=true`：本轮结束并退出循环

4. Task: `pr-fix`

- prompt 必须包含：
  - `PR #{{PR_NUMBER}}`
  - `round: <ROUND>`
  - `fixFile: <path>`
- 约定：`pr-fix` 对每个 findingId 单独 commit + push（一个 findingId 一个 commit），结束后再 `git push` 兜底

- pr-fix 输出：`fixReportFile: <path>`（Markdown）

5. Task: `pr-review-aggregate`（发布修复评论）

- prompt 必须包含：`PR #{{PR_NUMBER}}`、`round: <ROUND>`、`runId: <RUN_ID>`、`fixReportFile: <path>`
- 输出：`{"ok":true}`

6. 下一轮

- 回到 0（先跑 precheck gate，再进入下一轮 reviewers）
