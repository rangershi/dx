---
name: pr-train-ship
description: 仅在用户显式调用 $pr-train-ship 或明确要求使用 pr-train-ship 技能时使用；不要通过关键词、任务类型或上下文自动触发。
---

# PR Train Ship — PR 审查 · 修复 · 自动合并

## Overview

接收一个**已存在的 PR 编号**，跑 **两波并行审查（Wave 1 验证+验收 → Wave 2 三源代码审查：审查者 A 架构 + 审查者 B 逻辑 + 审查者 C 系统 `/code-review`，≤3 轮）→ 审查质量自检 → 三 comment（验收/审查/修复）→ 修复循环 → 验证总结 → `gh pr merge --squash --auto` → 独立 subagent 等真 merge 到 main**。Train 模式下严格串行：本 PR 真合并后才允许调用方启动下一 PR。

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

### 3.1 验证流水线 + Issue 验收 + 代码审查（两波并行，共 4 个 subagent）

仅在 `CODE_CHANGED_SINCE_LAST_CHECK=true` 时跑验证流水线（主线 A）。主线 B/C 每轮都跑。

**核心改进**：subagent 不再"一次并行"，拆成 **两波**，避免主 agent 同时融合多份风格迥异的报告导致代码审查深度被稀释：

- **Wave 1（并行 2 个，事实层扫描）**：主线 A 验证流水线 + 主线 C Issue 验收。两者负责"流水线是否过关 / 功能是否到位"的事实层结论。
- **Wave 2（并行 3 个，深度审查）**：审查者 A 架构 + 审查者 B 逻辑 + 审查者 C 系统 `/code-review`。**必须把 Wave 1 的 Issue 验收结论作为 prompt 输入**，并反向约束："功能缺失主线 C 已覆盖，你只挑 diff 内的代码 bug，不要重复列功能缺失"。

> **审查者 C = 系统 `/code-review` 第三路**：在裸 subagent 内调用系统 `/code-review`（**禁带 `--comment` / `--fix`**），让它只读地扫 diff、返回 findings 文本给主 agent。系统 `/code-review` 裸跑本身就是只读不发评论不改码，与「主 agent 唯一发布者」架构兼容——它的 findings 与审查者 A/B 一样并入 3.2 汇总，由主 agent 在 3.3b 统一发布。**绝不允许 `--comment`（会绕过单发布者产生重复评论）或 `--fix`（会越权改业务代码，违反 Hard Gate 7）。**

Wave 1 失败不阻塞 Wave 2 启动；但 Wave 2 的 prompt 必须带 Wave 1 验收结论。

> **关键约束**：所有 subagent（主线 A 验证 / 主线 C Issue 验收 / 审查者 A / 审查者 B）**只向主 agent 返回结果文本，禁止自行调用 `gh pr comment` 或任何方式直接发布 PR 评论**。只有主 agent 在 3.3a / 3.3b / 3.5 / 3.7 发布唯一汇总报告。违反 → PR 上会出现多条重复审核报告。

**Wave 1 — 主线 A：验证流水线（subagent 串行有错即停）**

派独立 subagent（后台运行）。不要在主 agent 直接跑——主 agent 易被打断。

Subagent prompt：

```
你是验证流水线执行者。严格按顺序执行，任一步骤失败立即停止，不执行后续。

【重要】只负责执行验证并返回结果文本。禁止调用 gh pr comment 或以任何方式直接发评论。

【重要】返回的失败错误必须完整原样输出（含文件:行号 / 报错栈）。
针对每个失败，额外用 git blame 或 git log -L 判定该行最近一次修改是否在本 PR 提交范围内：
- 取 PR base sha：BASE=$(gh pr view <PR_NUMBER> --json baseRefOid --jq .baseRefOid)
- 取 PR head sha：HEAD=$(gh pr view <PR_NUMBER> --json headRefOid --jq .headRefOid)
- 对失败行运行 `git log $BASE..$HEAD --oneline -- <file>` 看是否有 commit；或 `git blame -L <line>,<line> <file>` 看作者 commit 是否在 $BASE..$HEAD 范围内
分类输出：
  [本 PR 引入]  <file>:<line> <错误>
  [历史遗留]    <file>:<line> <错误>
所有错误都要返回——分类是给主 agent 决定 commit 拆分用，不是允许跳过的依据（Hard Gate 10）。

Step 1: dx lint
- 失败：记录所有错误（按上面分类），停止
- 通过：继续

Step 2: dx build affected --dev
- 失败：记录错误（按上面分类），停止
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
- 每条错误的 [本 PR 引入] / [历史遗留] 分类标签
```

