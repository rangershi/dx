# ai-monorepo dx 配置 Demo

该目录基于 `/Users/a1/work/ai-monorepo/dx/config` 精简而来，
用于演示 `dx` 在 pnpm + Nx monorepo 中的最小可读配置方式。

## 目录结构

- `config/commands.json`
- `config/env-layers.json`
- `config/env-policy.jsonc`
- `.env.development` / `.env.staging` / `.env.production`
- `.env.development.local.template` / `.env.staging.local.template` / `.env.production.local.template`

## 精简内容

- 命令面：仅保留 `start/build/db/deploy/lint/install` 的核心示例
- 环境层：仅保留 `development/staging/production`
- 环境变量策略：仅保留少量必需变量和机密字段
- 新增 `start.stack`（`internal: "pm2-stack"`）示例，支持：
  - 启动前端口占用清理（`preflight.killPorts`）
  - PM2 状态重置（`preflight.pm2Reset`）
  - 前端缓存和 `*.tsbuildinfo` 清理

## 本地体验

在本仓库根目录执行：

```bash
node ./bin/dx.js --config-dir ./dx/demo/config --help
```

快速试跑建议：

1. 复制本地模板为 `.local` 文件（仅示例，不要提交真实值）。
2. 把 `.env.*` 中的占位值保留为 `__SET_IN_env.local__`。
3. 在目标仓库根目录用 `--config-dir` 指向该 demo 配置后执行 `dx start backend --dev`。

如果你在实际 `ai-monorepo` 里使用，请把 `--config-dir` 指向该仓库自己的 `dx/config`。
