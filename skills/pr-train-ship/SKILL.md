---
name: pr-train-ship
description: 仅在用户显式调用 $pr-train-ship 或明确要求使用 pr-train-ship 技能时使用；不要通过关键词自动触发。
---

# PR Train Ship — PR 审查 · 修复 · 自动合并

## Overview

接收一个**已存在的 PR 编号**，跑 **双源审查（≤3 轮）→ 双 comment → 修复循环 → 验证总结 → `gh pr merge --squash --auto` → 等真 merge 到 main**。Train 模式下严格串行：本 PR 真合并后才允许调用方启动下一 PR。

**不负责** commit / push / 创建 PR — 这些由 `feature-decide-plan-execute` 完成后把 PR 编号交给本 skill。

## Scope

显式调用 / 上游 skill 显式 handoff 才进入。

**输入：**

```
$pr-train-ship --pr <PR_NUMBER>
# 或
$pr-train-ship                  # 自动从当前分支查 PR
```

**前提：**

- PR 已存在（`gh pr view <num>` 能查到）
- PR 已 push 最新代码（本 skill 不再 push 业务代码，仅 push 修复审查问题产生的 commit）
- 上游 `feature-decide-plan-execute` 已跑过本地 lint/build/test 全绿（本 skill 仍会在 subagent 里复跑作为门禁）

**不要用：** 用户未显式调用；PR 还没创建（先用 `feature-decide-plan-execute` 或 `git-pr-ship`）；纯讨论。

## 执行原则

- 全程中文输出。
- **每修复一个问题立即 commit 一次**，禁止攒到最后。
- AI 自主判断是否拒绝某个问题，**拒绝必须写明理由**。
- 扫描中顺便发现的同文件历史遗留问题视同本次问题修复；**不以"历史遗留"或"超出本 PR 范围"为唯一理由跳过**。但不主动扩大扫描范围。
- **预存的 lint / build / test 错误顺手修**：验证流水线（主线 A）跑出来的失败，即便不是本 PR diff 引入的（main 上原本就坏 / 别人 PR 引入 / 环境历史问题），也必须当作本轮问题修复并 commit，禁止以"非本 PR 引入"为由跳过、降级或留 TODO。无法在本 skill 内修复（如需大规模重构 / 跨服务协同）→ 必须新建 follow-up Issue 并在 PR body / 审核报告里附编号，不允许只口头说一下。
- 上次跑完测试 / lint 后改过代码 → 必须重跑验证。
- 使用 **heredoc** 写 commit message / `gh` 命令 body（禁止 `\n` 字面量）。
- **零业务代码改动**：本 skill 只产出修复审查问题的 commit，不做主功能代码改动（那是 `feature-decide-plan-execute` 的事）。

---

## 阶段一：上下文加载

```bash
# 输入 PR 编号
PR_NUMBER=<num>

# 拉取 PR 信息
gh pr view $PR_NUMBER --json number,title,headRefName,baseRefName,state,mergeable,mergeStateStatus,statusCheckRollup,url,body,author

# 切到 PR 对应分支
PR_BRANCH=$(gh pr view $PR_NUMBER --json headRefName --jq .headRefName)
git fetch origin "$PR_BRANCH"
git checkout "$PR_BRANCH"
git pull
```

**自动提取上下文：**

- **Issue ID** — 从 PR body `Closes: #<id>` / `Refs: #<id>` 提取
- **Train 序号**（如有）— 从 PR body 顶部 `**PR Train:** N/Total（依赖 #X）` 提取；保存 `DEPENDS_ON_PR` 用于 Hard Gate 检查
- **PR 状态** — `state` 必须为 `OPEN`；若已 merged/closed，本 skill 输出"PR 已终态"结束

### Train 依赖检查（PR body 含 `PR Train` 标记时执行）

```bash
# 提取依赖 PR 编号
DEPENDS=$(gh pr view $PR_NUMBER --json body --jq .body | grep -oE '依赖 #[0-9]+' | grep -oE '[0-9]+')

if [ -n "$DEPENDS" ]; then
  MERGED=$(gh pr view $DEPENDS --json mergedAt --jq .mergedAt)
  if [ "$MERGED" = "null" ] || [ -z "$MERGED" ]; then
    echo "依赖 PR #$DEPENDS 尚未 merge 到 main，本 skill 拒绝继续"
    exit 1
  fi
fi
```

