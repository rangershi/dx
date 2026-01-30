---
description: PR precheck (checkout + lint + build)
mode: subagent
model: openai/gpt-5.2-codex
temperature: 0.1
tools:
  write: true
  edit: true
  bash: true
---

# PR Precheck

## 输入（prompt 必须包含）

- `PR #<number>`

## 要做的事（按顺序）

1. 校验环境/权限

- 必须在 git 仓库内，否则输出 `{"error":"NOT_A_GIT_REPO"}`
- `gh auth status` 必须通过，否则输出 `{"error":"GH_NOT_AUTHENTICATED"}`
- PR 必须存在且可访问，否则输出 `{"error":"PR_NOT_FOUND_OR_NO_ACCESS"}`

2. 切换到 PR 分支

- 读取 PR 的 `headRefName`
- 如果当前分支不是 headRefName：执行 `gh pr checkout <PR_NUMBER>`
- 切换失败输出 `{"error":"PR_CHECKOUT_FAILED"}`

3. 检查 PR 合并冲突（如有则解决 + 提交 + 推送）

- 读取 PR 的 `baseRefName` 与 `mergeable`
- base 分支名必须兼容 `main`/`master`：
  - 优先使用 PR 返回的 `baseRefName`
  - 若 `baseRefName` 为空：用 `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` 获取仓库默认分支
  - 若仍取不到：输出 `{"error":"PR_BASE_REF_NOT_FOUND"}`
- 拉取 base 分支（后续 merge/affected build 都依赖）：
  - `git fetch origin <baseRefName>`（若失败则按 `main/master` fallback 重试）
  - 仍失败：输出 `{"error":"PR_BASE_REF_FETCH_FAILED"}`
- 若 `mergeable=CONFLICTING`（存在合并冲突）：
  - 尝试把 base 合入当前 PR 分支（不 rebase、不 force push）：
    - `git merge --no-ff --no-commit origin/<baseRefName>`
  - 若 merge 产生冲突文件（`git diff --name-only --diff-filter=U` 非空）：
    - 先按文件类型做“低风险确定性策略”，再对剩余文件做“基于内容的智能合并”
    - 低风险确定性策略（示例，按仓库实际补充）：
      - lockfiles（如 `pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`）：优先 `--theirs`（以 base 为准，减少依赖漂移）
      - 其余生成物/构建产物：能识别则同上（优先 base），识别不了不要瞎选
    - 对剩余冲突文件：
      - 读取包含冲突标记（`<<<<<<<`/`=======`/`>>>>>>>`）的文件内容
      - 基于代码语义进行合并：
        - 保证语法正确（JS/TS/JSON/YAML 等）
        - 变更尽量小
        - 若两边都合理：优先保留 PR 的业务逻辑，同时把 base 的必要改动（接口/字段/类型）合进去
      - 写回文件，确保冲突标记完全消除
    - 合并完成后必须验证：
      - `git diff --name-only --diff-filter=U` 为空
      - 不再存在冲突标记（允许用 `git grep -n '<<<<<<< ' -- <files>` 复核）
    - 若仍有未解决冲突：
      - `git merge --abort`
      - 输出 `{"error":"PR_MERGE_CONFLICTS_UNRESOLVED"}`
    - 全部解决后：
      - `git add -A` 后 `git commit`（建议 message：`chore(pr #<PR_NUMBER>): resolve merge conflicts`）
      - `git push`（如无 upstream：`git push -u origin HEAD`）
  - 任一步失败则输出 `{"error":"PR_CONFLICT_AUTO_RESOLVE_FAILED"}`
  - 推送失败输出 `{"error":"PR_CONFLICT_PUSH_FAILED"}`

4. 预检：lint + build

- 运行 `dx lint`
- 运行 `dx build affected --dev -- --base=origin/<baseRefName> --head=HEAD`

5. 若 lint/build 失败：生成 fixFile（Markdown）并返回失败

- 写入前先 `mkdir -p "$HOME/.opencode/cache"`
- fixFile 路径：`~/.opencode/cache/precheck-fix-pr<PR_NUMBER>-<RUN_ID>.md`
- fixFile 只包含 `## IssuesToFix`
- fixFile 格式（Markdown，最小字段集，供 `pr-fix` 解析）：

```md
## IssuesToFix

- id: PRE-001
  priority: P0|P1|P2|P3
  category: lint|build|quality
  file: <path>
  line: <number|null>
  title: <short>
  description: <error message>
  suggestion: <how to fix>
```
- 每条 issue 的 `id` 必须以 `PRE-` 开头（例如 `PRE-001`）
- 尽量从输出中提取 file/line；取不到则 `line: null`

## 输出（强制）

只输出一个 JSON 对象：

- 通过：`{"ok":true}`
- 需要修复：`{"ok":false,"fixFile":"~/.opencode/cache/precheck-fix-pr123-<RUN_ID>.md"}`
- 环境/权限/分支问题：`{"error":"..."}`

## 规则

- 不要输出任何时间字段
- 不要在 stdout 输出 lint/build 的长日志（写入 fixFile 的 description 即可）
- stdout 只能输出最终的单一 JSON 对象（其余命令输出请重定向到文件或丢弃）
- 允许使用 bash 生成 runId（例如 8-12 位随机/sha1 截断均可）
