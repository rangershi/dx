# Upgrade Guide: Migrate Env Validation to env-policy.jsonc

This document explains how to migrate from the legacy env validation config files:

- `dx/config/local-env-allowlist.jsonc`
- `dx/config/exempted-keys.jsonc`
- `dx/config/required-env.jsonc`

to the new unified config:

- `dx/config/env-policy.jsonc`

It also describes how the new rules differ, what will break during migration, and how to fix it.

## What Changes

### Legacy behavior (3 files)

- `local-env-allowlist.jsonc`: defines "secret keys" allowed to appear in `.env.*.local`.
- `exempted-keys.jsonc`: optional exemptions for allowlisted keys (allowed real values in non-local files).
- `required-env.jsonc`: defines required env vars (by `_common` + app group + environment group).

### New behavior (1 file)

`dx/config/env-policy.jsonc` unifies:

1) Layout constraints
- Forbid root `.env`
- Forbid root `.env.local`
- Forbid `.env*` in subdirectories (docker exceptions are allowed)

2) Secret policy (no exemptions)
- Every key in `keys.secret` must:
  - exist in the committed file (e.g. `.env.production`) AND equal the placeholder
  - only hold a real value in the matching local file (e.g. `.env.production.local`)

3) Required checks by "target" (your ends/ports) + environment
- A command with `app` triggers required validation.
- `app` is mapped to a target via `appToTarget`.
- Required vars come from `targets[target].required._common` plus `targets[target].required[environment]`.
- If a command has no `app`, dx does NOT run required checks (but still enforces layout + secret policy).

## Migration Plan (Recommended)

Do this in one PR to avoid a half-migrated state.

1) Create `dx/config/env-policy.jsonc`
2) Update your `.env.<env>` files to include secret placeholders
3) Update your `.env.<env>.local` files to contain real secret values
4) Remove/stop maintaining the legacy config files (optional; dx is backward compatible if policy is missing)

## Step-by-step

### Step 0: Inventory what you have today

Collect:

- All `app` values used in `dx/config/commands.json`
- Existing secret allowlist keys
- Existing exempted keys (if any)
- Existing required keys (by env and by group)

You will map these into `env-policy.jsonc`.

### Step 1: Create `dx/config/env-policy.jsonc`

Start from this minimal skeleton:

```jsonc
{
  "version": 1,
  "environments": ["development", "staging", "production", "test", "e2e"],

  "layout": {
    "forbidExact": [".env", ".env.local"],
    "allowRoot": [".env.{env}", ".env.{env}.local"],
    "allowSubdirGlobs": ["docker/.env*"]
  },

  "secretPlaceholder": "__SET_IN_env.local__",

  "keys": {
    "secret": [],
    "localOnly": [],
    "localOverride": []
  },

  "appToTarget": {},
  "targets": {}
}
```

### Step 2: Map `local-env-allowlist.jsonc` -> `keys.secret`

Legacy expected shape:

```jsonc
{ "allowed": ["DATABASE_URL", "APP_SECRET"] }
```

Migration:

- Copy `allowed` into `env-policy.jsonc.keys.secret`.

Important: Under the new rules, every `keys.secret` key must be present (as placeholder) in every committed env file used by any configured target.

### Step 3: Remove `exempted-keys.jsonc` by re-classifying those keys

Legacy behavior allowed some allowlisted keys to have real values in non-local files.

New design removes exemptions; you must decide what those keys really are:

- If the key is NOT a secret, remove it from `keys.secret`.
- If you still want local-only values (machine-specific), add it to `keys.localOnly`.
- If you want local overrides for a non-secret (rare), add it to `keys.localOverride`.

Mapping table:

- `exempted key` + should be committed -> normal key (not in any `keys.*` list)
- `exempted key` + should never be committed -> `keys.localOnly`
- `exempted key` + committed default but allow local override -> `keys.localOverride`

### Step 4: Define targets (your ends) and map `app` -> target

Targets are fully configurable. Add one target per "end" that has different required keys.

Example:

