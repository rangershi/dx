---
name: delivering-design-handoff
description: Use when a design is already approved and the user asks to create a design/spec doc, implementation plan, adversarial review, GitHub issue, issue branch, handoff document, commit, push, or copyable assignment text.
---

# Delivering Design Handoff

## Overview

Turn an approved design into a ready-to-assign engineering package with one closed loop: spec, spec review and fixes, implementation plan, plan review and fixes, handoff doc, issue, branch, commit, push, issue assignment comment, and copyable assignment text.

**Core principle:** after the design is approved, the user should not have to restate the delivery choreography. Each review gate must be completed and fixed before the next artifact is written.

## When To Use

Use this only after the solution direction is already approved. If the design is still being explored, first use `brainstorming`.

Typical user asks:

- “把这个方案写成设计文档并提 issue”
- “写计划和交接文档，提交到 issue 分支”
- “后续不想重复输入，从设计文档到 issue/分支/提交都自动做”
- “给我一段可以直接复制给工程师的任务分配文字”

## Required Output Contract

By the end, produce all of these or clearly state the blocker:

| Item | Required shape |
| --- | --- |
| Design spec | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, created using the design-doc discipline from `brainstorming` |
| Spec adversarial review | Reviewer subagent completed before the plan exists; valid findings applied to the spec, or explicit rejected findings with reasons |
| Implementation plan | `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, created by using `writing-plans` |
| Plan adversarial review | Reviewer subagent findings applied to the plan, or explicit rejected findings with reasons |
| Handoff doc | `docs/superpowers/handoffs/YYYY-MM-DD-<topic>-handoff.md` |
| GitHub issue | Structured issue with background, goals, plan, acceptance criteria, and doc paths |
| Issue branch | `codex/docs/<issue-id>-<slug>` for docs-only handoff, or matching repo convention |
| Commit | Conventional commit ending with `Refs: #<issue-id>` |
| Push | Branch pushed with upstream |
| Pull request | PR created or updated with the repo PR template, non-empty body, linked issue, doc paths, verification evidence, and read-back validation |
| Issue comment | Comment linking branch, commit, spec, plan, and handoff, plus the same project-manager-style assignment block from the final answer |
| Final answer | Short status plus a copyable project-manager-style assignment block |

## Workflow

### 1. Confirm starting state

- Read project instructions: `AGENTS.md`, referenced ruler docs, and git workflow docs.
- Check branch and worktree:

```bash
rtk git status --short --branch
rtk git remote -v
rtk gh auth status
```

- If there are unrelated dirty changes, do not overwrite them. If the handoff docs are the only dirty files, continue.

### 2. Write the design spec

Use `brainstorming` for the design-document phase. If the conversation already contains an approved design, do not restart exploratory questioning; treat that approved discussion as the input and apply `brainstorming`'s write-design-doc and self-review standards.

