# Deploy Backend: 添加 Prisma Seed 阶段

## 概述

在 `dx deploy backend` 远程部署脚本中，`prisma-migrate` 阶段之后、`switch-current` 之前，新增 `prisma-seed` 阶段。通过 `commands.json` 中的 `prismaSeed` 配置项控制是否启用（默认 `false`）。

## 动机

部署后端时，数据库迁移已在远程脚本中实现，但缺少幂等 seed 步骤。某些环境需要在部署时自动执行 seed（如初始化基础数据、字典表等），且 seed 应在切流量前完成以确保数据就绪。

## 设计决策

| 决策 | 选项 | 结论 |
|------|------|------|
| seed 命令 | Prisma 原生 `prisma db seed` | 使用 `prisma db seed --schema=... --config=...` |
| 执行位置 | migrate 后 / switch 后 / startup 后 | **migrate 之后、switch-current 之前** |
| 失败行为 | 中断 / 警告继续 / 可配置 | **中断部署** |
| 跳过控制 | 配置+CLI / 仅CLI / 仅配置 | **仅配置项 `prismaSeed`** |

## 改动清单

### 1. `lib/backend-artifact-deploy/config.js`

- `resolveBackendDeployConfig` 中从 `runConfig` 读取 `prismaSeed`，默认 `false`
- 添加到 `normalized.deploy` 对象中
- 当 `prismaSeed` 为 `true` 时，校验 `runtime.prismaSchemaDir` 和 `runtime.prismaConfig` 必须存在（复用现有校验逻辑）

```js
const prismaSeed = runConfig.prismaSeed === true
```

校验条件更新：
```js
if (normalized.deploy.prismaGenerate || normalized.deploy.prismaMigrateDeploy || normalized.deploy.prismaSeed) {
  requireString(normalized.runtime.prismaSchemaDir, 'runtime.prismaSchemaDir')
  requireString(normalized.runtime.prismaConfig, 'runtime.prismaConfig')
}
```

### 2. `lib/backend-artifact-deploy/remote-script.js`

**JS 变量：**
```js
const shouldSeed = deploy.prismaSeed === true
```

**Bash 变量注入：**
```bash
SHOULD_SEED=${shouldSeed ? '1' : '0'}
```

**新增阶段（在 `prisma-migrate` 之后、`switch-current` 之前）：**
```bash
if [[ "$SHOULD_SEED" == "1" ]]; then
  CURRENT_PHASE="prisma-seed"
  echo "DX_REMOTE_PHASE=prisma-seed"
  PRISMA_BIN="$RELEASE_DIR/node_modules/.bin/prisma"
  if [[ ! -x "$PRISMA_BIN" ]]; then
    echo "缺少可执行文件: $PRISMA_BIN" >&2
    exit 1
  fi
  run_with_env "$RELEASE_DIR" "$PRISMA_BIN" db seed --schema="$PRISMA_SCHEMA" --config="$PRISMA_CONFIG"
fi
```

**注意：** 不设置 `MIGRATION_EXECUTED=1`。seed 执行后如果 startup 失败，回滚行为仍由 migrate 是否执行决定。

### 3. `commands.json` 配置

在 `backendDeploy.deploy` 中新增 `prismaSeed` 字段：

```json
{
  "deploy": {
    "keepReleases": 5,
    "installCommand": "pnpm install --prod --no-frozen-lockfile --ignore-workspace",
    "prismaGenerate": true,
    "prismaMigrateDeploy": true,
    "prismaSeed": true
  }
}
```

### 4. 示例配置

`example/dx/config/commands.json` 中的 `deploy.backend` 配置同步更新，添加 `prismaSeed` 字段。

## 部署流程（更新后）

```
lock → extract → env → install → prisma-generate → prisma-migrate → prisma-seed → switch-current → startup → verify → cleanup
```

## 回滚影响

- seed 是幂等操作，无需回滚
- `MIGRATION_EXECUTED` 标记不受 seed 影响
- 回滚判断逻辑（`rollback.js`）不需要修改

## 测试要点

- `prismaSeed: true` 时生成的 bash 脚本包含 `prisma-seed` 阶段
- `prismaSeed: false`（或未设置）时不包含该阶段
- `prismaSeed: true` 但缺少 `prismaSchemaDir` 时配置校验报错
- seed 阶段失败时部署中断，不执行 `switch-current`
