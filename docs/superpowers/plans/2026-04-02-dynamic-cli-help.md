# Dynamic CLI Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded CLI help text with config-driven rendering backed by `commands.json`, while keeping command routing, flags, and positional validation grounded in the current code paths.

**Architecture:** Introduce a help pipeline split into schema validation, node classification/model building, and terminal rendering. In phase 1, help text and target descriptions move to `commands.json`, while true command registration, flags, and positional rules remain in code and are pulled into consistency checks so the help layer cannot drift from runtime behavior.

**Tech Stack:** Node.js ESM, existing `dx` CLI router, `commands.json`, Jest, existing CLI integration-style tests.

---

## Chunk 1: Lock Current Behavior and Add New Dynamic Help Fixtures

Dirty worktree note:
- This repository already contains unrelated in-progress runtime/help changes.
- Task ownership in this plan is file-scoped.
- During Task 1/2 review, judge only the files listed in each task’s `Files` block; do not treat pre-existing edits in other files as task-scope violations.

### Task 1: Add failing tests that define the new dynamic help contract

**Files:**
- Create: `test/dynamic-help-schema.test.js`
- Create: `test/dynamic-help-renderer.test.js`
- Modify: `test/start-stack-config.test.js`
- Reference: `docs/superpowers/specs/2026-04-02-dynamic-cli-help-design.md`

- [ ] **Step 1: Write schema-focused failing tests for help metadata validation**

```js
import { describe, expect, test } from '@jest/globals'

describe('dynamic help schema', () => {
  test('rejects unknown help option flags', () => {
    expect(() => validateHelpConfig({
      help: {
        globalOptions: [{ flags: ['--unknown'], description: 'bad' }],
      },
    }, { knownFlags: new Map([['--dev', {}]]) })).toThrow('--unknown')
  })

  test('rejects help examples that reference unknown commands', () => {
    expect(() => validateHelpConfig({
      start: {
        help: {
          examples: [{ command: 'dx nope x', description: 'bad' }],
        },
      },
    }, { registeredCommands: ['start'] })).toThrow('nope')
  })
})
```

- [ ] **Step 2: Write renderer/model failing tests for visible command and target resolution**

```js
test('global help uses registered commands instead of raw config roots', () => {})
test('help model hides internal config bags and category nodes from target list', () => {})
test('summary prefers help.summary and falls back to description', () => {})
test('usage falls back to generated usage when help.usage is absent', () => {})
```

- [ ] **Step 3: Extend the existing start help test to expect dynamic rendering inputs instead of hardcoded `showHelp` strings**

```js
test('dynamic start help includes stack notes from config help metadata', () => {})
```

Constraint:
- `test/start-stack-config.test.js` already contains non-help regression coverage for `start stack` routing and positional validation.
- Keep those pre-existing runtime regression tests intact.
- Only append the dynamic help contract assertion needed for this task.

- [ ] **Step 4: Run the focused test files and confirm failure**

Run: `pnpm test -- test/dynamic-help-schema.test.js test/dynamic-help-renderer.test.js test/start-stack-config.test.js`
Expected: FAIL because no dynamic help schema/model/renderer exists yet.

- [ ] **Step 5: Commit the failing test baseline**

```bash
git add test/dynamic-help-schema.test.js test/dynamic-help-renderer.test.js test/start-stack-config.test.js
git commit -m "test: define dynamic cli help contract"
```

### Task 2: Add minimal help metadata to config fixtures without changing runtime behavior

**Files:**
- Modify: `dx/config/commands.json`
- Modify: `example/dx/config/commands.json`
- Test: `test/dynamic-help-schema.test.js`

- [ ] **Step 1: Add top-level help metadata and command-level help metadata for the first migrated commands**

Configuration shape to add:

