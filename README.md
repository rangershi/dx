# dx

一个可安装的 Node.js CLI，用于管理 ai-monorepo 类项目的构建/启动/数据库/部署等流程。

## 安装

项目内安装（推荐）：

```bash
pnpm add -D dx
```

使用：

```bash
pnpm exec dx --help
pnpm exec dx status
pnpm exec dx build sdk --dev
```

也可以全局安装：

```bash
pnpm add -g dx
dx --help
```

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
  "command": "../../node_modules/.bin/dx-with-version-env --app front -- next build"
}
```

支持的 app：`backend` / `front` / `admin`。

## 约束与假设

当前版本面向 ai-monorepo 类结构，默认假设：

- 使用 pnpm + nx
- 项目布局包含 `apps/backend`、`apps/front`、`apps/admin-front`、`apps/sdk`

## 发布到 npm（准备工作）

如果你准备公开发布：

1. 注意：npm 上的包名 `dx` 很可能已被占用；更稳妥的是使用 scope（例如 `@ranger1/dx`）。
2. 发布前需要把 `package.json` 里的 `private: true` 去掉，并补全 `version` / `license` / `repository` 等字段。
3. 发布命令（公开包）：

```bash
npm publish --access public --registry=https://registry.npmjs.org
```

提示：当前仓库包含一个 `.npmrc`，用于确保 publish 走 npm 官方 registry（避免镜像源导致发布失败）。
