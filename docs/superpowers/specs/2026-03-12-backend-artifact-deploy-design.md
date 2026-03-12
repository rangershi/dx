# Backend Artifact Deploy Design

## Background

Current backend release flow in some managed projects is implemented as repository-local shell scripts. The representative example is `/Users/a1/work/ai-monorepo/scripts/release/backend-build-release.sh` plus `/Users/a1/work/ai-monorepo/scripts/release/backend-deploy-release.sh`.

That flow already embodies a stable deployment protocol:

- build backend locally
- collect runtime files into a minimal release payload
- package a release archive and a delivery bundle
- upload the bundle to a remote host
- verify, extract, install runtime dependencies, run Prisma tasks, switch `current`, and start the service remotely

The problem is not lack of functionality. The problem is that the functionality is duplicated in project scripts, so fixes and improvements do not accumulate in `dx`.

This design moves that backend artifact deployment capability into `dx` itself, with project-specific differences expressed through configuration instead of per-project shell scripts.

## Goal

Provide a first-class `dx` backend deployment capability for this use case:

- backend service only
- local artifact build
- upload via `scp`
- remote deploy via `ssh`
- remote host already has `node`, `pnpm`, and optionally `pm2`
- environment files are managed on the remote host, not packed into the artifact
- Prisma `generate` and `migrate deploy` are supported

## Non-Goals

- frontend, SDK, or static site deployment
- multi-host or rolling deployment
- `rsync` transport
- automatic installation of `node`, `pnpm`, or `pm2`
- Windows deployment targets
- arbitrary remote directory layouts
- a generic deployment framework for unrelated service types

## User Outcome

After this feature lands, a managed project should be able to replace custom backend release scripts with a `dx` command such as:

```bash
dx deploy backend --prod
```

The project still controls its own build command, file paths, and remote target details, but `dx` owns the release protocol and execution flow.

## Recommended Approach

Implement a new built-in deploy runner in `dx`:

- `internal: "backend-artifact-deploy"`

This follows the same pattern already used by `start.stack`:

- core behavior lives in `dx`
- project-side differences are supplied as structured configuration
- the protocol stays stable across repositories

This is preferred over keeping shell scripts or embedding long shell strings in `commands.json`, because those approaches preserve duplication and make behavior harder to test.

## Alternatives Considered

### 1. Keep project-local shell scripts and call them from `dx`

Rejected because the core problem remains: behavior still lives outside `dx`, so repositories continue to drift.

### 2. Add reusable primitives but keep per-project release scripts

Rejected for the first version because it reduces some duplication but still leaves each repository owning orchestration logic.

### 3. Encode the full flow as raw shell commands in `commands.json`

Rejected because long shell strings are hard to validate, test, evolve, and document. This would move script complexity into JSON rather than actually abstracting it.

## Command Model

The feature lives under the existing `deploy` command family.

Primary command:

```bash
dx deploy backend --dev|--staging|--prod
```

If no environment flag is passed, this backend deploy runner defaults to `--dev`, matching the repository-wide `dx` convention. This is intentionally different from the current Vercel-oriented deploy implementation and will require explicit handling in implementation so existing non-backend deploy targets are not regressed.

Initial optional flags:

- `--build-only`: build and package locally, do not upload or deploy remotely
- `--skip-migration`: remote deploy skips `prisma migrate deploy`

The default path is full end-to-end execution:

- build locally
- upload bundle
- deploy remotely

Environment flag mapping is explicit:

- `--dev` -> `development`
- `--staging` -> `staging`
- `--prod` -> `production`

`--build-only` is mutually exclusive with remote deploy behavior. The first version does not include `--upload-only`; upload-without-build can be added later only after a clear bundle input contract is designed.

The first version also does not include `--skip-install`. Remote deploy always installs production dependencies. This keeps Prisma and startup behavior coherent and avoids introducing a second artifact mode with prebundled `node_modules`.

## Configuration Model

Project-specific differences are declared in `dx/config/commands.json` under `deploy.backend`.