完成后设 `CODE_CHANGED_SINCE_LAST_CHECK=false`。

**历史遗留错误的 commit 隔离规则**（避免污染下一轮代码审查的 diff）：

- "本 PR 引入"失败 → 走 3.4 常规修复 commit（`fix:` 前缀，挂本 Issue）
- "历史遗留"失败 → **单独 commit**，前缀 `chore(precheck):`，commit body 写明"非本 PR diff 引入，按 Hard Gate 10 顺手修"；如确实修不动 → 不 commit，直接进入 Hard Gate 10 后半段（PR body + 审核报告双处登记 follow-up Issue 编号）
- 下一轮的代码审查 prompt 必须明确告知"本轮 commit 含历史遗留修复（commit hash: xxx），审查者请聚焦本 PR 业务 diff，不要在这些文件里做 nitpick"

**Wave 2 — 主线 B：代码审查**（必须在 Wave 1 主线 C 输出可用后再启动，A/B prompt 中嵌入主线 C 验收结论）

**第一轮：三源审查（必须）**

派三个独立 subagent（审查者 A 架构 + 审查者 B 逻辑 + 审查者 C 系统 `/code-review`）。**三个 prompt 都必须先嵌入主线 C 输出，再说明任务**：

**审查者 A** — 架构与代码质量：

```
【背景：主线 C Issue 验收结论已就位】
<这里粘贴主线 C 完整报告：验收标准条目数、✅/⚠️/❌ 表格、结论>

你是资深架构师，审查 PR #<PR_NUMBER> 的 diff。

【关注点】架构合理性、SOLID、错误处理、性能、安全、并发安全、资源泄漏、跨模块耦合。
【反向约束】Issue 验收已由主线 C 覆盖——你不要在报告里重复列「功能未实现 / 部分实现」，专注 diff 内代码层 bug。门禁 / 流程合规问题也不在你的范围内。
【范围】审查 diff 涉及的文件时如顺便发现同一文件内的历史遗留代码 bug 也报告（不主动扩大到 diff 之外）。本轮若 commit 含 `chore(precheck):` 历史遗留修复 commit，列入审查范围的代码 diff 排除这些 commit 的改动。

【输出格式】每条问题必须给出：
- 严重级（Critical / Major / Minor）
- 文件:行号
- 问题描述（≥1 句具体说明，禁止"建议优化"这类含糊表述）
- 建议改法（具体到代码层面，不写"考虑使用 X 模式"这种空话）
缺任一字段视为该条无效。

【重要】只返回审查结果文本。禁止调用 gh pr comment 或任何方式发评论——主 agent 统一发布。

获取 diff：gh pr diff <PR_NUMBER>
本 PR 历史遗留修复 commit 列表（若有）：<commit hash 列表，由主 agent 填入>
```

**审查者 B** — 逻辑缺陷与规范：

```
【背景：主线 C Issue 验收结论已就位】
<这里粘贴主线 C 完整报告>

你是质量工程师，审查 PR #<PR_NUMBER> 的 diff。

【关注点】逻辑缺陷、边界条件、空值 / 异常路径、命名规范、类型安全、测试覆盖、回归风险。
【反向约束】Issue 验收已由主线 C 覆盖——你不要重复列「功能未实现」，专注 diff 内代码层 bug 与规范偏离。
【范围】审查 diff 涉及的文件时如顺便发现同一文件内的历史遗留代码 bug 也报告（不主动扩大）。本轮历史遗留修复 commit 的改动从审查范围排除。

【输出格式】同审查者 A：严重级 + 文件:行号 + 问题描述 ≥1 句 + 具体改法。缺一视为无效。

【重要】只返回审查结果文本。禁止调用 gh pr comment 或任何方式发评论——主 agent 统一发布。

获取 diff：gh pr diff <PR_NUMBER>
本 PR 历史遗留修复 commit 列表（若有）：<commit hash 列表，由主 agent 填入>
```

**审查者 C** — 系统 `/code-review` 第三路（裸 subagent 内调用，只读返回 findings）：