```jsonc
{
  "appToTarget": {
    "backend": "backend",
    "front": "frontend",
    "admin-front": "frontend",
    "sdk": "sdk"
  },
  "targets": {
    "backend": {
      "files": { "committed": ".env.{env}", "local": ".env.{env}.local" },
      "required": { "_common": ["APP_ENV"], "production": [] }
    },
    "frontend": {
      "files": { "committed": ".env.{env}", "local": ".env.{env}.local" },
      "required": { "_common": ["NEXT_PUBLIC_APP_ENV"], "production": [] }
    },
    "sdk": {
      "files": { "committed": ".env.{env}", "local": ".env.{env}.local" },
      "required": { "_common": [], "production": [] }
    }
  }
}
```

Notes:

- If a command has `app`, dx will require it to exist in `appToTarget`.
- If a command has no `app`, dx will skip required checks (but still enforce layout + secret policy).

### Step 5: Map `required-env.jsonc` -> `targets.*.required`

Legacy `required-env.jsonc` is grouped like:

```jsonc
{
  "_common": ["APP_ENV"],
  "backend": ["DATABASE_URL"],
  "frontend": ["NEXT_PUBLIC_APP_ENV"],
  "production": ["SOME_PROD_ONLY"],
  "development": []
}
```

Migration:

For each target, set:

- `targets[target].required._common` = legacy `_common` + legacy group for that target (e.g. `backend`)
- `targets[target].required.<env>` = legacy `<env>` (if you want env-only keys to apply to that target)

Practical guidance:

- If a key is required only for backend, keep it only under `targets.backend.required.*`.
- If a key is required for all targets, put it under each target's `_common`.

### Step 6: Update committed env files to include secret placeholders

For each environment file you commit (e.g. `.env.development`, `.env.production`):

- Add every `keys.secret` key.
- Set its value to `secretPlaceholder` exactly.

Example:

```dotenv
APP_ENV=production
DATABASE_URL=__SET_IN_env.local__
APP_SECRET=__SET_IN_env.local__
```

If you miss any secret key template in a committed file, dx will fail with:

- `...: 缺少机密键模板 KEY`

### Step 7: Update local env files to contain real secret values

For each local file (e.g. `.env.production.local`):

- Put real values for secret keys you actually need.
- Do NOT use the placeholder in local files.
- Do NOT add random keys unless you declare them in `keys.localOnly` / `keys.localOverride`.

Example:

```dotenv
DATABASE_URL=postgres://...
APP_SECRET=change-me
```

### Step 8: Verify

Recommended checks:

```bash
# Example config
node bin/dx.js --config-dir example/dx/config --help

# In your real repo root
dx status
dx build backend --dev
```

If you see errors, use the error message path to update either:

- `env-policy.jsonc` (declare key category / required group / app mapping)
- `.env.<env>` (add placeholders)
- `.env.<env>.local` (add real values)

## Common Failure Modes and Fixes

### 1) "未找到 app 对应的 target 配置"

Cause:
- Your command has `app: "xxx"` but `appToTarget.xxx` is missing.

Fix:
- Add `appToTarget.xxx = "someTarget"`.

### 2) "缺少机密键模板 KEY"

Cause:
- `KEY` is in `keys.secret`, but your committed `.env.<env>` file does not define it.

Fix:
- Add `KEY=__SET_IN_env.local__` to the committed file.

### 3) "机密键 KEY 必须使用占位符"

Cause:
- You put a real value for a secret key in `.env.<env>`.

Fix:
- Replace it with the placeholder; move real value into `.env.<env>.local`.

### 4) ".env.<env>.local: 包含未声明的键 KEY"

Cause:
- New policy prevents drift: local files may only contain declared keys.

Fix options:
- If it is a secret: add to `keys.secret` and add placeholder to committed.
- If it is machine-specific: add to `keys.localOnly`.
- If it is a non-secret override: add to `keys.localOverride`.
- Or move it into the committed `.env.<env>`.

## Rollback

dx is backward compatible:

- If you remove `dx/config/env-policy.jsonc`, dx falls back to the legacy files.

This is useful if you need to temporarily revert while fixing migration issues.
