---
name: git-release
description: 仅在用户显式调用 $git-release 或明确要求使用 git-release 技能时使用；不要通过关键词自动触发。
---

# Git Release

## 目标

在 `release/vX.Y.Z` 或 `release/vX.Y.Z-<prerelease>.N` 分支上，完成从发布前检查到 GitHub Release 创建的全流程；若当前不在 release 分支，则先从最新 `main` 自动创建目标 release 分支。

## 执行原则

- 全程使用中文输出。
- 严格执行前置校验，任何硬性条件不满足时立即终止。
- 发行说明必须结构化、可读、可追溯。
- 命令默认在仓库根目录执行。
- 若能从当前 release 分支或自动建分支流程唯一推断出合法版本号，直接使用该版本继续发布，不要询问用户确认。

## 流程

### 一、发布前检查

1. 检查工作区是否干净：`git status --porcelain`。
2. 若存在未提交变更，列出文件并终止流程。
3. 检查当前分支：`git branch --show-current`。
4. 若当前分支不匹配 `^release/v\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$`，执行以下自动建分支流程（仅此场景执行）：
- 同步远程与本地 `main`：`git fetch origin main --tags && git checkout main && git pull --ff-only origin main`。
- 获取上一个已发布版本（优先）：`gh release list --limit 1 --json tagName,publishedAt --jq '.[0].tagName'`；若为空则回退 `git describe --tags --abbrev=0`。
- 解析版本号并将最后一位加一（例如 `v1.2.3 -> v1.2.4`），得到新分支版本 `<NEXT_VERSION>`。
- 创建并切换分支：`git checkout -b release/v<NEXT_VERSION>`。
5. 再次检查当前分支，必须匹配：`^release/v\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$`。
6. 从分支名提取版本号，例如：
- `release/v1.2.3` -> `v1.2.3` -> `1.2.3`
- `release/v1.2.3-beta.2` -> `v1.2.3-beta.2` -> `1.2.3-beta.2`
7. 检查目标 tag 是否已存在：`git tag -l "v<VERSION>"`。
8. 输出推断出的版本号和推断来源，直接使用该版本号继续执行；不要向用户请求确认。
9. 仅当无法从分支名或自动建分支流程唯一推断出合法版本号时，终止并要求用户显式指定目标版本。

### 二、更新版本号

1. 更新以下文件的 `version` 字段为纯版本号（不带 `v` 前缀）：
- `package.json`
- `apps/backend/package.json`
- `apps/front/package.json`
- `apps/admin-front/package.json`
2. 仅修改 `version` 字段，不变更其他内容。
3. 执行提交：

```bash
git add package.json apps/*/package.json
git commit -F - <<'MSG'
chore: bump version to <VERSION>

更新所有 package.json 版本号为 <VERSION>

发布准备提交
MSG
```

### 三、收集与分析变更

1. 优先获取最近已发布版本：

```bash
gh release list --limit 1 --json tagName,publishedAt --jq '.[0].tagName'
```

2. 若无 GitHub Release，回退：`git describe --tags --abbrev=0`。
3. 采集范围：`<last-release-tag>..HEAD`。
4. 收集数据：
- `git log <last-release-tag>..HEAD --oneline`
- `git log <last-release-tag>..HEAD --pretty=format:"%H|%s|%b"`
- `git diff <last-release-tag>..HEAD --shortstat`
5. 从提交中提取 PR 编号（合并提交、Refs、Closes 等），并用 `gh pr view` 获取标题与标签。
6. 去重同一 PR。
7. 分类变更：
- 新增：`feat` 或 feature 标签
- 优化：`refactor`、`perf`、`chore`
- 修复：`fix` 或 bug 标签
- 技术改进：`docs`、`test`、`build`、`ci`
8. 过滤噪音：忽略无意义合并记录与 `chore: bump version`。
9. 识别运维提醒：环境变量、数据库迁移、依赖更新、配置与部署变更。

### 四、生成发行说明

1. 生成 3-5 条发布摘要，按业务影响排序。
2. 输出分类变更清单，关联 PR 或 Issue。
3. 使用以下结构：

```markdown
# v<VERSION> 发行说明

## 发布摘要

- <核心变更1> (#PR)
- <核心变更2> (#PR)
- <核心变更3> (#PR)

发布日期：<YYYY-MM-DD>
对比分支：`<last-tag>...v<VERSION>`

## 新增

- <新增项> (#PR)

## 优化

- <优化项> (#PR)

## 修复

- <修复项> (#PR)

## 技术改进

- <技术改进项> (#PR)

## 运维提醒

- <提醒项>

## 引用

- PRs：#1, #2
- Issues：#10
- 共计 <X> 个提交

## 升级指南

1. <步骤1>
2. <步骤2>
```

### 五、创建发布

1. 创建 annotated tag：

```bash
git tag -a v<VERSION> -m "Release v<VERSION>"
```

2. 推送 tag：

```bash
git push origin v<VERSION>
```

3. 创建 GitHub Release：

```bash
gh release create v<VERSION> \
  --title "v<VERSION>" \
  --notes-file - <<'EOF'
<完整发行说明>
EOF
```

4. 输出发布 URL 与发布后检查清单。

## 终止条件

以下任一情况出现时终止流程并给出明确原因：

- 工作区存在未提交修改。
- 当前分支不符合 release 分支命名规则，且无法从 `main` 自动创建 release 分支。
- 版本号格式非法或与现有 tag 冲突。
- 自上次发布以来无新提交。

## 输出模板

### 发布前状态

- 工作目录状态
- 当前分支
- 解析出的版本号
- 版本格式校验结果
- tag 冲突校验结果

### 变更分析

- 基准版本
- 提交范围
- 提交数与 PR 数
- 代码变更统计
- 分类统计

### 发布结果

- 版本号
- 分支名
- tag 推送状态
- Release URL
- 发布后清单