```
【背景：主线 C Issue 验收结论已就位】
<这里粘贴主线 C 完整报告>

你是第三路代码审查者，对 PR #<PR_NUMBER> 的 diff 跑系统内置 /code-review。

【调用方式】调用系统 skill：/code-review --effort medium
- 严禁带 --comment（会直接发 PR 评论，绕过主 agent 单发布者，产生重复审核报告）
- 严禁带 --fix（会改工作区业务代码，违反本 skill 零业务改动约束）
- 只跑只读审查，把 /code-review 输出的 findings 原样整理成下方格式返回主 agent

【反向约束】Issue 验收已由主线 C 覆盖——findings 里若有"功能未实现"类条目请剔除，只保留 diff 内代码层 bug / 复用-简化-效率类清理项。

【输出格式】把 /code-review 的每条 finding 归一化为：
- 严重级（Critical / Major / Minor；/code-review 的 bug 类→按严重程度，cleanup 类→Minor）
- 文件:行号
- 问题描述（≥1 句）
- 建议改法（具体到代码层面）
缺任一字段的条目剔除。

【重要】只返回归一化后的 findings 文本。禁止 gh pr comment、禁止 --comment、禁止 --fix、禁止任何写操作——主 agent 统一发布、统一决定修/拒。

获取 diff：gh pr diff <PR_NUMBER>（/code-review 默认审当前 diff）
本 PR 历史遗留修复 commit 列表（若有）：<commit hash 列表，由主 agent 填入>
```

> ⚠️ **审查者 A/B 仍用裸 subagent，不得调用 `code-review` 技能或 `oh-my-claudecode:code-reviewer` agent**。只有**审查者 C** 专门承载系统 `/code-review`，且**必须裸跑（不带 `--comment` / `--fix`）**——裸跑只读不发评论不改码，findings 仍经主 agent 统一发布。带 `--comment` = 重复评论；带 `--fix` = 越权改码，两者都禁止。

**Wave 1 — 主线 C — Issue 验收检查者**（独立 subagent，每轮必须派，与主线 A 并行）：

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

- 单源审查（默认）：上一轮修复少 / 仅 Minor / 改动集中少数文件 → 派一个 subagent（优先保留审查者 C `/code-review`，或审查者 B 逻辑，二选一）
- 多源审查：改动大 / 涉核心逻辑 / 上一轮有 Critical 修复 → 仍派审查者 A + B + C
- **审查者 C `/code-review` 始终 medium 档**，不随轮次升降档（轮次降级只减审查者数量，不改 effort）
- **主线 C Issue 验收**：每轮都派，不降级（功能完成度必须每轮复核，因修复可能引入新的偏离）

是否进第二/三轮：

- 上一轮全部修复且改动简单（仅格式/命名）→ 跳过后续审查，直接最终验证
- 上一轮有 Critical/Major 修复 → 应进下一轮

### 3.1.5 审查质量自检（主 agent 内联，无新增 subagent）

Wave 2 返回后,主 agent 必须按下面清单**逐条核对审查者 A/B/C 的报告**,不达标则**就地把不达标条目退回**对应 subagent 要求补充(同一 subagent,带原 prompt + 不达标条目清单 + "请补全:文件:行号 / 具体描述 / 具体改法",直到达标或退回 2 次仍不达标——记为该条无效,不写入审核报告)。

清单:

- [ ] 每条问题都带 **严重级 + 文件:行号 + ≥1 句具体描述 + 具体改法** 四要素
- [ ] 没有"建议优化"/"考虑使用 X 模式"这类无具体改法的空话条目
- [ ] 审查者 A/B/C 报告中均不含「功能未实现」类条目(那是主线 C 的范围)
- [ ] 审查者 C 的 findings 已归一化(剔除功能缺失类、补齐四要素),且确认其调用未带 `--comment` / `--fix`
- [ ] 报告中没有针对 `chore(precheck):` 历史遗留修复 commit 的 nitpick

这一步**不发 PR 评论**,只是主 agent 把不合格条目踢回 subagent。目的是保证最终落到 3.3b 审核报告里的每条都有可执行的改法。

### 3.2 问题汇总与去重

汇总主线 A（lint/build/test 失败）、主线 B（审查者 A 架构 / B 逻辑 / C 系统 `/code-review` 的发现）、主线 C（Issue 验收偏离）所有问题。

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

### 3.3 发布审核报告到 PR（拆三条评论，职责单一）

无问题 → 跳 3.6 通过流程。

> **核心改进**：Issue 验收 / 代码审查 / 修复进度分别发独立评论（Hard Gate 3 升级为「三 comment gate」）。让 reviewer 在 GitHub PR 时间线上能按主题快速定位，不要把三种异构信息塞进同一长评论。

#### 3.3a Issue 验收独立评论（每轮第一条评论，主线 C 输出闭环）