```json
{
  "help": {
    "summary": "统一开发环境管理工具",
    "globalOptions": [
      { "flags": ["--dev", "--development"], "description": "使用开发环境" },
      { "flags": ["--prod", "--production"], "description": "使用生产环境" }
    ],
    "examples": [
      { "command": "dx start backend --dev", "description": "启动后端开发服务" }
    ],
    "commands": {
      "start": {
        "summary": "启动/桥接服务",
        "notes": [
          "未指定 service 时默认使用 dev 套件，仅允许 --dev"
        ],
        "examples": [
          { "command": "dx start backend --dev", "description": "启动后端开发服务" },
          { "command": "dx start stack front", "description": "PM2 服务栈 + Stagewise front" }
        ]
      }
    }
  }
}
```

Important:
- Do not place phase-1 command help metadata at `start.help` / `deploy.help` / `db.help`.
- Current runtime treats `start.*` and similar command-tree children as executable nodes, so embedding help there would change runtime behavior.

- [ ] **Step 2: Add explicit `help.nodeType` or `help.expose` only where heuristics would be ambiguous**

Example:

```json
{
  "parallelWeb": {
    "help": {
      "expose": false
    }
  }
}
```

- [ ] **Step 3: Keep existing `description` values untouched during this task**

Do not remove or rename `description` yet. This task is only about adding the new help metadata needed for schema/model tests.

- [ ] **Step 4: Re-run the schema test and confirm it still fails on missing validator implementation, not malformed config**

Run: `pnpm test -- test/dynamic-help-schema.test.js`
Expected: FAIL because validation functions do not exist yet, while JSON remains parseable.

- [ ] **Step 5: Commit**

```bash
git add dx/config/commands.json example/dx/config/commands.json test/dynamic-help-schema.test.js
git commit -m "chore: add initial help metadata to command configs"
```

## Chunk 2: Build the Help Validation and Modeling Pipeline

### Task 3: Implement help schema validation against real command and flag sources

**Files:**
- Create: `lib/cli/help-schema.js`
- Modify: `test/dynamic-help-schema.test.js`
- Reference: `lib/cli/flags.js`
- Reference: `lib/cli/dx-cli.js`

- [ ] **Step 1: Create a validator entry point that accepts config and runtime-derived registries**

```js
export function validateHelpConfig(commands, context) {
  const {
    registeredCommands = [],
    knownFlags = new Map(),
    usageValidator = () => ({ ok: true }),
    exampleValidator = () => ({ ok: true }),
  } = context
}
```

- [ ] **Step 2: Implement the first-pass structural checks**

Required checks:

```js
assertString(help.summary, 'help.summary')
assertArrayOfObjects(help.globalOptions, 'help.globalOptions')
assertArrayOfObjects(help.examples, 'help.examples')
assertFlagsExist(option.flags, knownFlags, path)
assertRegisteredCommand(example.command, registeredCommands, path)
```

- [ ] **Step 3: Validate examples and usage through injected runtime-aware callbacks**

```js
const usageResult = usageValidator(commandName, help.usage)
if (!usageResult.ok) throw new Error(usageResult.reason)

const exampleResult = exampleValidator(example.command)
if (!exampleResult.ok) throw new Error(exampleResult.reason)
```

- [ ] **Step 4: Re-run schema tests**

Run: `pnpm test -- test/dynamic-help-schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cli/help-schema.js test/dynamic-help-schema.test.js
git commit -m "feat: validate dynamic help config against runtime registries"
```

### Task 4: Implement node classification and help model building

**Files:**
- Create: `lib/cli/help-model.js`
- Modify: `test/dynamic-help-renderer.test.js`
- Reference: `dx/config/commands.json`

- [ ] **Step 1: Implement node classification for the six node types from the spec**

```js
export function classifyCommandNode(node = {}) {
  if (node?.help?.nodeType) return node.help.nodeType
  if (looksLikeInternalConfigBag(node)) return 'internal-config-bag'
  if (node.command || node.internal) return 'target-leaf'
  if (node.concurrent || node.sequential) return 'orchestration-node'
  if (looksLikeEnvContainer(node)) return 'env-container'
  if (looksLikeCategoryNode(node)) return 'category-node'
  return 'unknown-node'
}
```

- [ ] **Step 2: Add helpers to suppress hidden or non-user-facing nodes**

