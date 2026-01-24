# dx

一个可安装的 Node.js CLI，用于管理符合约定的 pnpm + nx monorepo 项目的构建/启动/数据库/部署等流程。

本工具通过项目内的 `dx/config/*` 配置文件来驱动命令执行：你可以把它理解成「带环境变量分层 + 校验 + 命令编排能力的脚本系统」。

## 安装

全局安装（推荐）：

```bash
pnpm add -g @ranger1/dx
```

安装后即可在任意目录使用：

```bash
dx --help
dx status
```

项目内安装（可选，如果你更希望锁定版本）：

```bash
pnpm add -D @ranger1/dx
pnpm exec dx --help
```

## 使用条件（必须满足）

- Node.js：>= 20
- 包管理器：pnpm（dx 内部会调用 `pnpm`）
- 构建系统：Nx（dx 默认命令配置里大量使用 `npx nx ...`）
- 环境加载：建议项目依赖 `dotenv-cli`（dx 会用 `pnpm exec dotenv ...` 包裹命令来注入 `.env.*`）
- 项目结构：默认按 `apps/backend` / `apps/front` / `apps/admin-front` / `apps/sdk` 这类布局编写命令配置

如果你的 monorepo 不完全一致，也能用：关键是你在 `dx/config/commands.json` 里把命令写成适配你项目的形式。

## 项目配置（必须）

dx 会从当前目录向上查找 `dx/config/commands.json` 来定位项目根目录。

你需要在项目根目录提供：

```
dx/
  config/
    commands.json
    env-layers.json
    required-env.jsonc
    local-env-allowlist.jsonc
    exempted-keys.jsonc
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

### 3) dx/config/required-env.jsonc

用于定义哪些环境变量是「必须存在」的（dx 会在执行命令前校验）。它是 jsonc（允许 // 注释）。

dx 的校验分组逻辑：

- `_common`: 所有命令都会校验
- `backend`: 当命令配置里 `app` 是 `backend` 时会校验
- `frontend`: 当命令配置里 `app` 是 `front`/`admin-front` 等前端应用时会校验
- `development`/`production`/`staging`/`test`/`e2e`: 按当前环境额外补充

### 4) dx/config/local-env-allowlist.jsonc + exempted-keys.jsonc

这是为了防止误提交机密：

- `local-env-allowlist.jsonc`：允许出现在 `.env.*.local` 里的键（这些被认为是“机密”）
- `exempted-keys.jsonc`：豁免键（允许在非 local 文件中出现真实值）

非 local 的 `.env.*` 文件里，机密键必须使用占位符：`__SET_IN_env.local__`。

## 示例工程

查看 `example/`：包含一个最小可读的 `dx/config` 配置示例，以及如何在一个 pnpm+nx monorepo 中接入 dx。

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
- 项目布局包含 `apps/backend`、`apps/front`、`apps/admin-front`、`apps/sdk`（如果你的命令配置不依赖这些目录，可自行调整）
- 版本注入脚本 `dx-with-version-env` 默认支持 app: `backend` / `front` / `admin`

## 发布到 npm（准备工作）

如果你准备公开发布：

1. 注意：npm 上的包名 `dx` 很可能已被占用；更稳妥的是使用 scope（例如 `@ranger1/dx`）。
2. 发布前需要把 `package.json` 里的 `private: true` 去掉，并补全 `version` / `license` / `repository` 等字段。
3. 发布命令（公开包）：

```bash
npm publish --access public --registry=https://registry.npmjs.org
```
