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
- `internal: start-dev`：开发环境一键启动

常用示例：

```bash
dx start backend --dev
dx start all
dx build backend --prod
dx build sdk --dev
dx db generate
dx db migrate --dev --name init
dx db deploy --prod -Y
dx deploy front --staging
dx lint
dx test e2e backend
```

## deploy 行为说明

从 `0.1.9` 起，`dx deploy <target>` 不再在 dx 内部硬编码执行任何 `nx build`/`sdk build` 等前置步骤。

- 需要的前置构建（例如 `shared`、`api-contracts`、OpenAPI 导出、后端构建等）应由项目自己的 Nx 依赖图（`dependsOn`/项目依赖）或 Vercel 的 `buildCommand` 负责。
- 这样 dx deploy 不会强依赖 `apps/sdk` 等目录结构，更容易适配不同 monorepo。

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
