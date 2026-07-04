---
name: ship-issue-pr
description: 仅在用户显式调用 $ship-issue-pr 或明确要求使用 ship-issue-pr 技能时使用；不要通过关键词、任务类型或上下文自动触发。
---

# Ship Issue PR

## 概览

把一次变更从 `Issue -> 分支 -> Commit -> 验证 -> PR -> 审查修复 -> 自动合并 -> 合并后回访` 独立闭环交付。核心原则：没有 Issue 不提交，没有验证不发 PR，没有审查修复不合并，没有真合并和 Issue 回访不算完成。

本技能是完整流程说明，不依赖其他 Git 流程技能。

## 使用场景

- 用户要求“一键从 Issue 到 PR 合并”。
- 当前工作树有改动，需要创建或绑定 Issue、提交、推送、建 PR、验证并合并。
- 已有 PR，但用户要求继续验证、审查、修复并合并。
- PR Train 需要严格串行：前一个 PR 真正合并到 `main` 后才继续下一个。

不要用于：

- 只讨论方案、不准备写入 GitHub。
- 只想做只读代码审查。
- 无法访问 `git` / `gh` / 远端仓库的环境。

## 全局硬门禁

| 门禁 | 要求 |
|---|---|
| 中文输出 | 所有过程说明、报告、阻塞原因用中文 |
| Issue | 提交/发 PR 前必须有 Issue ID；没有就先创建 |
| 分支 | 禁止在 `main/master` 直接提交；分支必须含 Issue ID |
| 命令位置 | 仓库命令从仓库根目录执行 |
| Heredoc | 多行 Issue body、commit message、PR body、PR comment 必须用 heredoc |
| 验证 | 发 PR 前必须运行并记录相关验证；改代码后必须重跑 |
| Issue/PR 形状 | 必须产出“标准样本”级正文；空 PR body、泛泛模板、占位文字一律阻塞 |
| PR body | 必须使用本技能内置 PR 模板，不得只写“已通过本地测试” |
| 评论发布 | 审查、验收、修复、验证总结由主流程统一发布 |
| 合并 | 只能 `gh pr merge --squash --auto`，禁止 `--admin` 和无 `--auto` 合并 |
| 真完成 | 必须轮询到 `mergedAt` 非空，并回访关联 Issue 状态 |

## 快速流程

| 阶段 | 产物 |
|---|---|
| 状态检测 | 当前分支、工作树、默认 base、已有关联 PR/Issue |
| Issue | 新建或确认 `#<id>`，正文含背景/目标/验收标准 |
| 分支 | `codex/<type>/<issue-id>-<slug>` 或 `<type>/<issue-id>-<slug>` |
| Commit | Conventional Commit，正文末尾 `Refs: #<issue-id>` |
| 验证 | `dx lint`、目标构建、相关测试，记录关键输出 |
| PR | 标题 Conventional Commit，正文含本仓模板，`Closes: #<issue-id>` |
| 审查修复 | Issue 验收、验证流水线、代码审查、逐项修复并提交 |
| 合并 | 设置 auto-merge，等待真实 merged |
| 回访 | 确认 Issue 自动关闭；未完成则重开或拆 follow-up |

## 标准正文契约

Issue 与 PR 不是记录动作的流水账，而是给 reviewer 的验收契约。正文必须像一个可审计交付说明：

- Issue：写清真实背景、目标、方案、验收标准、关联；验收标准必须能逐项对照 diff 和命令结果。
- PR：写清变更目的、主要改动和解决的问题、遗留的问题、已做的验证、PR 遗留未做的、关联。
- 有能力边界就明说边界和原因；有未完成项就创建 follow-up Issue 并引用。
- 验证必须列出实际命令、涉及测试文件/用例、关键结果；不能写“已测试”“本地通过”。
- PR body 不得为空。创建或更新后必须 `gh pr view --json body` 读回确认。

## 阶段一：状态检测

