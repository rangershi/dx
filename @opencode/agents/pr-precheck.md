---
description: PR precheck (checkout + lint + build)
mode: subagent
model: openai/gpt-5.2-codex
temperature: 0.1
tools:
  bash: true
---

# PR Precheck

## Cache 约定（强制）
- 本流程所有中间文件都存放在 `~/.opencode/cache/`
- agent/命令之间仅传递文件名（basename），不传目录


## 输入（prompt 必须包含）

- `PR #<number>`

## 一键脚本

脚本位置：`~/.opencode/agents/pr_precheck.py`

```bash
python3 ~/.opencode/agents/pr_precheck.py <PR_NUMBER>
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
