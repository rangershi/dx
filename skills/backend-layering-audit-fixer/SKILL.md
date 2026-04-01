---
name: backend-layering-audit-fixer
description: Use when backend、NestJS 分层架构或事务规范审查中，需要检查 Service 是否绕过 Repository 直接访问数据库、Controller 是否跨层注入 Repository、Service 是否伪装 Repository、事务装饰器是否匹配 afterCommit 使用、非 HTTP 场景事务模式是否正确、SSE 端点是否误加事务装饰器、以及是否存在直接 prisma.$transaction() 调用。
---

# 后端三层架构与事务规范合规检查

## 概览

扫描后端代码是否遵守 **Controller → Service → Repository** 三层架构约束及事务规范。默认只输出审计结果和修复建议；用户明确要求时才自动修复。

规则来源：`ruler/conventions.md` 第 4 节 "NestJS/Prisma 约定" + 第 5 节 "事务规范"。

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
| T3 | 直接 `prisma.$transaction()` | 绕过 `TransactionHost` 抽象，直接调用 `prisma.$transaction()` |
| T4 | SSE/流式端点加事务装饰器 | `@Sse()` 或流式返回的方法上使用了 `@Transactional()` / `@TransactionalWithAfterCommit()`（会导致 afterCommit 提前排空） |
| T5 | 非 HTTP 场景事务模式错误 | Subscriber/Scheduler 使用了 `@Transactional()` 装饰器而非 `txHost.withTransaction()` 或 `txEvents.withAfterCommit()` |
| T6 | 非 HTTP 场景缺少 CLS 作用域 | Scheduler 调用 `txHost.withTransaction()` 前未用 `cls.run()` 创建 CLS 作用域 |

## 审计命令

**分层架构扫描（并行执行）：**

```bash
# L1 + L2 + L3：Service 注入 PrismaService
rg "PrismaService" apps/backend/src/modules --glob '*.service.ts' -l

# L2：Service 含 Repository 模式
rg "getClient|txHost\.tx" apps/backend/src/modules --glob '*.service.ts' -l

# L4：Controller 注入 Repository
rg "Repository" apps/backend/src/modules --glob '*.controller.ts' -l
```

**事务规范扫描（并行执行）：**

```bash
# T1：找出所有只用 @Transactional() 的 Controller 方法（排除 @TransactionalWithAfterCommit）
rg "@Transactional\(\)" apps/backend/src/modules --glob '*.controller.ts' -l

# T2：Service 违规传播类型
rg "Propagation\.(Required|RequiresNew|Nested)" apps/backend/src/modules --glob '*.service.ts' -l

# T3：直接 prisma.$transaction()
rg "prisma\.\$transaction" apps/backend/src/modules -l

# T4：SSE 端点是否带事务装饰器（需人工确认上下文）
rg "@Sse\(\)" apps/backend/src/modules --glob '*.controller.ts' -l

# T5：Subscriber/Scheduler 误用 @Transactional 装饰器
rg "@Transactional" apps/backend/src/modules --glob '*.subscriber.ts' --glob '*.task.ts' --glob '*.scheduler*.ts' -l

# T6：Scheduler 使用 txHost.withTransaction 但未包 cls.run
rg "txHost\.withTransaction" apps/backend/src/modules --glob '*.scheduler*.ts' --glob '*.task.ts' -l
```

## 执行流程

1. 执行上述审计命令，收集命中文件列表
2. **分层检查**：对每个命中文件，读取构造函数和使用处，判定违规类型：
   - 注入了 `PrismaService` 且有 `this.prisma.*` 调用 → **L1**
   - 注入了 `PrismaService`/`txHost` 且有 `getClient()` → **L2**
   - 注入了 `PrismaService` 但无任何 `this.prisma.*` 调用 → **L3**
   - Controller 文件 import/注入 Repository → **L4**
