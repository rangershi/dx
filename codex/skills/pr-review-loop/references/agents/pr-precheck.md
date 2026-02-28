# PR Precheck

## Cache 约定（强制）

- 缓存目录固定为 `./.cache/`；交接一律传 `./.cache/<file>`（repo 相对路径），禁止 basename-only（如 `foo.md`）。

## 输入（prompt 必须包含）

- `PR #<number>`
- `round: <number>`（默认 1）

## 执行方式（强制）

- 由当前 agent 按本文件流程逐步执行预检。
- 预检期间允许执行 shell 命令，但最终 stdout 仍必须遵守“单行 JSON 输出契约”。

## 预检流程（按顺序执行）

1. reviewer 配置校验（强制，先于其他所有检测）
- 项目根目录必须存在 `./reviewer/` 目录。
- `./reviewer/` 下必须至少有一个 `*-reviewer.md` 文件。
- 每个 `*-reviewer.md` 文件都必须包含 `ROLE_CODE = <CODE>`（例如 `ROLE_CODE = STY`）。
- 若上述任一条件不满足，立即终止并返回：`{"error":"REVIEWER_CONFIG_INVALID","detail":"..."}`。

2. 参数校验
- `PR_NUMBER` 必须是正整数；`round` 必须是 `>=1` 的整数。
- 参数非法时返回：`{"error":"INVALID_ARGS"}`（可附带 `prNumber`、`round`）。

3. 工作区干净校验（强制）
- 先校验是否在 git 仓库：`git rev-parse --is-inside-work-tree`。
- 非 git 仓库时返回：`{"error":"NOT_A_GIT_REPO"}`。
- 执行：`git status --porcelain`。
- 若存在未提交变更（包含 staged/unstaged/untracked），直接返回：
- `{"error":"UNCOMMITTED_CHANGES_PRESENT","detail":"请先处理当前仓库全部未提交代码后再执行 precheck"}`。

4. 切换到 PR 分支并与远程同步（优先自愈）
- 先从输入文本解析出实际 PR 编号（例如从 `PR #2884` 解析得到 `2884`），记为 `prNumber`。
- 所有命令中的 `<PR_NUMBER>` 都表示占位符，必须替换为真实数字后再执行，禁止原样执行字面量 `gh pr checkout <PR_NUMBER>`。
- 首选执行：使用gh 命令获取 PR 相关信息并切换到对应分支
- 然后执行同步：`git pull --ff-only`（或等价的 fetch + fast-forward）。
- 若可自动修复（例如当前分支不对、需要补齐 tracking），应先自愈再继续，不要立刻失败。
- 当 `gh` 返回认证失败（典型：`GH_NOT_AUTHENTICATED`，token 失效）时，必须进入 SSH 自愈分支，而不是要求用户重新授权：
  - 禁止提示用户执行 `gh auth login`；默认假设用户已配置好仓库可用的 SSH 密钥。
  - 校验 `origin` 是否为 SSH remote（`git@github.com:*` 或 `ssh://git@github.com/*`）。
  - 校验当前仓库 SSH 连通性：`ssh -T git@github.com`（返回 1 但含 “successfully authenticated” 也算通过）。
  - 直接用 git 拉取 PR 头引用并切换：`git fetch origin pull/<prNumber>/head:pr-<prNumber>-head && git checkout pr-<prNumber>-head`
  - 再执行：`git pull --ff-only origin pr-<prNumber>-head`。
- 仅当上述主路径 + SSH 自愈都失败时返回错误：
- `gh` 不存在且 SSH 自愈也失败：`{"error":"GH_CLI_NOT_FOUND"}`。
- `gh` 未认证且 SSH 自愈失败：`{"error":"GH_NOT_AUTHENTICATED","host":"github.com","detail":"token 失效且 SSH 自愈失败"}`。
- PR 不存在或无权限：`{"error":"PR_NOT_FOUND_OR_NO_ACCESS"}`。
- checkout 失败：`{"error":"PR_CHECKOUT_FAILED"}`。
- 与远程同步失败：`{"error":"PR_SYNC_FAILED"}`。

5. 清理缓存目录（强制）
- 清理 `./.cache/` 下所有历史文件（保留目录本身），推荐：
- `mkdir -p ./.cache && find ./.cache -mindepth 1 -delete`
- 清理失败返回：`{"error":"CACHE_CLEAN_FAILED"}`。