并行收集：

```bash
git status --short
git branch --show-current
git log -1 --format='%H %s' 2>/dev/null || echo "no-commits"
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "no-upstream"
git remote -v
git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo "origin/main"
git log --oneline -n 5
git log origin/main..HEAD --oneline
git diff --stat origin/main...HEAD
gh pr status
```

决策：

- 工作树有改动：执行完整链路。
- 工作树干净且当前分支已有未发 PR 提交：直接进入 PR 创建/更新与验证链路。
- 当前分支已有 OPEN PR：进入审查修复与合并链路。
- 工作树干净且无分支差异、无 OPEN PR：输出“无需交付”并结束。

阻塞条件：

- 不在 Git 仓库。
- `gh auth status` 不可用且需要写 GitHub。
- 当前分支为 `main/master` 且无法创建新分支。
- 远端默认 base 无法确定。

## 阶段二：Issue 创建或绑定

先从用户输入、分支名、commit、PR body 中提取 Issue ID。提取不到就创建 Issue。

Issue 标题格式：

- `<type>(<scope>): 简洁目标`
- `[模块] 简洁目标`

Issue 标签从这些里选择：`bug`、`enhancement`、`documentation`、`performance`、`refactor`、`backend`、`frontend`、`infrastructure`、`test`。

Issue 正文必须包含以下五段。禁止使用“现状/问题、期望行为、执行计划、影响范围”作为主模板；这些信息要归入“背景/目标/方案/验收标准/关联”。

```bash
gh issue create \
  --title "fix(scope): 问题摘要" \
  --label enhancement \
  --body-file - <<'MSG'
## 背景

说明触发问题、现有行为、失败证据、相关文件/PR/Issue。背景必须让 reviewer 理解为什么现在要做。

## 目标

描述完成后系统应该达到的可观察状态。目标写结果，不写操作清单。

## 方案

写当前准备采用的实现路径、能力边界、取舍和已知阻塞。若方案依赖上游配置、外部服务或后续 PR，必须在这里说明。

## 验收标准

- [ ] 可客观验证的一件事，能在 PR diff、命令输出或手测步骤中找到证据
- [ ] 覆盖边界条件、错误路径、配置/权限/契约等关键风险

## 关联

Refs: #<相关 issue/pr-id>
MSG
```

验收标准写不出时先停止，回到目标澄清。禁止为了凑格式写“代码更优雅”这类主观标准。

Issue 创建后必须读回校验：

```bash
gh issue view <ISSUE_ID> --json title,body,labels,url
```

校验失败条件：

- 缺少任一必需段落。
- 验收标准少于 1 条。
- 验收标准是动作清单而不是可验证结果。
- 正文仍保留占位文字。
- 关联项应存在但没有 `Refs:`。

## 阶段三：分支处理

分支类型只用：`feat`、`fix`、`refactor`、`docs`、`chore`、`test`。

允许格式：

- `codex/<type>/<issue-id>-<slug>`
- `<type>/<issue-id>-<slug>`

其中 `<type>` 只能是 `feat`、`fix`、`refactor`、`docs`、`chore`、`test`。

规则：

- 当前分支是 `main/master`：必须创建新分支。
- 当前分支不含 Issue ID：创建或切换到合规分支。
- 当前分支已合规且不是主分支：继续使用。

示例：

```bash
git switch -c codex/fix/1234-short-topic
```

## 阶段四：提交前验证与 Commit

提交前先看暂存范围：

```bash
git diff --stat
git diff --name-only
```

按改动范围执行最低验证：

