---
name: git-pr-ship
description: PR 交付流程（仅限显式调用）
---

# PR Ship — 提交 · 审查 · 修复 · 交付

## 概览

一条命令完成：`Commit -> PR -> (Lint->Build->Test // 代码审查) -> 逐项修复 -> 推送 -> 下一轮`，最多三轮审查。

## 执行原则

- 全程中文输出。
- 禁止在 `main/master` 直接提交。
- 每修复一个问题立即 commit 一次，禁止攒到最后一次性提交。
- AI 自主判断是否拒绝修复某个问题，拒绝必须写明理由。
- 扫描范围内顺便发现的历史遗留问题（非本次 PR 引入），视同本次问题一并修复，不以"历史遗留"或"超出本 PR 范围"为由跳过。但不主动扩大扫描范围去寻找无关问题。
- 上次跑完测试/Lint 后如果改过代码，必须重跑验证。
- 使用 heredoc 写 commit message 和 gh 命令的 body（禁止 `\n`）。
- 零参数设计：所有信息从仓库状态、当前分支、gh CLI 自动获取，不接受手动参数。

## 输入

```
/pr-ship    # 唯一入口，全自动
```

---

## 阶段一：状态检测

并行执行：

```bash
git status --short
git branch --show-current
git log --oneline -n 5
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "no-upstream"
git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo "origin/main"
git log origin/main..HEAD --oneline
git diff --stat origin/main...HEAD
gh pr list --head "$(git branch --show-current)" --json number,url --limit 1
```

**自动获取上下文**：
- Issue ID：从当前分支名提取（如 `feat/3606-xxx` -> `#3606`），或从最近 commit message 的 `Refs: #xxx` 提取
- PR 编号：通过 `gh pr list --head <当前分支>` 获取已有 PR

**决策规则：**

| 条件 | 行动 |
|------|------|
| 已有 PR 存在 | 跳转阶段四（审查循环） |
| 工作树有改动 | 执行完整流程（阶段二 -> 三 -> 四） |
| 工作树干净且有未推送提交 | 跳转阶段三（PR 创建） |
| 工作树干净且无差异 | 输出"无需提交"，结束 |

---

## 阶段二：Issue · 分支 · Commit

### 2.1 Issue 创建

若从分支名或 commit 中已提取到 Issue ID，跳过创建。

收集上下文：

```bash
git diff --stat
git diff          # 读取完整 diff 以理解改动内容
```

分析改动后创建 Issue：

```bash
gh issue create \
  --title "[模块] 变更摘要" \
  --label label1 --label label2 \
  --body-file - <<'MSG'
## 背景
[为什么要做这个改动]

## 变更内容
- [具体改动点1]
- [具体改动点2]

## 影响范围
[哪些模块/接口/页面受影响]

## 验证方式
- [ ] 验证项1
- [ ] 验证项2
MSG
```

### 2.2 分支处理

若当前在 `main/master`，必须切新分支：

```bash
git switch -c <type>/<issue-id>-<slug>
```

分支前缀遵循仓库约定：`feat/` `fix/` `refactor/` `docs/` `chore/` `test/`；Codex 会话使用 `codex/` 前缀。

### 2.3 Commit

```bash
git add -A
git diff --cached --stat
```

生成 commit（分析 diff 后写出精确描述）：

```bash
git commit -F - <<'MSG'
<type>: <概要>

变更说明：
- <改动点1：具体描述做了什么、为什么>
- <改动点2>

Refs: #<issue-id>
MSG
```

提交后确认：

```bash
git status
git log -1 --oneline
```

---

## 阶段三：PR 创建

### 3.1 推送

```bash
git push -u origin HEAD
```

### 3.2 变更分析

收集完整差异信息以生成详细 PR 描述：

```bash
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
git diff origin/main...HEAD    # 完整 diff，用于分析改动细节
```

### 3.3 创建 PR

PR 描述必须让审查者无需看代码就能理解改动的目的和方式：

```bash
gh pr create --base main \
  --title "<type>: <概要>" \
  --body-file - <<'MSG'
## 变更目的

[一段话说清楚：为什么做这个改动，解决了什么问题]

## 主要改动

### [模块/文件组1]
- [改动描述：做了什么 + 为什么这样做]
- [改动描述]

### [模块/文件组2]
- [改动描述]

## 影响范围

- **API 变更**：[有/无，如有列出端点]
- **数据库变更**：[有/无，如有说明迁移]
- **向后兼容**：[是/否，如否说明破坏点]

## 验证情况

- [x] 本地验证通过的项目
- [ ] 待 CI 验证的项目

## 关联

Closes: #<issue-id>
MSG
```