6. 读取 PR 元信息（含 SSH 降级）
- 首选执行：
  - `gh pr view <PR_NUMBER> --json headRefName,baseRefName,mergeable,headRefOid`
- 若 `gh` 可用，必须提取：`headRefName`、`baseRefName`、`mergeable`、`headRefOid`。
- 若 `gh` 因认证失败不可用，但第 4 步已完成 SSH 自愈，则使用 git 回填字段：
  - `headRefName`：`git rev-parse --abbrev-ref HEAD`
  - `headRefOid`：`git rev-parse HEAD`
  - `baseRefName`：`git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'`
  - `mergeable`：置为 `UNKNOWN`，后续通过“冲突 gate”的试合并结果判定。
- 若 `headRefOid` 缺失：返回 `{"error":"PR_HEAD_OID_NOT_FOUND"}`。
- 若主路径与降级路径都无法获取有效元信息：返回 `{"error":"PR_NOT_FOUND_OR_NO_ACCESS"}`。

7. 生成 runId（强制）
- `headShort = headRefOid[:7]`
- `runId = <PR_NUMBER>-<round>-<headShort>`
- 后续输出中的 `runId/headOid/headShort` 必须与此一致，禁止重算为其他值。

8. 校验 base 信息并抓取远程基线
- 若 `baseRefName` 为空，尝试：
  - `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`
- 若仍为空，且已走 SSH 降级路径，尝试：
  - `git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'`
- 仍为空返回：`{"error":"PR_BASE_REF_NOT_FOUND"}`。
- 执行：`git fetch origin <baseRefName>`；失败返回：`{"error":"PR_BASE_REF_FETCH_FAILED"}`。

9. 合并冲突 gate
- 若 `mergeable == "CONFLICTING"`，直接返回：`{"error":"PR_MERGE_CONFLICTS_UNRESOLVED"}`。
- 若 `mergeable == "UNKNOWN"`（SSH 降级路径），必须通过试合并判定：
  - `git merge --no-ff --no-commit origin/<baseRefName>`
  - 若出现冲突：`git merge --abort` 后返回 `{"error":"PR_MERGE_CONFLICTS_UNRESOLVED"}`。
  - 若无冲突：`git merge --abort`，继续下一步。

10. 质量 gate（预检核心）
- 创建日志文件（都放 `./.cache/`）：
  - `precheck-<runId>-build.log`
  - `precheck-<runId>-meta.json`
- 执行：
  - `dx build all`
- 若成功：返回 `{"ok":true,...}`（附带上下文字段，见“成功返回字段”）。
- 若失败：
  - 生成 `./.cache/precheck-fix-<runId>.md`，收敛 lint/build 失败信息（含日志路径与可定位 file/line）。
  - 返回 `{"ok":false,"fixFile":"./.cache/precheck-fix-<runId>.md",...}`。

## fixFile 内容规范（强制）

- 文件格式建议：
- 一级标题：`## IssuesToFix`
- 每个问题至少包含：`id`、`priority`、`category`、`file`、`line`、`title`、`description`、`suggestion`
- 问题分级建议：
- `dx build all` 失败至少 `P0`
- `dx lint` 失败至少 `P1`

## 成功返回字段（建议完整透出）

- `ok: true`
- `prNumber`
- `round`
- `runId`
- `headOid`
- `headShort`
- `headRefName`
- `baseRefName`
- `mergeable`

## 单行 JSON 输出契约（强制）

- 允许在执行过程中输出简短进度反馈，建议格式：
- `progress: <阶段名> - <当前动作>`
- 进度反馈建议在关键长耗时步骤前后输出（如 checkout/sync、cache clean、lint/build）。
- **最终结果必须放在最后一行**，且该行必须是合法 JSON（可 `JSON.parse()`）。
- 除 `progress:` 行与最后一行 JSON 外，禁止输出其他解释/分析文字。
- 禁止输出 Markdown 代码块（```）。
- 禁止前后空行。
- 若流程发生未捕获异常，且无法产出合法业务 JSON：
- 仅输出：`{"error":"PR_PRECHECK_AGENT_FAILED"}`（必要时可加 `detail`）。

## 仅当出现 merge 冲突时怎么处理

当返回 `{"error":"PR_MERGE_CONFLICTS_UNRESOLVED"}` 时：

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

# 5) 重新执行本 precheck 流程（从“预检流程”第 1 步开始重跑）
```
