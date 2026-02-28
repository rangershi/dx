---
name: pr-review-loop
description: pr 审查
---

## 输入

- `PR_NUMBER`
- `round`（默认 1，由编排器控制）
# PR 审核闭环（技能主编排）

本文件是该技能的**唯一编排真值源**。不要再依赖独立的编排 md 文件。

## 适用场景

- 用户要求对某个 GitHub PR 执行“审核 -> 修复 -> 再审核”的循环。
- 需要严格执行 `runId` 透传、`./.cache` 交接、Decision Log 持久化。
- 需要确保修复动作由专职 `fixer` 角色执行，而不是编排器直接改代码。

## 目录约定

- 子代理说明：`${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/references/agents/*.md`
- 确定性脚本：`${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/scripts/*.py`
- 缓存目录：`./.cache/`
- 网络要求：`reviewer / aggregator / fixer ` 角色应启用 `network_access = true`。

## 输入

- `PR_NUMBER`
- `round`（默认 1，由编排器控制）

## runId（强制）

- 格式：`<PR>-<ROUND>-<HEAD_SHORT>`
- 生成者：`pr_context.py`（或 precheck 输出中的同格式值）
- 后续所有阶段仅允许透传，禁止重算或篡改。

## 角色分工（强制）

- `reviewer`：并行执行审查，产出 reviewFile。
- `fixer`：执行修复、提交推送、维护 decision-log、产出 fixReportFile。
- `spark`：通用agent 根据提示词执行通用任务。

## 阶段 0：预检 gate（必须先通过）

reviewer 配置检测由 `pr-precheck` 执行，并且必须在其他预检动作之前完成。

调用 `spark`，输入：
--prompt： `${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/references/agents/pr-precheck.md`
--others： `PR #<PR_NUMBER> - round <1>`

处理规则：

- 若返回 `{"ok":true}`：进入下一阶段。
- 若返回 `{"error":"..."}`：立即终止流程，不重试；直接透传 precheck 的简短失败原因（可附带 `fixFile`）。

说明：阶段 0 是强 gate，不允许修复后重跑，也不进入“错误分级与重试”。


## Step 1: 生成上下文（串行）

调用 `spark`，输入：
--prompt： `${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/references/agents/pr-context.md`
--others： `PR #<PR_NUMBER> - round <1>`

- 等待 spark 返回，输出必须包含 `contextFile`、`runId`、`headOid`。
- 检查 `./.cache/decision-log-pr<PR_NUMBER>.md` 是否存在，存在则后续传给 reviewer 以供决策过滤。
- 若失败：按“错误分级与重试”处理。


## 阶段 2~N：最多 3 轮循环
### Step 2: reviewers 并行（唯一允许并行阶段）

并行调用同一个 `reviewer` 角色的多个实例（提示词驱动实体），提示词来源为项目根目录：

- 使用阶段 0（precheck）已确认可用的 `./reviewer/*-reviewer.md` 列表，发现几个文件就并行启动几个 reviewer 实例（1..N）。
- 每个文件中的 `ROLE_CODE = <CODE>` 用于统一命名产物和 findings 前缀。

每个 reviewer 实例输入至少包含：

- `PR #<PR_NUMBER>`
- `round: <ROUND>`
- `runId: <RUN_ID>` 来自 Step 1 的输出，必须透传，禁止自行生成）
- `contextFile: ./.cache/<file>.md`
- `reviewerPromptFile: ./reviewer/<name>-reviewer.md`
- `decisionLogFile: ./.cache/decision-log-pr<PR_NUMBER>.md`（若存在）

执行要求：

- reviewer 必须先读取 `reviewerPromptFile`，并严格按其中规则执行。
- 当通用 reviewer 约束与 `reviewerPromptFile` 冲突时，以 `reviewerPromptFile` 为准。
- 每个 reviewer 产物命名必须使用其 `ROLE_CODE`：`./.cache/review-<ROLE_CODE>-pr<PR_NUMBER>-r<ROUND>-<RUN_ID>.md`。

每个 reviewer 实例输出：

- `reviewFile: ./.cache/review-<ROLE_CODE>-pr<PR_NUMBER>-r<ROUND>-<RUN_ID>.md`

### Step 3: 聚合（模式 A）

调用 `spark`，输入：
--prompt： `${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/references/agents/pr-review-aggregate.md`
--others： `contextFile + 1..n reviewFile + runId (+ decisionLogFile) + 模式 A`。

