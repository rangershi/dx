# Backend Artifact Deploy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in `dx deploy backend` runner that builds a backend artifact locally, uploads it with `scp`, and deploys it remotely over `ssh` using configuration from `dx/config/commands.json`.

**Architecture:** Extend the existing `deploy` command router so backend deploy targets can dispatch to a new internal runner without regressing the current Vercel flow. Implement the feature as a few focused units: config normalization, local artifact building, remote transport, and remote command/result handling; keep runtime package generation backend-specific and fail fast on unsupported workspace dependency shapes.

**Tech Stack:** Node.js ESM, existing `dx` CLI command system, Jest, shelling out to `ssh`/`scp`/`tar`/`sha256sum`, existing logger/env/exec helpers.

---

## Chunk 1: CLI Routing, Config Validation, and Local Artifact Build

### Task 1: Add deploy CLI surface for backend artifact mode

**Files:**
- Create: `lib/backend-artifact-deploy.js`
- Modify: `lib/cli/commands/deploy.js`
- Modify: `lib/cli/help.js`
- Modify: `lib/cli/flags.js`
- Test: `test/backend-artifact-deploy-routing.test.js`

- [ ] **Step 1: Write the failing routing/help tests**

```js
test('deploy backend internal target dispatches to backend artifact runner', async () => {
  // mock commands.deploy.backend.internal = 'backend-artifact-deploy'
  // expect Vercel deploy path not to run
})

test('deploy backend defaults to development while Vercel targets keep staging default', async () => {
  // backend target => development
  // front target => staging
})

test('parseFlags reads build-only and skip-migration for backend deploy', () => {
  // expect flags.buildOnly === true and flags.skipMigration === true
})

test('deploy help documents backend artifact mode and build-only flag', () => {
  // expect help text to mention backend build/deploy and --build-only/--skip-migration
  // and show backend deploy default differs from Vercel deploy default
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- backend-artifact-deploy-routing.test.js`
Expected: FAIL with missing backend deploy routing/help behavior.

- [ ] **Step 3: Implement minimal deploy routing and flag/help updates**

```js
// deploy.js
if (targetConfig?.internal === 'backend-artifact-deploy') {
  const { runBackendArtifactDeploy } = await import('../../backend-artifact-deploy.js')
  await runBackendArtifactDeploy({ cli, target: normalizedTarget, args, environment })
  return
}
```

```js
// backend-artifact-deploy.js temporary seam
export async function runBackendArtifactDeploy() {
  throw new Error('backend-artifact-deploy runner not implemented yet')
}
```

```js
// flags.js
deploy: [
  { flag: '--build-only' },
  { flag: '--skip-migration' },
  // existing telegram flags preserved
]
```

```js
// parseFlags()
case '--build-only':
  flags.buildOnly = true
  break
case '--skip-migration':
  flags.skipMigration = true
  break
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- backend-artifact-deploy-routing.test.js deploy-env-merge.test.js deploy-telegram-webhook-flags.test.js`
Expected: PASS, proving backend routing was added without regressing current deploy parsing helpers.

- [ ] **Step 5: Commit**

```bash
git add lib/backend-artifact-deploy.js lib/cli/commands/deploy.js lib/cli/help.js lib/cli/flags.js test/backend-artifact-deploy-routing.test.js
git commit -m "feat: route backend deploy targets to internal artifact runner"
```

### Task 2: Define backend deploy config normalization and validation

**Files:**
- Create: `lib/backend-artifact-deploy/config.js`
- Test: `test/backend-artifact-deploy-config.test.js`
- Reference: `docs/superpowers/specs/2026-03-12-backend-artifact-deploy-design.md`

- [ ] **Step 1: Write the failing config validation tests**

