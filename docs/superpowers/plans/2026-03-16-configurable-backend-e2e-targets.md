# Configurable Backend E2E Targets Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `dx test e2e <target> <path>` support multiple configured backend-style targets while rejecting all whole-target and aggregate E2E runs.

**Architecture:** Move E2E guarding from a hardcoded `backend` branch to config-driven capability checks based on `test.e2e.<target>`. Keep responsibilities split across validation, command assembly, and help/test coverage so future targets such as `quantify` only require `commands.json` updates, not new CLI branching.

**Tech Stack:** Node.js ESM, existing `dx` CLI command router, Jest, existing logger/help/test harness.

---

## Chunk 1: Guarded E2E Validation

### Task 1: Expand CLI guard tests from backend-only to config-driven behavior

**Files:**
- Modify: `test/test-command-e2e-guard.test.js`
- Reference: `docs/superpowers/specs/2026-03-16-configurable-backend-e2e-targets-design.md`

- [ ] **Step 1: Write failing guard cases for all confirmed command rules**

```js
test('rejects backend e2e without path', () => {})
test('rejects backend e2e all', () => {})
test('rejects quantify e2e without path', () => {})
test('rejects quantify e2e all', () => {})
test('rejects dx test e2e all', () => {})
```

- [ ] **Step 2: Add one compatibility case for unguarded E2E targets**

```js
test('unguarded e2e targets still keep previous behavior', () => {})
```

- [ ] **Step 3: Run the focused test file and confirm failure**

Run: `pnpm test -- test-command-e2e-guard.test.js`
Expected: FAIL because the current guard only blocks `backend` without a path.

- [ ] **Step 4: Commit the failing test update**

```bash
git add test/test-command-e2e-guard.test.js
git commit -m "test: define guarded e2e target validation cases"
```

### Task 2: Implement config-driven E2E validation in the CLI shell

**Files:**
- Modify: `lib/cli/dx-cli.js`
- Reference: `dx/config/commands.json`

- [ ] **Step 1: Update `validateTestPositionals` to use config instead of `backend` hardcoding**

Implementation shape:

```js
const [type = 'e2e', target = 'all', testPath] = positionalArgs

if (type !== 'e2e') return
if (target === 'all') rejectGlobalAggregate()

const testConfig = this.commands?.test?.[type]?.[target]
if (!testConfig) return
if (!testConfig.requiresPath) return
if (!testPath) rejectMissingPath(target)
if (testPath === 'all') rejectAggregatePath(target)
```

- [ ] **Step 2: Keep unknown target behavior unchanged**

Do not emit guard errors for unknown targets. Let later command resolution continue to surface the existing `未找到测试配置` message.

- [ ] **Step 3: Add target-aware error helpers or inline messages**

Required messages:

```text
dx test e2e <target> 必须提供测试文件或目录路径
dx test e2e <target> 不支持 all，必须提供测试文件或目录路径
dx test e2e all 不受支持，请指定 target 和测试文件或目录路径
```

- [ ] **Step 4: Re-run the focused guard test file**

Run: `pnpm test -- test-command-e2e-guard.test.js`
Expected: PASS for validation coverage, while command assembly tests still fail until Chunk 2 lands.

- [ ] **Step 5: Commit**

```bash
git add lib/cli/dx-cli.js test/test-command-e2e-guard.test.js
git commit -m "feat: make e2e path guards configurable by target"
```

## Chunk 2: Guarded E2E Command Assembly

### Task 3: Add tests for target-specific `fileCommand` execution

**Files:**
- Create: `test/test-command-e2e-targets.test.js`
- Reference: `lib/cli/commands/core.js`

- [ ] **Step 1: Write failing execution tests around guarded targets**

```js
test('backend path run uses configured fileCommand', () => {})
test('quantify path run uses quantify fileCommand', () => {})
test('appends escaped -t pattern to guarded target fileCommand', () => {})
test('guarded target without fileCommand fails with configuration error', () => {})
test('unknown target still returns 未找到测试配置', () => {})
```

- [ ] **Step 2: Use a fixture config with at least two guarded E2E targets**

The fixture should model:

```json
{
  "test": {
    "e2e": {
      "backend": { "requiresPath": true, "fileCommand": "echo backend {TEST_PATH}" },
      "quantify": { "requiresPath": true, "fileCommand": "echo quantify {TEST_PATH}" },
      "sample": { "command": "echo sample" }
    }
  }
}
```

- [ ] **Step 3: Run the new test file and confirm failure**

Run: `pnpm test -- test-command-e2e-targets.test.js`
Expected: FAIL because `handleTest` only special-cases `backend`.

- [ ] **Step 4: Commit the failing test file**

```bash
git add test/test-command-e2e-targets.test.js
git commit -m "test: cover configurable guarded e2e target execution"
```

### Task 4: Refactor `handleTest` to use `fileCommand` for guarded E2E targets

**Files:**
- Modify: `lib/cli/commands/core.js`

- [ ] **Step 1: Resolve target config before command rewriting**

