# Configurable Backend E2E Targets Design

## 1. Background

The `stats` monorepo now contains more than one backend-style application that owns E2E tests, including `apps/backend` and `apps/quantify`.

Project configuration already declares separate `dx` test targets for both applications in `dx/config/commands.json`, but the `dx` CLI still hardcodes special E2E behavior around `backend`:

- missing-path validation only blocks `dx test e2e backend`
- file/directory execution is only assembled for `backend`
- help text and examples assume `backend` is the only E2E backend target

This makes `quantify` partially configurable in project config but not fully supported by the CLI runtime.

## 2. Goals

- Support `dx test e2e <target> <path>` for multiple backend E2E targets such as `backend` and `quantify`
- Let future backend-style apps opt in through configuration instead of CLI source edits
- Keep the current safety rule that E2E execution must be incremental only
- Reject all whole-project or aggregate E2E invocations that would trigger large full runs

## 3. Non-Goals

- Do not add a new aggregated `dx test e2e all` mode
- Do not allow whole-target E2E runs such as `dx test e2e backend` or `dx test e2e quantify`
- Do not redesign unrelated `dx test unit` behavior
- Do not change project-specific test commands beyond the configuration contract needed by CLI

## 4. User-Facing Command Rules

Allowed:

- `dx test e2e backend apps/backend/e2e/auth`
- `dx test e2e backend apps/backend/e2e/auth/auth.login.e2e-spec.ts`
- `dx test e2e quantify apps/quantify/e2e/health/health.e2e-spec.ts`

Rejected:

- `dx test e2e backend`
- `dx test e2e backend all`
- `dx test e2e quantify`
- `dx test e2e quantify all`
- `dx test e2e all`

Rule summary:

- Every backend E2E target that opts into guarded mode must receive a file or directory path
- The literal positional value `all` is never accepted as the path for guarded E2E targets
- `dx test e2e all` is not supported, even if project config contains an `all` entry

## 5. Configuration Contract

Project configuration remains the source of truth for supported backend E2E targets.

Each guarded E2E target under `test.e2e.<target>` in `dx/config/commands.json` must provide:

- `command`: base command definition
- `app`: existing app-to-env-policy binding
- `requiresPath: true`: marks this target as incremental-only
- `fileCommand`: command template used when a file or directory path is provided

`fileCommand` must contain the `{TEST_PATH}` placeholder.

Example shape:

```json
{
  "test": {
    "e2e": {
      "backend": {
        "command": "...",
        "app": "backend",
        "requiresPath": true,
        "fileCommand": "... {TEST_PATH}"
      },
      "quantify": {
        "command": "...",
        "app": "quantify",
        "requiresPath": true,
        "fileCommand": "... {TEST_PATH}"
      }
    }
  }
}
```

This keeps future onboarding simple: adding another backend E2E target becomes a project config change instead of a CLI whitelist change.

## 6. CLI Design

### 6.1 Validation

`validateTestPositionals` should stop hardcoding `backend`.

Instead it should:

1. resolve `type`, `target`, and optional `testPath` from positionals
2. look up `commands.test[type][target]`
3. if `type !== 'e2e'`, preserve existing behavior
4. if `target === 'all'` and `type === 'e2e'`, reject immediately with a dedicated message
5. if the resolved target config has `requiresPath: true`:
   - reject when `testPath` is missing
   - reject when `testPath === 'all'`

This turns the guard into a capability-driven rule instead of a `backend` special case.

### 6.2 Execution

`handleTest` should stop generating a one-off backend command.

Instead, for `type === 'e2e'`:

- when a guarded target receives a path, resolve its `fileCommand`
- replace `{TEST_PATH}` with the provided path
- append `-t "<pattern>"` when the user passed `-t`
- execute the resulting target-specific command

If a target sets `requiresPath: true` but omits `fileCommand`, CLI should fail with a configuration error instead of silently falling back. That keeps project misconfiguration obvious and avoids accidentally running the wrong command shape.

### 6.3 Help Text

CLI help should show multiple supported examples and make the restriction explicit:

- one `backend` example
- one `quantify` example
- statement that guarded E2E targets require a file or directory path
- statement that `all` is not supported for E2E

## 7. Error Handling

Error messages should be explicit and consistent:

- missing path: `dx test e2e <target> 必须提供测试文件或目录路径`
- forbidden aggregate path: `dx test e2e <target> 不支持 all，必须提供测试文件或目录路径`
- forbidden global aggregate: `dx test e2e all 不受支持，请指定 target 和测试文件或目录路径`
- missing `fileCommand` for guarded target: explain that `requiresPath: true` targets must define `fileCommand`

The goal is to make the safe path obvious and prevent accidental long-running full E2E runs.

## 8. Testing Strategy

Add or update CLI tests for:

- guarded target without path is rejected for `backend`
- guarded target without path is rejected for `quantify`
- guarded target with `all` as path is rejected for `backend`
- guarded target with `all` as path is rejected for `quantify`
- `dx test e2e all` is rejected
- guarded target with a path uses its own `fileCommand`
- `-t` continues to append to the resolved guarded command correctly
- help output includes the new multi-target examples and restrictions

Use fixture config that declares at least two guarded E2E targets so the tests verify configurability rather than a renamed backend-only flow.

## 9. Trade-Offs Considered

### Option A: Config-driven guarded targets

Chosen.

Pros:

- scalable for future backend apps
- keeps project-specific execution logic in project config
- removes CLI hardcoded target knowledge

Cons:

- requires a small contract between config and runtime

### Option B: Hardcode `backend` and `quantify`

Rejected.

Pros:

- lower immediate implementation effort

Cons:

- every new backend app requires another CLI code change
- keeps the wrong abstraction boundary

### Option C: Add a second config list for guarded E2E targets

Rejected.

Pros:

- somewhat configurable

Cons:

- duplicates meaning already represented by `requiresPath`
- higher drift risk between config fields

## 10. Rollout Notes

Implementation should update:

- CLI validation logic
- test command assembly logic
- help text
- example docs if they reference backend-only E2E behavior

Project config in `stats` should ensure both `backend` and `quantify` use the guarded contract.

## 11. Success Criteria

- `dx` supports incremental E2E execution for multiple backend targets through config
- whole-target and aggregate E2E invocations are consistently blocked
- adding a new guarded backend E2E target requires config only, not CLI target-specific branching
