---
allowed-tools: [Bash, Read, Glob, TodoWrite, Edit, Grep, Task]
description: '循环审核修复'
agent: sisyphus
---

# PR Review Loop

## Stacked PR / PR -> PR（重要）

- 本流程的 diff 基准来自 GitHub PR 元数据的 `baseRefName`（不是硬编码 main/master），因此天然支持“PR 合并到另一个 PR 分支”的 stacked PR。
- 当 `baseRefName` 缺失时：会回退到仓库默认分支（`defaultBranchRef.name`）。
- 当 base 分支 fetch 失败时：会直接报错终止（不再静默回退到 main/master），避免 review/changed-files 基准悄悄跑偏。

## 输入

- `{{PR_NUMBER}}`

## Cache 约定（强制）

- 本流程所有中间文件都存放在项目内：`./.cache/`
- agent/命令之间传递**repo 相对路径**（例如：`./.cache/pr-context-...md`），不要只传 basename

## 固定 subagent_type（直接用 Task 调用，不要反复确认）

- `pr-precheck`
- `pr-context`
- `codex-reviewer`
- `claude-reviewer`
- `gemini-reviewer`
- `gh-thread-reviewer`
- `pr-review-aggregate`
- `pr-fix`


## 预检

0. Task: `pr-precheck`（强制 gate：编译/预检必须先通过）

- prompt 必须包含：`PR #{{PR_NUMBER}}`
- 若返回 `{"error":"..."}`：立即终止本轮并回传错误（不再调用 reviewers）
- 若返回 `{"ok":false,"fixFile":"..."}`：
  - 最多修复 2 次（防止无限循环）：
    - 第 1 次：Task `pr-fix`（使用该 fixFile）→ 再 Task `pr-precheck`
    - 若仍返回 `{"ok":false,"fixFile":"..."}`：第 2 次 Task `pr-fix` → 再 Task `pr-precheck`
  - 若仍不是 `{"ok":true}`：终止并回传错误（建议：`{"error":"PRECHECK_NOT_CLEAN_AFTER_FIX"}`）


## 循环（最多 3 轮）

**⚠️ 严格串行执行要求（Critical）**:

- 每个 Step 必须完成（收到返回值）后才能开始下一个 Step
- **禁止任何步骤并行执行**（除了 Step 2 的三个 reviewer 可并行）
- 如果任何步骤失败或超时，必须立即终止当前轮次，不能跳过或重试
- 每个步骤的 Task 调用必须 await 返回结果，不能 fire-and-forget

每轮按顺序执行：

1. Task: `pr-context` **（必须先完成，不可与 Step 2 并行）**

- prompt 必须包含：`PR #{{PR_NUMBER}}`、`round: <ROUND>`
- 若返回 `{"error":"..."}`：立即终止本轮并回传错误（不再调用 reviewers）
- 取出：`contextFile`、`runId`、`headOid`（如有）
- **CRITICAL**: 必须等待此 Task 成功完成并获取到 `contextFile` 后，才能进入 Step 2

**检查 Decision Log**：
- 检查是否存在 `./.cache/decision-log-pr{{PR_NUMBER}}.md`
- 如存在，将路径记录为 `decisionLogFile`（用于后续步骤）
- 如不存在，`decisionLogFile` 为空或不传递

2. Task（并行）: `codex-reviewer` + `claude-reviewer` + `gemini-reviewer` + `gh-thread-reviewer` **（依赖 Step 1 的 contextFile 和 decisionLogFile）**

- **DEPENDENCY**: 这些 reviewers 依赖 Step 1 返回的 `contextFile` 和 `decisionLogFile`（如存在），因此**必须等 Step 1 完成后才能并行启动**
- 每个 reviewer prompt 必须包含：
  - `PR #{{PR_NUMBER}}`
  - `round: <ROUND>`
  - `runId: <RUN_ID>`（来自 Step 1 的输出，必须透传，禁止自行生成）
  - `contextFile: ./.cache/<file>.md`（来自 Step 1 的输出）
  - `decisionLogFile: ./.cache/decision-log-pr{{PR_NUMBER}}.md`（如存在，来自检查后得出）
