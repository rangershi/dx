# dx deploy 多环境多账号隔离加固（避免 .vercel 回退污染）

适用仓库：`@ranger1/dx`（CLI）  
优先目标版本：CI 正在使用的 `0.1.38` 线（建议以小版本增量方式合入）

## 1. 背景与问题

当前 `dx deploy front/admin --staging/--prod` 的执行链路为：

- `lib/cli/commands/deploy.js`：加载 env layers，并在当前进程合并 `process.env`
- `lib/vercel-deploy.js`：读取 `VERCEL_*` 变量，执行 `vercel build` + `vercel deploy --prebuilt`

在多环境/多账号共用同一工作目录时，如果 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID_*` 任一缺失、占位、冲突，Vercel CLI 可能落回本地链接态（`.vercel/project.json` / repo link），导致部署漂移到错误项目或错误账号。

典型现象：

- `scope-not-accessible`
- `cannot-load-project-settings`
- 或无报错但发布到了错误项目

## 2. 已确认的现状（仓库证据）

### 2.1 deploy 入口与 env 合并

- `lib/cli/commands/deploy.js:82` 使用 `collectEnvFromLayers(null, environment)`
- `lib/cli/commands/deploy.js:90` 仅在“当前值不存在或为占位值”时才覆盖 `process.env`
- `lib/cli/commands/deploy.js:104` 调用 `deployToVercel(normalizedTarget, { environment, telegramWebhook })`

### 2.2 Vercel 部署逻辑

- `lib/vercel-deploy.js:114-118` 读取 `VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID_*`
- `lib/vercel-deploy.js:133-176` 对缺失/占位变量做 fail-fast（当前已存在）
- `lib/vercel-deploy.js:247-249`、`263-265` 对 `build/deploy` 传 `--scope`
- 当前未对 `.vercel/project.json` 做冲突检测/隔离清理（只清理 `source.tgz.part*`）

### 2.3 占位值判定与日志脱敏

- 占位判定统一使用：`envManager.isPlaceholderEnvValue`（`lib/env.js:141`）
- 日志脱敏统一使用：`logger.sanitizeForLog`（`lib/logger.js:8`，包含 `VERCEL_TOKEN` 等）

## 3. 外部行为依据（Vercel CLI）

官方文档给出的项目选择优先级：

1. `--project`
2. `VERCEL_PROJECT_ID`
3. `.vercel/project.json`

并建议在 CI/非交互环境显式设置 `VERCEL_ORG_ID + VERCEL_PROJECT_ID`，以跳过 project linking。  
（来源：Vercel CLI Global Options / Project Linking 文档）

结论：dx 需要把“显式上下文”提升为唯一可信输入，禁止隐式 fallback 决定目标项目。

## 4. 改造目标（必须满足）

1. front/admin 部署前必须有完整上下文：
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - 对应 `VERCEL_PROJECT_ID_FRONT` 或 `VERCEL_PROJECT_ID_ADMIN`
2. 严格模式默认开启：不允许 `.vercel` 历史链接态左右本次部署。
3. 部署前输出可审计上下文日志（脱敏）。
4. staging/prod 连续切换时，部署目标稳定，不受上一条部署留下的 `.vercel` 状态影响。

## 5. 最小补丁清单（函数级）

以下方案以最小侵入修改 `lib/cli/commands/deploy.js` 与 `lib/vercel-deploy.js`，不引入新依赖。

### 5.1 `lib/cli/commands/deploy.js`：透传 strictContext 开关

在调用 `deployToVercel` 前增加 strictContext 计算并透传。

建议规则（与现有 `telegram-webhook` 风格一致）：

- 环境变量 `DX_VERCEL_STRICT_CONTEXT` 显式配置时：
  - `0/false/no` => `false`
  - 其他 => `true`
- 未显式配置时默认 `true`（安全默认）

伪代码：

```js
const strictContext = process.env.DX_VERCEL_STRICT_CONTEXT != null
  ? !['0', 'false', 'no'].includes(String(process.env.DX_VERCEL_STRICT_CONTEXT).toLowerCase())
  : true

