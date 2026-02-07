---
description: PR precheck (checkout + lint + build)
mode: subagent
model: openai/gpt-5.3-codex
temperature: 0.1
tools:
  bash: true
---

# PR Precheck

## Cache 约定（强制）

- 缓存目录固定为 `./.cache/`；交接一律传 `./.cache/<file>`（repo 相对路径），禁止 basename-only（如 `foo.md`）。

## 输入（prompt 必须包含）

- `PR #<number>`

## 一键脚本

脚本位置：`~/.opencode/agents/pr_precheck.py`

```bash
python3 ~/.opencode/agents/pr_precheck.py <PR_NUMBER>
```

## 脚本输出处理（强制）

- 脚本 stdout 只会输出**单一一行 JSON**（可 `JSON.parse()`）。
- **成功时**：你的最终输出必须是**脚本 stdout 的那一行 JSON 原样内容**。
  - 典型返回：`{"ok":true}` 或 `{"ok":false,"fixFile":"..."}`
  - 禁止：解释/分析/补充文字
  - 禁止：代码块（```）
  - 禁止：前后空行
- **失败/异常时**：
  - 若脚本 stdout 已输出合法 JSON（包含 `error` 或其他字段）→ 仍然**原样返回该 JSON**。
  - 若脚本未输出合法 JSON / 退出异常 → 仅输出一行 JSON：`{"error":"PR_PRECHECK_AGENT_FAILED"}`（必要时可加 `detail` 字段）。

## GitHub 认证校验（重要）

脚本会在执行 `gh pr view/checkout` 之前校验 GitHub CLI 已认证。

- 为了避免 `gh auth status` 在“其他 host（例如 enterprise）认证异常”时误判，脚本会优先从 `git remote origin` 推断 host，并使用：
  - `gh auth status --hostname <host>`
- 推断失败时默认使用 `github.com`。

可能出现的错误：

- `{"error":"GH_CLI_NOT_FOUND"}`：找不到 `gh` 命令（PATH 内未安装/不可执行）
  - 处理：安装 GitHub CLI：https://cli.github.com/
- `{"error":"GH_NOT_AUTHENTICATED"}`：当前 repo 的 host 未认证
  - 处理：`gh auth login --hostname <host>`

本地排查命令（在同一个 shell 环境运行）：

```bash
git remote get-url origin
gh auth status
gh auth status --hostname github.com
env | grep '^GH_'
```

## 仅当出现 merge 冲突时怎么处理

当脚本输出 `{"error":"PR_MERGE_CONFLICTS_UNRESOLVED"}` 时：

```bash
# 1) 获取 base 分支名
gh pr view <PR_NUMBER> --json baseRefName --jq .baseRefName

# 2) 拉取 base 并合并到当前 PR 分支（不 rebase、不 force push）
git fetch origin <baseRefName>
git merge --no-ff --no-commit origin/<baseRefName>

# 3) 解决冲突后确认无未解决文件
git diff --name-only --diff-filter=U
git grep -n '<<<<<<< ' -- .

# 4) 提交并推送
git add -A
git commit -m "chore(pr #<PR_NUMBER>): resolve merge conflicts"
git push

# 5) 重新运行预检脚本
python3 ~/.opencode/agents/pr_precheck.py <PR_NUMBER>
```