依赖未 merge → 直接结束本 skill，提示调用方等待。

---

## 阶段二：合并冲突检测

```bash
git fetch origin main
git merge --no-commit --no-ff origin/main
```

- 无冲突 → `git merge --abort` 撤回，继续阶段三
- 有冲突 →
  1. `git merge --abort`
  2. `git merge origin/main` 解冲突
  3. Commit：
     ```bash
     git add -A
     git commit -F - <<'MSG'
     merge: 解决与 main 的合并冲突

     - <冲突文件及解决方式>

     Refs: #<issue-id>
     MSG
     ```
  4. `git push`
  5. 标 `CODE_CHANGED_SINCE_LAST_CHECK=true`

---

## 阶段三：审查修复循环（≤3 轮）

循环变量：`ROUND=1`，`MAX_ROUNDS=3`，`CODE_CHANGED_SINCE_LAST_CHECK=true`

### 3.1 验证流水线 + 代码审查 + Issue 验收（并行启动 4 个 subagent）

仅在 `CODE_CHANGED_SINCE_LAST_CHECK=true` 时跑验证流水线（主线 A）。主线 B/C 每轮都跑。

**审查方式对齐 `git-pr-ship` 阶段四 4.1**：3 个 subagent 分别做 3 件事（验证 / 架构审查 / 逻辑审查），**额外**再派 1 个 subagent 做 Issue 验收检查（PR 是否真的实现了关联 Issue 的功能）。共计 **4 个 subagent 并行**。

> **关键约束**：所有 subagent（主线 A 验证 / 审查者 A / 审查者 B / 主线 C Issue 验收）**只向主 agent 返回结果文本，禁止自行调用 `gh pr comment` 或任何方式直接发布 PR 评论**。只有主 agent 在 3.3 / 3.5 / 3.7 发布唯一汇总报告。违反 → PR 上会出现多条重复审核报告。

**主线 A：验证流水线（subagent 串行有错即停）**

派独立 subagent（后台运行）。不要在主 agent 直接跑——主 agent 易被打断。

Subagent prompt：

```
你是验证流水线执行者。严格按顺序执行，任一步骤失败立即停止，不执行后续。

【重要】只负责执行验证并返回结果文本。禁止调用 gh pr comment 或以任何方式直接发评论。

【重要】返回的失败错误必须完整原样输出（含文件:行号 / 报错栈），不要做"是否本 PR 引入"的判断——主 agent 会统一处理，所有 lint/build/test 错误（含历史遗留）都要修。

Step 1: dx lint
- 失败：记录所有错误，停止
- 通过：继续

Step 2: dx build affected --dev
- 失败：记录错误，停止
- 通过：继续

Step 3: 运行关联测试（按改动范围判断）
- 后端改动 (apps/backend/)：识别受影响 E2E -> dx test e2e backend <file-or-dir>；受影响 *.spec.ts 按文件运行
- 前端改动 (apps/front/)：dx test unit front
- 管理端改动 (apps/admin-front/)：dx test unit admin
- 无相关改动测试：跳过

返回格式：
- 执行到第几步
- 每步通过/失败
- 失败步骤完整错误输出
```

完成后设 `CODE_CHANGED_SINCE_LAST_CHECK=false`。

**主线 B：代码审查**

**第一轮：双源审查（必须）**

派两个独立 subagent：

**审查者 A** — 架构与代码质量：

```
作为资深架构师审查 PR #<PR_NUMBER> 的 diff，关注架构合理性、SOLID、错误处理、性能、安全。
审查 diff 涉及的文件时如顺便发现同一文件内的历史遗留问题，也一并报告（不主动扩大到 diff 之外）。

【重要】只返回审查结果文本。禁止调用 gh pr comment 或任何方式发评论——主 agent 统一发布。

获取 diff：gh pr diff <PR_NUMBER>
```

**审查者 B** — 逻辑缺陷与规范：