await deployToVercel(normalizedTarget, {
  environment,
  telegramWebhook,
  strictContext,
})
```

### 5.2 `lib/vercel-deploy.js`：增加部署上下文校验函数

新增内部函数：`collectMissingVercelContext(targets)` / `assertVercelContext(...)`，复用 `envManager.isPlaceholderEnvValue`。

校验要点：

- token/org 必填
- front/admin 按 target 校验对应 project id
- 任一缺失/占位，立即 `process.exitCode = 1` 并 return（保持当前错误风格）

### 5.3 `lib/vercel-deploy.js`：严格模式处理 `.vercel/project.json`

新增内部函数：

- `readLinkedProjectContext(cwd)`：读取 `.vercel/project.json`（存在则返回 `{ orgId, projectId }`）
- `clearLinkedProjectFile(cwd)`：删除 `.vercel/project.json`（最低隔离成本）

执行策略（每个 target 部署前）：

1. 读取本地链接态（如果存在）
2. 若与当前目标 `orgId/projectId` 不一致：
   - `strictContext=true`：直接失败并打印差异
   - `strictContext=false`：告警并继续
3. `strictContext=true` 时，在执行 `vercel build/deploy` 前删除 `.vercel/project.json`，防止 fallback 污染

可选保留开关：

- `DX_VERCEL_KEEP_LINK=1`：跳过清理（仅应急）

### 5.4 `lib/vercel-deploy.js`：显式项目参数优先

在现有 `--scope` 基础上，统一为 `build` 与 `deploy` args 增加：

- `--project <projectId>`

并继续注入：

- `envVars.VERCEL_PROJECT_ID = projectId`
- `envVars.VERCEL_ORG_ID = orgId`
- `envVars.VERCEL_TOKEN = token`

这样项目定位优先走显式参数，不依赖本地 link 状态。

### 5.5 `lib/vercel-deploy.js`：增加部署前审计日志（脱敏）

每个 target 在 build 前输出：

- `environment`
- `target`
- `strictContext`
- `orgId`（可截断）
- `projectId`（可截断，如前 6 后 4）
- `.vercel/project.json` 是否存在、是否匹配
- token 来源（固定写 `env`，不输出明文）

保持使用 `logger.info`，由 `sanitizeForLog` 兜底。

## 6. 错误信息规范（建议）

### 6.1 上下文缺失

```text
❌ 部署上下文不完整（strict）
缺失变量:
- VERCEL_ORG_ID
- VERCEL_PROJECT_ID_FRONT
已阻止回退到 .vercel，避免误部署
```

### 6.2 本地链接冲突

```text
❌ 检测到 .vercel 链接冲突
当前目标: org=team_xxx project=prj_aaa
本地链接: org=team_yyy project=prj_bbb
请清理 .vercel 或修正环境变量后重试
```

## 7. 验收标准

必须全部满足：

1. 同机连续执行：
   - `dx deploy front --staging`
   - `dx deploy front --prod`
   即使仓库保留 staging 的 `.vercel/project.json`，prod 仍部署到 prod project。
2. 去掉 `VERCEL_PROJECT_ID_FRONT` 后，命令在本地校验阶段硬失败，不触发 vercel 命令。
3. 日志中可明确看到本次生效 `org/project`（脱敏）。
4. front/admin/all 路径行为一致（all 下每个 target 都做独立校验与上下文隔离）。

## 8. 回归用例建议

1. staging/prod 使用不同 token、不同 org、不同 project。
2. token 有效但 org 不匹配，应报权限错误且不得漂移到错误项目。
3. `.vercel/project.json` 指向 staging，执行 prod，应按 prod 变量部署。
4. 删除 `VERCEL_PROJECT_ID_FRONT`，应在本地校验阶段失败。

## 9. 兼容性与风险

- 兼容性：变量齐全且显式上下文正确的流程无破坏。
- 风险收敛：依赖 `.vercel` 隐式链接态的旧流程会被拦截（符合安全预期）。
- 应急回滚：
  - `DX_VERCEL_STRICT_CONTEXT=0` 可临时关闭严格模式（仅应急）。
  - 若需保留本地 link 文件：`DX_VERCEL_KEEP_LINK=1`（不建议长期启用）。

## 10. 合入建议

建议按小版本发布（`0.1.x`）：

1. 先在 staging CI 验证 1 天
2. 再切到 prod 使用
3. 保留应急开关但在文档中标注“仅短期故障绕行”
