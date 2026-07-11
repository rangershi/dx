# Backend E2E Test Name Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure backend E2E file, test-name, passthrough, and default worker arguments are executed before any trailing shell comment.

**Architecture:** Keep command construction inside `lib/cli/commands/core.js`, but replace raw end-of-string concatenation with a small comment-aware append helper. The helper recognizes only unquoted shell comment boundaries and preserves the original comment after all executable arguments; worker detection inspects only the executable portion.

**Tech Stack:** Node.js ESM, Jest 29, shell command execution through the existing DX CLI test harness.

## Global Constraints

- Preserve E2E environment loading and automatic `--e2e` selection.
- Preserve existing E2E path normalization and target `cwd` resolution.
- Preserve the default E2E worker value at exactly `8`.
- Preserve `requiresPath` rejection for missing paths and `all`.
- Do not change target-project `project.json`, `commands.json`, or CLI configuration formats.

---

## File Structure

- Modify `test/test-command-e2e-targets.test.js`: add the CLI-level regression that executes a direct target command containing a trailing worker comment.
- Modify `lib/cli/commands/core.js`: add shell-comment splitting and argument-appending helpers, then route E2E dynamic arguments and default workers through them.
- Reuse `test/test-command-e2e-guard.test.js` unchanged to prove the repository gate remains active.

### Task 1: Add the failing backend E2E CLI regression

**Files:**
- Modify: `test/test-command-e2e-targets.test.js`
- Test: `test/test-command-e2e-targets.test.js`

**Interfaces:**
- Consumes: existing `runDx`, `createTempConfigDir`, `createRunnableWorkspace`, and `writeProjectConfig` test helpers.
- Produces: a regression test proving the spawned runner receives the normalized path, `-t` value, and `--workers=8` before the trailing comment.

- [ ] **Step 1: Add the failing CLI regression test**

Insert this test after the existing `nx e2e fileCommand runs the resolved project target command directly` case:

```js
  test('nx e2e direct command inserts test arguments before a trailing worker comment', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    mkdirSync(join(workspaceDir, 'apps', 'backend', 'e2e'), { recursive: true })
    writeProjectConfig(workspaceDir, 'backend', {
      targets: {
        'test:e2e': {
          options: {
            command:
              'node -e "console.log(\'DIRECT_ARGS=\' + JSON.stringify(process.argv.slice(1)))" -- # --workers=1',
            cwd: 'apps/backend',
          },
        },
      },
    })
    const testPath = 'apps/backend/e2e/character/character.e2e-spec.ts'

    const result = runDx(
      ['--config-dir', configDir, 'test', 'e2e', 'nxBackend', testPath, '-t', 'case name'],
      { cwd: workspaceDir },
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain(
      'DIRECT_ARGS=["e2e/character/character.e2e-spec.ts","-t","case name","--workers=8"]',
    )
    expect(result.output).toContain(
      "-- 'e2e/character/character.e2e-spec.ts' -t 'case name' --workers=8 # --workers=1",
    )
  })
```

- [ ] **Step 2: Run the regression and verify RED**

Run:

```bash
rtk pnpm test --runInBand test/test-command-e2e-targets.test.js
```

Expected: FAIL in the new test because the existing command places the normalized path, `-t 'case name'`, and default worker handling after `# --workers=1`; the spawned process prints `DIRECT_ARGS=[]`.

- [ ] **Step 3: Commit the failing regression**

```bash
rtk git add test/test-command-e2e-targets.test.js
rtk git commit -F - <<'MSG'
test: 覆盖 E2E 参数被 shell 注释截断

变更说明：
- 增加带空格测试名称的 backend E2E CLI 回归用例
- 验证路径、-t 和默认 worker 到达底层 runner

Refs: #39
MSG
```

### Task 2: Make test command argument appending shell-comment aware

**Files:**
- Modify: `lib/cli/commands/core.js`
- Test: `test/test-command-e2e-targets.test.js`

**Interfaces:**
- Consumes: already shell-escaped argument strings produced by `shellEscape`, plus raw configured command strings.
- Produces: `splitShellCommandComment(command) -> { executable: string, comment: string }` and `appendShellArgs(command, args) -> string` local helpers.