记录 PR 编号（`PR_NUMBER`），后续阶段使用。

---

## 阶段 3.5：合并冲突检测

在进入审查循环之前，检查 PR 是否与目标分支存在合并冲突：

```bash
git fetch origin main
git merge --no-commit --no-ff origin/main
```

- 如果无冲突：`git merge --abort`（撤回试探性合并），继续阶段四
- 如果有冲突：
  1. `git merge --abort` 撤回
  2. 执行 `git merge origin/main`，解决所有冲突
  3. 解决后 commit：
     ```bash
     git add -A
     git commit -F - <<'MSG'
     merge: 解决与 main 的合并冲突

     - <冲突文件及解决方式>

     Refs: #<issue-id>
     MSG
     ```
  4. 推送：`git push`
  5. 标记 `CODE_CHANGED_SINCE_LAST_CHECK=true`

---

## 阶段四：审查修复循环（最多 3 轮）

循环变量：`ROUND=1`，`MAX_ROUNDS=3`，`CODE_CHANGED_SINCE_LAST_CHECK=true`

### 4.1 验证流水线与代码审查（并行启动）

仅在 `CODE_CHANGED_SINCE_LAST_CHECK=true` 时执行验证流水线。

> **关键约束：所有子任务（验证流水线 subagent、审查者 A、审查者 B）只向主 agent 返回结果文本，禁止自行调用 `gh pr comment` 或任何方式直接发布 PR 评论。** 只有主 agent 在 4.3 才发布唯一的一条汇总报告。违反此约束会导致 PR 上出现多条重复审核报告。

**两条并行主线同时启动：**

---

**主线 A：验证流水线（派 subagent 执行，串行有错即停）**

必须派一个独立 subagent（后台运行）来执行整条流水线。不要在主 agent 里直接跑 bash 命令——主 agent 容易只跑第一步就被其他任务打断。subagent 有独立上下文，会严格按顺序跑完全部步骤。

Subagent prompt 模板：

```
你是验证流水线执行者。严格按顺序执行以下步骤，任一步骤失败立即停止，不执行后续步骤。

【重要】你只负责执行验证并返回结果文本。禁止调用 gh pr comment 或以任何方式直接往 PR 发评论——评论由主 agent 统一发布。

Step 1: 运行 dx lint
- 如果失败：记录所有 lint 错误，停止，返回结果
- 如果通过：继续

Step 2: 运行 dx build affected --dev
- 如果失败：记录构建错误，停止，返回结果
- 如果通过：继续

Step 3: 运行关联测试（根据以下改动范围判断需要跑哪些）
- 后端改动（apps/backend/）：识别受影响的 E2E 测试文件/目录 -> dx test e2e backend <file-or-dir>；识别受影响的 *.spec.ts -> 按文件运行
- 前端改动（apps/front/）：dx test unit front
- 管理端改动（apps/admin-front/）：dx test unit admin
- 如果没有相关改动的测试：跳过本步骤

最终返回格式：
- 执行到第几步
- 每步的通过/失败状态
- 失败步骤的完整错误输出
```

任何失败都记为 **严重问题**。流水线完成后设置 `CODE_CHANGED_SINCE_LAST_CHECK=false`。

---

**主线 B：代码审查**

审查策略根据轮次和改动规模动态调整：

**第一轮：双源审查（必须）**

同时派出两个独立审查者，从不同角度审查：

审查者 A — 代码质量与架构（派独立 subagent）：
- 关注：架构合理性、SOLID 原则、错误处理、性能、安全
- 审查 PR diff 涉及的文件时，如果顺便发现同一文件中的历史遗留问题，也一并报告（不主动扩大到 diff 之外的文件）
- 输入：PR diff

审查者 B — 逻辑缺陷与规范（派独立 subagent）：
- 关注：逻辑缺陷、边界条件、命名规范、类型安全、测试覆盖
- 审查 PR diff 涉及的文件时，如果顺便发现同一文件中的历史遗留问题，也一并报告（不主动扩大到 diff 之外的文件）
- 输入：PR diff

> **禁止使用 `code-review` 技能或 `oh-my-claudecode:code-reviewer` agent 来执行审查。** 这些工具内置了自动发 PR 评论的行为，会导致 PR 上出现多条重复审核报告。必须派独立 subagent，并在 prompt 中明确要求"只返回审查结果文本，禁止调用 gh pr comment 或以任何方式发布 PR 评论"。

