---
name: env-accessor-audit-fixer
description: Use when backend、NestJS、配置模块、E2E 测试或脚本中需要审计或修复 `process.env` 直读，判断项目是否已具备统一环境访问基础设施，并在缺少 EnvAccessor、EnvService、EnvModule 或统一配置接入时补齐最小可用实现。
---

# 环境变量访问审计与修复

## 概览

先扫描 `process.env` 直读点，再判断仓库是否已有统一 env 访问基础设施。

- 若已有 `EnvService`、`createEnvAccessor`、`defaultEnvAccessor` 或等价封装，优先复用现有方案并逐项迁移。
- 若缺少统一入口，先补齐最小基础设施，再收口剩余直读点。

## 快速开始

先运行扫描脚本：

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
python "$CODEX_HOME/skills/env-accessor-audit-fixer/scripts/env_accessor_audit.py" \
  --workspace /Users/a1/work/ai-monorepo
```

需要结构化结果时输出 JSON：

```bash
python "$CODEX_HOME/skills/env-accessor-audit-fixer/scripts/env_accessor_audit.py" \
  --workspace /Users/a1/work/ai-monorepo \
  --output-json /tmp/env-accessor-audit.json
```

若脚本显示尚未形成统一 env 入口，再读取 [references/bootstrap-env-foundation.md](./references/bootstrap-env-foundation.md)。

## 执行流程

1. 扫描 `apps/backend/src` 与 `apps/backend/e2e` 中的 `process.env`。
2. 仅排除真正的基础封装文件：
   - `env.accessor.ts`
   - `env.service.ts`
3. 不排除 `apps/backend/src/config/**/*.ts`，确保 `registerAs` 配置层也纳入审计。
4. 优先识别当前基础设施状态：
   - 是否存在 `createEnvAccessor`
   - 是否存在 `defaultEnvAccessor`
   - 是否存在 `EnvService`
   - 是否存在 `EnvModule`
   - 是否已有 `registerAs` 或配置层通过统一 env 入口读取变量
5. 按场景为每个直读点选择迁移方式，而不是机械替换。
6. 修复后重新扫描，并补跑最小验证，确认配置读取与运行行为一致。

## 快速复核命令

项目具备 `rg` 时，优先用下列命令复核：

```bash
rg "process\\.env" apps/backend/src apps/backend/e2e \
  --glob '!*env.accessor.ts' \
  --glob '!*env.service.ts'
```

## 修复准则

### 配置层与 `registerAs`

- 优先使用 `defaultEnvAccessor`
- 仅在必须显式传入环境对象时使用 `createEnvAccessor(process.env)`
- 不要继续裸读 `process.env.FOO`

```typescript
import { registerAs } from '@nestjs/config'
import { defaultEnvAccessor } from '@/common/env/env.accessor'

const env = defaultEnvAccessor

export const redisConfig = registerAs('redis', () => ({
  host: env.str('REDIS_HOST', 'localhost'),
}))
```

### 运行期服务、控制器、提供者

- 注入 `EnvService`
- 优先使用 `getString`、`getInt`、`getBoolean`、`isProd`、`isE2E` 等 typed getter
- 若模块尚未暴露 `EnvModule`，先补模块依赖，再迁移读取逻辑

```typescript
@Injectable()
export class ExampleService {
  constructor(private readonly env: EnvService) {}

  getRedisHost() {
    return this.env.getString('REDIS_HOST', 'localhost')
  }
}
```

### 独立脚本与 CLI

- 在完成 dotenv 装载后显式创建 accessor

```typescript
const env = createEnvAccessor(process.env)
```

### 必须读取原始值

- 使用 `EnvService.getAccessor().raw(key)`，或 accessor 的 `raw(key)`
- 在代码中简短说明为何 typed getter 不适用

## 缺失基础设施时的补齐顺序

若扫描结果显示项目尚未形成统一 env 访问方案，按以下顺序补齐：

1. 创建 `env.accessor.ts`
   - 提供 `createEnvAccessor`
   - 提供 `defaultEnvAccessor`
   - 至少支持 `str`、`bool`、`int`、`num`、`raw`、`appEnv`、`snapshot`
2. 创建 `env.service.ts`
   - 包装 `ConfigService`
   - 提供 typed getter 与常用环境判断方法
3. 创建 `env.module.ts`
   - 暴露 `EnvService`
4. 将配置层迁移到 `registerAs + defaultEnvAccessor`
5. 将运行期服务迁移到 `EnvService`
6. 重新扫描剩余 `process.env` 直读点

优先复用现有命名、目录与模块结构；若无统一基础设施，再参考 [references/bootstrap-env-foundation.md](./references/bootstrap-env-foundation.md)。

## 例外与判断原则

- `env.accessor.ts`、`env.service.ts` 本身允许访问 `process.env`
- 负责 dotenv 装载、环境注入、测试环境临时覆写的底层入口可保留少量受控访问
- 测试里对 `process.env` 的显式设值可视为受控例外，但优先复用公共 fixture 或 helper
- 若某文件同时负责“装载环境”和“消费环境”，优先拆分职责，避免例外扩大

## 输出要求

最终输出至少包含：

1. 基础设施状态
2. `process.env` 直读文件清单
3. 每个问题的推荐迁移方式
4. 是否需要补齐基础设施
5. 已修改内容、验证结果与剩余风险

## 资源

- 扫描脚本：`scripts/env_accessor_audit.py`
- 补齐模板：`references/bootstrap-env-foundation.md`
