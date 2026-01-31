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

## 一键脚本（推荐，省 token）

把「环境/权限校验、PR 信息读取、checkout、base 分支 fetch、cache clear、lint+build、失败时写 fixFile、最终 JSON 输出」压到一次 `bash` 调用里执行。只有当脚本返回 merge 冲突相关错误时，才进入下面第 3 步做内容级合并。

注意：脚本会把所有命令输出写入 `~/.opencode/cache/`，stdout 只打印最终单一 JSON。

```bash
# 用法：把 PR 号填到 PR_NUMBER
PR_NUMBER=123 python3 - <<'PY'
import json
import os
import re
import secrets
import subprocess
from pathlib import Path


def run(cmd, *, cwd=None, stdout_path=None, stderr_path=None):
    if stdout_path and stderr_path and stdout_path == stderr_path:
        f = open(stdout_path, "wb")
        try:
            p = subprocess.run(cmd, cwd=cwd, stdout=f, stderr=f)
            return p.returncode
        finally:
            f.close()

    stdout_f = open(stdout_path, "wb") if stdout_path else subprocess.DEVNULL
    stderr_f = open(stderr_path, "wb") if stderr_path else subprocess.DEVNULL
    try:
        p = subprocess.run(cmd, cwd=cwd, stdout=stdout_f, stderr=stderr_f)
        return p.returncode
    finally:
        if stdout_path:
            stdout_f.close()
        if stderr_path:
            stderr_f.close()


def run_capture(cmd, *, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p.returncode, p.stdout, p.stderr


def tail_text(path, max_lines=200, max_chars=12000):
    try:
        data = Path(path).read_text(errors="replace")
    except Exception:
        return "(failed to read log)"
    lines = data.splitlines()
    tail = "\n".join(lines[-max_lines:])
    if len(tail) > max_chars:
        tail = tail[-max_chars:]
    return tail


def first_file_line(text):
    # Best-effort: match "path:line:col" or "path:line".
    for m in re.finditer(r"^([^\s:]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?\b", text, flags=re.M):
        file = m.group(1)
        line = int(m.group(2))
        return file, line
    return None, None


def write_fixfile(path, issues):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # Minimal schema for pr-fix parser.
    out = ["## IssuesToFix", ""]
    for it in issues:
        out.append(f"- id: {it['id']}")
        out.append(f"  priority: {it['priority']}")
        out.append(f"  category: {it['category']}")
        out.append(f"  file: {it['file']}")
        out.append(f"  line: {it['line'] if it['line'] is not None else 'null'}")
        out.append(f"  title: {it['title']}")
        # Keep as one line; caller should truncate.
        desc = it["description"].replace("\n", "\\n")
        sugg = it["suggestion"].replace("\n", "\\n")
        out.append(f"  description: {desc}")
        out.append(f"  suggestion: {sugg}")
    p.write_text("\n".join(out) + "\n")


def main():
    pr = os.environ.get("PR_NUMBER", "").strip()
    if not pr.isdigit():
        print(json.dumps({"error": "PR_NUMBER_NOT_PROVIDED"}))
        return

    # Step 1: must be in git repo.
    rc, out, _ = run_capture(["git", "rev-parse", "--is-inside-work-tree"])
    if rc != 0 or out.strip() != "true":
        print(json.dumps({"error": "NOT_A_GIT_REPO"}))
        return

    # Step 1: gh auth.
    rc = run(["gh", "auth", "status"])  # devnull
    if rc != 0:
        print(json.dumps({"error": "GH_NOT_AUTHENTICATED"}))
        return

    # Read PR info.
    rc, pr_json, _ = run_capture(["gh", "pr", "view", pr, "--json", "headRefName,baseRefName,mergeable"]) 
    if rc != 0:
        print(json.dumps({"error": "PR_NOT_FOUND_OR_NO_ACCESS"}))
        return
    try:
        pr_info = json.loads(pr_json)
    except Exception:
        print(json.dumps({"error": "PR_NOT_FOUND_OR_NO_ACCESS"}))
        return

    head = (pr_info.get("headRefName") or "").strip()
    base = (pr_info.get("baseRefName") or "").strip()
    mergeable = (pr_info.get("mergeable") or "").strip()

    # Step 2: checkout PR branch if needed.
    rc, cur_branch, _ = run_capture(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        print(json.dumps({"error": "PR_CHECKOUT_FAILED"}))
        return
    if head and cur_branch.strip() != head:
        if run(["gh", "pr", "checkout", pr]) != 0:
            print(json.dumps({"error": "PR_CHECKOUT_FAILED"}))
            return

    # Step 3 pre-req: resolve base ref.
    if not base:
        rc, out, _ = run_capture(["gh", "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])
        if rc == 0:
            base = out.strip()
    if not base:
        print(json.dumps({"error": "PR_BASE_REF_NOT_FOUND"}))
        return

    # Fetch base.
    if run(["git", "fetch", "origin", base]) != 0:
        ok = False
        for fallback in ("main", "master"):
            if fallback == base:
                continue
            if run(["git", "fetch", "origin", fallback]) == 0:
                base = fallback
                ok = True
                break
        if not ok:
            print(json.dumps({"error": "PR_BASE_REF_FETCH_FAILED"}))
            return

    # If mergeable reports conflict, ask agent to go to conflict-resolution step.
    if mergeable == "CONFLICTING":
        print(json.dumps({"error": "PR_MERGE_CONFLICTS_UNRESOLVED"}))
        return

    # Step 4: cache clear then lint + build (in parallel), logs to cache.
    run_id = secrets.token_hex(4)
    cache = Path.home() / ".opencode" / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    cache_clear_log = cache / f"precheck-pr{pr}-{run_id}-cache-clear.log"
    lint_log = cache / f"precheck-pr{pr}-{run_id}-lint.log"
    build_log = cache / f"precheck-pr{pr}-{run_id}-build.log"
    meta_log = cache / f"precheck-pr{pr}-{run_id}-meta.json"

    # Keep meta for debugging (not printed to stdout).
    meta_log.write_text(json.dumps({
        "pr": int(pr),
        "headRefName": head,
        "baseRefName": base,
        "mergeable": mergeable,
        "cacheClearLog": str(cache_clear_log),
        "lintLog": str(lint_log),
        "buildLog": str(build_log),
    }, indent=2) + "\n")

    cache_rc = run(["dx", "cache", "clear"], stdout_path=str(cache_clear_log), stderr_path=str(cache_clear_log))
    if cache_rc != 0:
        fix_file = f"~/.opencode/cache/precheck-fix-pr{pr}-{run_id}.md"
        fix_path = str(cache / f"precheck-fix-pr{pr}-{run_id}.md")
        log_tail = tail_text(cache_clear_log)
        issues = [{
            "id": "PRE-001",
            "priority": "P1",
            "category": "quality",
            "file": "<unknown>",
            "line": None,
            "title": "dx cache clear failed",
            "description": log_tail,
            "suggestion": f"Open log: {cache_clear_log}",
        }]
        write_fixfile(fix_path, issues)
        print(json.dumps({"ok": False, "fixFile": fix_file}))
        return

    import threading

    results = {}

    def worker(name, cmd, log_path):
        results[name] = run(cmd, stdout_path=str(log_path), stderr_path=str(log_path))

    t1 = threading.Thread(target=worker, args=("lint", ["dx", "lint"], lint_log))
    t2 = threading.Thread(target=worker, args=("build", ["dx", "build", "all"], build_log))
    t1.start(); t2.start(); t1.join(); t2.join()

    if results.get("lint", 1) == 0 and results.get("build", 1) == 0:
        print(json.dumps({"ok": True}))
        return

    fix_file = f"~/.opencode/cache/precheck-fix-pr{pr}-{run_id}.md"
    fix_path = str(cache / f"precheck-fix-pr{pr}-{run_id}.md")

    issues = []
    i = 1
    if results.get("lint", 1) != 0:
        log_tail = tail_text(lint_log)
        file, line = first_file_line(log_tail)
        issues.append({
            "id": f"PRE-{i:03d}",
            "priority": "P1",
            "category": "lint",
            "file": file or "<unknown>",
            "line": line,
            "title": "dx lint failed",
            "description": log_tail,
            "suggestion": f"Open log: {lint_log}",
        })
        i += 1
    if results.get("build", 1) != 0:
        log_tail = tail_text(build_log)
        file, line = first_file_line(log_tail)
        issues.append({
            "id": f"PRE-{i:03d}",
            "priority": "P0",
            "category": "build",
            "file": file or "<unknown>",
            "line": line,
            "title": "dx build all failed",
            "description": log_tail,
            "suggestion": f"Open log: {build_log}",
        })

    write_fixfile(fix_path, issues)
    print(json.dumps({"ok": False, "fixFile": fix_file}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Keep stdout contract.
        print(json.dumps({"error": "PRECHECK_SCRIPT_FAILED"}))

PY
```

## 要做的事（按顺序）

优先使用上面的「一键脚本」完成第 1/2/4/5 步；仅当脚本返回 merge 冲突相关错误时，再进入第 3 步进行内容级合并（完成后重跑脚本）。

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

- 运行 `dx cache clear`
- 运行 `dx lint`
- 运行 `dx build all`

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