Subagent A prompt：
```
作为资深架构师审查此 PR diff，关注架构、性能、安全问题。
审查 diff 涉及的文件时，如果顺便发现同一文件中已有的历史遗留问题（非本次 diff 引入），也一并报告——不要因为是历史代码就忽略。但不要主动扩大到 diff 未涉及的文件。
【重要】只返回审查结果文本给调用者。禁止调用 gh pr comment 或以任何方式直接往 PR 发评论——评论由主 agent 统一发布。
```

Subagent B prompt：
```
作为质量工程师审查此 PR diff，关注逻辑缺陷、边界条件、规范遵从。
审查 diff 涉及的文件时，如果顺便发现同一文件中已有的历史遗留问题（非本次 diff 引入），也一并报告——不要因为是历史代码就忽略。但不要主动扩大到 diff 未涉及的文件。
【重要】只返回审查结果文本给调用者。禁止调用 gh pr comment 或以任何方式直接往 PR 发评论——评论由主 agent 统一发布。
```

**第二轮及以后：按需降级**

根据上一轮修复情况自主决策审查力度：

- 单源审查（默认）：改动较小、仅修复 Minor 问题、或改动集中在少数文件 -> 派一个 subagent 即可
- 双源审查：改动较大、涉及核心逻辑修改、或上一轮有 Critical 修复引入新代码 -> 仍派两个 subagent

同样，后续轮次的审查 subagent 也必须遵守"只返回结果文本、禁止发 PR 评论"的约束。

是否进行第二轮/第三轮审查也需自主判断：
- 上一轮全部修复且改动简单（仅格式/命名调整）-> 可以跳过后续审查，直接进入最终验证
- 上一轮有 Critical/Major 修复 -> 应进入下一轮审查

---

主线 A 和主线 B 同时启动，等待全部完成后进入 4.2。

### 4.2 问题汇总与去重

收集所有来源的问题：
- Lint 错误（来自主线 A Step 1）
- 构建失败（来自主线 A Step 2）
- 测试失败（来自主线 A Step 3，列出失败的用例名和错误信息）
- 审查者 A 的发现
- 审查者 B 的发现（如有）

**去重规则**：
- 同一文件同一行的相同类型问题 -> 合并，保留描述更详细的那条
- 同一根因导致的多个测试失败 -> 合并为一条，附带所有失败用例名
- 两个审查者指出的同一问题 -> 合并，综合两者描述

为每个问题分配严重级别：
- **Critical**：构建失败、测试失败、安全漏洞、数据丢失风险
- **Major**：逻辑缺陷、错误处理缺失、性能问题
- **Minor**：命名不规范、代码风格、文档缺失

### 4.3 发布审核报告到 PR

如果没有任何问题，跳转到"审查通过"流程（4.6）。

将汇总结果作为 PR 评论发布：

```bash
gh pr comment <PR_NUMBER> --body-file - <<'MSG'
## 审核报告（第 N 轮）

### 概要
- Critical：X 个
- Major：Y 个
- Minor：Z 个

### Critical 问题
| # | 来源 | 文件:行号 | 描述 |
|---|------|-----------|------|
| 1 | Lint/构建/测试 | path/to/file:42 | 描述 |

### Major 问题
| # | 来源 | 文件:行号 | 描述 |
|---|------|-----------|------|
| 1 | 审查者A | path/to/file:10 | 描述 |

### Minor 问题
| # | 来源 | 文件:行号 | 描述 |
|---|------|-----------|------|
| 1 | 审查者B | path/to/file:5 | 描述 |

---
*审查工具：dx lint -> dx build -> dx test + 代码审查*
MSG
```

### 4.4 逐项修复

按严重级别从高到低处理每个问题。

对每个问题：

1. **判断是否修复**：
   - 修复：执行修改（包括扫描过程中顺便发现的历史遗留问题，不以"非本次引入"为由跳过）
   - 拒绝：记录理由（如：误报、设计意图如此）。"历史遗留"或"超出本 PR 范围"不是合法的拒绝理由

2. **修复后立即 commit**（一个问题一个 commit）：

```bash
git add <修改的文件>
git commit -F - <<'MSG'
fix: 修复审查问题 #<问题编号> — <简要描述>

- <具体改动说明>

Refs: #<issue-id>
MSG
```