- [ ] **Step 1: Add comment-aware shell helpers after `shellEscape`**

Add:

```js
function splitShellCommandComment(command) {
  const text = String(command || '')
  let quote = null
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }

    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'"
      continue
    }

    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"'
      continue
    }

    if (char === '#' && quote === null && (i === 0 || /\s/.test(text[i - 1]))) {
      return {
        executable: text.slice(0, i).trimEnd(),
        comment: text.slice(i).trim(),
      }
    }
  }

  return { executable: text.trimEnd(), comment: '' }
}

function appendShellArgs(command, args = []) {
  const additions = args.filter(Boolean).join(' ')
  if (!additions) return command

  const { executable, comment } = splitShellCommandComment(command)
  const executableWithArgs = executable ? `${executable} ${additions}` : additions
  return comment ? `${executableWithArgs} ${comment}` : executableWithArgs
}
```

- [ ] **Step 2: Route E2E path, test-name, and passthrough arguments through the helper**

Replace the direct-target construction and raw concatenation in `handleTest` with:

```js
    let command = directTarget
      ? appendShellArgs(directTarget.command, [shellEscape(normalizedTestPath)])
      : fileCommand.replace('{TEST_PATH}', shellEscape(normalizedTestPath))

    if (testNamePattern) {
      command = appendShellArgs(command, ['-t', shellEscape(testNamePattern)])
    }

    if (passthroughArgs.length > 0) {
      command = appendShellArgs(command, passthroughArgs.map(shellEscape))
    }
```

- [ ] **Step 3: Ignore comments during worker detection and append the default worker before comments**

Replace `appendDefaultTestWorkers` with:

```js
function appendDefaultTestWorkers(cli, command, type) {
  const flag = getDefaultWorkerFlag(type)
  if (!flag) return command

  const text = String(command || '').trim()
  const executable = type === 'e2e'
    ? splitShellCommandComment(text).executable
    : text
  if (!executable || hasWorkerFlag(executable, flag)) return command
  if (type === 'unit' && commandUsesRunInBand(cli, executable)) return command

  const workerArg = `${flag}=${DEFAULT_TEST_WORKERS}`
  if (isNodeEvalCommandWithoutArgSeparator(executable)) {
    return type === 'e2e'
      ? appendShellArgs(text, ['--', workerArg])
      : `${text} -- ${workerArg}`
  }

  return type === 'e2e'
    ? appendShellArgs(text, [workerArg])
    : `${text} ${workerArg}`
}
```

- [ ] **Step 4: Run the focused E2E target tests and verify GREEN**

Run:

```bash
rtk pnpm test --runInBand test/test-command-e2e-targets.test.js
```

Expected: PASS, including the new trailing-comment regression and existing path, alias, passthrough, direct-target, and worker cases.

- [ ] **Step 5: Commit the minimal implementation**

```bash
rtk git add lib/cli/commands/core.js
rtk git commit -F - <<'MSG'
fix: 避免 backend E2E 参数落入 shell 注释

变更说明：
- 在行尾注释之前追加 E2E 路径、测试名称与透传参数
- 仅从可执行命令检测 worker 并保留默认值 8

Closes: #39
MSG
```

### Task 3: Verify repository gates and full compatibility

**Files:**
- Test unchanged: `test/test-command-e2e-guard.test.js`
- Test unchanged: all files under `test/`

**Interfaces:**
- Consumes: the completed implementation from Task 2.
- Produces: fresh evidence that the path gate and full DX CLI suite remain green.

- [ ] **Step 1: Run focused E2E target and guard tests**

Run:

```bash
rtk pnpm test --runInBand test/test-command-e2e-targets.test.js test/test-command-e2e-guard.test.js
```

Expected: both suites PASS; the guard suite confirms missing paths and `all` remain rejected.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
rtk pnpm test --runInBand
```

Expected: all Jest suites PASS with zero failed tests.

- [ ] **Step 3: Inspect the final diff and repository state**

Run:

```bash
rtk git diff main...HEAD --check
rtk git status --short --branch
rtk git log --oneline --decorate -4
```

Expected: `git diff --check` exits 0; the branch is `fix/39-backend-e2e-test-name`; only intentional commits are present; the worktree is clean.