```js
export function isVisibleHelpNode(name, node, nodeType) {
  if (node?.help?.expose === false) return false
  if (nodeType === 'internal-config-bag') return false
  if (nodeType === 'category-node') return false
  return true
}
```

- [ ] **Step 3: Build global and command-level help models using registered commands rather than raw config root keys**

```js
export function getGlobalHelpModel(commands, context) {
  return {
    summary: commands.help?.summary ?? '',
    commands: context.registeredCommands.map(name => getCommandHelpModel(commands, name, context)),
  }
}
```

- [ ] **Step 4: Respect summary fallback rules**

```js
function resolveSummary(node) {
  return node?.help?.summary || node?.description || ''
}
```

- [ ] **Step 5: Add runtime context helpers needed by the renderer before wiring `help.js`**

Required interface:

```js
export function buildHelpRuntimeContext(cli) {
  return {
    registeredCommands: getRegisteredCommands(cli),
    knownFlags: cli.getAllowedFlags ? null : null,
  }
}
```

At minimum, this helper must provide:
- registered top-level commands derived from `DxCli.commandHandlers`
- a way for schema/model/renderer to access runtime-derived flag knowledge

- [ ] **Step 6: Run focused model/renderer tests**

Run: `pnpm test -- test/dynamic-help-renderer.test.js`
Expected: PASS for model classification and summary fallback assertions, while CLI integration tests still fail until rendering is wired in.

- [ ] **Step 7: Commit**

```bash
git add lib/cli/help-model.js test/dynamic-help-renderer.test.js
git commit -m "feat: classify config nodes for dynamic cli help"
```

## Chunk 3: Migrate Minimum Help Metadata Needed for Dynamic Rendering

### Task 5: Add config help metadata for `start`, `deploy`, and `db` before switching renderers

**Files:**
- Modify: `dx/config/commands.json`
- Modify: `example/dx/config/commands.json`
- Modify: `test/backend-artifact-deploy-routing.test.js`
- Modify: `test/start-stack-config.test.js`
- Modify: `test/db-migrate-guard.test.js`

- [ ] **Step 1: Add command-level help metadata for the three initial commands**

For `start`:

```json
"help": {
  "commands": {
    "start": {
      "summary": "启动/桥接服务",
      "usage": "dx start <service> [环境标志]",
      "notes": [
        "未指定 service 时默认使用 dev 套件，仅允许 --dev"
      ]
    }
  }
}
```

For `deploy` and `db`, add equivalent `summary`, `usage`, `notes`, and `examples` under `help.commands`.

- [ ] **Step 2: Add target-level help metadata for the targets that currently rely on hardcoded prose**

Targets to cover first:
- `start.stack`
- `start.stagewise-front`
- `start.stagewise-admin`
- `deploy.backend`
- `deploy.telegram-bot`
- `db.migrate`
- `db.deploy`
- `db.script`

Use a phase-1 safe location such as:

```json
{
  "help": {
    "targets": {
      "deploy": {
        "backend": {
          "summary": "构建并部署 backend 制品到远端主机"
        }
      }
    }
  }
}
```

- [ ] **Step 3: Rework existing tests so they assert config-driven text sources now exist**

Examples:

```js
expect(output).toContain('dx start stack')
expect(output).toContain('dx deploy backend --build-only')
expect(output).toContain('dx db migrate --dev --name init-user-table')
```

- [ ] **Step 4: Run targeted help/config tests**

Run: `pnpm test -- test/start-stack-config.test.js test/backend-artifact-deploy-routing.test.js test/db-migrate-guard.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dx/config/commands.json example/dx/config/commands.json test/start-stack-config.test.js test/backend-artifact-deploy-routing.test.js test/db-migrate-guard.test.js
git commit -m "docs: add config help metadata for start deploy db"
```

## Chunk 4: Replace Hardcoded Help Rendering with the New Pipeline

### Task 6: Add a renderer and swap `help.js` over to dynamic output

**Files:**
- Create: `lib/cli/help-renderer.js`
- Modify: `lib/cli/help.js`
- Modify: `test/dynamic-help-renderer.test.js`
- Modify: `test/backend-artifact-deploy-routing.test.js`
- Modify: `test/start-stack-config.test.js`