| 改动范围 | 必跑命令 |
|---|---|
| 任意 JS/TS | `dx lint` |
| 后端 | `dx build backend --dev`，相关 `dx test unit backend [path]` |
| 后端 E2E 相关 | `dx test e2e backend <file-or-dir>`，禁止无参全量 E2E |
| 前端用户端 | `dx build front --dev`，相关 `dx test unit front [path]` |
| 管理端 | `dx build admin --dev`，相关 `dx test unit admin [path]` |
| DTO/API 契约 | `dx build backend --dev` 后再 `dx build api-contracts` |
| 共享包 | `dx build shared` 或相关 shared 测试 |
| Flutter | `cd apps/mobile && flutter analyze`，相关 `flutter test <path>` |
| 范围不确定 | `dx lint` + `dx build affected --dev` + 相关测试 |

验证失败必须修复后重跑。无法在当前 PR 内修复的预存错误，必须创建 follow-up Issue，并在 PR body 与审查报告同时登记编号。

提交：

```bash
git add -A
git diff --cached --stat
git commit -F - <<'MSG'
fix: 简洁摘要

变更说明：
- 说明关键改动
- 说明影响范围

Refs: #123
MSG
```

提交标题必须是 Conventional Commit：`feat:`、`fix:`、`refactor:`、`docs:`、`chore:`、`test:`。

提交后确认：

```bash
git status --short
git log -1 --oneline
```

## 阶段五：PR 创建或更新

先推送：

```bash
git push -u origin HEAD
```

生成 PR 前收集：

```bash
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --name-only
```

PR body 必须先生成到临时文件并自检。禁止直接创建空 body PR，禁止用“稍后补充”。

```bash
cat > /tmp/ship-pr-body.md <<'MSG'
## 变更目的

- 闭环 Issue #123 中的具体目标，说明用户可观察问题如何被解决。
- 对应 Issue 验收标准 [1]：说明实现落点和关键取舍。
- 能力边界：如果只完成目标的一部分，写清为什么、证据是什么、follow-up 是哪个 Issue。

## 主要改动和解决的问题

- 解决问题 1：对应 Issue 验收标准 [1]，列出关键文件/模块和原因。
- 解决问题 2：对应 Issue 验收标准 [2]，说明行为变化、配置变化或契约变化。
- 测试/契约/文档改动：列出为什么需要这些改动。

## 遗留的问题

- 无；或写明未覆盖的 Issue 范围、原因、follow-up #<id>。

## 已做的验证

- 变更提交：
  - `<full-sha>`（`fix: ...`）
- 涉及测试文件：
  - `path/to/spec.ts`
- 最终通过命令：
  - `rtk dx lint`
  - `rtk dx build <target> --dev`
  - `rtk dx test ...`（列出文件数/用例数或关键通过摘要）
- 手测：无；或列出关键路径步骤与结果。

## PR 遗留未做的

- 无；或 `Owner: <owner>。后续在 #<id> 中完成 <事项>。`

## 关联

Closes: #123
Refs: #<相关 issue/pr-id>
MSG
```

创建或更新 PR：

```bash
grep -q '^## 变更目的' /tmp/ship-pr-body.md
grep -q '^## 主要改动和解决的问题' /tmp/ship-pr-body.md
grep -q '^## 遗留的问题' /tmp/ship-pr-body.md
grep -q '^## 已做的验证' /tmp/ship-pr-body.md
grep -q '^## PR 遗留未做的' /tmp/ship-pr-body.md
grep -q '^## 关联' /tmp/ship-pr-body.md
grep -q 'Closes: #[0-9]' /tmp/ship-pr-body.md
! grep -qE '稍后补充|TODO|TBD|path/to/spec|<full-sha>|#<|问题摘要|简洁摘要' /tmp/ship-pr-body.md

