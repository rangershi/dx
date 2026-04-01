---
name: git-commit-and-pr
description: 在 Git 仓库中执行自动化 Issue、Commit、PR 工作流。用于以下场景：需要零输入一键完成 Issue→分支→Commit→PR；需要根据仓库状态自动判断下一步；需要创建结构化 GitHub Issue；需要基于暂存变更生成规范 commit；需要推送分支并创建 Pull Request；需要串联输出清晰阶段结果。支持仅建 Issue、仅建 PR、指定 Issue 编号、指定 PR 基准分支。
---

# Git Commit And PR

## 目标

在最少人工输入下完成 `Issue -> Branch -> Commit -> PR` 标准流程，并保持可审计输出。

## 默认行为（零输入）

当用户只调用 `/git-commit-and-pr` 且不带参数时，执行“全自动模式”，不再向用户追问：

1. 检查仓库状态与当前分支。
2. 若工作树有未提交改动：执行 Issue -> Branch -> Commit -> PR。
3. 若工作树干净：对比当前分支与 `main`（或默认基准）差异，并检查最近提交，判断是否应直接创建 PR。
4. 若工作树干净且存在分支差异：直接推送并创建 PR（不再创建新 Issue/Commit）。
5. 输出 Issue、Commit、PR 链接与下一步命令。

说明：保留所有旧能力，不影响 `--issue`、`--issue-only`、`--pr --base`。

## 执行原则

- 全程中文输出。
- 先检查状态，再决定执行阶段。
- 禁止在 `main/master` 直接提交代码。
- 优先自动完成，不因“小缺信息”中断；只在不可执行时报阻塞。
- 输出必须包含：已完成项、阻塞原因、下一步建议。

## 输入形式

- 自动模式：`/git-commit-and-pr`
- 指定 Issue：`/git-commit-and-pr --issue <ID>`
- 仅创建 Issue：`/git-commit-and-pr --issue-only`
- 仅创建 PR：`/git-commit-and-pr --pr --base <BRANCH>`

## 流程

### 一、状态检测（并行）

```bash
git status --short
git branch --show-current
git log -1 --format='%H %s' 2>/dev/null || echo "no-commits"
```

补充检测：

```bash
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "no-upstream"
git remote -v
git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo "origin/main"
git log --oneline -n 5
git log origin/main..HEAD --oneline
git diff --stat origin/main...HEAD
```

决策规则：

- `--issue-only`：仅走 Issue 创建并结束。
- `--pr`：跳过 Issue/Commit，直接走 PR 流程。
- 默认模式：
  - 若 `git status --short` 非空：按 `Issue -> Branch -> Commit -> PR` 全链路执行。
  - 若 `git status --short` 为空且 `origin/main..HEAD` 有提交差异：直接执行 PR 创建。
  - 若 `git status --short` 为空且无分支差异：输出“无需创建 PR”，并结束。

### 二、Issue 创建

1. 收集上下文：
- `git status --short`
- `git diff --stat`
- 可选去重：`gh issue list --search "<关键词>" --limit 5`

2. 生成标题：`[模块] 简洁描述` 或 `[类型] 功能/问题描述`。

3. 标签：从 `bug`、`enhancement`、`documentation`、`performance`、`refactor`、`backend`、`frontend`、`infrastructure` 中选择。

4. 正文结构固定：背景、现状/问题、期望行为、执行计划、影响范围、相关资源。

5. 创建命令（heredoc）：

```bash
gh issue create \
  --title "[模块] 问题摘要" \
  --label label1 --label label2 \
  --body-file - <<'MSG'
## 背景
[背景]

## 现状/问题
[问题]

## 期望行为
[目标]

## 执行计划
- [ ] 步骤一
- [ ] 步骤二

## 影响范围
[范围]
MSG
```

### 三、分支处理（新增强制步骤）

1. 若当前分支是 `main/master`，必须切新分支后再提交。
2. 若存在 Issue 编号，分支名优先：`codex/fix/<issue-id>-<slug>`。
3. 若已在合法功能分支且用户显式要求保留，则继续使用当前分支。

示例：

```bash
git switch -c codex/fix/1234-short-topic
```

### 四、Commit 流程

1. 暂存与检查：

```bash
git add -A
git diff --cached --stat
```

2. 根据 `git diff --cached` 生成提交：

```bash
git commit -F - <<'EOF'
<type>: <概要>

变更说明：
- <变更项一>
- <变更项二>

Refs: #<issue-id>
EOF
```

3. `type` 仅用：`feat/fix/refactor/docs/chore/test`。

4. 提交后确认：

```bash
git status
git log -1 --oneline
```

### 五、PR 创建

1. 推送分支：

```bash
git push -u origin HEAD
```

2. 变更分析：

```bash
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
```

3. 创建 PR（默认 `--base main`）：

```bash
gh pr create --base main --title '<type>: <概要>' --body-file - <<'EOF'
## 变更说明

- <变更项>

## 测试

- [ ] 本地测试通过

Closes: #<issue-id>
EOF
```

4. 成功后输出评审命令：`/pr-review-loop --pr <PR_NUMBER>`。

## 质量检查

- 标题简洁可读，语义明确。
- 描述包含背景、问题、目标、影响范围。
- 提交与 PR 文案可核对到 diff。
- 标签与提交类型匹配。
- 不泄露敏感信息。

## 失败与阻塞输出

输出以下四项：

- 停止阶段
- 已完成列表
- 阻塞原因
- 继续执行命令建议

## 成功输出

输出以下四项：

- Issue 编号与标题
- Commit 摘要
- PR 编号与链接
- 下一步评审命令
