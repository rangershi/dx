# 错误处理规范参考

## 目标

后端业务代码抛出异常时，应统一接入 `DomainException` / `ErrorCode` 体系，避免直接抛出字符串化的 Nest 标准异常或裸 `Error`，以保证：

- 前端可稳定依赖 `error.code`
- 日志具备结构化 `args`
- 请求链路可透出 `requestId`
- 模块内异常语义可复用

## 默认排除范围

- `apps/backend/src/common/exceptions/**/*.ts`
- `apps/backend/src/common/filters/**/*.ts`
- `apps/backend/src/main.ts`
- `*.spec.ts`

说明：

- 领域异常定义文件允许继承和封装 Nest 异常能力
- 全局过滤器允许直接接触 Nest 异常
- `main.ts` 中的 `ValidationPipe` 自定义异常通常属于框架接线层

## 检测规则

### 1. 直接实例化 Nest 标准异常

命中对象：

- `BadRequestException`
- `UnauthorizedException`
- `ForbiddenException`
- `NotFoundException`
- `HttpException`
- `InternalServerErrorException`

通常表示业务语义绕过了领域异常体系。

### 2. 直接创建 Error

命中对象：

- `throw new Error(...)`
- `Promise.reject(new Error(...))`

这类写法通常无法提供稳定错误码，也不利于结构化日志。

### 3. DomainException 缺少 code

命中对象：

- `new DomainException(...)` 但 payload 未显式声明 `code`

即使暂时不抽专用异常类，也必须提供 `ErrorCode`。

### 4. DomainException 直接返回中文 message

命中对象：

- `DomainException(...)` 中直接出现中文 message

后端不应直接决定面向用户的中文文案。优先返回稳定错误码，由前端或上层映射展示。

## 修复优先级

1. 复用现有模块异常类
2. 新增模块领域异常类
3. 临时直接使用 `DomainException`

## 正反例

### 错误示例

```typescript
throw new BadRequestException('余额不足, 请充值')
```

```typescript
throw new Error('wallet not found')
```

```typescript
throw new DomainException('余额不足')
```

### 正确示例：复用模块异常

```typescript
throw new InsufficientBalanceException({
  currentBalance: wallet.available,
  requestedAmount: dto.amount,
  isFromFreeze: false,
})
```

### 正确示例：临时直接使用 DomainException

```typescript
throw new DomainException('wallet.insufficient_balance', {
  code: ErrorCode.WALLET_INSUFFICIENT_BALANCE,
  args: {
    currentBalance: wallet.available,
    requestedAmount: dto.amount,
  },
})
```

## 建议替换策略

### BadRequestException

- 参数校验类错误：优先看是否属于框架输入校验层
- 业务校验类错误：优先替换为模块领域异常

### NotFoundException

- 若资源查找失败属于明确业务语义，替换为 `XxxNotFoundException`

### ForbiddenException / UnauthorizedException

- 若表达的是业务权限或业务身份限制，替换为模块异常
- 若是认证框架本身的接入层，可保留在边界层

### HttpException

- 一般视为待治理项，优先改成领域异常或统一异常封装

### Error

- 原则上应全部迁移到领域异常或基础设施异常

## 输出建议模板

每个命中项建议包含：

- 文件路径
- 行号
- 问题类型
- 当前写法
- 推荐替换方式
- 是否可复用已有异常类
- 若不可复用，建议新增的异常类名

## 何时不要直接修

- 仓库尚未定义 `DomainException`
- 仓库没有统一 `ErrorCode`
- 现有全局过滤器不会透出 `code` / `args` / `requestId`
- 当前模块不存在异常目录，且团队尚未确认命名规范

遇到以上情况，先转向基础设施补齐。