- 输出 `{"stop":true}`：进入 Step 7 本轮结束退出循环。
- 输出 `{"stop":false,"fixFile":"..."}`：进入 Step 4。
- 输出 `{"error":"GH_PR_COMMENT_FAILED"}`：按可重试错误处理，优先重试本步骤（脚本幂等，重复调用安全）。
- 其他 `{"error":"..."}`：按“错误分级与重试”处理。

### Step 4: 修复（必须委托 fixer）

**此步禁止 orchestrator 直接修复代码。**

必须调用 `fixer`，输入：

- `PR #<PR_NUMBER>`
- `round: <ROUND>`
- `runId: <RUN_ID>`
- `fixFile: ./.cache/<file>.md`

期望输出：

- `fixReportFile: ./.cache/<file>.md`

### Step 5: 发布修复报告（模式 B）

调用 `spark`，输入：
--prompt： `${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/references/agents/pr-review-aggregate.md`
--others： `fixReportFile + runId + round` + 模式 B`。


- 期望输出：`{"ok":true}`
- 若返回 `{"error":"GH_PR_COMMENT_FAILED"}`：按可重试错误处理后再判定终止。

### Step 6: 下一轮

- 轮次 round +1，回到 Step 2。
- 总轮次上限 3。

## Step 7 收尾（强制）

- 若某轮 Step 3 返回 `stop=true`：发布 final-report = `RESOLVED`。
- 若达到 3 轮仍未 stop：发布 final-report = `MAX_ROUNDS_REACHED`。

final-report 由 `aggregator` 调用脚本发布，且幂等。

## 失败防护建议

- 如果日志显示“编排器直接改代码而非调用 fixer”，视为流程违约。
- 直接回滚该轮并重新执行，确保 Step 4 通过 `fixer` 完成。


## 编排硬规则（强制）

1. 除 reviewer 阶段外，其余步骤必须串行且 await 返回。
2. 每轮最多发布一次 Review Summary / Fix Report（由脚本幂等保证）。
3. `orchestrator` **禁止直接修改业务代码**。
4. 当 aggregate 返回 `stop=false` 时，`orchestrator` **必须调用 `fixer` 角色**处理 `fixFile`。
5. 如果无法调用 `fixer`，必须终止并返回 `{"error":"FIXER_NOT_INVOKED"}`（或等价错误），禁止降级为 orchestrator 自修。

## 错误分级与重试（强制）

默认策略不是“见 error 立刻终止”，而是先分级：

1. 可重试错误：先重试再决定终止。
2. 不可恢复错误：立即终止。

例外：阶段 0（预检 gate）不适用本节重试策略；除 `ok:true` 外，其余返回（含任意 `error`）都必须立即终止。

### 可重试错误（建议最多 2 次重试，合计最多 3 次尝试）

- `GH_PR_COMMENT_FAILED`
- `HARVEST_FAILED`
- `AGGREGATE_SCRIPT_FAILED`
- `PR_CONTEXT_SCRIPT_FAILED`
- `GIT_PUSH_FAILED_NETWORK`
- 其他明显网络抖动/平台瞬时错误（例如 gh API 超时）

重试要求：

- 使用**同一组输入**重试同一步骤（保持 `runId` 不变）。
- 使用退避：第 1 次重试前等待 2 秒，第 2 次重试前等待 5 秒。
- 可先做轻量自愈检查：`gh auth status`、`git remote get-url origin`、必要时重跑本步骤脚本。
- 若是 `fixer` 推送失败，错误码统一为 `GIT_PUSH_FAILED_NETWORK`，由编排器按可重试错误处理。
- 若重试后成功，继续流程，不得误判为终止。
- 若重试仍失败，才终止当前轮。

### 不可恢复错误（立即终止）

- 参数/协议错误：`INVALID_ARGS`、`MISSING_*`
- 环境错误：`NOT_A_GIT_REPO`、`GH_CLI_NOT_FOUND`
- 权限/资源错误：`PR_NOT_FOUND_OR_NO_ACCESS`
- 流程违约错误：`FIXER_NOT_INVOKED`


执行原则：
- 优先调用 `${CODEX_HOME:-$HOME/.codex}/skills/pr-review-loop/scripts/*.py` 作为确定性真值源。
- 不在编排层做“聪明猜测”来替代脚本返回。
- 对外输出只保留关键状态、产物路径与下一步动作。