```js
test('normalizes build commands by environment', () => {
  // commands.production should resolve for --prod
})

test('allows remote config to be omitted for build-only', () => {
  // --build-only should not require host/user/baseDir
})

test('supports single build.command form for all environments', () => {
  // no build.commands => build.command reused
})

test('fails on unsupported startup/prisma combinations', () => {
  // pm2 requires serviceName + ecosystemConfig
  // direct requires entry
  // prisma generate/deploy require schema + config
})

test.each([
  'build.distDir',
  'build.versionFile',
  'runtime.appPackage',
  'runtime.rootPackage',
  'runtime.lockfile',
  'artifact.outputDir',
  'artifact.bundleName',
])('requires %s for all local build flows including build-only', fieldPath => {
  // removing any required field should throw a targeted validation error
})

test('fails when selected environment command is missing from build.commands', () => {
  // production env with only development command should throw
})

test('rejects local paths that escape projectRoot', () => {
  // runtime/build/artifact paths must remain inside cli.projectRoot
})

test('rejects remote.baseDir containing unsafe shell characters', () => {
  // remote baseDir must be absolute and shell-safe
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- backend-artifact-deploy-config.test.js`
Expected: FAIL because config normalization module does not exist yet.

- [ ] **Step 3: Implement the config resolver**

```js
export function resolveBackendDeployConfig({ cli, targetConfig, environment, flags }) {
  return {
    environment,
    build: { app, command, distDir, versionFile },
    runtime: { appPackage, rootPackage, lockfile, prismaSchemaDir, prismaConfig, ecosystemConfig },
    artifact: { outputDir, bundleName },
    remote: buildOnly ? null : { host, port, user, baseDir },
    startup: { mode, serviceName, entry },
    deploy: { keepReleases, installCommand, prismaGenerate, prismaMigrateDeploy, skipMigration },
  }
}
```

All project-local paths must be resolved relative to `cli.projectRoot` and rejected if they escape that base. `remote.baseDir` must be validated as an absolute, shell-safe POSIX path before any SSH/SCP command is assembled.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- backend-artifact-deploy-config.test.js`
Expected: PASS with deterministic normalization and validation errors.

- [ ] **Step 5: Commit**

```bash
git add lib/backend-artifact-deploy/config.js test/backend-artifact-deploy-config.test.js
git commit -m "feat: add backend deploy config normalization"
```

### Task 3: Add local artifact builder and runtime package generation

**Files:**
- Create: `lib/backend-artifact-deploy/runtime-package.js`
- Create: `lib/backend-artifact-deploy/artifact-builder.js`
- Create: `lib/backend-artifact-deploy/path-utils.js`
- Test: `test/backend-artifact-runtime-package.test.js`
- Test: `test/backend-artifact-builder.test.js`
- Reference: `lib/backend-package.js`

- [ ] **Step 1: Write the failing runtime package tests**

```js
test('generates runtime package.json with required fields only', () => {
  // expect name/version/dependencies/packageManager/engines.node
})

test('fails on workspace dependencies that cannot be installed remotely', () => {
  // dependency: "workspace:*" should throw
})

test('fails on other non-installable local dependency references', () => {
  // file:, link:, workspace:^ should throw
})

test('preserves prisma cli from devDependencies for remote deploy flows', () => {
  // prisma in devDependencies should still be present in generated runtime dependencies
})
```

- [ ] **Step 2: Write the failing artifact builder tests**

```js
test('builds inner archive, checksum, and outer bundle metadata', async () => {
  // mock build command + file staging + tar/sha steps
})

test('fails when staged payload contains env files', async () => {
  // .env.production should reject packaging
})

test('rejects nested .env files anywhere in the staged payload', async () => {
  // apps/backend/.env.production should also reject packaging
})

test('preserves paths relative to distDir and writes runtime files at release root', async () => {
  // dist/backend/apps/backend/src/main.js => <releaseRoot>/apps/backend/src/main.js
  // package.json and pnpm-lock.yaml => <releaseRoot>/
})

test('stages prisma and ecosystem files at configured relative paths', async () => {
  // schema/config copied under release root, ecosystem at release root
})

test('uses exact release naming and checksum contract', async () => {
  // backend-v1.2.3-20260312-010203.tgz
  // backend-bundle-v1.2.3-20260312-010203.tgz
  // matching .sha256
})

