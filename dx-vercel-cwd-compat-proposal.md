# dx Vercel 部署 cwd 兼容改造提案（提交 @ranger1/dx 团队）

## 背景

当前 `dx deploy` 在 `@ranger1/dx` 的实现中，统一以仓库根目录作为 `vercel build/deploy` 的执行目录（`cwd=projectRoot`）。

在 monorepo 场景下，这会导致同一份 `vercel.*.json` 在不同环境（`--staging` / `--prod`）下出现路径敏感问题，典型表现为：

- installCommand 相对路径在某些环境可用、某些环境失效
- Next.js 产物目录查找错误（`.next` 目录定位漂移）
- 管理端静态产物目录定位受 cwd 影响

我们目前在业务仓库里通过“配置层兼容逻辑（if/软链接）”兜底，能跑但不优雅，且增加维护复杂度。

## 问题复现（已出现）

### 案例一：front staging 构建安装失败

报错摘要：

`ERR_PNPM_NO_PKG_MANIFEST No package.json found in /Users/a1`

根因：

- `installCommand` 使用了 `pnpm --dir ../.. install --frozen-lockfile`
- 实际执行 cwd 已在仓库根目录，再回退两级后指向错误路径

### 案例二：front `.next` 目录定位失败

报错摘要：

`The Next.js output directory ".next" was not found at "/repo/.next"`

根因：

- 构建产物实际在 `apps/front/.next`
- Vercel/构建器在根目录查找 `.next`
- cwd 与 output 期望不一致

## 当前 dx 实现关键点（需改造）

文件：`@ranger1/dx/lib/vercel-deploy.js`

当前逻辑（摘要）：

- `projectRoot = process.cwd()`
- `runVercel(..., { cwd: projectRoot })`
- build/deploy 均固定传 `cwd: projectRoot`
- `TARGET_CONFIGS` 仅包含 `configFile` 与 `projectIdEnvVar`

这使得 target 无法声明自己的工作目录语义。

## 改造目标

1. 从 `dx` 层统一解决 cwd 漂移问题
2. 业务仓库的 `vercel.*.json` 恢复为简洁、无路径分支的写法
3. 保持向后兼容（默认行为不破坏现有项目）

## 设计方案（推荐）

### 1) 在 `TARGET_CONFIGS` 增加可选 `deployCwd`

示例：

```js
const TARGET_CONFIGS = {
  front: {
    configFile: 'vercel.front.json',
    projectIdEnvVar: 'VERCEL_PROJECT_ID_FRONT',
    deployCwd: 'apps/front',
  },
  admin: {
    configFile: 'vercel.admin.json',
    projectIdEnvVar: 'VERCEL_PROJECT_ID_ADMIN',
    deployCwd: 'apps/admin-front',
  },
  'telegram-bot': {
    configFile: 'vercel.telegram-bot.json',
    projectIdEnvVar: 'VERCEL_PROJECT_ID_TELEGRAM_BOT',
    // 可先保持 projectRoot，后续按项目结构再决定
  },
}
```

### 2) 统一计算 target 级执行目录

```js
const runCwd = targetConfig.deployCwd
  ? join(projectRoot, targetConfig.deployCwd)
  : projectRoot
```

build/deploy 都改为：

```js
await run(buildArgs, { env: envVars, cwd: runCwd })
await deployPrebuiltWithFallback({ ..., env: envVars, cwd: runCwd, ... })
```

### 3) `--local-config` 继续传绝对路径

`configPath` 保持 `join(projectRoot, configFile)`，避免因 cwd 变化导致配置文件找不到。

## 兼容性策略

### 默认行为不破坏

- 若 target 未配置 `deployCwd`，继续使用 `projectRoot`（与当前一致）

### 可选安全开关（建议）

新增环境变量（可选）：

- `DX_VERCEL_TARGET_CWD=1`：启用 target 级 cwd

上线策略：

1. 先灰度开启（内部仓库验证）
2. 验证通过后切为默认开启

## 业务仓库落地后可删除的临时兼容

本仓库当前为了绕过 dx 限制，加入了：

- installCommand 的多分支路径判断
- buildCommand 的软链接归一化逻辑

当 dx 完成改造并稳定后，可回收为更简洁配置：

- `installCommand: pnpm install --frozen-lockfile`
- `outputDirectory` 直接按目标项目目录语义设置
- 删除 shell 分支与软链接步骤

## 验收标准（建议）

对每个 target 至少验证以下矩阵：

- 环境：`development` / `staging` / `production`
- 命令：`dx deploy <target> --staging`、`dx deploy <target> --prod`

验收通过条件：

1. build 与 deploy 均成功（exit 0）
2. 不再需要 `../..` 这类脆弱相对路径
3. front 不再出现 `.next not found`
4. admin 不再依赖复制/软链接兜底
5. 不影响 telegram-bot 既有部署行为

## 风险与回滚

风险点：

- 某些项目 `vercel.json` 默认假设 cwd 为仓库根
- telegram-bot 的函数路径语义可能受 cwd 影响

回滚策略：

- 通过 `DX_VERCEL_TARGET_CWD=0`（或不设置）退回 `projectRoot` 行为
- 保留现有 strictContext 校验与 missing_files fallback 逻辑，不变更

## 给 dx 维护团队的最小改动清单

1. 修改 `lib/vercel-deploy.js` 的 `TARGET_CONFIGS` 结构，支持 `deployCwd`
2. 在 per-target 循环中计算 `runCwd`
3. `run()` 与 `deployPrebuiltWithFallback()` 都使用 `runCwd`
4. 保持 `configPath` 绝对路径
5. 增加 2~3 个集成测试样例（front/admin/root-cwd fallback）

---

如果维护团队希望，我可以再提供一版“可直接粘贴的补丁 diff（基于 `@ranger1/dx@0.1.56`）”。