```
作为质量工程师审查 PR #<PR_NUMBER> 的 diff，关注逻辑缺陷、边界条件、命名规范、类型安全、测试覆盖。
审查 diff 涉及的文件时如顺便发现同一文件内的历史遗留问题，也一并报告（不主动扩大）。

【重要】只返回审查结果文本。禁止调用 gh pr comment 或任何方式发评论——主 agent 统一发布。

获取 diff：gh pr diff <PR_NUMBER>
```

> ⚠️ **禁止使用 `code-review` 技能或 `oh-my-claudecode:code-reviewer` agent** —— 这些工具内置自动发 PR 评论行为，导致重复审核报告。必须用裸 subagent 并显式约束"禁止发评论"。

**主线 C — Issue 验收检查者**（独立 subagent，每轮必须派）：

目的：审 PR diff 是否真把关联 Issue 的"验收标准 / 目标"逐条落地，避免「代码改了但功能没做完」「PR 描述说做了但 diff 里没体现」。

```
作为产品验收审查者，验证 PR #<PR_NUMBER> 是否实现了关联 Issue 的全部功能。

【任务步骤】
1. 提取关联 Issue ID：gh pr view <PR_NUMBER> --json body --jq .body | grep -oE '(Closes|Refs):\s*#[0-9]+'
2. 拉 Issue 全文：gh issue view <issue-id> --json title,body,state,labels
3. 拉 PR diff 与描述：gh pr diff <PR_NUMBER> 与 gh pr view <PR_NUMBER> --json title,body
4. 逐条比对 Issue 「验收标准」「目标」「方案」三节与 PR 的实际改动：
   - 每条验收标准 → 在 diff 中找到对应实现位置（文件:行号），标记 ✅ 已实现 / ⚠️ 部分实现 / ❌ 未实现 / ➕ 超出范围
   - 「部分实现」必须写明欠缺什么；「未实现」必须写明该在哪个文件做
   - 若 Issue 无明确验收标准，按「目标」一节推断应有的可观察结果

【输出格式】
## Issue 验收报告
- Issue：#<id> <标题>
- 验收标准条目数：N

| # | 验收标准 | 状态 | 证据 / 欠缺 |
|---|----------|------|------------|
| 1 | <原文> | ✅/⚠️/❌ | <文件:行号 或 欠缺描述> |

## 结论
- 全部完成 / 部分完成（欠 X 条）/ 严重缺失（欠 Y 条核心项）
- 建议：通过 / 补做 / 拆 follow-up Issue

【重要】只返回上述报告文本。禁止调用 gh pr comment 或任何方式发评论——主 agent 统一发布。禁止改代码。
```

主线 C 的产出会被纳入 3.2 问题汇总，「❌ 未实现」「⚠️ 部分实现」按 **Critical / Major** 处理（详见 3.2 严重级映射）。

**第二轮及以后：按需降级**

- 单源审查（默认）：上一轮修复少 / 仅 Minor / 改动集中少数文件 → 派一个 subagent
- 双源审查：改动大 / 涉核心逻辑 / 上一轮有 Critical 修复 → 仍派两个
- **主线 C Issue 验收**：每轮都派，不降级（功能完成度必须每轮复核，因修复可能引入新的偏离）

是否进第二/三轮：

- 上一轮全部修复且改动简单（仅格式/命名）→ 跳过后续审查，直接最终验证
- 上一轮有 Critical/Major 修复 → 应进下一轮

### 3.2 问题汇总与去重

汇总主线 A（lint/build/test 失败）、主线 B（架构 / 逻辑审查发现）、主线 C（Issue 验收偏离）所有问题。

**主线 A 错误一律纳入本轮问题**：不区分"本 PR 引入"还是"历史遗留"，全部按 Critical / Major 处理并修复。确实无法在本 skill 内修（跨服务 / 大规模重构）→ 在审核报告 + PR body 双处登记 follow-up Issue 编号后才能放行。

**主线 C 严重级映射：**

- ❌ 未实现核心验收标准 → **Critical**
- ⚠️ 部分实现 / 欠缺边界 → **Major**
- ➕ 超出 Issue 范围且无说明 → **Major**（要求 PR body 补释，或拆 follow-up Issue）

**去重规则：**