Create `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

Spec sections:

- Background
- Goals
- Non-goals
- Chosen approach and rejected alternatives
- Backend/frontend/data/API design as applicable
- Error handling
- Testing and verification
- Compatibility and risks
- Acceptance criteria

Run a self-review:

```bash
rtk rg -n "TBD|TODO|待定|占位|\\.\\.\\." <spec-path>
```

Fix every hit that is a placeholder. A literal example such as `new BasePaginationResponseDto(total, page, limit, items)` is allowed; vague ellipses are not.

### 3. Dispatch adversarial review

Spawn one reviewer subagent. The prompt must include:

- spec path
- repo root
- current approved design context
- review axes: correctness, missing edge cases, repo convention violations, testability, and handoff ambiguity
- “read-only, do not modify files”

Apply all valid findings to the spec. If rejecting a finding, record the reason in the handoff doc's review notes and mention it briefly in the final answer only if material.

**Gate before planning:** do not create the implementation plan until the reviewer subagent has returned, every valid spec finding has been fixed, every rejected finding has a recorded reason, and the spec placeholder scan has passed again. If the reviewer subagent is still running, timed out, or failed, this gate is not complete. If the user asks to save time by writing the plan while review or fixes are pending, decline that shortcut and finish this gate first.

### 4. Create the implementation plan

Announce and use `writing-plans`:

> I'm using the writing-plans skill to create the implementation plan.

Start this step only after Step 3 is complete.

Create `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` using the `writing-plans` required structure:

- header with goal, architecture, tech stack, and global constraints
- file map before tasks
- bite-sized tasks with exact files, interfaces, steps, commands, and expected results
- self-review for spec coverage, placeholders, and type consistency

Run placeholder scan:

```bash
rtk rg -n "TBD|TODO|待定|占位|\\.\\.\\." <plan-path>
```

Fix every true placeholder. Do not proceed to handoff until the plan can guide an engineer without asking back.

### 5. Dispatch plan adversarial review

Spawn one reviewer subagent for the plan. The prompt must include:

- spec path
- plan path
- repo root
- review axes: spec coverage, task order, file ownership, testability, missing code/commands, placeholders, type/interface consistency, and repo convention violations
- “read-only, do not modify files”

Apply all valid findings to the plan. If a finding reveals a spec defect, fix the spec too and re-check plan consistency.

### 6. Write the handoff document

Create `docs/superpowers/handoffs/YYYY-MM-DD-<topic>-handoff.md`.

This is separate from the implementation plan. It is the short assignment packet for a human engineer:

- Issue title and eventual issue id placeholder until issue exists
- branch name placeholder until branch exists
- links/paths to spec and plan
- why the work matters
- implementation order summary
- top risks and invariants
- required verification commands
- PR expectations and acceptance checklist pointer

Run placeholder scan over all docs. Placeholders that must be filled before commit, such as issue id after creation, must not remain.

```bash
rtk rg -n "TBD|TODO|待定|占位|\\.\\.\\." <spec-path> <plan-path> <handoff-path>
```

### 7. Create the GitHub issue

Use heredoc, never `-m` or literal `\n`.

Issue body must include:

- Background
- Goals
- Plan
- Acceptance criteria with objective checkboxes
- Links or paths to the spec, implementation plan, and handoff doc

Labels should match repo conventions. Prefer labels for backend/frontend/admin/database/api/docs when they exist.

After issue creation, fill the concrete issue id and URL into the handoff doc if it used placeholders.

### 8. Create the issue branch

Fetch the base and create a clean issue branch:

```bash
rtk git fetch origin main --prune
rtk git switch -c codex/docs/<issue-id>-<slug> origin/main
```

If the spec was created before switching, remember that untracked files usually follow the checkout but tracked edits may not. Verify both docs are present after the switch. If content disappears, recover it intentionally with `git show`, `git stash`, or re-apply the patch; never use destructive checkout/reset.

After branch creation, fill the concrete branch name into the handoff doc if needed. Run final placeholder scan:

```bash
rtk rg -n "TBD|TODO|待定|占位|\\.\\.\\." <spec-path> <plan-path> <handoff-path>
```

### 9. Commit and push

Stage only the intended docs:

```bash
rtk git add <spec-path> <plan-path> <handoff-path>
rtk git diff --cached --stat
rtk git diff --cached --check
```

Commit:

```bash
rtk git commit -F - <<'MSG'
docs: add <topic> handoff

变更说明：
- 新增设计文档，固化已确认方案、风险、测试和验收标准。
- 新增实施计划和交接文档，拆分实现任务、文件范围和验证命令。

Refs: #<issue-id>
MSG
```

Push:

```bash
rtk git push -u origin <branch>
```

Comment on the issue with branch, commit, spec path, plan path, handoff path, and the copyable project-manager-style assignment block from the final answer. This issue comment is mandatory; do not finish with only a local final answer.

### 10. Create or update the pull request

If the user asks for a PR, or repo convention expects a PR for the handoff branch, create or update it before the final answer.

PR body must be written to a temporary markdown file and passed with `--body-file "$pr_body_file"`. Never use `gh pr create --body-file -`, `gh pr edit --body-file -`, or `--body "multi-line text"` for PR content. Do not trust `ok` or a returned URL as proof that the body was saved; only trust a read-back from `gh pr view --json body`.

Use the repository PR template. When this repo's template is the standard git workflow template, the body must include all of these headings exactly:

- `## 变更目的`
- `## 主要改动和解决的问题`
- `## 遗留的问题`
- `## 已做的验证`
- `##  PR 遗留未做的`
- `## 关联`

The body must also include:

- `Closes: #<issue-id>`
- branch name
- commit sha or subject
- spec path
- plan path
- handoff path
- verification commands and results, or an explicit docs-only note

Example shape:

```bash
pr_body_file="$(mktemp "${TMPDIR:-/tmp}/handoff-pr-body.XXXXXX.md")"
cat > "$pr_body_file" <<'MSG'
## 变更目的
<why this handoff exists and which approved design it packages>

## 主要改动和解决的问题
- 新增设计文档：`<spec-path>`
- 新增实施计划：`<plan-path>`
- 新增交接文档：`<handoff-path>`
- 分支：`<branch>`
- 提交：`<sha> <subject>`

## 遗留的问题
- 无，或列出明确遗留风险和处理建议。

## 已做的验证
- `rtk git diff --cached --check`：通过
- `rtk rg -n "TBD|TODO|待定|占位|\\.\\.\\." <spec-path> <plan-path> <handoff-path>`：无真实占位
- 文档交付，无需运行构建或测试。

##  PR 遗留未做的
- 无，或列出需要后续实现 PR 完成的事项。

## 关联
Closes: #<issue-id>
MSG

pr_url="$(rtk gh pr create --base main --title 'docs: add <topic> handoff' --body-file "$pr_body_file")"
pr_number="$(rtk gh pr view "$pr_url" --json number --jq '.number')"
pr_body="$(rtk gh pr view "$pr_number" --json body --jq '.body')"
test -n "$pr_body"
for heading in \
  "## 变更目的" \
  "## 主要改动和解决的问题" \
  "## 遗留的问题" \
  "## 已做的验证" \
  "##  PR 遗留未做的" \
  "## 关联"; do
  printf '%s\n' "$pr_body" | grep -F "$heading" >/dev/null
done
printf '%s\n' "$pr_body" | grep -F "Closes: #<issue-id>" >/dev/null
printf '%s\n' "$pr_body" | grep -F "<branch>" >/dev/null
printf '%s\n' "$pr_body" | grep -F "<sha>" >/dev/null
printf '%s\n' "$pr_body" | grep -F "<spec-path>" >/dev/null
printf '%s\n' "$pr_body" | grep -F "<plan-path>" >/dev/null
printf '%s\n' "$pr_body" | grep -F "<handoff-path>" >/dev/null
rm -f "$pr_body_file"
```

If a PR already exists, use the same temp-file path with `rtk gh pr edit <pr-number> --body-file "$pr_body_file"`, then run the same read-back validation. If any heading, issue link, doc path, branch, commit, or verification evidence is missing, fix the temp body file, edit again, and read back again before continuing.

### 11. Final verification

Before claiming completion, run:

```bash
rtk git status --short --branch
rtk git log -1 --oneline
rtk git rev-parse --abbrev-ref --symbolic-full-name @{u}
```

Report actual state. If no tests/builds were run because this is docs-only, say that.

If a PR was created or updated, read back the PR body and verify it is non-empty, follows the repo template headings, includes `Closes: #<issue-id>`, and contains the branch, commit, spec path, plan path, handoff path, and verification evidence. If `gh pr create` or `gh pr edit` reported success but read-back is empty or incomplete, repair the PR with a temp body file and read it back again before claiming completion.

Read back the issue comments and verify that the latest handoff comment contains the branch, commit, spec path, plan path, handoff path, and the same assignment block shown in the final answer. If `gh issue comment` failed, the comment is missing, or the readback does not match the final assignment block, fix that before claiming completion.

## Final Answer Template

Keep it short, then include this copyable block:

```markdown
已准备好交接资料：

- Issue：#<issue-id> <issue-url>
- PR：#<pr-id> <pr-url>
- 分支：`<branch>`
- 提交：`<sha> <subject>`
- 设计文档：`<spec-path>`
- 实施计划：`<plan-path>`
- 交接文档：`<handoff-path>`

以下交接评论已同步写入 Issue，可直接派发给开发工程师：

请基于 `<branch>` 接手实现 Issue #<issue-id>：<issue-title>。

先阅读：
1. `<spec-path>`
2. `<plan-path>`
3. `<handoff-path>`

实现时请按实施计划的 Task 顺序推进，并重点守住以下约束：
- <top-risk-or-constraint-1>
- <top-risk-or-constraint-2>
- <top-risk-or-constraint-3>

完成后请至少运行：
- `<verification-command-1>`
- `<verification-command-2>`
- `<verification-command-3>`

验收标准以 Issue #<issue-id> 的 checklist 为准。提 PR 时请逐条对应验收标准，并贴出验证命令结果；如遇到与设计文档冲突的实现细节，先在 Issue 中同步风险和建议处理方式。
```

In Codex app, after successful git actions, also emit the app directives for branch creation, staging, commit, and push.

## Common Mistakes

- Writing the issue before the spec is stable and then forgetting to update links.
- Writing the implementation plan before spec adversarial review has completed and valid findings have been fixed.
- Skipping adversarial review because the spec “looks obvious”.
- Treating the handoff doc as the implementation plan. The implementation plan must be produced with `writing-plans`, reviewed, and fixed before the handoff doc.
- Skipping adversarial review of the implementation plan.
- Creating the branch from the current stale feature branch instead of `origin/main`.
- Committing on an unrelated branch.
- Writing a handoff that says “add tests” without exact files, behaviors, and commands.
- Forgetting the issue comment, leaving the receiving engineer to hunt for branch and docs.
- Posting an issue comment with links only, but omitting the project-manager-style assignment block.
- Creating or editing a PR with `--body-file -` and assuming the body was saved.
- Trusting `gh pr create`, `gh pr edit`, or `ok` without reading back `gh pr view --json body`.
- Creating a PR whose body is empty, misses the repo template headings, omits `Closes: #<issue-id>`, or lacks doc paths and verification evidence.
- Final answer lists artifacts but omits the copyable project-manager-style assignment block.