gh pr create --base main --title "fix: 简洁摘要" --body-file /tmp/ship-pr-body.md
```

规则：

- `#123` 只用于真实 GitHub Issue/PR 引用。
- 普通序号写 `[1]`、`问题 1`、`PR1`，禁止写会被 GitHub 自动链接的普通 `#1`。
- 若 Issue 有未覆盖验收标准，不得写“无”；必须补做或创建 follow-up Issue 并引用。
- `已做的验证` 必须包含实际命令；如果命令未跑，PR 不得创建或必须标记阻塞。
- 有新增/修改测试时必须列测试文件；没有测试时必须说明为什么没有。
- 有多个 commit、冲突提交或审查修复提交时，`变更提交` 必须列出关键 commit。
- 只更新既有 PR 时，也要确保 body 符合模板，不合格立即用 `gh pr edit <PR_NUMBER> --body-file /tmp/ship-pr-body.md` 修正。
- PR 创建或更新后必须读回：

```bash
gh pr view <PR_NUMBER> --json title,body,url
```

读回校验失败条件：

- body 为空。
- 缺少任一必需段落。
- 仍有占位符、示例路径、`TODO`、`TBD`、`稍后补充`。
- `已做的验证` 没有实际命令。
- `遗留的问题` 或 `PR 遗留未做的` 写“无”，但 Issue 验收标准仍有未覆盖项。
- 缺少 `Closes: #<issue-id>`。

## 阶段六：合并冲突检测

如果 PR body 含 `PR Train`、`依赖 #<PR_NUMBER>`、`depends on #<PR_NUMBER>` 等串行依赖标记，先检查依赖 PR：

```bash
gh pr view <DEPENDS_ON_PR> --json state,mergedAt,url
```

- `mergedAt` 非空：继续。
- `mergedAt` 为空：停止，输出“依赖 PR 尚未真实合并到 main”，禁止继续审查、修复或合并当前 PR。

依赖通过后再检测与 `main` 的冲突：

```bash
git fetch origin main
git merge --no-commit --no-ff origin/main
```

- 无冲突：`git merge --abort` 后继续。
- 有冲突：`git merge --abort`，再执行真实合并、解冲突、验证、提交、推送。

冲突提交：

```bash
git add -A
git commit -F - <<'MSG'
fix: 解决与 main 的合并冲突

变更说明：
- 说明冲突文件
- 说明保留哪一侧语义以及原因

Refs: #123
MSG
git push
```

## 阶段七：审查修复循环

最多 3 轮。每轮必须包含：Issue 验收、验证流水线、代码审查、修复报告。

### 7.1 Issue 验收

读取关联 Issue：

```bash
gh issue view 123 --json title,body,state,labels
gh pr diff <PR_NUMBER>
gh pr view <PR_NUMBER> --json title,body,headRefName,baseRefName,url
```

逐条核对 Issue 的「验收标准」：

| 状态 | 含义 | 后续 |
|---|---|---|
| 通过 | diff 有明确实现证据 | 记录文件/行号或模块 |
| 部分 | 实现不完整或边界缺失 | 必须修复 |
| 未实现 | 核心标准没有落地 | 必须补做或拆 follow-up Issue |
| 超出范围 | PR 做了 Issue 未描述事项 | PR body 补释或拆 Issue |

发布独立评论：

```bash
gh pr comment <PR_NUMBER> --body-file - <<'MSG'
## Issue 验收报告（第 N 轮）

- Issue：#123 标题
- 验收标准条目数：N
- 结论：全部完成 / 部分完成 / 严重缺失

| 序号 | 验收标准 | 状态 | 证据 / 欠缺 |
|---|---|---|---|
| [1] | 原文 | 通过/部分/未实现 | 文件:行号 或欠缺说明 |

### 后续处理

- 未实现或部分实现项：进入本轮修复，或登记 follow-up Issue
MSG
```

### 7.2 验证流水线

执行阶段四的相关验证。失败时必须保留完整错误，包括文件、行号、命令、失败摘要。

将失败分类：

- 本 PR 引入：正常 `fix:` commit 修复。
- 历史遗留：仍需修复；若修复，单独 `chore(precheck):` commit；若无法修，创建 follow-up Issue，并在 PR body 与审查报告登记。

### 7.3 代码审查

审查范围：

