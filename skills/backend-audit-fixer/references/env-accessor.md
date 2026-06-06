# 维度：环境变量访问（env-accessor）

脚本：`scripts/env_accessor_audit.py`。规则来源：`ruler/conventions.md` §2 环境变量访问。

先扫 `process.env` 直读点，再判断是否已有统一 env 基础设施；有则复用迁移，缺则先补最小基础设施再收口。

## 运行

```bash
SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"
python "$SKILL_HOME/backend-audit-fixer/scripts/env_accessor_audit.py" \
  --workspace /Users/a1/work/ai-monorepo \
  --output-json /tmp/audit-env.json
```

`rg` 快速复核：

```bash
rg "process\.env" apps/backend/src apps/backend/e2e \
  --glob '!*env.accessor.ts' --glob '!*env.service.ts'
```

## 执行流程

1. 扫 `apps/backend/src` 与 `apps/backend/e2e` 的 `process.env`。
2. 仅排除真正封装文件：`env.accessor.ts`、`env.service.ts`。**不排除** `apps/backend/src/config/**`（`registerAs` 配置层也纳入审计）。
3. 识别基础设施状态：是否存在 `createEnvAccessor` / `defaultEnvAccessor` / `EnvService` / `EnvModule` / `registerAs` 经统一入口读取。
4. 按场景为每个直读点选迁移方式，不机械替换。
5. 修复后复扫 + 补跑最小验证。

## 修复准则

- **配置层与 `registerAs`**：优先 `defaultEnvAccessor`；必须显式传环境对象时用 `createEnvAccessor(process.env)`；不再裸读。
  ```typescript
  import { registerAs } from '@nestjs/config'
  import { defaultEnvAccessor } from '@/common/env/env.accessor'
  const env = defaultEnvAccessor
  export const redisConfig = registerAs('redis', () => ({
    host: env.str('REDIS_HOST', 'localhost'),
  }))
  ```
- **运行期服务/控制器/提供者**：注入 `EnvService`，用 `getString/getInt/getBoolean/isProd/isE2E` 等 typed getter；模块未暴露 `EnvModule` 先补依赖。
- **独立脚本/CLI**：dotenv 装载后显式 `const env = createEnvAccessor(process.env)`。
- **必须读原始值**：用 `EnvService.getAccessor().raw(key)` 或 accessor 的 `raw(key)`，并注释说明为何 typed getter 不适用。

## 缺失基础设施时的补齐顺序

见 [bootstrap-env-foundation.md](./bootstrap-env-foundation.md)。顺序：
1. `env.accessor.ts`（`createEnvAccessor`/`defaultEnvAccessor`，支持 `str/bool/int/num/raw/appEnv/snapshot`）
2. `env.service.ts`（包 `ConfigService` + typed getter）
3. `env.module.ts`（暴露 `EnvService`）
4. 配置层迁 `registerAs + defaultEnvAccessor`
5. 运行期服务迁 `EnvService`
6. 复扫剩余直读点

优先复用现有命名/目录/模块结构。

## 例外

- `env.accessor.ts`/`env.service.ts` 本身允许访问 `process.env`。
- 负责 dotenv 装载、环境注入、测试临时覆写的底层入口可保留少量受控访问。
- 测试里显式设值视为受控例外，但优先复用公共 fixture/helper。

## 返回给主 agent 的 findings

```json
{
  "dimension": "env-accessor",
  "infra_status": {"createEnvAccessor":false,"defaultEnvAccessor":false,"EnvService":false,"EnvModule":false},
  "total": 0,
  "violations": [{"file":"","line":0,"suggestion":""}]
}
```