- 同文件同行同类问题 → 合并，保留更详细描述
- 同根因多个测试失败 → 合并，附所有失败用例名
- 多个审查者指同一问题 → 综合描述合并

**严重级分配：**

- **Critical** — 构建失败 / 测试失败 / 安全漏洞 / 数据丢失风险
- **Major** — 逻辑缺陷 / 错误处理缺失 / 性能问题
- **Minor** — 命名 / 风格 / 文档

### 3.3 发布审核报告到 PR

无问题 → 跳 3.6 通过流程。

```bash
gh pr comment $PR_NUMBER --body-file - <<'MSG'
## 审核报告（第 N 轮）

### 概要
- Critical：X 个
- Major：Y 个
- Minor：Z 个

### Issue 验收结果（主线 C）
- Issue：#<id>
- 验收标准：N 条，✅ a / ⚠️ b / ❌ c
- 结论：[全部完成 / 部分完成 / 严重缺失]

### Critical 问题
| # | 来源 | 文件:行号 | 描述 |
|---|------|-----------|------|
| 1 | Lint/构建/测试/验收 | path/to/file:42 | 描述 |

### Major 问题
| # | 来源 | 文件:行号 | 描述 |
|---|------|-----------|------|

### Minor 问题
| # | 来源 | 文件:行号 | 描述 |
|---|------|-----------|------|

### 处理决策
逐条标 修/拒（拒绝附 ≥1 句理由）

---
*审查工具：dx lint -> dx build -> dx test + 双源代码审查 + Issue 验收检查*
MSG
```

### 3.4 逐项修复

按严重级从高到低。

每个问题：

1. **判断修/拒**：
   - 修：执行修改（含同文件历史遗留问题）
   - 拒：记录理由（误报 / 设计意图）。"历史遗留" / "超出本 PR 范围"不是合法唯一理由
2. **修复后立即 commit**（一问题一 commit）：

```bash
git add <修改文件>
git commit -F - <<'MSG'
fix: 修复审查问题 #<问题编号> — <简要描述>

- <具体改动说明>

Refs: #<issue-id>
MSG
```

3. 标 `CODE_CHANGED_SINCE_LAST_CHECK=true`

### 3.5 发布修复报告 + 推送

```bash
git push
```

```bash
gh pr comment $PR_NUMBER --body-file - <<'MSG'
## 修复报告（第 N 轮）

### 已修复
| # | 问题 | 修复方式 | Commit |
|---|------|----------|--------|
| 1 | [描述] | [说明] | abc1234 |

### 拒绝修复
| # | 问题 | 理由 |
|---|------|------|
| 1 | [描述] | [理由：误报/设计意图/超出范围] |

### 统计
- 总问题数：X
- 已修复：Y
- 拒绝修复：Z
MSG
```

### 3.6 决定是否下一轮

**通过条件**（任一）：

- 本轮零问题
- 已达 `MAX_ROUNDS`（3 轮）
- 所有问题已修复且改动简单（仅格式/命名）

**继续下一轮条件**（全满足）：

- `ROUND < MAX_ROUNDS`
- 本轮修过代码
- 存在 Critical/Major 修复（可能引入新问题）

继续 → `ROUND += 1`，回 3.1。

结束且 `CODE_CHANGED_SINCE_LAST_CHECK=true` → **最终验证**（串行 `dx lint` → `dx build affected --dev` → 关联测试，subagent 跑）。有失败修复 commit/push 后进 3.7；无失败直接 3.7。

结束且 `CODE_CHANGED_SINCE_LAST_CHECK=false` → 基于最近验证结果发 3.7。

### 3.7 发布验证总结报告

```bash
gh pr comment $PR_NUMBER --body-file - <<'MSG'
## ✅ 验证总结

### 门禁结果

| 步骤 | 状态 | 备注 |
|------|------|------|
| Lint (`dx lint`) | ✅ 通过 | |
| 构建 (`dx build affected --dev`) | ✅ 通过 | |
| 后端 E2E | ✅ 通过 | `dx test e2e backend <实际执行文件>` |
| 前端单测 | ⏭️ 跳过 | 无相关改动 |
| 管理端单测 | ⏭️ 跳过 | 无相关改动 |

### 审查统计

- 审查轮数：N
- 发现问题：X 个（Critical: a / Major: b / Minor: c）
- 已修复：Y 个
- 拒绝修复：Z 个

### 结论

所有质量门禁通过，PR 可合并。
MSG
```