- [ ] **Step 1: Implement a simple text renderer for global help and single-command help**

```js
export function renderGlobalHelp(model) {
  return [
    '',
    model.title,
    '',
    '命令:',
    ...model.commands.map(item => `  ${item.name.padEnd(12)} ${item.summary}`),
  ].join('\n')
}
```

- [ ] **Step 2: Refactor `help.js` so it no longer owns the giant hardcoded `switch`**

Implementation shape:

```js
import { buildHelpRuntimeContext, getGlobalHelpModel, getCommandHelpModel } from './help-model.js'
import { renderGlobalHelp, renderCommandHelp } from './help-renderer.js'

export function showHelp(cliContext) {
  const model = getGlobalHelpModel(cliContext.commands, buildHelpRuntimeContext(cliContext))
  console.log(renderGlobalHelp(model))
}
```

- [ ] **Step 3: Keep backward-compatible wrappers while the CLI call sites are being updated**

Use a default path that still works from existing call sites:

```js
export function showHelp(cliContext = null) { ... }
export function showCommandHelp(command, cliContext = null) { ... }
```

- [ ] **Step 4: Rewrite tests that currently assert hardcoded help strings so they assert dynamic content instead**

Required assertions:

```js
expect(output).toContain('启动/桥接服务')
expect(output).toContain('dx start backend --dev')
expect(output).toContain('构建并部署 backend 制品到远端主机')
```

- [ ] **Step 5: Run focused help tests**

Run: `pnpm test -- test/dynamic-help-renderer.test.js test/backend-artifact-deploy-routing.test.js test/start-stack-config.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/cli/help-renderer.js lib/cli/help.js test/dynamic-help-renderer.test.js test/backend-artifact-deploy-routing.test.js test/start-stack-config.test.js
git commit -m "feat: render cli help from command config metadata"
```

### Task 7: Pass real CLI context into help rendering and preserve current `--help` behavior

**Files:**
- Modify: `lib/cli/dx-cli.js`
- Modify: `lib/cli/commands/core.js`
- Modify: `test/bin-unknown-command-fast-fail.test.js`
- Modify: `test/dynamic-help-renderer.test.js`

- [ ] **Step 1: Update top-level help call sites to pass the current CLI instance**

```js
if (this.flags.help && this.command && this.command !== 'help') {
  showCommandHelp(this.command, this)
} else {
  showHelp(this)
}
```

- [ ] **Step 2: Update `handleHelp` to pass CLI context through**

```js
export function handleHelp(cli, args = []) {
  if (args[0]) showCommandHelp(args[0], cli)
  else showHelp(cli)
}
```

- [ ] **Step 3: Keep positional validation unchanged in phase 1**

Do not add `dx help <command> <target>` yet. Preserve the current one-argument rule so this task stays focused on dynamic rendering parity.

- [ ] **Step 4: Re-run focused CLI help tests**

Run: `pnpm test -- test/bin-unknown-command-fast-fail.test.js test/dynamic-help-renderer.test.js`
Expected: PASS, and unknown command output still ends with a usable global help page.

- [ ] **Step 5: Commit**

```bash
git add lib/cli/dx-cli.js lib/cli/commands/core.js test/bin-unknown-command-fast-fail.test.js test/dynamic-help-renderer.test.js
git commit -m "refactor: route cli help through live cli context"
```

## Chunk 5: Add Consistency Checks and Finish Phase-1 Migration

### Task 8: Add runtime-aware consistency tests so config help cannot drift from real CLI rules

**Files:**
- Create: `test/dynamic-help-consistency.test.js`
- Modify: `test/dynamic-help-schema.test.js`
- Reference: `lib/cli/flags.js`
- Reference: `lib/cli/dx-cli.js`

- [ ] **Step 1: Write consistency tests that parse configured examples against live command and flag registries**

```js
test('every configured example command uses a registered top-level command', () => {})
test('every configured option flag exists in FLAG_DEFINITIONS', () => {})
test('configured usage strings do not contradict positional validation', () => {})
```