- reviewer 默认读 `contextFile`；如果 `decisionLogFile` 存在，reviewer 应在 prompt 中提供该文件路径以参考前轮决策；必要时允许用 `git/gh` 只读命令拿 diff
- 忽略问题：1.格式化代码引起的噪音 2.已经lint检查以外的格式问题 3.忽略单元测试不足的问题
- 特别关注: 逻辑、安全、性能、可维护性
- 同时要注意 pr 前面轮次的 修复和讨论，对于已经拒绝、已修复的问题不要反复的提出
- 同时也要注意fix的过程中有没有引入新的问题。

备注：fixFile 分为 `IssuesToFix`（P0/P1，必须修）与 `OptionalIssues`（P2/P3，pr-fix 自主裁决）。
- 每个 reviewer 输出：`reviewFile: ./.cache/<file>.md`（Markdown）

3. Task: `pr-review-aggregate`

- prompt 必须包含：`PR #{{PR_NUMBER}}`、`round: <ROUND>`、`runId: <RUN_ID>`、`contextFile: ./.cache/<file>.md`、以及 1+ 条 `reviewFile: ./.cache/<file>.md`、以及 `decisionLogFile: ./.cache/decision-log-pr{{PR_NUMBER}}.md`（如存在）
- 输出：`{"stop":true}` 或 `{"stop":false,"fixFile":"..."}`
- 若 `stop=true`：本轮结束并退出循环
- **唯一性约束**: 每轮只能发布一次 Review Summary；脚本内置幂等检查，重复调用不会重复发布

4. Task: `pr-fix`

- prompt 必须包含：
  - `PR #{{PR_NUMBER}}`
  - `round: <ROUND>`
  - `runId: <RUN_ID>`（来自 Step 1 的输出，必须透传，禁止自行生成）
  - `fixFile: ./.cache/<file>.md`
- 约定：`pr-fix` 对每个 findingId 单独 commit + push（一个 findingId 一个 commit），结束后再 `git push` 兜底

- pr-fix 输出：`fixReportFile: ./.cache/<file>.md`（Markdown）

5. Task: `pr-review-aggregate`（发布修复评论）

- prompt 必须包含：`PR #{{PR_NUMBER}}`、`round: <ROUND>`、`runId: <RUN_ID>`、`fixReportFile: ./.cache/<file>.md`
- 输出：`{"ok":true}`
- **唯一性约束**: 每轮只能发布一次 Fix Report；脚本内置幂等检查，重复调用不会重复发布

**Decision Log 更新**：
- `pr-fix` agent 在修复过程中会在 `./.cache/decision-log-pr{{PR_NUMBER}}.md` 中追加本轮决策（Fixed/Rejected）
- 下一轮 review 将自动使用更新后的 decision-log，避免重复提出已决策问题

6. 下一轮

- 回到 1（进入下一轮 reviewers）


## 终止与收尾（强制）

循环结束时，必须发布一个最终评论到 PR，格式如下：

### 情况 A: 所有问题已解决（stop=true）

当 Step 3 返回 `{"stop":true}` 时，调用 `pr-review-aggregate` 发布收尾评论：

- prompt 必须包含：
  - `PR #{{PR_NUMBER}}`
  - `round: <ROUND>`
  - `runId: <RUN_ID>`
  - `--final-report "RESOLVED"`（新增参数，表示所有问题已解决）

### 情况 B: 达到最大轮次（3 轮后仍有问题）

当循环完成 3 轮后仍未 stop，调用 `pr-review-aggregate` 发布收尾评论：

- prompt 必须包含：
  - `PR #{{PR_NUMBER}}`
  - `round: 3`
  - `runId: <RUN_ID>`
  - `--final-report "MAX_ROUNDS_REACHED"`（新增参数，表示达到最大轮次）

### 最终评论格式（由脚本生成）

```markdown
<!-- pr-review-loop-marker -->

## Final Report

- PR: #<PR_NUMBER>
- Total Rounds: <N>
- Status: ✅ All issues resolved / ⚠️ Max rounds reached (some issues may remain)

### Summary

[自动生成的总结]
```
