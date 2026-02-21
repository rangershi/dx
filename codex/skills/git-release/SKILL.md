---
name: git-release
description: 在 Git 仓库中执行标准化版本发布流程并自动生成高质量中文发行说明。用于以下场景：需要从 release 分支发布新版本；需要从分支名提取并校验语义化版本（含 alpha/beta/rc 预发布）；需要批量更新多个 package.json 的 version 字段并提交；需要基于最近 GitHub Release 汇总提交与 PR 信息、分类变更、生成发布摘要；需要创建 annotated tag、推送远端并创建 GitHub Release。
---

# Git Release

## 目标

在 `release/vX.Y.Z` 或 `release/vX.Y.Z-<prerelease>.N` 分支上，完成从发布前检查到 GitHub Release 创建的全流程。

## 执行原则

- 全程使用中文输出。
- 严格执行前置校验，任何硬性条件不满足时立即终止。
- 发行说明必须结构化、可读、可追溯。
- 命令默认在仓库根目录执行。

## 流程

### 一、发布前检查

1. 检查工作区是否干净：`git status --porcelain`。
2. 若存在未提交变更，列出文件并终止流程。
3. 检查当前分支：`git branch --show-current`。
4. 仅接受以下正则：`^release/v\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$`。
5. 从分支名提取版本号，例如：
- `release/v1.2.3` -> `v1.2.3` -> `1.2.3`
- `release/v1.2.3-beta.2` -> `v1.2.3-beta.2` -> `1.2.3-beta.2`
6. 检查目标 tag 是否已存在：`git tag -l "v<VERSION>"`。
7. 向用户确认版本号；若用户修改版本号，重新校验格式与 tag 冲突。

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
- 当前分支不符合 release 分支命名规则。
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