test('rejects local output paths that escape the configured artifact directory', async () => {
  // computed stage/archive/bundle paths outside outputDir should throw
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- backend-artifact-runtime-package.test.js backend-artifact-builder.test.js`
Expected: FAIL with missing builder/runtime package modules.

- [ ] **Step 4: Implement runtime package generation**

```js
export function createRuntimePackage({ appPackage, rootPackage }) {
  return {
    name: appPackage.name,
    version: appPackage.version,
    private: appPackage.private,
    type: appPackage.type,
    dependencies: mergeRuntimeDependencies(appPackage.dependencies, appPackage.devDependencies),
    packageManager: rootPackage.packageManager,
    engines: resolveEngines(rootPackage, appPackage),
  }
}
```

- [ ] **Step 5: Implement artifact staging and packaging**

```js
export async function buildBackendArtifact(config, deps) {
  await deps.runBuild(config.build)
  await deps.stageFiles(config)
  await deps.assertNoEnvFiles(stageDir)
  await deps.createInnerArchive()
  await deps.writeChecksum()
  await deps.createBundle()
  return { version, timeTag, versionName, bundlePath, innerArchivePath, checksumPath }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- backend-artifact-runtime-package.test.js backend-artifact-builder.test.js`
Expected: PASS with stable artifact metadata and explicit failure on unsupported dependency/file layouts.

- [ ] **Step 7: Commit**

```bash
git add lib/backend-artifact-deploy/runtime-package.js lib/backend-artifact-deploy/artifact-builder.js lib/backend-artifact-deploy/path-utils.js test/backend-artifact-runtime-package.test.js test/backend-artifact-builder.test.js
git commit -m "feat: build backend release artifacts locally"
```

### Task 4: Wire the local runner entrypoint

**Files:**
- Create: `lib/backend-artifact-deploy.js`
- Modify: `lib/cli/commands/deploy.js`
- Test: `test/backend-artifact-deploy-local-flow.test.js`

- [ ] **Step 1: Write the failing local flow tests**

```js
test('build-only runs config resolution and artifact build without remote calls', async () => {
  // runBackendArtifactDeploy({ flags: { buildOnly: true } })
})

test('full deploy invokes artifact build before remote transport', async () => {
  // verify order: resolve -> build -> remote
})

test('build failure stops before any remote seam is invoked', async () => {
  // build throws => remote transport mock not called
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- backend-artifact-deploy-local-flow.test.js`
Expected: FAIL because the runner entrypoint is missing.

- [ ] **Step 3: Implement the entrypoint orchestration**

Use dependency injection for the not-yet-built remote seam so Chunk 1 can finish independently:

```js
export async function runBackendArtifactDeploy({ cli, target, args, environment, deps = defaultDeps }) {
  const config = resolveBackendDeployConfig({ cli, targetConfig, environment, flags: cli.flags })
  const bundle = await buildBackendArtifact(config, deps)
  if (flags.buildOnly) return bundle
  return await deployBackendArtifactRemotely(config, bundle, deps)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- backend-artifact-deploy-local-flow.test.js`
Expected: PASS with correct orchestration order and build-only short-circuit.

- [ ] **Step 5: Commit**

```bash
git add lib/backend-artifact-deploy.js lib/cli/commands/deploy.js test/backend-artifact-deploy-local-flow.test.js
git commit -m "feat: add backend artifact deploy runner entrypoint"
```

## Chunk 2: Remote Transport, Remote Execution, and Documentation

### Task 5: Add remote command builder and result parser

**Files:**
- Create: `lib/backend-artifact-deploy/remote-phases.js`
- Create: `lib/backend-artifact-deploy/remote-script.js`
- Create: `lib/backend-artifact-deploy/remote-result.js`
- Test: `test/backend-artifact-remote-script.test.js`
- Test: `test/backend-artifact-remote-result.test.js`

- [ ] **Step 1: Write the failing remote protocol tests**

```js
test('builds a bash script that emits DX_REMOTE_RESULT JSON', () => {
  // script should include bash strict mode, lock handling, phase markers, exactly one final sentinel
})

test('prefers flock and falls back to lock directory when flock is unavailable', () => {
  // phase model / rendered script should contain both branches
})

test('rejects unsafe archive entries and escaped remote paths', () => {
  // abs path, .., suspicious symlink targets, baseDir escape
})

test('parses final DX_REMOTE_RESULT line from ssh output', () => {
  // stdout ending with DX_REMOTE_RESULT={"ok":false,"phase":"startup","message":"...","rollbackAttempted":true,"rollbackSucceeded":false}
})

test('falls back to unstructured remote failure when result line is missing', () => {
  // ssh non-zero without sentinel => fallback phase/message
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- backend-artifact-remote-script.test.js backend-artifact-remote-result.test.js`
Expected: FAIL with missing remote protocol modules.

- [ ] **Step 3: Implement remote script builder and result parsing**

```js
export function createRemotePhaseModel(payload) {
  return [
    { phase: 'lock', command: '...' },
    { phase: 'extract', command: '...' },
    { phase: 'install', command: '...' },
    { phase: 'startup', command: '...' },
  ]
}

export function buildRemoteDeployScript(phaseModel) {
  return `set -euo pipefail\n... \necho "DX_REMOTE_RESULT=${json}"\n`
}

export function parseRemoteResult({ stdout, stderr, exitCode }) {
  // parse final sentinel line or synthesize fallback failure
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- backend-artifact-remote-script.test.js backend-artifact-remote-result.test.js`
Expected: PASS with deterministic remote protocol behavior.

- [ ] **Step 5: Commit**

```bash
git add lib/backend-artifact-deploy/remote-phases.js lib/backend-artifact-deploy/remote-script.js lib/backend-artifact-deploy/remote-result.js test/backend-artifact-remote-script.test.js test/backend-artifact-remote-result.test.js
git commit -m "feat: add backend deploy remote execution protocol"
```

### Task 6: Add remote transport and full remote deploy orchestration

**Files:**
- Create: `lib/backend-artifact-deploy/remote-transport.js`
- Create: `lib/backend-artifact-deploy/rollback.js`
- Modify: `lib/backend-artifact-deploy.js`
- Test: `test/backend-artifact-remote-transport.test.js`
- Test: `test/backend-artifact-deploy-remote-flow.test.js`
- Test: `test/backend-artifact-rollback.test.js`

- [ ] **Step 1: Write the failing remote transport tests**

```js
test('creates remote directories, uploads bundle, and runs ssh script', async () => {
  // expect ssh mkdir, scp upload, ssh bash invocation
})

test('surfaces missing shared env file, lock contention, and checksum mismatch', async () => {
  // parse structured remote result into thrown/user-visible error
})

test('surfaces upload failure and missing remote tool failure', async () => {
  // scp failure, remote node/pnpm/pm2 missing
})

test('quotes remote mkdir directories to avoid shell metacharacter execution', () => {
  // remote mkdir command must quote each derived directory path
})

test('handles startup failure before migration and after migration differently', async () => {
  // before migration => rollback attempt allowed
  // after migration => no automatic rollback
})

test('direct mode stays attached and skips post-start pruning', async () => {
  // success path should not prune releases in direct mode
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- backend-artifact-remote-transport.test.js backend-artifact-deploy-remote-flow.test.js`
Expected: FAIL because remote transport/orchestration does not exist yet.

- [ ] **Step 3: Implement remote transport**

```js
export async function deployBackendArtifactRemotely(config, bundle, deps) {
  await deps.ensureRemoteBaseDirs(config.remote)
  await deps.uploadBundle(config.remote, bundle.bundlePath)
  const phaseModel = createRemotePhaseModel(createRemotePayload(config, bundle))
  const script = buildRemoteDeployScript(phaseModel)
  const result = await deps.runRemoteScript(config.remote, script)
  return parseRemoteResult(result)
}
```

- [ ] **Step 4: Implement rollback decision helpers**

```js
export function shouldAttemptRollback({ migrationExecuted, startupMode }) {
  if (migrationExecuted) return false
  if (startupMode === 'direct') return false
  return true
}
```

- [ ] **Step 5: Implement remote flow integration in the main runner**

```js
const remoteResult = await deployBackendArtifactRemotely(config, bundle, deps)
if (!remoteResult.ok) throw new Error(formatRemoteFailure(remoteResult))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- backend-artifact-remote-transport.test.js backend-artifact-deploy-remote-flow.test.js backend-artifact-rollback.test.js`
Expected: PASS with upload/ssh sequencing, rollback decision coverage, and structured remote failure handling.

- [ ] **Step 7: Commit**

```bash
git add lib/backend-artifact-deploy/remote-transport.js lib/backend-artifact-deploy/rollback.js lib/backend-artifact-deploy.js test/backend-artifact-remote-transport.test.js test/backend-artifact-deploy-remote-flow.test.js test/backend-artifact-rollback.test.js
git commit -m "feat: deploy backend artifacts to remote hosts"
```

### Task 7: Add config/examples/docs coverage

**Files:**
- Modify: `README.md`
- Modify: `example/dx/config/commands.json`
- Create: `test/backend-artifact-deploy-doc-config.test.js`

- [ ] **Step 1: Write the failing doc/config test**

```js
test('example commands config documents backend artifact deploy shape', () => {
  // expect internal backend-artifact-deploy with backendDeploy block
})

test('README documents backend artifact deploy command and fixed remote layout', () => {
  // expect dx deploy backend --prod, --build-only, --skip-migration, releases/current/shared layout
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- backend-artifact-deploy-doc-config.test.js`
Expected: FAIL because example config/docs do not mention the new runner.

- [ ] **Step 3: Update README and example config**

```json
{
  "deploy": {
    "backend": {
      "internal": "backend-artifact-deploy",
      "description": "Build, upload, and deploy backend artifact",
      "backendDeploy": {
        "build": {
          "app": "backend",
          "distDir": "dist/backend",
          "versionFile": "apps/backend/package.json",
          "commands": {
            "development": "npx nx build backend --configuration=development",
            "staging": "npx nx build backend --configuration=production",
            "production": "npx nx build backend --configuration=production"
          }
        },
        "runtime": {
          "appPackage": "apps/backend/package.json",
          "rootPackage": "package.json",
          "lockfile": "pnpm-lock.yaml",
          "prismaSchemaDir": "apps/backend/prisma/schema",
          "prismaConfig": "apps/backend/prisma.config.ts",
          "ecosystemConfig": "ecosystem.config.cjs"
        },
        "artifact": {
          "outputDir": "release/backend",
          "bundleName": "backend-bundle"
        },
        "remote": {
          "host": "deploy.example.com",
          "port": 22,
          "user": "deploy",
          "baseDir": "/srv/example-app"
        },
        "startup": {
          "mode": "pm2",
          "serviceName": "backend"
        },
        "deploy": {
          "keepReleases": 5,
          "installCommand": "pnpm install --prod --no-frozen-lockfile --ignore-workspace",
          "prismaGenerate": true,
          "prismaMigrateDeploy": true
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- backend-artifact-deploy-doc-config.test.js`
Expected: PASS with docs/examples aligned to implementation shape.

- [ ] **Step 5: Commit**

```bash
git add README.md example/dx/config/commands.json test/backend-artifact-deploy-doc-config.test.js
git commit -m "docs: document backend artifact deploy runner"
```

### Task 8: Run focused verification and final regression sweep

**Files:**
- Test: `test/backend-artifact-*.test.js`
- Test: `test/deploy-env-merge.test.js`
- Test: `test/deploy-telegram-webhook-flags.test.js`
- Test: `test/vercel-deploy.test.js`

- [ ] **Step 1: Run focused backend artifact deploy test suite**

Run: `pnpm test -- backend-artifact`
Expected: PASS for all new backend artifact deploy tests.

- [ ] **Step 2: Run deploy regression coverage**

Run: `pnpm test -- deploy-env-merge.test.js deploy-telegram-webhook-flags.test.js vercel-deploy.test.js`
Expected: PASS, proving Vercel deploy behavior still works.

- [ ] **Step 3: Run full repository test suite**

Run: `pnpm test`
Expected: PASS for the full Jest suite.

- [ ] **Step 4: Commit final verification if code changed during fixup**

```bash
git add -A
git commit -m "test: verify backend artifact deploy integration"
```
