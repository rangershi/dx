# dx

一个可安装的 Node.js CLI，用于管理符合约定的 pnpm + nx monorepo 项目的构建/启动/数据库/部署等流程。

本工具通过项目内的 `dx/config/*` 配置文件来驱动命令执行：你可以把它理解成「带环境变量分层 + 校验 + 命令编排能力的脚本系统」。

## 安装

必须全局安装，并始终使用最新版本：

```bash
pnpm add -g @ranger1/dx@latest
```

安装后即可在任意目录使用：

```bash
dx --help
dx status
```

升级到最新版本：

```bash
pnpm update -g @ranger1/dx
```

## 使用条件（必须满足）

- Node.js：>= 20
- 包管理器：pnpm（dx 内部会调用 `pnpm`）
- 构建系统：Nx（dx 默认命令配置里大量使用 `npx nx ...`）
- 环境加载：建议项目依赖 `dotenv-cli`（dx 会用 `pnpm exec dotenv ...` 包裹命令来注入 `.env.*`）
- 项目结构：推荐按 `apps/backend` / `apps/front` / `apps/admin-front` 这类布局组织；如有自定义目录结构，请通过 `dx/config/commands.json` 适配

如果你的 monorepo 不完全一致，也能用：关键是你在 `dx/config/commands.json` 里把命令写成适配你项目的形式。

## 项目配置（必须）

dx 会从当前目录向上查找 `dx/config/commands.json` 来定位项目根目录。

你需要在项目根目录提供：

```
dx/
  config/
    commands.json
    env-layers.json
    env-policy.jsonc
```

可选覆盖：

- 环境变量：`DX_CONFIG_DIR=/abs/path/to/config`
- 参数：`dx --config-dir /abs/path/to/config ...`

全局安装场景下，如果你不在项目目录内执行，也可以通过 `DX_CONFIG_DIR` / `--config-dir` 显式指定配置目录（目录下需要存在 `commands.json`）。

示例：

```bash
# 在任意目录执行
dx --config-dir /path/to/your-repo/dx/config status

# 或
DX_CONFIG_DIR=/path/to/your-repo/dx/config dx status
```

## 配置文件写法

### 1) dx/config/commands.json

这是核心文件，定义了 dx 各命令要执行的 shell 命令，支持：

- 单命令：`{ "command": "..." }`
- 并发：`{ "concurrent": true, "commands": ["build.front.dev", "build.admin.dev"] }`
- 串行：`{ "sequential": true, "commands": ["build.backend.prod", "build.sdk"] }`
- 环境分支：如 `build.backend.dev` / `build.backend.prod`（dx 会根据 `--dev/--prod/--staging/...` 选择）
- dotenv 包裹：配置里带 `"app": "backend"` 时，dx 会按 `env-layers.json` 拼出 dotenv 层并用 `pnpm exec dotenv ... -- <command>` 执行

常见字段（单命令配置）：

```jsonc
{
  "command": "npx nx build backend --configuration=production",
  "app": "backend",                // 可选：用于选择 dotenv 层，并决定需要校验的 env 变量组
  "ports": [3000],                  // 可选：用于 start 类命令，冲突时自动清理
  "description": "构建后端(生产环境)",
  "dangerous": true,                // 可选：危险操作需要确认
  "skipEnvValidation": true,         // 可选：跳过 env 校验（仍可加载 dotenv 层）
  "env": { "NX_CACHE": "false" } // 可选：注入额外环境变量
}
```

命令路径引用（并发/串行的 commands 数组）使用点号字符串，例如：

```json
{ "concurrent": true, "commands": ["build.shared", "build.front.dev"] }
```

### 2) dx/config/env-layers.json

用于定义不同环境下加载哪些 `.env.*` 文件（顺序 = 覆盖优先级）。格式：

```json
{
  "development": [".env.development", ".env.development.local"],
  "staging": [".env.staging", ".env.staging.local"],
  "production": [".env.production", ".env.production.local"],
  "test": [".env.test", ".env.test.local"],
  "e2e": [".env.e2e", ".env.e2e.local"]
}
```

### 3) dx/config/env-policy.jsonc

统一的 env 策略配置（jsonc），同时覆盖：

- env 文件布局约束（禁用 `.env` / `.env.local`；禁止子目录散落 `.env*`，仅允许少数特例路径）
- 机密键策略：机密 key 只能在 `.env.<env>.local` 放真实值；对应的 `.env.<env>` 必须存在同名 key 且为占位符 `__SET_IN_env.local__`
- 必填校验：按环境 + 按 target（端）定义 required keys，执行命令前校验是否缺失/仍为占位符

target（端）不写死，由 `env-policy.jsonc.targets` 定义；`commands.json` 里的 `app` 通过 `env-policy.jsonc.appToTarget` 映射到某个 target。

注：`env-policy.jsonc` 为必需配置；未提供时 dx 将直接报错。

## 示例工程

