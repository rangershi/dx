# 开发流程与命令系统

本文件描述两类流程：
1) 开发本仓库（dx CLI 工具本身）
2) 在“目标 monorepo 工程”中使用 dx（由目标工程的 `dx/config/*` 决定具体命令）

## 1) 开发本仓库（dx CLI）

### 先决条件

- Node.js：>= 20.11.0（见 `package.json`）
  - 包管理器：pnpm

### 安装依赖

```bash
pnpm install
```

### 运行测试

本仓库仅在 `package.json` 中定义了 `test` script：

```bash
pnpm test
```

说明：Jest 配置位于 `jest.config.cjs`，测试用例位于 `test/`。

### 本地手动验证 CLI（用 example 配置）

无需全局安装也可以直接用 node 跑入口文件（推荐用于开发调试；在仓库根目录执行）：

```bash
node ./bin/dx.js --config-dir ./example/dx/config --help
node ./bin/dx.js --config-dir ./example/dx/config status
```

更多示例见：`example/README.md`。

### 发布到 npm（本仓库）

使用 `publish.sh` 发布（要求 git 工作区干净、提供 npm token；可选 OTP）：

```bash
./publish.sh --token "npm_xxx"
```

## 2) 目标工程使用 dx（被管理的 pnpm + Nx monorepo）

### 核心规则（目标工程）

- 所有 dx 命令在“目标工程根目录”执行（或用 `DX_CONFIG_DIR/--config-dir` 显式指向目标工程配置）
- 环境切换只用标志：`--dev/--staging/--prod/--test/--e2e`（禁止位置参数传 `dev/prod/...`）
- 未指定环境时默认 `--dev`

### 目标工程必须提供的配置

目标工程根目录需要：

```
dx/
  config/
    commands.json
    env-layers.json
    env-policy.jsonc
```

说明与字段约定详见：`README.md` 与 `example/README.md`。

### env-policy 迁移（legacy -> 新策略）

如果目标工程仍在使用 legacy 的 3 个配置文件，迁移指南见：`upgrade.md`。