> **基于实际结果填写，不编造**。失败后修复再通过 → 标"✅ 通过（修复后重跑）"。测试命令列写实际完整命令。

---

## 阶段四：自动合并

```bash
gh pr merge $PR_NUMBER --squash --auto
```

**禁止：**

- `gh pr merge --squash` 不带 `--auto`（绕过 CI）
- `--admin` 越权
- `--squash --auto || --squash` 短路 fallback

### Auto-merge 监控

设定 `--auto` 后等待 main 真合并：

```bash
# 监控 PR 状态（间隔轮询；stuck > 30 min 人工介入）
gh pr view $PR_NUMBER --json state,mergedAt,statusCheckRollup,mergeStateStatus
```

**正常路径**：CI 全绿后 GitHub 自动 merge → `mergedAt` 不为 null → 本 skill 完成。

**Stuck > 30 min**：人工介入，检查 CI / required reviews / branch protection。本 skill 输出"auto-merge stuck，需人工介入"提示，给出当前 `mergeStateStatus`，结束。

> Train 模式：本 PR 真正 merge 到 main 之前**调用方不允许启动下一 PR**。这是 train 串行的核心约束（由 `feature-decide-plan-execute` C-Step 3 阶段 1 的依赖检查兜底）。

---

## 阶段五：完成输出

```
PR Ship 完成！

- PR: #<PR_NUMBER> <链接>
- Issue: #<ID> <标题>
- 审查轮数：N
- 修复 commit 数：X
- 问题统计：发现 A 个 / 修复 B 个 / 拒绝 C 个
- 合并状态：✓ Auto-merge 已触发并合并到 main（merged_at=<ts>）

状态：✓ Lint 通过 ✓ 构建通过 ✓ 测试通过 ✓ 审查完成 ✓ 已合并

下一步（Train 模式）：可调用 feature-decide-plan-execute 继续下一 PR
```

---

## Hard Gates（不可跳过）

1. **输入 gate** — 必须有 PR 编号输入（或当前分支能查到 PR）。PR 不存在 → 拒绝执行，提示先用 `feature-decide-plan-execute` 建 PR。
2. **依赖串行 gate** — PR body 含 `PR Train` 标记时，依赖的上游 PR 必须已 merge 到 main（`mergedAt` 不为 null）才能继续。
3. **双 comment gate** — 每轮必须发**两条**评论：`审核报告`（issue table）+ `修复报告`（修复+拒绝 table）。**不允许合并成一条**。reviewer 用 review comment 决定 approve，用 fix comment 验证落实。
4. **Subagent 禁发评论 gate** — 验证流水线 / 审查者 / Issue 验收 subagent **只返回文本**，禁止自己 `gh pr comment`。主 agent 统一发布。
4.1. **4 subagent 并行 gate** — 阶段三 3.1 每轮必须并行派 4 个 subagent：主线 A 验证 + 审查者 A 架构 + 审查者 B 逻辑 + 主线 C Issue 验收。任一缺失视为流程违规。第二轮起代码审查可降级为单源，但 **主线 C 不可降级、不可跳过**。
4.2. **Issue 验收 gate** — 主线 C 报告「❌ 未实现核心验收标准」时，本轮不得跳到 3.6 通过流程；必须进入 3.4 修复（补做功能）或在 PR body 显式声明拆 follow-up Issue 并附编号，才能放行。
5. **禁用 code-review 技能 / code-reviewer agent gate** — 这些工具内置自动发评论。必须用裸 subagent。
6. **Auto-merge gate** — 最终合并只能 `gh pr merge --squash --auto`。禁止不带 `--auto`、禁止 `--admin`、禁止 fallback。
7. **不越界做业务代码改动** — 本 skill 只产出"修复审查问题"的 commit；新增功能 / 重构 / 拆 PR 等动作回退给 `feature-decide-plan-execute`。
8. **Heredoc gate** — `gh pr comment` / commit message 多行内容必须 heredoc，禁止 `--body "...\n..."`。
9. **真合并才算完成** — 设定 `--auto` 后必须监控 `mergedAt`；stuck > 30 min 人工介入，不允许伪造完成态。
10. **预存错误零放行 gate** — 验证流水线报的任何 lint / build / test 失败（含非本 PR 引入的历史遗留）都必须在本 skill 内修复并 commit；确实无法当场修 → PR body + 审核报告双处登记 follow-up Issue 编号才能放行。禁止"非本 PR 引入"、"main 上本来就坏"、"先合了再说"等理由跳过。