查看 `example/`：包含一个最小可读的 `dx/config` 配置示例，以及如何在一个 pnpm+nx monorepo 中接入 dx。

## PR Review Loop（自动评审-修复闭环）

仓库内提供了基于 Codex Skill 的 PR 评审自动化工作流：并行评审 -> 聚合结论 -> 生成修复清单 -> 自动修复 -> 再评审，最多循环 3 轮，用于让 PR 更快收敛。

### 什么时候用

- PR 变更较大、想要更系统地覆盖安全/性能/可维护性问题
- 希望在 CI 通过前提下，把评审建议落成可执行修复清单（fixFile）
- 希望避免同一个问题在不同轮次被反复提出（Decision Log）

### 如何运行

在 Codex 会话中触发该技能：

```text
使用 $pr-review-loop 对 PR #<PR_NUMBER> 执行审核闭环
```

技能入口与说明见：

- `codex/skills/pr-review-loop/SKILL.md`
- `codex/skills/pr-review-loop/references/agents/*.md`

### 工作流概览

- 预检（`pr-precheck`）：先做编译/基础 gate，不通过则终止流程
- 获取上下文（`pr-context`）：生成本轮上下文缓存 `contextFile` 与 `runId`
- 并行评审（reviewers）：按 `./reviewer/*-reviewer.md` 并行审查并产出 reviewFile
- 聚合（`pr-review-aggregate` 模式 A）：合并评审结果、去重、发布 Review Summary、生成 `fixFile`
- 修复（`fixer`）：按 `fixFile` 执行修复并产出 `fixReportFile`
- 发布修复报告（`pr-review-aggregate` 模式 B）

### 缓存文件（项目内 `./.cache/`）

该流程中间产物写入 `./.cache/`，并在各阶段传递相对路径：

- `./.cache/pr-context-pr<PR>-r<ROUND>-<RUN_ID>.md`（contextFile）
- `./.cache/review-<ROLE_CODE>-pr<PR>-r<ROUND>-<RUN_ID>.md`（reviewFile）
- `./.cache/fix-pr<PR>-r<ROUND>-<RUN_ID>.md`（fixFile）
- `./.cache/fix-report-pr<PR>-r<ROUND>-<RUN_ID>.md`（fixReportFile）

### Decision Log（跨轮次决策日志）

- 文件：`./.cache/decision-log-pr<PR_NUMBER>.md`
- 作用：记录每轮 Fixed/Rejected 结论，后续轮次用于过滤重复问题
- 规则：默认 append-only，保留历史决策用于收敛

## 命令

dx 的命令由 `dx/config/commands.json` 驱动，并且内置了一些 internal runner（避免项目侧依赖任何 `scripts/lib/*.js`）：

- `internal: sdk-build`：SDK 生成/构建
- `internal: backend-package`：后端打包
- `internal: backend-artifact-deploy`：后端制品构建、上传与远端部署
- `internal: start-dev`：开发环境一键启动
- `internal: pm2-stack`：PM2 交互式服务栈（支持端口清理/缓存清理配置）

常用示例：

```bash
dx start backend --dev
dx start all --dev
dx build backend --prod
dx build sdk --dev
dx db generate
dx db migrate --dev --name init
dx db deploy --prod -Y
dx deploy front --staging
dx deploy backend --prod
dx lint
dx test e2e backend apps/backend/e2e/auth
```

命令约束摘要：

- `dx test e2e backend` 必须提供文件或目录路径，禁止无路径全量执行
- `dx db migrate` 仅允许在 `--dev` 环境创建迁移；非开发环境请使用 `dx db deploy`
- `dx start` 未指定服务时默认是开发套件，仅允许 `--dev`
- `dx start` 下的单层目标（如 `stagewise-front`）默认仅支持 `--dev`
- `dx build` 显式传入环境标志时，必须是该 target 实际支持的环境

### `dx start stack` 配置详解（PM2 交互式服务栈）

从 `0.1.78` 起，`dx start stack` 推荐完全由 `dx/config/commands.json` 配置驱动，不再依赖硬编码服务列表。

最小可用配置：

```json
{
  "start": {
    "stack": {
      "internal": "pm2-stack",
      "interactive": true,
      "description": "PM2 交互式服务栈",
      "stack": {
        "ecosystemConfig": "ecosystem.config.cjs",
        "services": ["backend", "front", "admin"],
        "preflight": {
          "killPorts": [3000, 3001, 3500],
          "pm2Reset": true
        }
      }
    }
  }
}
```

完整字段说明：

- `start.stack.internal`
  - 固定为 `pm2-stack`，表示启用内置 PM2 交互式 runner。
- `start.stack.interactive`
  - 建议设为 `true`，用于标记这是交互式命令（便于团队识别）。
- `start.stack.stack.ecosystemConfig`
  - PM2 配置文件路径；支持相对路径（相对项目根目录）或绝对路径。
  - 默认值：`ecosystem.config.cjs`。