Example shape:

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
          "host": "example.com",
          "port": 22,
          "user": "deploy",
          "baseDir": "/srv/example-app"
        },
        "startup": {
          "mode": "pm2",
          "serviceName": "backend",
          "entry": "apps/backend/src/main.js"
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

### Configuration Boundaries

Projects may configure:

- local build command, either as one shared command or per-environment commands
- release input paths
- artifact output directory
- remote host identity and base directory
- startup mode and service identity
- retention count
- whether Prisma generate and Prisma migrate deploy are part of deploy

Projects may not configure:

- arbitrary remote directory protocol
- custom rollback semantics
- bundle checksum behavior
- unsafe tar extraction behavior
- custom ad hoc deploy phases

That boundary is intentional. The feature must stay opinionated enough that behavior is predictable across repositories.

### Build Configuration Contract

`build` supports two forms:

- `command`: one command reused for all environments
- `commands`: explicit per-environment commands keyed by `development`, `staging`, and `production`

Resolution rules:

- if `commands` is present, the selected environment key must exist and is used
- if `commands` is absent, `command` is required and is used for all environments
- the build command is executed through the normal `dx` command execution path so environment loading for the configured `build.app` can still apply

This keeps the runner environment-aware without forcing every project to duplicate commands when `staging` and `production` share the same build.

### CLI Routing Contract

The existing `deploy` command family remains the public entry point.

Dispatch rules for implementation:

- `handleDeploy` first resolves `deploy.<target>` from `commands.json`
- if the target config contains `internal: "backend-artifact-deploy"`, dispatch to the new backend deploy runner
- otherwise keep the existing Vercel-oriented deploy path unchanged

Environment defaulting rules:

- backend artifact deploy targets default to `development` when no env flag is passed
- existing non-backend deploy targets keep their current behavior unless separately migrated

This avoids breaking Vercel deploy targets while still allowing backend deploy to follow the repository-wide default-env convention.

## Standard Remote Layout

The remote filesystem layout is fixed by `dx`:

- `<baseDir>/releases/<version-name>`
- `<baseDir>/current` as a symlink to the active release
- `<baseDir>/shared/.env.<environment>`
- `<baseDir>/shared/.env.<environment>.local`
- `<baseDir>/uploads/<bundle-file>`

This layout matches the deployment model already used by existing project scripts and keeps releases inspectable and rollback-aware.

## Versioning and Artifact Naming

Each deployable version uses:

- application version from the configured `versionFile`
- a time tag in `YYYYMMDD-HHMMSS`

Standard names:

- release directory name: `backend-v<version>-<time>`
- inner release archive: `backend-v<version>-<time>.tgz`
- delivery bundle name: `backend-bundle-v<version>-<time>.tgz`

The outer bundle contains:

- the inner release archive
- a `sha256` checksum file for the inner archive

The bundle exists to keep transport simple while still validating the actual release payload before extraction.

## End-to-End Flow

### Local build and package phase

1. Determine environment from `--dev`, `--staging`, or `--prod`.
2. Resolve configuration and validate required fields.
3. Resolve version from `versionFile` unless explicitly overridden in the future.
4. Run the configured local build command.
5. Collect runtime files into a staging directory:
   - copy the contents of `distDir` into the release root without flattening nested paths inside that directory
   - Prisma schema directory if configured
   - Prisma config file if configured
   - runtime `package.json` generated from app and root package data
   - lockfile
   - ecosystem config for `pm2` mode if configured
6. Assert the staged payload does not include `.env*` files.
7. Create the inner release archive.
8. Write a `sha256` checksum for the inner archive.
9. Wrap the archive plus checksum into the delivery bundle.

### Upload phase

`--build-only` stops before this phase.

1. Ensure the local bundle file exists.
2. Ensure the remote base directories exist using `ssh`.
3. Upload the bundle into `<baseDir>/uploads/` using `scp`.

### Remote deploy phase

1. Acquire a deployment lock on the remote host.
2. Validate the uploaded bundle path and archive entries.
3. Extract the outer bundle to a temporary directory.
4. Verify the inner release archive checksum.
5. Extract the inner release archive into `<baseDir>/releases/<version-name>`.
6. Link remote shared environment files into the release directory:
   - `shared/.env.<environment>` -> `<releaseDir>/.env.<environment>`
   - `shared/.env.<environment>.local` -> `<releaseDir>/.env.<environment>.local`
7. Check required runtime tools:
   - `node`
   - `pnpm`
   - `pm2` only when `startup.mode=pm2`
8. Always run the configured install command inside the release directory.
9. Run Prisma generate when enabled.
10. If migration is enabled:
   - run `prisma migrate deploy`
11. Switch `current` to the new release.
12. Start the service using the configured startup mode.
13. For `pm2` mode, on success, prune old releases beyond `keepReleases`.
14. For `direct` mode, remain attached to the remote process; automatic release pruning does not run in that attached session.

## Runtime Package Behavior

The current `ai-monorepo` scripts generate a runtime-oriented `package.json` rather than copying the full workspace manifest. The `dx` implementation should preserve that idea.

The local packaging phase should reuse a built-in runtime package generator, not rely on project-local scripts. It should produce a release `package.json` containing only the runtime dependencies and scripts needed on the server.

Authoritative inputs:

- the configured backend app package file
- the configured workspace root package file

Required output behavior for V1:

- output `package.json` must include:
  - `name`
  - `version`
  - `private` when present in the app package
  - `type` when present in the app package
  - `dependencies`
  - `packageManager` copied from the workspace root package when present
  - `engines.node` copied from the workspace root or app package when present
- include backend runtime `dependencies`
- exclude `devDependencies`
- include only the minimal scripts required for remote install and startup, if any are needed by the generated package contract
- do not include workspace-only fields that imply a full monorepo install on the remote host
- if backend package dependencies contain `workspace:` or other monorepo-local package references that cannot be installed on the remote host from the generated release package alone, packaging fails explicitly
- V1 does not rewrite or publish workspace-local dependencies automatically
- V1 assumes deployable backend runtime dependencies are either normal registry-resolvable packages or already compiled into the built output copied from `distDir`

The output contract for V1 is backend-focused and opinionated rather than fully generic. It is acceptable for the generator to support only the dependency and metadata shapes needed by the existing backend deployment model.

## Release Layout Contract

The extracted release root is the working directory for remote install, Prisma, and startup.

Layout rules:

- files copied from `distDir` keep their paths relative to `distDir`
- Prisma files are added under the configured paths relative to the release root
- generated `package.json` and copied lockfile are written at the release root
- ecosystem config is written at the release root unless an absolute remote path is intentionally supported later

Implication:

- if `distDir` contains `apps/backend/src/main.js`, then `startup.entry` should be `apps/backend/src/main.js`
- both `startup.entry` and Prisma paths are always resolved relative to the extracted release root

Runtime command rule:

- install and Prisma commands run from `<baseDir>/releases/<version-name>`
- startup commands run from `<baseDir>/current` after the symlink switch

This keeps install and migration pinned to the new release while making runtime process control align with the `current` symlink used for rollback and operator inspection.

## Prisma Execution Contract

Prisma paths are resolved relative to the extracted release root on the remote host.

If Prisma support is enabled:

- `runtime.prismaSchemaDir` is required
- `runtime.prismaConfig` is required

Remote commands are:

- generate: `./node_modules/.bin/prisma generate --schema=./<prismaSchemaDir> --config=./<prismaConfig>`
- migrate: `./node_modules/.bin/prisma migrate deploy --schema=./<prismaSchemaDir> --config=./<prismaConfig>`

These commands run inside the release root and are wrapped with the selected environment files already linked into that release.

If Prisma support is disabled in deploy config, both commands are omitted.

## Startup Modes

Two startup modes are supported.

### `pm2`

Requirements:

- remote host has `pm2`
- artifact includes the configured ecosystem config file

Behavior:

- deploy runner performs `pm2 delete <serviceName>` if needed
- starts the configured ecosystem file with `--only <serviceName>`
- persists process state with `pm2 save`

### `direct`

Requirements:

- startup `entry` path is configured

Behavior:

- `startup.entry` is resolved relative to the extracted release root
- deploy runner starts the service directly with `node <entry>` as a foreground remote process
- the `ssh` session remains attached for the lifetime of the process
- the command is considered successful only after the remote process exits cleanly
- while the process is attached, the CLI does not return and post-start cleanup such as release pruning does not run
- this mode is therefore operationally a manual validation or emergency mode, not a normal unattended deploy mode

This mode is useful for one-off validation or environments not managed by `pm2`, but it remains a foreground process model. It is not intended as a production process manager replacement.

## Environment File Model

Environment files are never packaged into the artifact.

The deploy protocol expects remote shared files:

- `shared/.env.development`
- `shared/.env.development.local`
- `shared/.env.staging`
- `shared/.env.staging.local`
- `shared/.env.production`
- `shared/.env.production.local`

During deploy, the runner symlinks the environment pair for the selected environment into the release directory.

If either required environment file is missing, deploy fails before install, migration, `current` switch, or startup.

This keeps secrets outside the artifact and preserves the existing `dx` direction around committed vs local environment responsibility.

## Error Handling

### Local failures

- If local build fails, stop immediately.
- If staging or packaging fails, stop immediately.
- If the staged payload contains `.env*`, fail before archiving.

### Upload failures

- If bundle upload fails, stop immediately.
- Do not attempt remote deploy when upload did not succeed.

### Remote failures before `current` switch

- Leave the previous `current` symlink unchanged.
- Remove incomplete temporary extraction state.
- Always release the remote deploy lock before exit.
- If lock acquisition fails, deploy exits without modifying the target host.
- If checksum verification fails, deploy exits before release extraction.
- If the computed release directory already exists and is the current target, deploy fails rather than overwriting it.

### Remote failures after `current` switch

- If migration was not executed in this deploy, roll back `current` to the previous target and attempt to restore service availability:
  - for `pm2`, restart the previous release using the same startup protocol against the previous target
  - for `direct`, no automatic restore is attempted because the mode is attached and manual by design
- If migration was executed, do not automatically roll back `current`.
- Always release the remote deploy lock before exit.

The no-automatic-rollback-after-migration rule is critical. Old code may no longer be compatible with the migrated schema.

### Remote tool failures

- Missing `node`, `pnpm`, or required `pm2` fail the deploy with an explicit message.
- The first version does not attempt installation or repair.

## Remote Lock Contract

V1 remote deploy must use an atomic lock under `<baseDir>/.deploy.lock`.

Behavior:

- prefer `flock` when available on the remote host
- fall back to an atomic lock directory such as `<baseDir>/.deploy.lock.d` when `flock` is unavailable
- if lock acquisition fails, exit without modifying release state
- lock cleanup is best-effort on normal exit and failure paths
- stale lock recovery is out of scope for V1; operators must resolve it manually

## Remote Command Execution Contract

Remote deploy commands run through `ssh` using a POSIX shell in strict mode equivalent to `set -euo pipefail`.

Execution expectations:

- stdout and stderr are streamed back to the local CLI
- non-zero remote exit status is treated as deploy failure
- the remote executor maps the failing phase into the structured failure model returned to the CLI layer
- release extraction, install, migration, and startup all run from the extracted release root unless a step explicitly targets another fixed path

## Validation Matrix

Config resolver rules for V1:

- `startup.mode=pm2`
  - requires `startup.serviceName`
  - requires `runtime.ecosystemConfig`
  - ignores `startup.entry`
- `startup.mode=direct`
  - requires `startup.entry`
  - ignores `startup.serviceName`
- `deploy.prismaGenerate=true` or `deploy.prismaMigrateDeploy=true`
  - requires `runtime.prismaSchemaDir`
  - requires `runtime.prismaConfig`
- `deploy.prismaGenerate=false` and `deploy.prismaMigrateDeploy=false`
  - Prisma paths may be omitted
- `--build-only`
  - forbids remote execution phases
  - `--skip-migration` is accepted but has no effect because remote execution does not run

## Security and Safety Requirements

The deploy feature must keep the existing scripts' defensive posture.

Required checks:

- reject absolute or path-traversing bundle input paths
- reject tar entries with absolute paths
- reject tar entries containing `..`
- reject suspicious symlink targets inside archives
- validate computed release paths remain under the configured output or remote base directory
- require remote deployment lock to prevent concurrent deploys
- never copy `.env*` files into the artifact

## Architecture Units

The implementation should be separated into clear units.

### 1. Deploy config resolver

Responsibilities:

- read and validate `backendDeploy` configuration
- normalize paths relative to project root
- derive environment-specific names and flags

Interface:

- input: CLI flags plus raw config node
- output: normalized backend deploy config

### 2. Local artifact builder

Responsibilities:

- run local build
- stage release contents
- generate runtime package
- create archives and checksum

Interface:

- input: normalized deploy config plus target environment
- output: bundle metadata including absolute local bundle path and version name

### 3. Remote transport

Responsibilities:

- create remote directories
- upload bundle using `scp`
- invoke remote deploy execution over `ssh`

Interface:

- input: bundle metadata plus remote config
- output: remote execution result

### 4. Remote deploy executor

Responsibilities:

- perform locked extraction and validation on the server
- link environment files
- check remote tools
- install dependencies
- run Prisma tasks
- switch `current`
- start service
- prune old releases

Interface:

- input: normalized remote deploy payload
- output: success or structured failure

### 5. Remote command builder

Responsibilities:

- construct the remote shell payload deterministically
- ensure dynamic values are shell-escaped safely

Interface:

- input: normalized remote deploy payload
- output: shell command string passed to `ssh`

These units are intentionally narrower than "one big deploy runner" so they can be tested independently.

### Remote result protocol

The remote command builder must emit a shell program that prints exactly one final machine-readable result line on completion or handled failure:

```text
DX_REMOTE_RESULT=<json>
```

Minimum JSON shape:

```js
{
  ok: boolean,
  phase: string,
  message: string,
  rollbackAttempted: boolean,
  rollbackSucceeded: boolean | null
}
```

Protocol rules:

- the local remote executor captures stdout and stderr from `ssh`
- it parses the final `DX_REMOTE_RESULT=` line when present
- parsed JSON becomes the structured success or failure result returned to the CLI layer
- if `ssh` exits non-zero without a parseable result line, the executor returns an unstructured remote failure using the failure model with the best-known phase

## Interface Contracts

### Normalized backend deploy config

The deploy config resolver returns a shape equivalent to:

```js
{
  environment: 'development' | 'staging' | 'production',
  build: {
    app: string | null,
    command: string,
    distDir: string,
    versionFile: string
  },
  runtime: {
    appPackage: string,
    rootPackage: string,
    lockfile: string,
    prismaSchemaDir: string | null,
    prismaConfig: string | null,
    ecosystemConfig: string | null
  },
  artifact: {
    outputDir: string,
    bundleName: string
  },
  remote: {
    host: string,
    port: number,
    user: string,
    baseDir: string
  },
  startup: {
    mode: 'pm2' | 'direct',
    serviceName: string | null,
    entry: string | null
  },
  deploy: {
    keepReleases: number,
    installCommand: string,
    prismaGenerate: boolean,
    prismaMigrateDeploy: boolean,
    skipMigration: boolean
  }
}
```

### Bundle metadata

The local artifact builder returns a shape equivalent to:

```js
{
  version: string,
  timeTag: string,
  versionName: string,
  bundlePath: string,
  innerArchivePath: string,
  checksumPath: string
}
```

### Normalized remote deploy payload

The remote transport and command builder use a shape equivalent to:

```js
{
  environment: 'development' | 'staging' | 'production',
  versionName: string,
  uploadedBundlePath: string,
  remote: {
    host: string,
    port: number,
    user: string,
    baseDir: string
  },
  runtime: {
    prismaSchemaDir: string | null,
    prismaConfig: string | null,
    ecosystemConfig: string | null
  },
  startup: {
    mode: 'pm2' | 'direct',
    serviceName: string | null,
    entry: string | null
  },
  deploy: {
    keepReleases: number,
    installCommand: string,
    prismaGenerate: boolean,
    prismaMigrateDeploy: boolean,
    skipMigration: boolean
  }
}
```

### Failure model

The remote deploy executor should surface structured failure information to the CLI layer, with at least:

```js
{
  phase: 'build' | 'package' | 'upload' | 'lock' | 'extract' | 'env' | 'install' | 'prisma-generate' | 'prisma-migrate' | 'switch-current' | 'startup' | 'cleanup',
  message: string,
  rollbackAttempted: boolean,
  rollbackSucceeded: boolean | null
}
```

This contract is for implementation planning and testability. The CLI may still render the result as user-facing logs.

## Compatibility

This feature is additive.

- existing `deploy` targets for Vercel continue to work
- existing command-based project configurations continue to work
- only projects that opt into `internal: "backend-artifact-deploy"` use this new flow

No existing project should be forced to migrate immediately.

## Testing Strategy

### Unit tests

- config normalization and validation
- environment-to-runtime mapping
- artifact naming
- output path boundary checks
- archive path validation
- remote command construction
- rollback decision logic

### Integration tests with mocked process execution

- successful end-to-end call sequence
- local build failure
- upload failure
- missing remote tool failure
- missing shared env file failure
- deploy lock contention
- checksum mismatch
- startup failure before migration
- startup failure after migration

### Documentation coverage

- add README documentation for the new internal runner
- add example configuration showing the smallest supported backend deploy setup

## Migration Path

For a project currently using repository-local backend release scripts:

1. move project-specific paths and host details into `dx/config/commands.json`
2. point deployment to `internal: "backend-artifact-deploy"`
3. remove or retire the old release scripts after verification

The migration target is a project with no custom backend build/deploy shell scripts for the standard case.

## Open Questions Intentionally Deferred

The following are postponed, not blocked:

- multiple remote hosts
- artifact reuse across multiple deploys
- remote bundle cleanup policy beyond normal release retention
- explicit `--version` override support
- resumable uploads

They are intentionally out of scope for the first implementation so the feature remains focused on the backend single-host path already proven by current project scripts.

## Acceptance Criteria

The design is successful when all of the following are true:

- a managed project can replace custom backend build/deploy shell scripts with `dx` configuration plus `dx deploy backend --prod`
- the remote deployment protocol matches the existing proven pattern: bundle, verify, extract, install, migrate, switch, start, retain
- secrets remain outside artifacts
- remote runtime dependency presence is checked and reported, not auto-installed
- configuration is flexible for path and command differences but not so open-ended that each project recreates the protocol
