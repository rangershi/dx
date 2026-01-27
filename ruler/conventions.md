# 开发规范与约束

这些规则用于：
1) 开发本仓库（dx CLI 本身）
2) 使用 dx 去管理“目标 monorepo 工程”

两者不要混淆：本仓库是 dx 工具代码；`apps/backend` 等目录是被 dx 管理的目标工程的常见布局，不一定存在于本仓库。

## 1) 输出与沟通

- 输出语言：中文（除非用户明确要求英文）
- 术语区分：
  - “dx 仓库/本仓库” = 当前仓库里的 CLI 工具实现
  - “目标工程/被管理工程” = 用户实际的 pnpm + Nx monorepo（包含 `dx/config/*`）

## 2) 模块系统与代码风格（本仓库）

- 模块系统：ESM（见 `package.json` 的 `"type": "module"`）
- 代码风格：保持与现有 `lib/**/*.js` 一致（显式 import/export、async/await、类封装、语义化日志）
- 失败策略：遇到致命错误时，先用 logger 打印可操作信息，再 `process.exit(1)`
- 不要在本仓库假设存在 ESLint/Prettier 配置：仓库内未发现 `.eslintrc*` / `.prettierrc*`，也未在 `package.json` 中配置

## 3) 配置格式约定（目标工程）

- `dx/config/commands.json`：JSON（不含注释），定义 dx 命令树与执行内容
- `dx/config/env-layers.json`：JSON，定义 `.env.<env>(.local)` 的分层顺序
- `dx/config/env-policy.jsonc`：JSONC（允许 `//` 与 `/* */` 注释），统一 env 布局/机密/required 规则
- 机密占位符：默认 `__SET_IN_env.local__`（由 env-policy.jsonc.secretPlaceholder 决定）

## 4) 环境标志与参数规范（目标工程）

- 环境只能用标志：`--dev/--staging/--prod/--test/--e2e`（禁止通过位置参数传 `dev/prod/...`）
- 默认环境：未显式指定时默认 `--dev`
- 透传参数：使用 `--` 分隔（如 `dx db script my-script --dev -- --arg1 --arg2`）

## 5) 安全与危险操作

- 危险操作必须显式确认（例如 `commands.json` 标记 `dangerous: true`）
- 非交互/CI：使用 `-Y/--yes`，或设置 `AI_CLI_YES=1` / `YES=1`（见 `lib/confirm.js`）
- 禁止提交任何真实机密：目标工程的 committed `.env.<env>` 文件只能写占位符；真实值只能出现在 `.env.<env>.local`
- 根目录禁止 `.env` 与 `.env.local`：存在即报错（见 `lib/validate-env.js`）

## 6) 日志与可观测性（本仓库实现）

- 统一使用 `lib/logger.js` 的 `logger` 输出，不要散落 `console.log` 作为主要通道
- 命令执行应打印最终执行的完整命令字符串（便于排障），并在成功/失败时给出明确结论

## 7) 变更风险与兼容性

- dx 是“工具链基础设施”，变更优先考虑向后兼容
- 如果需要破坏性变更：
  - 先在文档中写清升级路径（参考 `upgrade.md`）
  - 给出可执行的迁移步骤与失败提示（不要依赖“回退到 legacy 配置”）