## Critic 决策矩阵

| 严重级 | 默认决策 | 例外 |
|--------|---------|------|
| **Critical** | 必修 | 无 |
| **Major** | 修，除非有书面 out-of-scope 理由 | 转 follow-up issue |
| **Minor** | 修复 if < 5 行；否则附理由拒绝 | "超出本 PR 范围"不是唯一合法理由 |
| **What's Missing** | 转 follow-up issue 或纳入拒绝理由 | 历史遗留需明示 |

## Quick Reference

| 操作 | 命令 |
|------|------|
| 查 PR | `gh pr view <num> --json ...` |
| 拉 PR 分支 | `git fetch origin <branch> && git checkout <branch> && git pull` |
| 查 PR diff | `gh pr diff <num>` |
| 查依赖 PR 是否 merged | `gh pr view <dep> --json mergedAt --jq .mergedAt` |
| 冲突检测 | `git fetch origin main && git merge --no-commit --no-ff origin/main` |
| 发审核报告 | `gh pr comment <num> --body-file - <<'MSG' ... MSG` |
| 发修复报告 | 同上（不同模板） |
| 发验证总结 | 同上（验证总结模板） |
| 自动合并 | `gh pr merge <num> --squash --auto` |
| 监控合并状态 | `gh pr view <num> --json state,mergedAt,mergeStateStatus` |

## Common Mistakes

| 错误 | 加固 |
|------|------|
| 没传 PR 编号也没法从当前分支查到 | Hard Gate 1：先用 `feature-decide-plan-execute` 建 PR |
| 验证流水线 / 审查 / Issue 验收 subagent 自己 `gh pr comment` | Hard Gate 4：subagent 只返回文本 |
| 阶段三只派 3 个 subagent，漏掉 Issue 验收 | Hard Gate 4.1：必须 4 个并行 |
| Issue 验收报 ❌ 但 PR 直接合并 | Hard Gate 4.2：要么补做要么拆 follow-up Issue |
| 用 `code-review` 技能 / `code-reviewer` agent | Hard Gate 5：必须裸 subagent |
| 把 review + fix 合并成一条评论 | Hard Gate 3：双 comment 必须分开 |
| `gh pr merge --squash` 不带 `--auto` | Hard Gate 6：绕过 CI |
| `gh pr merge --squash --auto \|\| --squash` 短路 fallback | 同上 |
| Train 依赖 PR 未 merge 就开始本 skill | Hard Gate 2：依赖串行 |
| 在本 skill 内做新功能业务代码改动 | Hard Gate 7：回退给 `feature-decide-plan-execute` |
| commit message / PR body 用 `\n` 字面量 | Hard Gate 8：必须 heredoc |
| 设 `--auto` 后不监控 `mergedAt` 就声称完成 | Hard Gate 9：必须真合并 |
| Auto-merge stuck > 30 min 不介入 | 检查 CI / 必需 reviews / branch protection |
| 拒绝修复只写"超出范围" | 必须 ≥1 句具体理由 |
| 主线 A 报的 lint/build/test 错误标"非本 PR 引入"跳过 | Hard Gate 10：预存错误零放行，必须修或登记 follow-up Issue |
| 把历史遗留 lint 错误留 TODO 不修 | Hard Gate 10：当场修；修不动就开 Issue 登记，不留口头承诺 |
| 简单改动跳过双 comment 直接 squash | 流程一致，避免漏掉历史遗留问题 |

## Tie-In With Other Skills

- `feature-decide-plan-execute` — 上游：建好 PR 后把 PR 编号交给本 skill
- `oh-my-claudecode:critic` agent — 阶段三审查子任务可调度（约束"禁发评论"）