- `start.stack.stack.pm2Bin`
  - PM2 命令前缀，默认 `pnpm pm2`。如果团队使用全局 pm2，可改为 `pm2`。
- `start.stack.stack.services`
  - 交互命令（`r/l/s`）可操作的服务名单。
  - 示例：`["backend", "front", "admin"]`。
- `start.stack.stack.preflight.killPorts`
  - 启动前自动清理占用端口列表。
  - 这就是“某些端口被占用时自动处理”的核心配置。
- `start.stack.stack.preflight.forcePortCleanup`
  - 是否强制清理端口占用，默认 `true`。
- `start.stack.stack.preflight.pm2Reset`
  - 启动前是否执行 PM2 状态重置（`delete all` / `kill` / 状态文件清理），默认 `true`。
- `start.stack.stack.preflight.cleanPaths`
  - 启动前需要删除的缓存路径列表（相对项目根目录）。
  - 适合清理 `.next`、`dist`、`.vite` 等缓存，避免脏状态。
- `start.stack.stack.preflight.cleanTsBuildInfo`
  - 是否清理 `*.tsbuildinfo`，默认 `true`。
- `start.stack.stack.preflight.cleanTsBuildInfoDirs`
  - 扫描 `*.tsbuildinfo` 的目录列表。

交互命令保持不变：

- `r <service>` 重启服务
- `l <service>` 查看日志
- `s <service>` 停止服务
- `list` 查看状态
- `monit` 打开 PM2 监控
- `q` 停止所有服务并退出

推荐实践：

- 将 `services` 与 `ecosystem.config.cjs` 里的 app 名保持一致，避免交互命令找不到服务。
- `killPorts` 只配置开发态常驻端口，避免误杀不相关进程。
- 如果项目不是 `apps/front` / `apps/admin-front` 结构，请按实际目录改 `cleanPaths` 与 `cleanTsBuildInfoDirs`。

## deploy 行为说明

从 `0.1.9` 起，`dx deploy <target>` 不再在 dx 内部硬编码执行任何 `nx build`/`sdk build` 等前置步骤。

- 需要的前置构建（例如 `shared`、`api-contracts`、OpenAPI 导出、后端构建等）应由项目自己的 Nx 依赖图（`dependsOn`/项目依赖）或 Vercel 的 `buildCommand` 负责。
- 这样 dx deploy 不会强依赖 `apps/sdk` 等目录结构，更容易适配不同 monorepo。

### backend 制品发布

当 `dx/config/commands.json` 的 `deploy.backend.internal` 配置为 `backend-artifact-deploy` 时，`dx deploy backend` 走内置的后端制品发布流程，而不是 Vercel 部署。

常用命令：

```bash
dx deploy backend --prod
dx deploy backend --build-only
dx deploy backend --prod --skip-migration
```

最小示例配置：

```json
{
  "deploy": {
    "backend": {
      "internal": "backend-artifact-deploy",
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

固定远端目录协议：

- `<baseDir>/releases/<version-name>`
- `<baseDir>/current`
- `<baseDir>/shared/.env.<environment>`
- `<baseDir>/shared/.env.<environment>.local`
- `<baseDir>/uploads/<bundle-file>`

## 依赖关系约定

dx 不负责管理「工程之间的构建依赖关系」。如果多个工程之间存在依赖（例如 `front/admin` 依赖 `shared` 或 `api-contracts`），必须由 Nx 的依赖图来表达并自动拉起：

- 使用 Nx 的项目依赖（基于 import graph 或 `implicitDependencies`）
- 使用 `nx.json` 的 `targetDefaults.dependsOn` / `targetDependencies`

dx 只会执行你在 `dx/config/commands.json` 中配置的命令，不会在执行过程中额外硬编码插入依赖构建。

## 给 Nx target 注入版本信息（可选）

本包提供 `dx-with-version-env`，用于在 `nx:run-commands` 中注入版本/sha/构建时间等环境变量：

```json
{
  "command": "dx-with-version-env --app front -- next build"
}
```

支持的 app：`backend` / `front` / `admin`。

## 约束与假设

当前版本面向 pnpm + nx 的 monorepo，默认假设：

- 使用 pnpm + nx
- 项目布局包含 `apps/backend`、`apps/front`、`apps/admin-front`（如有差异，通过 `dx/config/commands.json` 适配）
- 版本注入脚本 `dx-with-version-env` 默认支持 app: `backend` / `front` / `admin`

## 发布到 npm（准备工作）

如果你准备公开发布：

1. 注意：npm 上的包名 `dx` 很可能已被占用；更稳妥的是使用 scope（例如 `@ranger1/dx`）。
2. 发布前需要把 `package.json` 里的 `private: true` 去掉，并补全 `version` / `license` / `repository` 等字段。
3. 发布命令（公开包）：

```bash
npm publish --access public --registry=https://registry.npmjs.org
```
