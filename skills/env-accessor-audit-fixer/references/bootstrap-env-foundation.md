# 缺失统一 env 基础设施时的最小补齐模板

当扫描结果显示项目尚未具备 `createEnvAccessor`、`defaultEnvAccessor`、`EnvService` 等统一入口时，可按下面的最小骨架补齐。优先复用项目现有工具链、路径别名与公共类型；只有在仓库确实没有对应能力时，才照此新建。

## 1. `env.accessor.ts`

目标：

- 为配置层、脚本、工具函数提供无依赖的统一读取入口
- 允许显式传入 `process.env` 或自定义 env record
- 提供 typed getter 与 `raw()` 回退口

最小示例：

```typescript
export interface EnvAccessor {
  str(key: string, defaultValue?: string): string | undefined
  bool(key: string, defaultValue?: boolean): boolean
  int(key: string, defaultValue?: number): number
  raw(key: string): string | undefined
}

type EnvSource = Record<string, string | undefined> | NodeJS.ProcessEnv | undefined

function resolveEnv(source?: EnvSource): Record<string, string | undefined> {
  return source ? { ...source } : process.env
}

export function createEnvAccessor(source?: EnvSource): EnvAccessor {
  const env = resolveEnv(source)
  return {
    str(key, defaultValue) {
      const value = env[key]
      return value === undefined || value === '' ? defaultValue : value
    },
    bool(key, defaultValue = false) {
      const value = String(env[key] ?? '').toLowerCase()
      if (!value) return defaultValue
      return value === 'true' || value === '1'
    },
    int(key, defaultValue = 0) {
      const value = Number.parseInt(String(env[key] ?? ''), 10)
      return Number.isFinite(value) ? value : defaultValue
    },
    raw(key) {
      return env[key]
    },
  }
}

export const defaultEnvAccessor = createEnvAccessor()
```

## 2. `env.service.ts`

目标：

- 为 NestJS 运行期服务提供注入式访问方式
- 统一接入 `ConfigService`
- 预留缓存、阈值裁剪、调试开关等运行期逻辑

最小示例：

```typescript
@Injectable()
export class EnvService {
  constructor(private readonly config: ConfigService) {}

  getString(key: string, defaultValue?: string): string | undefined {
    const value = this.config.get<string>(key)
    return value === undefined || value === null || value === '' ? defaultValue : String(value)
  }

  getBoolean(key: string, defaultValue = false): boolean {
    const value = String(this.config.get<string>(key) ?? '').toLowerCase()
    if (!value) return defaultValue
    return value === 'true' || value === '1'
  }

  getInt(key: string, defaultValue = 0): number {
    const value = Number.parseInt(String(this.config.get<string>(key) ?? ''), 10)
    return Number.isFinite(value) ? value : defaultValue
  }

  isProd(): boolean {
    return this.getString('APP_ENV', this.getString('NODE_ENV', 'development')) === 'production'
  }

  getAccessor() {
    return createEnvAccessor(process.env)
  }
}
```

## 3. `env.module.ts`

目标：

- 统一导出 `EnvService`
- 供业务模块直接导入

最小示例：

```typescript
@Module({
  providers: [EnvService],
  exports: [EnvService],
})
export class EnvModule {}
```

## 4. 配置层接入

配置文件中不要继续写 `process.env.REDIS_HOST`，改为：

```typescript
import { registerAs } from '@nestjs/config'
import { defaultEnvAccessor } from '@/common/env/env.accessor'

const env = defaultEnvAccessor

export const redisConfig = registerAs('redis', () => ({
  host: env.str('REDIS_HOST', 'localhost'),
  port: env.int('REDIS_PORT', 6379),
}))
```

## 5. 运行期服务接入

业务代码中不要继续裸读环境变量，改为：

```typescript
@Injectable()
export class ExampleService {
  constructor(private readonly env: EnvService) {}

  shouldEnableFeature(): boolean {
    return this.env.getBoolean('FEATURE_FLAG_ENABLED', false)
  }
}
```

## 6. 迁移顺序建议

1. 先落 `env.accessor.ts`
2. 再落 `env.service.ts` 与 `env.module.ts`
3. 先迁配置层，再迁服务层
4. 最后清理残留 `process.env` 直读

## 7. 允许保留的少量例外

- 负责加载 `.env` 文件的底层入口
- 用于测试注入的 setup / fixture
- 必须读取原始未加工字符串的极少数路径

即便属于例外，也优先把“装载环境”和“消费环境”拆开，避免把业务逻辑继续锁在 `process.env` 上。