```bash
gh pr comment $PR_NUMBER --body-file - <<'MSG'
## Issue 验收报告（第 N 轮）

- Issue：#<id> <标题>
- 验收标准条目数：N
- 结论：[全部完成 / 部分完成（欠 X 条） / 严重缺失（欠 Y 条核心项）]

### 逐条比对

| # | 验收标准 | 状态 | 证据 / 欠缺 |
|---|----------|------|------------|
| 1 | <原文> | ✅/⚠️/❌ | <文件:行号 或 欠缺描述> |

### 后续处理

- ❌ 未实现项 → 进入 3.4 修复或拆 follow-up Issue（附编号）
- ⚠️ 部分实现项 → 进入 3.4 修复
- ➕ 超出范围项 → 要求 PR body 补释或拆 follow-up Issue

---
*主线 C 产出，与代码审查解耦发布*
MSG
```

#### 3.3b 代码审查 + 验证审核报告（每轮第二条评论，主线 A + 主线 B 汇总）

```bash
gh pr comment $PR_NUMBER --body-file - <<'MSG'
## 代码审查报告（第 N 轮）

### 概要
- Critical：X 个
- Major：Y 个
- Minor：Z 个

### 验证流水线（主线 A）
- Lint：✅/❌
- 构建：✅/❌
- 测试：✅/❌（列实际执行的命令）
- 错误分类：本 PR 引入 X 条 / 历史遗留 Y 条（详见下方表）

### 历史遗留错误处理（若 Y > 0）
| # | 文件:行号 | 错误 | 本轮处理 |
|---|-----------|------|----------|
| 1 | path/file:42 | 描述 | 已 chore(precheck) 修复 / 已开 follow-up Issue #NNN |

### Critical 问题
| # | 来源 | 文件:行号 | 描述 | 建议改法 |
|---|------|-----------|------|----------|
| 1 | 审查者A / 审查者B / 审查者C(code-review) / 验证 | path/to/file:42 | 描述 | 改法 |

### Major 问题
| # | 来源 | 文件:行号 | 描述 | 建议改法 |
|---|------|-----------|------|----------|

### Minor 问题
| # | 来源 | 文件:行号 | 描述 | 建议改法 |
|---|------|-----------|------|----------|

### 处理决策
逐条标 修/拒（拒绝附 ≥1 句理由，"超出范围"不是唯一合法理由）

---
*主线 A 验证 + 主线 B 三源代码审查（架构 A / 逻辑 B / 系统 code-review C）汇总，与 Issue 验收解耦发布*
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

### Auto-merge 监控（独立 subagent）

设定 `--auto` 后,主 agent 派**独立 subagent 后台监控**, 自己释放上下文(避免审核完成后主 agent 还背着轮询任务,精力分散)。

Subagent prompt：

```
你是 auto-merge 监控者。轮询 PR #<PR_NUMBER> 直到合并完成或达到 stuck 阈值。

【任务】
1. 每 60 秒跑一次：
   gh pr view <PR_NUMBER> --json state,mergedAt,statusCheckRollup,mergeStateStatus
2. 满足任一终止条件即返回：
   - mergedAt 不为 null → 返回"已合并,merged_at=<ts>"
   - state = CLOSED 且 mergedAt 为 null → 返回"PR 已关闭未合并"
   - statusCheckRollup 出现 FAILURE → 返回"CI 失败,需修复",列失败 check 名称
   - 累计轮询超过 30 分钟 → 返回"stuck > 30 min,当前 mergeStateStatus=<状态>"
3. 期间若 statusCheckRollup 还在 PENDING / IN_PROGRESS,继续等待,不要主动重跑 CI 或推 commit。

