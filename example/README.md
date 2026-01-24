# dx example

这个目录是一个“最小可读”的 dx 接入示例，用于演示：

- monorepo 需要满足的条件
- `dx/config/*` 应该如何写
- `.env.*` 的分层与校验规则

注意：这是示例配置，不保证开箱即用跑通（因为不同团队的 nx target/应用名称不同）。你应该按自己的 monorepo 调整 `commands.json` 里的命令。

## 目录结构

```
example/
  dx/
    config/
      commands.json
      env-layers.json
      env-policy.jsonc
  .env.development
  .env.development.local
  .env.production
  .env.production.local
```

## 快速体验（推荐全局安装）

```bash
pnpm add -g @ranger1/dx

# 在任意目录执行，显式指定配置目录
dx --config-dir /absolute/path/to/example/dx/config --help
dx --config-dir /absolute/path/to/example/dx/config status
```

## commands.json 怎么写

dx 的命令配置是一个 JSON 对象（不是代码）。通常会按命令名分组，例如：

- `start.*`：启动服务
- `build.*`：构建
- `db.*`：数据库
- `deploy.*`：部署

示例（节选，完整见 `example/dx/config/commands.json`）：

```json
{
  "start": {
    "backend": {
      "command": "npx nx dev backend",
      "app": "backend",
      "ports": [3000]
    }
  },
  "build": {
    "backend": {
      "dev": { "command": "npx nx build backend --configuration=development", "app": "backend" },
      "prod": { "command": "npx nx build backend --configuration=production", "app": "backend" }
    }
  }
}
```

并发/串行编排示例：

```json
{
  "build": {
    "all": {
      "dev": {
        "concurrent": true,
        "commands": ["build.backend.dev", "build.front.dev"]
      }
    }
  }
}
```

## env-layers.json 怎么写

`env-layers.json` 用于定义每个环境加载哪些 `.env.*` 文件：

```json
{
  "development": [".env.development", ".env.development.local"],
  "production": [".env.production", ".env.production.local"]
}
```

dx 会按顺序加载，并在执行命令时用 `pnpm exec dotenv ... -- <cmd>` 包裹（因此项目里需要安装 `dotenv-cli`）。

## env-policy.jsonc

`env-policy.jsonc` 是统一的 env 策略配置：

- 机密 key：只能在 `.env.<env>.local` 放真实值；在 `.env.<env>` 中必须存在同名 key 且为占位符 `__SET_IN_env.local__`
- 必填校验：按环境 + 按 target（端）定义 required keys

示例配置见 `example/dx/config/env-policy.jsonc`。
