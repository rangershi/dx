# 维度：枚举唯一真源（enum-single-source）

脚本：`scripts/enum_single_source_audit.py`。规则来源：数据库枚举唯一真源与共享枚举生成约定。

先区分枚举来源：数据库枚举只允许在 Prisma schema 中手写定义，再通过生成脚本产出 shared 枚举；非数据库枚举也必须只有一个 shared 或模块内真源，其他地方 import/derive 复用。

## 运行

```bash
SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"
python "$SKILL_HOME/backend-audit-fixer/scripts/enum_single_source_audit.py" \
  --workspace /Users/a1/work/ai-monorepo \
  --output-json /tmp/audit-enum-single-source.json
```

必要时用 `--schema-dir` 指定 Prisma schema 目录，用 `--include-glob` 扩展扫描范围。

## 执行流程

1. 读取 `apps/backend/prisma/schema/*.prisma` 中的 `enum`，建立 DB enum 名称和值集合。
2. 检查生成产物是否存在且与 schema 同步：
   - `packages/shared/src/generated/prisma-enums.ts`
   - `packages/shared/src/generated/prisma-enum-names.json`（若项目使用该文件约束 lint）
3. 扫描 `apps/backend/src/**/*.ts` 与 `packages/shared/src/**/*.ts`，排除 generated、测试文件与声明文件。
4. 识别 DB enum 绕过真源的候选问题：
   - 在业务代码里重新 `export enum X`，且名称或值匹配 Prisma enum。
   - 在 DTO/常量里用 `['A', 'B'] as const` 或本地 `*_VALUES` 重写 Prisma enum 值。
   - Swagger 装饰器里手写 `enum: ['A', 'B']`。
   - 从 `@prisma/client` 直接 import DB enum，而不是经 shared 生成枚举。
   - 生成产物缺失或与 Prisma schema 不一致。
5. 打开命中文件复核。脚本结果是候选，不是最终真相；每条必须给 `verdict`。

## 合法模式

- DB enum 真源：只在 `apps/backend/prisma/schema/*.prisma` 手写。
- DB enum 生成产物：`packages/shared/src/generated/prisma-enums.ts`，文件头应标记 generated，禁止手改。
- DB enum values：用 `Object.values(PrismaEnum)` 派生，例如：
  ```typescript
  import { TaskRunStatus } from '../generated/prisma-enums'

  export const TASK_RUN_STATUS_VALUES = Object.values(TaskRunStatus) as TaskRunStatus[]
  ```
- 非 DB 枚举：不存在于 Prisma schema 时，可在 shared 统一定义（如 `packages/shared/src/constants/backend-enums.ts`）或模块私有 enum 文件定义；同一语义不得在 DTO、service、controller 中重复字面量数组。
- 组合视图枚举：可以由 DB enum 成员加少量业务状态组合而成，但必须显式从 DB enum 引用已有成员，不要复制 DB enum 全量字面量。

## 违规模式

```typescript
// DB enum 已存在于 Prisma schema，又在业务代码重写
export enum TaskRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
}
```

```typescript
// 本地重复 Prisma enum values
export const TASK_RUN_STATUS_VALUES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED'] as const
```

```typescript
// DTO/Swagger 重复字面量
@ApiProperty({ enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED'] })
status!: string
```

## 修复准则

- **DB enum 新增/变更**：只改 Prisma schema，创建迁移，再运行项目枚举生成命令（常见为 `pnpm run generate:enums` 或仓库约定脚本）。
- **业务代码使用 DB enum**：从 shared 生成产物或 shared 统一出口导入，禁止重新定义。
- **需要 values 数组**：在 shared 常量层用 `Object.values(PrismaEnum)` 派生，然后业务代码 import 该数组。
- **Swagger enum**：引用生成枚举或 shared values，不手写字符串数组。
- **非 DB enum 被多处复制**：抽到 shared 或模块唯一 enum 文件；DTO/service/controller 只 import。
- **生成产物过期**：运行生成命令，确认 `packages/shared/src/generated/prisma-enums.ts` 与 Prisma schema 同步。

## 复核原则

- 名称匹配但值不匹配：标 `needs-review`，确认是不是同名不同语义；不要直接改。
- 值集合是 Prisma enum 子集：多数是视图状态/筛选条件，只有在语义确认为同一 DB enum 时才报 `real`。
- 非 DB enum：脚本可能不报或只报候选；人工检查是否存在重复定义与是否适合提升到 shared。
- 生成产物下的重复结构不算违规，除非缺少 generated 标记或内容与 schema 不一致。

## 返回给主 agent 的 findings

`total` 是脚本候选命中数；`real_total` 是复核后真违规数。每条 violation 必须带 `verdict`。

```json
{
  "dimension": "enum-single-source",
  "infra_status": {"prisma_schema_enums": 0, "generated_prisma_enums": false, "generation_script": false},
  "total": 0,
  "real_total": 0,
  "by_rule": {
    "db-enum-redeclared": 0,
    "db-enum-values-duplicated": 0,
    "swagger-db-enum-literal": 0,
    "db-enum-imported-from-prisma-client": 0,
    "generated-prisma-enum-missing": 0,
    "generated-prisma-enum-stale": 0
  },
  "violations": [
    {
      "file": "",
      "line": 0,
      "rule": "",
      "symbol": "",
      "prisma_enum": "",
      "verdict": "real|false-positive|needs-review",
      "note": ""
    }
  ]
}
```