3. **事务检查**：
   - T1：对只用 `@Transactional()` 的 Controller，追踪其调用的 Service 方法，检查是否存在 `txEvents.afterCommit()` 调用
   - T2：直接匹配即违规
   - T3：直接匹配即违规
   - T4：对 `@Sse()` 方法，检查同一方法上是否有事务装饰器
   - T5：直接匹配即违规（Subscriber/Scheduler 不应用装饰器声明事务）
   - T6：对命中文件，检查 `txHost.withTransaction()` 调用是否在 `cls.run()` 回调内部
4. 输出审计报告（按模块分组，标注违规类型和行号）
5. 仅当用户明确要求修复时，才执行修复

## 修复策略

### 分层架构

**L1：Service 直接访问数据库**
- 将数据库查询逻辑提取到对应 Repository（新建或复用已有）
- Service 改为注入 Repository 调用

**L2：Service 伪装为 Repository**
- 重命名文件为 `*.repository.ts`，类名改为 `*Repository`
- 更新所有引用（import、Module providers、注入处）
- 确认 Service 层消费者改为注入新 Repository

**L3：Service 死依赖**
- 移除构造函数中 `PrismaService` 注入
- 移除对应 import 语句
- 运行 lint 确认无残留

**L4：Controller 跨层调用**
- Controller 中的 Repository 调用下沉到 Service
- Controller 改为调用 Service 方法

### 事务规范

**T1：afterCommit 未被排空**
- 将 Controller 方法的 `@Transactional()` 改为 `@TransactionalWithAfterCommit()`
- 或确认调用链中确实不存在 `afterCommit()` 回调（则无需修改）

**T2：Service 违规传播类型**
- 改为 `Propagation.Mandatory`（必须在事务中调用）或 `Propagation.Supports`（有事务则加入）
- 事务边界上移到 Controller 层

**T3：直接 `prisma.$transaction()`**
- 改用 `txHost.withTransaction()` 或由 Controller 层 `@Transactional()` 声明事务边界
- Repository 内通过 `txHost.tx` 自动参与事务

**T4：SSE/流式端点加事务装饰器**
- 移除事务装饰器
- 如需事务操作，在流式逻辑内部用 `cls.run()` + `txHost.withTransaction()` 局部处理

**T5：非 HTTP 场景误用 @Transactional 装饰器**
- Subscriber：改用 `txEvents.withAfterCommit()` 包裹处理逻辑
- Scheduler/Task：改用 `cls.run()` + `txHost.withTransaction()`

**T6：非 HTTP 场景缺少 CLS 作用域**
- 在 `txHost.withTransaction()` 外层包裹 `cls.run()`：
  ```typescript
  await this.cls.run(async () => {
    await this.txHost.withTransaction(async () => { /* ... */ })
  })
  ```

## 排除项

以下场景不视为违规：
- `*.repository.ts` 文件中使用 `PrismaService` / `getClient()` / `txHost`（Repository 正常职责）
- `prisma/` 目录下的基础设施文件（`prisma.service.ts` 等）
- `common/` 目录下的事务基础设施（`TransactionEventsService`、`AfterCommitInterceptor` 等）
- `*.spec.ts` / `e2e/` 测试文件
- Subscriber / Scheduler 中通过 `txHost.withTransaction()` 管理事务（正确模式，但其中数据库查询仍应走 Repository）

## 审计报告模板

```
## 后端分层架构与事务规范审计报告

### 违规汇总

**分层架构：**
- L1（Service 直接访问 DB）：N 处
- L2（Service 伪装 Repository）：N 处
- L3（Service 死依赖）：N 处
- L4（Controller 跨层调用）：N 处

**事务规范：**
- T1（afterCommit 未被排空）：N 处
- T2（Service 违规传播类型）：N 处
- T3（直接 prisma.$transaction）：N 处
- T4（SSE 端点加事务装饰器）：N 处
- T5（非 HTTP 场景误用装饰器）：N 处
- T6（非 HTTP 缺少 CLS 作用域）：N 处

### 详细列表

#### [模块名]
| 文件 | 违规类型 | 行号 | 说明 |
|------|----------|------|------|
| ... | L1 | 39 | `this.prisma.user.findMany()` |
| ... | T1 | 85 | `@Transactional()` 但调用链含 `afterCommit()` |
```
