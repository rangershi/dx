# 错误处理基础设施补齐指南

## 适用场景

当项目执行错误处理规范审计时，若发现缺少以下任一基础设施，应先补齐，再推进大规模业务修复：

- `DomainException`
- `ErrorCode`
- 领域异常目录约定
- 全局异常过滤器或统一错误输出链路

## 最小可用基础设施

### 1. DomainException

需要具备：

- 统一异常基类
- 接收稳定 `messageKey` 或内部 message
- payload 至少支持：
  - `code`
  - `args`
  - `cause`
  - 可扩展的 `meta`

### 2. ErrorCode

需要具备：

- 集中定义的枚举或常量集
- 可按模块分组命名
- 命名稳定，不直接耦合中文文案

示例命名：

- `WALLET_INSUFFICIENT_BALANCE`
- `USER_NOT_FOUND`
- `AUTH_LOGIN_EXPIRED`

### 3. 模块异常目录

推荐：

- 每个业务模块使用 `exceptions/` 目录
- 每个异常类表达单一明确业务语义
- 不在 Service 里散落大量 `new DomainException(...)`

### 4. 全局异常过滤器

输出应至少包含：

- `code`
- `message`
- `args`
- `requestId`
- `timestamp`
- `path`

如果现有过滤器只输出字符串 message，需要先升级输出结构。

## 推荐补齐顺序

1. 建立 `ErrorCode`
2. 建立 `DomainException`
3. 建立全局异常过滤器输出契约
4. 在一个模块内先试点 1 到 2 个领域异常类
5. 再批量治理业务代码中的裸异常

## 迁移原则

- 先收敛契约，再批量替换调用点
- 先在高频模块试点，再扩散到全仓
- 保持旧错误响应的兼容窗口，避免前端瞬间失配
- 中文文案不要直接塞进后端异常 message，优先使用 code + args

## 自动修复前的门槛

只有在以下条件满足时，才适合让 AI 直接批量修代码：

- `DomainException` 已可复用
- `ErrorCode` 已有统一来源
- 全局过滤器已能稳定透出结构化字段
- 模块异常类命名规则已经明确

否则默认只给建议，不默认改业务代码。
