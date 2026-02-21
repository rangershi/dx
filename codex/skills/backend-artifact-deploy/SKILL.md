---
name: backend-artifact-deploy
description: 将后端部署从“目标机拉源码并编译”改造为“本地构建制品、目标机仅安装运行依赖并启动”的标准流程。用于 Node/NestJS/Nx/Prisma 等后端项目，尤其适合需要无源码部署、支持 dev/staging/prod 多环境、要求双层环境文件覆盖（如 .env.production 与 .env.production.local）、以及需要在 pm2 与 direct 启动方式之间切换的场景。
---

# 后端制品部署

## 概览

使用该技能时，先识别项目当前的环境变量加载链路与启动链路，再落地“制品打包脚本 + 服务器发布脚本 + 回滚策略”。
目标是保证目标机器不需要源码编译，同时保持与项目既有环境覆盖规则一致。

## 执行流程

### 第一步：确认现状链路

依次核对：

1. 构建链路是否依赖源码目录（例如 dist 里软链回源码 `node_modules`）。
2. 运行链路如何加载环境变量（是否是两层覆盖，是否通过 `dotenv -e A -e B`）。
3. 数据库迁移链路是否依赖运行时环境（Prisma `generate` / `migrate deploy` 前是否已加载 env）。
4. 进程启动是否仅支持 pm2，是否需要 direct 前台测试模式。

如果项目已有统一入口（例如 `dx` 或内部脚手架），优先复用该入口，不要绕开既有环境策略。

### 第二步：定义制品边界

默认采用“轻制品”模式：

1. 本地只打包编译产物与必要运行文件，不打包 `node_modules`。
2. 目标机解压后再安装生产依赖。
3. 制品命名固定含版本与时间片，例如 `backend-v<version>-<月-日-时-分>.tgz`。

制品最小清单应包含：

1. 编译产物目录（如 `dist/backend/**`）。
2. 数据库 schema 与迁移目录（如 `prisma/schema/**`）。
3. 生产依赖清单（`package.production.json` 重命名为 `package.json`）。
4. 锁文件（`pnpm-lock.yaml`）。
5. 启动配置（如 `ecosystem.config.cjs`）。
6. 双层环境文件（`.env.<env>` 与 `.env.<env>.local`）。

### 第三步：实现打包脚本

打包脚本应支持参数：

1. `--env dev|staging|prod`。
2. `--version`（默认取后端 `package.json` 版本）。
3. `--time`（格式 `MM-DD-HH-mm`）。

脚本关键行为：

1. 按环境构建（`dev -> --dev`，`staging/prod -> --prod`）。
2. 复制双层环境文件到制品目录。
3. 不在本地安装运行依赖。
4. 生成 `tgz`。

### 第四步：实现发布脚本

发布脚本应支持参数：

1. `--archive`（必填）。
2. `--env dev|staging|prod`。
3. `--start-mode pm2|direct`（默认 `pm2`）。
4. `--env-file` 与 `--env-local-file`（可选覆盖路径）。
5. `--skip-install`、`--skip-migration`、`--skip-pm2`。

发布顺序建议：

1. 解压到 `releases/<version>`。
2. 准备双层 env 文件。
3. 安装生产依赖。
4. 执行 `prisma generate`。
5. 执行 `prisma migrate deploy`。
6. 切换 `current` 软链。
7. 启动服务（pm2 或 direct）。
8. 清理旧版本。

### 第五步：双层环境加载规则（必须一致）

所有关键步骤统一使用相同加载顺序：

1. 基础层 `.env.<env>`。
2. 覆盖层 `.env.<env>.local`。

推荐显式写法：

```bash
APP_ENV="<env-name>" pnpm exec dotenv -e ".env.<env-name>" -e ".env.<env-name>.local" -- <command>
```

命令示例中的 `<command>` 包括：

1. `pnpm exec prisma generate --schema=...`
2. `pnpm exec prisma migrate deploy --schema=...`
3. `pm2 startOrReload ...` 或 `node apps/backend/src/main.js`

## 验证清单

交付前必须至少验证：

1. 打包脚本 `--help` 与语法检查通过。
2. 发布脚本 `--help` 与语法检查通过。
3. 制品内同时包含 `.env.<env>` 与 `.env.<env>.local`。
4. 发布脚本在默认路径下能正确识别并使用两层 env。
5. `start-mode=direct` 可前台启动。
6. `start-mode=pm2` 可重载或启动。
7. 版本目录与 `current` 切换正常，可回滚。

## 常见陷阱

1. 把 env 文件链接到自身，造成坏链路。
2. 只加载 `.env.<env>`，遗漏 `.local` 覆盖。
3. 迁移与启动阶段用不同 env 加载逻辑，导致行为不一致。
4. staging 构建误用 development 或 production 的 env 层。
5. 打包包含本机 `node_modules`，跨系统运行失败。

## 参考资料

需要细化实现时，读取：

- `references/deployment-checklist.md`
