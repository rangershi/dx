---
name: error-handling-audit-fixer
description: Use when backend、NestJS、领域异常治理或错误处理审查中，需要检查业务代码是否绕过 DomainException / ErrorCode 体系，区分生产代码与 E2E 测试中的异常写法，识别直接抛出 BadRequestException、HttpException、Error 或直接返回中文 DomainException，并在项目缺少统一异常基础设施时给出补齐路径。
---

# 错误处理规范检查与修复建议

## 概览

先判断项目是否已经具备统一错误处理基础设施，再扫描业务代码是否绕过 `DomainException` / `ErrorCode` 体系。默认只输出审计结果和修复建议，不自动改代码；只有用户明确要求时才进入自动修复。

## 快速开始

1. 先审计生产代码：

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
python "$CODEX_HOME/skills/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --scope src
```

2. 再按需审计 E2E 或全量：

```bash
python "$CODEX_HOME/skills/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --scope all \
  --output-json /tmp/error-handling-audit.json
```

3. 当项目尚未具备 `DomainException` / `ErrorCode` / 领域异常目录等基础设施时，先阅读 [references/foundation-bootstrap.md](./references/foundation-bootstrap.md) 再决定是否补齐。

4. 当项目基础设施齐全但出现违规抛错时，按 [references/error-handling-standard.md](./references/error-handling-standard.md) 给出替换建议；如用户明确要求，才实施自动修复。

5. 当结果里 `e2e/raw-error` 数量很大时，不要直接把它和生产代码风险混在一起汇报；先给 `src` 结论，再决定是否单独治理 `e2e`。

## 执行流程

1. 默认先扫描 `apps/backend/src`，只有在用户明确要求或需要评估测试债务时再扫描 `apps/backend/e2e`。
2. 先判断基础设施状态：
   - 是否存在 `DomainException`
   - 是否存在 `ErrorCode`
   - 是否存在领域异常目录或模块异常类
   - 是否存在全局异常过滤器或结构化错误输出链路
3. 再识别四类问题：
   - 直接实例化 Nest 标准异常，如 `BadRequestException`、`HttpException`
   - `throw new Error(...)` 或 `Promise.reject(new Error(...))`
   - 直接 `new DomainException(...)` 但 payload 中未显式带 `code`
   - `DomainException` 直接返回中文 message
4. 对每个命中项给出修复建议，优先级固定如下：
   - 优先复用现有模块异常类
   - 其次建议在模块 `exceptions/` 目录新增领域异常类
   - 最后才允许直接使用 `DomainException`，且必须补齐 `code` 与 `args`
5. 若基础设施缺失，不直接把全部命中项定性为“应立刻改业务代码”，而是先输出“需补齐基础设施”的诊断与最小落地路径。
6. 只有在用户明确说“自动修复”“直接改”或等价表述时，才进入落代码阶段。
7. 若脚本结果与实际代码不一致，必须抽样打开命中文件复核，不要把脚本结果当成绝对真相。

## 审计命令

项目具备 ripgrep 时，可先用下列命令快速复核：

```bash
rg "new (BadRequestException|UnauthorizedException|ForbiddenException|NotFoundException|HttpException|InternalServerErrorException)\(" \
  apps/backend/src apps/backend/e2e \
  --glob '!*spec.ts' \
  --glob '!*exception.ts' \
  --glob '!apps/backend/src/common/filters/**' \
  --glob '!apps/backend/src/main.ts'
```

```bash
rg "new Error\(" apps/backend/src apps/backend/e2e --glob '!*spec.ts'
```

```bash
rg "new DomainException\([^)]*$" -A3 apps/backend/src
```

```bash
rg "DomainException\([^)]*[\u4e00-\u9fa5]" apps/backend/src apps/backend/e2e \
  --glob '!*spec.ts' \
  --glob '!apps/backend/src/common/exceptions/**'
```

如果只想快速看生产代码，可优先改成：

```bash
python "$CODEX_HOME/skills/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --scope src
```

如果只想看 E2E 存量问题，可改成：

```bash
python "$CODEX_HOME/skills/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --scope e2e
```

## 修复准则

### 1. 优先复用现有领域异常

- 若模块 `exceptions/` 已有语义匹配的异常类，直接复用。
- 不要把已可表达为领域异常的问题继续保留成裸 `BadRequestException('字符串')`。

### 2. 缺少模块异常时新增领域异常类

- 在模块 `exceptions/` 下新增异常类。
- 异常类继承统一 `DomainException`。
- 构造函数中显式指定 `ErrorCode`。
- 把上下文放进 `args`，不要把业务文案直接写死到 message。
- 为新增异常补最小单测。

### 3. 临时直接使用 DomainException

- 仅在尚未抽出专用异常类、但当前修复必须继续推进时使用。
- payload 中必须显式包含 `code`。
- `args` 中必须保留排障所需上下文。

### 4. 基础设施缺失时的判断

- 如果仓库里根本没有 `DomainException` 或 `ErrorCode`，优先建议补基础设施，不要直接发散式新增几十个本地异常实现。
- 如果已有 `DomainException` 但没有统一 `ErrorCode`，先统一错误码来源，再扩展模块异常。
- 如果已有异常类与错误码，但缺少结构化输出链路，优先补过滤器或输出映射，保证 `code`、`args`、`requestId` 可稳定透出。

## 输出要求

执行这个技能时，最终输出至少包含：

1. 基础设施状态
2. 命中文件清单
3. 每个问题的类型、定位与建议替换方式
4. 是否可复用现有领域异常
5. 是否需要先补齐基础设施
6. 若用户要求自动修复，列出拟修改文件、验证方式与剩余风险

补充要求：

7. 明确区分 `src` 与 `e2e` 命中数量，避免测试噪音淹没生产代码风险
8. 标注哪些命中是脚本结果、哪些已经过源码抽样复核
9. 若脚本疑似误报，要在结论里明确说明“脚本规则限制”而不是直接要求改代码

## 资源

- 扫描脚本：`scripts/error_handling_audit.py`
- 规范参考：`references/error-handling-standard.md`
- 基础设施补齐指南：`references/foundation-bootstrap.md`
