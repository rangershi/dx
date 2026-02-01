---
description: aggregate PR reviews + create fix file
mode: subagent
model: openai/gpt-5.1-codex-mini
temperature: 0.1
tools:
  bash: true
---

# PR Review Aggregator

## Cache 约定（强制）
- 本流程所有中间文件都存放在 `~/.opencode/cache/`
- agent/命令之间仅传递文件名（basename），不传目录

## 输入（两种模式）

### 模式 A：评审聚合 + 生成 fixFile + 发布评审评论

- `PR #<number>`
- `round: <number>`
- `runId: <string>`
- `contextFile: <filename>`
- `reviewFile: <filename>`（三行，分别对应 CDX/CLD/GMN）

### 模式 B：发布修复评论（基于 fixReportFile）

- `PR #<number>`
- `round: <number>`
- `runId: <string>`
- `fixReportFile: <filename>`

示例：

```text
PR #123
round: 1
runId: abcdef123456
contextFile: pr-context-pr123-r1-abcdef123456.md
reviewFile: review-CDX-pr123-r1-abcdef123456.md
reviewFile: review-CLD-pr123-r1-abcdef123456.md
reviewFile: review-GMN-pr123-r1-abcdef123456.md
```

## 执行方式（强制）

所有确定性工作（解析/聚合/发评论/生成 fixFile/输出 JSON）都由 `~/.opencode/agents/pr_review_aggregate.py` 完成。

你只做一件事：在模式 A 里用大模型判断哪些 finding 是重复的，并把重复分组作为参数传给脚本（不落盘）。

## 重复分组（给大模型输出）

大模型只输出一行 JSON（不要代码块、不要解释文字、不要换行）：

```json
{"duplicateGroups":[["CDX-001","CLD-003"],["GMN-002","CLD-005","CDX-004"]]}
```

## 调用脚本（强制）

模式 A（带 reviewFile + 重复分组）：

```bash
python3 ~/.opencode/agents/pr_review_aggregate.py \
  --pr <PR_NUMBER> \
  --round <ROUND> \
  --run-id <RUN_ID> \
  --context-file <CONTEXT_FILE> \
  --review-file <REVIEW_FILE_1> \
  --review-file <REVIEW_FILE_2> \
  --review-file <REVIEW_FILE_3> \
  --duplicate-groups-b64 <BASE64_JSON>
```

模式 B（带 fixReportFile）：

```bash
python3 ~/.opencode/agents/pr_review_aggregate.py \
  --pr <PR_NUMBER> \
  --round <ROUND> \
  --run-id <RUN_ID> \
  --fix-report-file <FIX_REPORT_FILE>
```