- `gh pr diff <PR_NUMBER>` 的改动。
- diff 涉及文件内顺手发现的真实 bug。
- 不主动扩大到无关模块。

每条问题必须有四要素：

- 严重级：`Critical` / `Major` / `Minor`
- 文件:行号
- 具体问题描述
- 具体改法

严重级：

| 严重级 | 例子 | 默认处理 |
|---|---|---|
| Critical | 构建失败、测试失败、安全漏洞、数据丢失 | 必修 |
| Major | 逻辑缺陷、错误处理缺失、性能问题、验收部分缺失 | 修复或拆 follow-up |
| Minor | 命名、局部风格、文档、小范围清理 | 小于 5 行优先修，否则说明拒绝理由 |

审查质量自检：

- 缺四要素的条目不进入报告。
- “建议优化”“可以考虑”这类没有具体改法的条目不进入报告。
- 功能未实现类问题归入 Issue 验收，不重复写进代码审查。

发布独立评论：

```bash
gh pr comment <PR_NUMBER> --body-file - <<'MSG'
## 代码审查报告（第 N 轮）

### 概要

- Critical：0
- Major：0
- Minor：0

### 验证流水线

- Lint：通过/失败
- 构建：通过/失败
- 测试：通过/失败/跳过（列实际命令）

### 问题列表

| 严重级 | 来源 | 文件:行号 | 描述 | 建议改法 |
|---|---|---|---|---|
| Major | 代码审查 | path/file.ts:42 | 具体描述 | 具体改法 |

### 处理决策

- 每条问题标记：修复 / 拒绝 / follow-up
- 拒绝必须写具体理由
MSG
```

### 7.4 逐项修复

按 `Critical -> Major -> Minor` 顺序处理。每个问题一个 commit，禁止攒到最后。

```bash
git add <files>
git commit -F - <<'MSG'
fix: 修复审查问题 - 简洁描述

变更说明：
- 说明具体修复

Refs: #123
MSG
git push
```

历史遗留验证失败修复：

```bash
git add <files>
git commit -F - <<'MSG'
chore(precheck): 修复合并前验证发现的历史问题

变更说明：
- 说明该问题不是本 PR diff 引入
- 说明按合并前门禁修复

Refs: #123
MSG
git push
```

发布修复报告：

```bash
gh pr comment <PR_NUMBER> --body-file - <<'MSG'
## 修复报告（第 N 轮）

### 已修复

| 序号 | 问题 | 修复方式 | Commit |
|---|---|---|---|
| [1] | 描述 | 修复说明 | abc1234 |

### 拒绝修复

| 序号 | 问题 | 理由 |
|---|---|---|
| [1] | 描述 | 具体理由 |

### Follow-up

| 序号 | 问题 | Issue |
|---|---|---|
| [1] | 描述 | #456 |
MSG
```

继续下一轮条件：

- 本轮修过代码，并且有 Critical/Major 修复。
- Issue 验收从未实现/部分实现变为需要复核。
- 验证失败被修复后需要重跑。

结束条件：

- 验收全部完成。
- 验证全部通过或不可修项已登记 follow-up。
- 代码审查无未处理 Critical/Major。
- 已达 3 轮但仍未完成时，禁止合并，输出阻塞原因。

## 阶段八：最终验证总结

合并前最后一次运行相关验证。发布总结：

```bash
gh pr comment <PR_NUMBER> --body-file - <<'MSG'
## 验证总结

| 步骤 | 状态 | 备注 |
|---|---|---|
| Lint (`dx lint`) | 通过 | 关键输出 |
| 构建 | 通过 | 实际命令 |
| 测试 | 通过/跳过 | 实际命令和原因 |

### 审查统计

- 审查轮数：N
- 发现问题：X 个
- 已修复：Y 个
- 拒绝修复：Z 个
- Follow-up：K 个

### 结论

所有合并门禁已满足，PR 可进入 auto-merge。
MSG
```

禁止在验证失败时写“可合并”。