```js
let testConfig = cli.commands.test[type]?.[target] || cli.commands.test[type]
if (!testConfig) { ... }
```

Keep this entry point, but remove the `target === 'backend'` branch.

- [ ] **Step 2: Build a guarded-target command path**

Implementation shape:

```js
if (type === 'e2e' && testConfig?.requiresPath && testPath) {
  if (!testConfig.fileCommand) throwConfigError()
  let command = testConfig.fileCommand.replace('{TEST_PATH}', escapeValue(testPath))
  if (testNamePattern) command = appendEscapedPattern(command, testNamePattern)
  testConfig = { ...testConfig, command }
}
```

- [ ] **Step 3: Reuse one escaping strategy for both path and `-t`**

Do not directly interpolate raw `testPath` or test name input. If there is no reusable helper yet, extract a small local helper in `core.js` for this command path and cover it through tests.

- [ ] **Step 4: Preserve non-guarded behavior**

If `requiresPath` is absent or false, keep the old `testConfig.command` execution path unchanged.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm test -- test-command-e2e-guard.test.js test-command-e2e-targets.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/cli/commands/core.js test/test-command-e2e-targets.test.js test/test-command-e2e-guard.test.js
git commit -m "feat: route guarded e2e targets through file commands"
```

## Chunk 3: Help Text and Project Config Alignment

### Task 5: Update help output to document multi-target guarded E2E behavior

**Files:**
- Modify: `lib/cli/help.js`
- Modify: `test/test-command-e2e-guard.test.js`

- [ ] **Step 1: Rewrite help text around `dx test`**

Required help updates:

- mention that `path` is required for guarded E2E targets, not only `backend`
- add one `quantify` example
- remove any example that suggests whole-target E2E runs are valid
- state that `dx test e2e all` is not supported

- [ ] **Step 2: Tighten help assertions**

```js
expect(output).toContain('dx test e2e backend apps/backend/e2e/auth')
expect(output).toContain('dx test e2e quantify apps/quantify/e2e/health/health.e2e-spec.ts')
expect(output).toContain('dx test e2e all 不受支持')
```

- [ ] **Step 3: Run focused tests**

Run: `pnpm test -- test-command-e2e-guard.test.js`
Expected: PASS with updated examples and restriction text.

- [ ] **Step 4: Commit**

```bash
git add lib/cli/help.js test/test-command-e2e-guard.test.js
git commit -m "docs: update help for guarded backend e2e targets"
```

### Task 6: Align example config and docs with the new guarded contract

**Files:**
- Modify: `dx/config/commands.json`
- Modify: `README.md`
- Modify: `example/dx/config/commands.json`
- Modify: `example/README.md`

- [ ] **Step 1: Ensure example config shows the guarded contract**

At minimum, document or configure:

```json
{
  "test": {
    "e2e": {
      "backend": {
        "requiresPath": true,
        "fileCommand": "..."
      }
    }
  }
}
```

- [ ] **Step 2: Update README examples to match the new behavior**

Required examples:

- `dx test e2e backend apps/backend/e2e/auth`
- `dx test e2e quantify apps/quantify/e2e/health/health.e2e-spec.ts`

Required restrictions:

- guarded E2E targets require a file or directory path
- `all` is not supported for E2E aggregate runs

- [ ] **Step 3: Run doc-adjacent verification**

Run: `pnpm test -- test-command-e2e-guard.test.js`
Expected: PASS after example/help alignment.

- [ ] **Step 4: Commit**

```bash
git add dx/config/commands.json README.md example/dx/config/commands.json example/README.md
git commit -m "docs: document configurable guarded e2e targets"
```

## Chunk 4: Final Verification

### Task 7: Run the complete regression slice for this change

**Files:**
- Modify: none
- Verify: `lib/cli/dx-cli.js`
- Verify: `lib/cli/commands/core.js`
- Verify: `lib/cli/help.js`
- Verify: `test/test-command-e2e-guard.test.js`
- Verify: `test/test-command-e2e-targets.test.js`

- [ ] **Step 1: Run targeted Jest coverage for the changed behavior**

Run: `pnpm test -- test-command-e2e-guard.test.js test-command-e2e-targets.test.js`
Expected: PASS.

- [ ] **Step 2: Run the full repository test suite if it is fast enough**

Run: `pnpm test`
Expected: PASS. If the suite is too slow or unrelated failures already exist, capture that explicitly in the final handoff instead of claiming full verification.

- [ ] **Step 3: Review git diff for accidental drift**

Run: `git diff --stat HEAD~4..HEAD`
Expected: only CLI/help/test/docs files relevant to guarded E2E target support.

- [ ] **Step 4: Final commit if verification required any cleanup**

```bash
git add lib/cli/dx-cli.js lib/cli/commands/core.js lib/cli/help.js test/test-command-e2e-guard.test.js test/test-command-e2e-targets.test.js README.md example/dx/config/commands.json example/README.md
git commit -m "chore: finalize configurable backend e2e target support"
```