【重要】只返回结果文本。禁止调用 gh pr comment / gh pr merge / git push 等任何写操作。
```

**正常路径**：CI 全绿后 GitHub 自动 merge → subagent 返回"已合并" → 本 skill 完成。

**Stuck > 30 min**：subagent 返回 stuck 状态,主 agent 输出"auto-merge stuck,需人工介入",附 `mergeStateStatus`,结束。**禁止主 agent 自行 `--admin` 越权合并**。

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
3. **三 comment gate** — 每轮必须发**三条**评论：`Issue 验收报告`（3.3a，主线 C 输出）+ `代码审查报告`（3.3b，主线 A 验证 + 主线 B 审查汇总）+ `修复报告`（3.5，修复+拒绝 table）。**不允许合并**。reviewer 用验收 comment 看功能完成度，用审查 comment 看代码质量，用修复 comment 验证落实。
4. **Subagent 禁发评论 gate** — 验证流水线 / 审查者 / Issue 验收 / auto-merge 监控 subagent **只返回文本**，禁止自己 `gh pr comment`。主 agent 统一发布。
4.1. **两波 5 subagent gate** — 阶段三 3.1 每轮（第一轮）必须按两波派 subagent：
   - Wave 1 并行 2 个：主线 A 验证 + 主线 C Issue 验收
   - Wave 2 并行 3 个：审查者 A 架构 + 审查者 B 逻辑 + 审查者 C 系统 `/code-review`（三者 prompt 必须嵌入 Wave 1 主线 C 验收结论 + 历史遗留 commit hash 列表）
   任一波缺失视为流程违规。第二轮起代码审查可降级减少审查者数量，但 **主线 C 不可降级、不可跳过**，且**审查者 C `/code-review` 固定 medium 档不随轮次升降**；Wave 1→Wave 2 的顺序依赖不可省略（即使主线 C 还在跑也要等它完成才能启动 Wave 2，因为 Wave 2 prompt 依赖其输出）。
4.2. **Issue 验收 gate** — 主线 C 报告「❌ 未实现核心验收标准」时，本轮不得跳到 3.6 通过流程；必须进入 3.4 修复（补做功能）或在 PR body 显式声明拆 follow-up Issue 并附编号，才能放行。
4.3. **审查质量自检 gate** — Wave 2 返回后必须按 3.1.5 清单核对 A/B 报告，缺四要素（严重级 + 文件:行号 + 描述 + 改法）的条目要退回 subagent 补全；最多退回 2 次，仍不达标的条目不写入 3.3b 审核报告。避免审查者用"建议优化"等空话凑数。
5. **`/code-review` 受控接入 gate** —
   - 审查者 C 在裸 subagent 内调用系统 `/code-review --effort medium`，**必须只读**：严禁 `--comment`（会绕过单发布者产生重复评论）、严禁 `--fix`（会越权改业务代码，违反 Hard Gate 7）。findings 文本返回主 agent，由主 agent 在 3.3b 统一发布。
   - 审查者 A / B 仍用**裸 subagent**，**不得**调用 `code-review` 技能或 `oh-my-claudecode:code-reviewer` agent（保持双源人格审查的多样性，且避免重复跑 `/code-review`）。
   - 任何 subagent 都禁止 `gh pr comment`。
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
| 阶段三只派 3 个 subagent，漏掉 Issue 验收 | Hard Gate 4.1：必须两波 5 个（Wave2 三源） |
| 把 5 个 subagent 一次并行不分波 | Hard Gate 4.1：必须 Wave 1 完成主线 C 后再启 Wave 2，prompt 嵌验收结论 |
| Wave 2 审查者 prompt 没嵌主线 C 结论，跑出"功能未实现"重复条目 | Hard Gate 4.1：prompt 强制反向约束（审查者 A/B/C 都要剔除功能缺失类） |
| 审查者用"建议优化"凑条目 | Hard Gate 4.3：四要素自检退回补全 |
| Issue 验收报 ❌ 但 PR 直接合并 | Hard Gate 4.2：要么补做要么拆 follow-up Issue |
| 审查者 C 跑 `/code-review --comment` 直接发评论 | Hard Gate 5：必须裸跑只读，findings 经主 agent 统一发，禁 `--comment` |
| 审查者 C 跑 `/code-review --fix` 改了业务代码 | Hard Gate 5 + 7：禁 `--fix`，零业务改动，修复走 3.4 主 agent 决策 |
| 审查者 A/B 也去调 `/code-review` 技能 / `code-reviewer` agent | Hard Gate 5：只有审查者 C 承载 `/code-review`，A/B 裸 subagent 保人格多样性 |
| 把 Issue 验收 + 审核 + 修复 合并成一条评论 | Hard Gate 3：三 comment 必须分开 |
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
| 历史遗留修复和本 PR 业务修复混在同一个 `fix:` commit | 3.1 隔离规则：历史遗留走 `chore(precheck):`，本 PR 走 `fix:`，下一轮审查 diff 排除历史 commit |
| 主 agent 自己轮询 auto-merge | 阶段四：独立 subagent 监控，主 agent 完成审核闭环即释放 |
| 简单改动跳过双 comment 直接 squash | 流程一致，避免漏掉历史遗留问题 |

## Tie-In With Other Skills

- `feature-decide-plan-execute` — 上游：建好 PR 后把 PR 编号交给本 skill
- `oh-my-claudecode:critic` agent — 阶段三审查子任务可调度（约束"禁发评论"）
- 系统 `/code-review` — 阶段三 Wave 2 审查者 C 的承载工具，裸跑（`--effort medium`，禁 `--comment`/`--fix`），findings 经主 agent 统一发布