## 阶段九：自动合并与监控

设置自动合并：

```bash
gh pr merge <PR_NUMBER> --squash --auto
```

轮询直到终态：

```bash
gh pr view <PR_NUMBER> --json state,mergedAt,statusCheckRollup,mergeStateStatus,url
```

终止条件：

- `mergedAt` 非空：合并成功。
- `state=CLOSED` 且 `mergedAt=null`：PR 已关闭但未合并，阻塞。
- `statusCheckRollup` 有失败：CI 失败，回到修复循环。
- 超过 30 分钟仍未合并：输出 stuck 状态，禁止 `--admin` 越权。

## 阶段十：合并后回访

合并成功后：

```bash
gh pr view <PR_NUMBER> --json mergedAt,mergeCommit,url
gh issue view 123 --json state,title,url
```

检查：

- Issue 是否因 `Closes: #123` 正确关闭。
- Issue 验收标准是否真的全部覆盖。
- PR body 的遗留项是否都有 follow-up Issue。
- 若 Issue 被误关但仍有未完成验收标准：重开 Issue 或拆 follow-up，并在最终输出写明编号。

## 成功输出

最终只在确认真合并和 Issue 回访后输出：

```text
Ship Issue PR 完成

- Issue：#123 标题
- PR：#456 链接
- 分支：codex/fix/123-short-topic
- Commit：首个提交摘要；修复提交 X 个
- 验证：Lint 通过；构建通过；测试通过/跳过原因
- 审查：N 轮；发现 X 个；修复 Y 个；拒绝 Z 个；Follow-up K 个
- 合并：已合并到 main，merged_at=<timestamp>
- 回访：Issue 状态已确认
```

## 阻塞输出

遇到不可继续情况，必须输出：

```text
Ship Issue PR 阻塞

- 停止阶段：阶段名
- 已完成：列出已经完成的可审计动作
- 阻塞原因：具体错误、缺权限、验证失败、依赖未合并等
- 不应做的事：说明禁止绕过的门禁
- 下一步建议：给出可执行命令或需要用户提供的信息
```

## 常见错误

| 错误 | 正确做法 |
|---|---|
| 没 Issue 就提交 | 先创建或绑定 Issue |
| 在 `main/master` commit | 先切含 Issue ID 的分支 |
| 分支名没有 Issue ID | 重命名或新建合规分支 |
| Issue 使用“期望行为/执行计划/影响范围”旧模板 | 改为“背景/目标/方案/验收标准/关联” |
| PR body 为空 | 立即用完整模板 `gh pr edit --body-file` 修正，未修正不得进入审查/合并 |
| PR body 只写“已测试” | 填完整 PR 模板和命令证据 |
| PR body 有模板占位符 | 替换成真实 commit、文件、命令、follow-up 编号后再创建/更新 |
| 普通序号写 `#1` | 写 `[1]` 或 `问题 1` |
| E2E 无参全量运行 | 指定文件或目录 |
| 验证失败说“历史遗留不管” | 修复或登记 follow-up Issue |
| 多个审查修复攒一个 commit | 每个问题一个 commit |
| `gh pr merge --squash` 不带 `--auto` | 只允许 `--squash --auto` |
| 设置 auto-merge 后立即宣称完成 | 必须轮询到 `mergedAt` |
| 合并后不看 Issue | 必须回访 Issue 状态和验收覆盖 |

## 红旗

出现这些想法时停止并回到对应阶段：

- “这个改动很小，不需要 Issue。”
- “PR body 之后再补。”
- “CI 应该会过，先合并。”
- “历史遗留错误不是我引入的，跳过。”
- “GitHub 已显示 mergeable，不用逐条核对验收标准。”
- “auto-merge 已设置，所以算完成。”
- “先 `--admin` 合了再说。”

这些都表示流程正在失真。交付的定义是真实合并且 Issue 回访完成，不是把 PR 发出去。
