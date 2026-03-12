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

Initial optional flags:

- `--build-only`: build and package locally, do not upload or deploy remotely
- `--skip-install`: remote deploy skips `pnpm install` and Prisma generate
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
          "command": "npx nx build backend --configuration=production",
          "app": "backend",
          "distDir": "dist/backend",
          "versionFile": "apps/backend/package.json"
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

- local build command
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
   - built backend output from `distDir`
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
   - `.env.<environment>`
   - `.env.<environment>.local`
7. Check required runtime tools:
   - `node`
   - `pnpm`
   - `pm2` only when `startup.mode=pm2`
8. If install is enabled:
   - run the configured install command inside the release directory
   - run Prisma generate when enabled
9. If migration is enabled:
   - run `prisma migrate deploy`
10. Switch `current` to the new release.
11. Start the service using the configured startup mode.
12. On success, prune old releases beyond `keepReleases`.

## Runtime Package Behavior

The current `ai-monorepo` scripts generate a runtime-oriented `package.json` rather than copying the full workspace manifest. The `dx` implementation should preserve that idea.

The local packaging phase should reuse a built-in runtime package generator, not rely on project-local scripts. It should produce a release `package.json` containing only the runtime dependencies and scripts needed on the server.

Authoritative inputs:

- the configured backend app package file
- the configured workspace root package file

Required output behavior for V1:

- include backend runtime `dependencies`
- exclude `devDependencies`
- include only the minimal scripts required for remote install and startup, if any are needed by the generated package contract
- preserve package manager metadata needed for `pnpm` install on the remote host

The output contract for V1 is backend-focused and opinionated rather than fully generic. It is acceptable for the generator to support only the dependency and metadata shapes needed by the existing backend deployment model.

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

- deploy runner starts the service directly with `node <entry>` as a foreground remote process
- the `ssh` session remains attached for the lifetime of the process
- deploy success means the process started successfully and remains alive until the operator ends the session or the process exits
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