3. 标记 `CODE_CHANGED_SINCE_LAST_CHECK=true`

### 4.5 发布修复报告 + 推送

推送所有修复 commit：

```bash
git push
```

发布修复报告到 PR：

```bash
gh pr comment <PR_NUMBER> --body-file - <<'MSG'
## 修复报告（第 N 轮）

### 已修复
| # | 问题 | 修复方式 | Commit |
|---|------|----------|--------|
| 1 | [问题描述] | [修复说明] | abc1234 |

### 拒绝修复
| # | 问题 | 理由 |
|---|------|------|
| 1 | [问题描述] | [拒绝理由：如误报/设计意图/超出范围] |

### 统计
- 总问题数：X
- 已修复：Y
- 拒绝修复：Z
MSG
```

### 4.6 决定是否下一轮

**审查通过条件**（满足任一即结束）：
- 本轮零问题
- 已达到 `MAX_ROUNDS`（3 轮）
- 所有问题均已修复且改动简单（仅格式/命名），无需再审

**继续下一轮条件**（同时满足）：
- `ROUND < MAX_ROUNDS`
- 本轮有修复过代码（`CODE_CHANGED_SINCE_LAST_CHECK=true`）
- 存在 Critical 或 Major 级别的修复（可能引入新问题）

若继续：`ROUND += 1`，回到 4.1。

若结束且 `CODE_CHANGED_SINCE_LAST_CHECK=true`：执行最终验证——按串行顺序跑 `dx lint` -> `dx build affected --dev` -> 关联测试，有错即停。有失败则修复并 commit/push，无失败则进入 4.7 发布验证总结。

若结束且 `CODE_CHANGED_SINCE_LAST_CHECK=false`（本轮零问题直接通过）：同样进入 4.7，基于最近一次验证结果发布总结。

### 4.7 发布验证总结报告到 PR

最终验证通过后，在 PR 上发布一条验证总结，让审查者一眼看清本次交付的质量门禁结果。

收集并汇总以下信息：
- **审查轮数**：共经历了几轮审查修复循环
- **Lint 结果**：通过/失败（最终状态）
- **构建结果**：通过/失败（最终状态）
- **测试执行明细**：列出实际执行的每条测试命令及其结果（如 `dx test e2e backend apps/backend/e2e/ai-model/virtual-model.e2e-spec.ts` -> 通过），未执行测试的类别注明"无相关改动，跳过"
- **代码审查**：共发现多少问题、修复多少、拒绝多少

```bash
gh pr comment <PR_NUMBER> --body-file - <<'MSG'
## ✅ 验证总结

### 门禁结果

| 步骤 | 状态 | 备注 |
|------|------|------|
| Lint (`dx lint`) | ✅ 通过 | |
| 构建 (`dx build affected --dev`) | ✅ 通过 | |
| 后端 E2E | ✅ 通过 | `dx test e2e backend <实际执行的文件/目录>` |
| 前端单测 | ⏭️ 跳过 | 无相关改动 |
| 管理端单测 | ⏭️ 跳过 | 无相关改动 |

### 审查统计

- 审查轮数：N
- 发现问题：X 个（Critical: a / Major: b / Minor: c）
- 已修复：Y 个
- 拒绝修复：Z 个（附理由见上方修复报告）

### 结论

所有质量门禁通过，PR 可合并。
MSG
```

> **注意**：表格中的"状态"和"备注"列必须基于实际执行结果填写，不能编造。若某步骤失败后经修复再次通过，标注"✅ 通过（修复后重跑）"。测试命令列必须写出实际执行的完整命令，不能用占位符。

---

## 阶段五：完成输出

```
PR Ship 完成！

- Issue: #<ID> <标题>
- PR: #<PR_NUMBER> <链接>
- 审查轮数：N
- 总提交数：X（初始 + 修复）
- 问题统计：发现 A 个 / 修复 B 个 / 拒绝 C 个

状态：✓ Lint 通过 ✓ 构建通过 ✓ 测试通过 ✓ 审查完成
```

---

## 失败与中断

如果任何阶段不可恢复地失败，输出：

- 停止阶段
- 已完成列表
- 阻塞原因
- 建议的人工介入方式

## 质量检查清单

- PR 描述让审查者无需看代码就能理解改动
- 每个 commit message 精确描述改动内容和原因
- 审核报告中相同问题已合并
- 每个修复都是独立 commit
- 拒绝修复的问题都有理由
- 最终状态：Lint/构建/测试全部通过