- [ ] **Step 2: Build a minimal helper that tokenizes `dx ...` example strings safely for validation**

Implementation shape for the test helper:

```js
function parseExampleCommand(commandText) {
  return shellLikeSplit(commandText)
}
```

Required behavior:
- preserve double-quoted and single-quoted segments as one argument
- preserve escaped quotes inside quoted segments when present
- reject unclosed quotes with a descriptive validation error

Do not use `split(/\s+/)` in this task. Current help examples already contain quoted test-name patterns, so whitespace splitting would produce false negatives.

- [ ] **Step 3: Run the new consistency suite**

Run: `pnpm test -- test/dynamic-help-schema.test.js test/dynamic-help-consistency.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/dynamic-help-consistency.test.js test/dynamic-help-schema.test.js
git commit -m "test: prevent dynamic help config from drifting from cli rules"
```

### Task 9: Migrate remaining command help and define phase-1 modeling for non-execution commands

**Files:**
- Modify: `dx/config/commands.json`
- Modify: `example/dx/config/commands.json`
- Modify: `lib/cli/help.js`
- Modify: `test/dynamic-help-renderer.test.js`

- [ ] **Step 1: Add help metadata for the remaining top-level commands still shown in help**

Commands to cover:
- `build`
- `test`
- `worktree`
- `clean`
- `cache`
- `install`
- `status`
- `contracts`
- `release`
- `package`
- `export`

- [ ] **Step 2: Use phase-1 `help-only` command metadata for commands that do not have a natural execution tree in `commands.json`**

Allowed shape:

```json
{
  "helpCommands": {
    "worktree": {
      "summary": "Git Worktree 管理",
      "usage": "dx worktree [action] [num...]"
    }
  }
}
```

Rules:
- phase 1 允许 `helpCommands` 作为 help-only metadata 区域
- `help.commands` 与 `helpCommands` 二选一，最终以仓库收敛后的统一命名为准；在本次实现中优先使用 `help.commands`，仅在命令没有对应执行树且迁移风险更低时保留 `helpCommands` 作为兼容过渡
- `helpCommands` 不参与运行时 target 解析
- `DxCli.commandHandlers` 仍然是顶层命令真源，`helpCommands` 只补正文

- [ ] **Step 3: Remove the last hardcoded command prose from `lib/cli/help.js`**

Target end state:

```js
export { showHelp, showCommandHelp } from './help-runtime.js'
```

or equivalently small wrappers that only build context and call renderer helpers.

- [ ] **Step 4: Run the focused help suite**

Run: `pnpm test -- test/dynamic-help-renderer.test.js test/dynamic-help-consistency.test.js`
Expected: PASS with no assertions depending on hardcoded help strings.

- [ ] **Step 5: Commit**

```bash
git add dx/config/commands.json example/dx/config/commands.json lib/cli/help.js test/dynamic-help-renderer.test.js test/dynamic-help-consistency.test.js
git commit -m "refactor: remove hardcoded cli help text"
```

### Task 10: Run full verification and document remaining phase-2 work

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-02-dynamic-cli-help-design.md`
- Modify: `docs/superpowers/plans/2026-04-02-dynamic-cli-help.md`

- [ ] **Step 1: Add a short README note about the new help source of truth**

Required note:

```md
CLI help content now comes from `dx/config/commands.json` help metadata. Top-level command registration, flags, and positional validation remain code-driven in phase 1.
```

- [ ] **Step 2: Record deferred phase-2 work in the spec/plan**

Deferred items to note:
- moving command registration into config
- moving flag definitions into config
- supporting `dx help <command> <target>`

- [ ] **Step 3: Run full test verification**

Run: `pnpm test`
Expected: PASS for the full Jest suite.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-04-02-dynamic-cli-help-design.md docs/superpowers/plans/2026-04-02-dynamic-cli-help.md
git commit -m "docs: record dynamic cli help phase one boundaries"
```

- [ ] **Step 5: Final verification note**

Capture in the final implementation summary:
- changed files
- which commands were migrated
- which runtime sources still remain authoritative in phase 1
- deferred phase-2 items
