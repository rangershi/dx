# 维度：后端三层架构与事务规范（backend-layering）

无脚本维度。subagent 跑 rg + 读命中代码判定。规则来源：`ruler/conventions.md` §4 NestJS/Prisma + §5/§6 事务规范。

默认只输出审计结果与修复建议；用户明确要求时才自动修复。

## 检查项

### 分层架构

| 编号 | 违规类型 | 说明 |
|------|----------|------|
| L1 | Service 直接访问数据库 | Service 注入 `PrismaService` 并调用 `this.prisma.*` |
| L2 | Service 伪装为 Repository | Service 文件含 `getClient()` / `txHost.tx` 模式，实质是 Repository |
| L3 | Service 死依赖 | Service 注入 `PrismaService` 但从未使用 |
| L4 | Controller 跨层调用 | Controller 直接注入 Repository |

### 事务规范

| 编号 | 违规类型 | 说明 |
|------|----------|------|
| T1 | afterCommit 未被排空 | Controller 用 `@Transactional()` 但调用链中存在 `txEvents.afterCommit()` 回调（应改用 `@TransactionalWithAfterCommit()`） |
| T2 | Service 违规传播类型 | Service 使用 `Propagation.Required` / `RequiresNew` / `Nested`（禁止 Service 自行创建事务） |
| T3 | 直接 `prisma.$transaction()` | 绕过 `TransactionHost` 抽象 |
| T4 | SSE/流式端点加事务装饰器 | `@Sse()` 或流式返回方法上有事务装饰器（会导致 afterCommit 提前排空） |
| T5 | 非 HTTP 场景事务模式错误 | Subscriber/Scheduler 用 `@Transactional()` 而非 `txHost.withTransaction()` / `txEvents.withAfterCommit()` |
| T6 | 非 HTTP 场景缺少 CLS 作用域 | Scheduler 调 `txHost.withTransaction()` 前未用 `cls.run()` 创建 CLS 作用域 |

## 审计命令（并行执行）

```bash
# L1+L2+L3：Service 注入 PrismaService
rg "PrismaService" apps/backend/src/modules --glob '*.service.ts' -l
# L2：Service 含 Repository 模式
rg "getClient|txHost\.tx" apps/backend/src/modules --glob '*.service.ts' -l
# L4：Controller 注入 Repository
rg "Repository" apps/backend/src/modules --glob '*.controller.ts' -l
# T1：只用 @Transactional() 的 Controller 方法
rg "@Transactional\(\)" apps/backend/src/modules --glob '*.controller.ts' -l
# T2：Service 违规传播类型
rg "Propagation\.(Required|RequiresNew|Nested)" apps/backend/src/modules --glob '*.service.ts' -l
# T3：直接 prisma.$transaction()
rg "prisma\.\$transaction" apps/backend/src/modules -l
# T4：SSE 端点
rg "@Sse\(\)" apps/backend/src/modules --glob '*.controller.ts' -l
# T5：Subscriber/Scheduler 误用 @Transactional
rg "@Transactional" apps/backend/src/modules --glob '*.subscriber.ts' --glob '*.task.ts' --glob '*.scheduler*.ts' -l
# T6：Scheduler 用 txHost.withTransaction 但未包 cls.run
rg "txHost\.withTransaction" apps/backend/src/modules --glob '*.scheduler*.ts' --glob '*.task.ts' -l
```

## 判定流程

1. 跑审计命令收集命中文件。
2. 分层：读构造函数+使用处判定：
   - 注入 `PrismaService` 且有 `this.prisma.*` → **L1**
   - 注入 `PrismaService`/`txHost` 且有 `getClient()` → **L2**
   - 注入 `PrismaService` 但无任何 `this.prisma.*` → **L3**
   - Controller import/注入 Repository → **L4**
3. 事务：
   - T1：对只用 `@Transactional()` 的 Controller，追踪其调用的 Service 方法是否存在 `txEvents.afterCommit()`
   - T2/T3/T5：直接匹配即违规
   - T4：对 `@Sse()` 方法查同方法上是否有事务装饰器
   - T6：查 `txHost.withTransaction()` 是否在 `cls.run()` 回调内部
4. 输出报告（按模块分组，标违规类型+行号）。

## 修复策略

- **L1**：DB 查询逻辑提取到 Repository，Service 改注入 Repository。
- **L2**：文件重命名 `*.repository.ts`，类名 `*Repository`，更新所有引用与 Module providers。
- **L3**：移除构造函数 `PrismaService` 注入及 import，跑 lint 确认无残留。
- **L4**：Repository 调用下沉到 Service，Controller 改调 Service。
- **T1**：`@Transactional()` → `@TransactionalWithAfterCommit()`（或确认无 afterCommit 则不改）。
- **T2**：改 `Propagation.Mandatory` 或 `Supports`，事务边界上移到 Controller。
- **T3**：改 `txHost.withTransaction()` 或由 Controller `@Transactional()` 声明边界。
- **T4**：移除装饰器；如需事务在流式逻辑内用 `cls.run()` + `txHost.withTransaction()` 局部处理。
- **T5**：Subscriber → `txEvents.withAfterCommit()`；Scheduler/Task → `cls.run()` + `txHost.withTransaction()`。
- **T6**：外层包 `cls.run()`：
  ```typescript
  await this.cls.run(async () => {
    await this.txHost.withTransaction(async () => { /* ... */ })
  })
  ```

## 排除项

- `*.repository.ts` 使用 `PrismaService` / `getClient()` / `txHost`（Repository 正常职责）
- `prisma/` 基础设施文件（`prisma.service.ts` 等）
- `common/` 事务基础设施（`TransactionEventsService`、`AfterCommitInterceptor` 等）
- `*.spec.ts` / `e2e/` 测试文件
- Subscriber/Scheduler 中通过 `txHost.withTransaction()` 管理事务（正确模式）

## 返回给主 agent 的 findings

```json
{
  "dimension": "backend-layering",
  "infra_status": "n/a",
  "total": 0,
  "by_rule": {"L1":0,"L2":0,"L3":0,"L4":0,"T1":0,"T2":0,"T3":0,"T4":0,"T5":0,"T6":0},
  "violations": [{"file":"","rule":"L1","line":0,"note":""}]
}
```
