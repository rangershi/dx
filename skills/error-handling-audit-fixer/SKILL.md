---
name: error-handling-audit-fixer
description: Use when backend、NestJS、领域异常治理或错误处理审查中，需要检查业务代码是否绕过 DomainException / ErrorCode 体系，区分生产代码与 E2E 测试中的异常写法，识别直接抛出 BadRequestException、HttpException、Error 或直接返回中文 DomainException，并在项目缺少统一异常基础设施时给出补齐路径。
---

# 错误处理规范检查与修复建议

## 概览

先判断项目是否已经具备统一错误处理基础设施，再扫描业务代码是否绕过 `DomainException` / `ErrorCode` 体系。默认只输出审计结果和修复建议，不自动改代码；只有用户明确要求时才进入自动修复。

## 扫描范围

脚本不预设任何项目路径，需要通过 `--src-dir` / `--e2e-dir` 显式传入。执行前必须先完成项目探索（见下方步骤 0）。

以下路径/后缀始终排除，不会产生误报：

| 排除类别 | 路径/后缀 |
|----------|-----------|
| 单元测试 | `*.spec.ts`、`*.test.ts`、`*.e2e-spec.ts` |
| 测试辅助 | `*.mock.ts`、`*.stub.ts`、`*.fixture.ts`、`fixtures/`、`test-utils/`、`testing/`、`__tests__/`、`__test__/` |
| 基础设施 | `*/filters/`、`prisma/`、`scripts/` |
| 异常定义 | `*.exception.ts` |
| 入口文件 | `main.ts` |

只有在用户**明确要求**评估测试债务时，才传 `--e2e-dir` + `--scope e2e` 扫描测试代码。

## 快速开始

### 步骤 0：项目探索（每个项目首次执行时必须完成）

在调用脚本前，先探索项目结构，识别出后端生产代码和测试代码的实际路径。方法：

1. 查看项目根目录结构（`ls` 或 Glob）
2. 识别后端应用目录（可能是 `apps/backend/src`、`src`、`server/src` 等）
3. 识别测试目录（可能是 `apps/backend/e2e`、`test`、`e2e`、`__tests__` 等）
4. 如果是 monorepo，可能有多个后端服务，每个都需要单独传 `--src-dir`

典型示例：

| 项目类型 | 生产代码 | 测试代码 |
|----------|----------|----------|
| NestJS monorepo | `apps/backend/src` | `apps/backend/e2e` |
| 单体 NestJS | `src` | `test` 或 `e2e` |
| 多服务 monorepo | `apps/api/src`、`apps/worker/src` | `apps/api/e2e`、`apps/worker/e2e` |

### 步骤 1：审计生产代码

将探索到的路径传给脚本（`--src-dir` 可传多个）：

```bash
SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"
python "$SKILL_HOME/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --src-dir <探索到的生产代码路径>
```

示例（当前项目）：

```bash
python "$SKILL_HOME/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --src-dir apps/backend/src
```

多服务示例：

```bash
python "$SKILL_HOME/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --src-dir apps/api/src \
  --src-dir apps/worker/src
```

### 步骤 2：（仅在用户明确要求时）审计测试代码

```bash
python "$SKILL_HOME/error-handling-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --e2e-dir <探索到的测试代码路径> \
  --scope e2e \
  --output-json /tmp/error-handling-audit.json
```

3. 当项目尚未具备 `DomainException` / `ErrorCode` / 领域异常目录等基础设施时，先阅读 [references/foundation-bootstrap.md](./references/foundation-bootstrap.md) 再决定是否补齐。

4. 当项目基础设施齐全但出现违规抛错时，按 [references/error-handling-standard.md](./references/error-handling-standard.md) 给出替换建议；如用户明确要求，才实施自动修复。

5. 当结果里 `e2e/raw-error` 数量很大时，不要直接把它和生产代码风险混在一起汇报；先给 `src` 结论，再决定是否单独治理 `e2e`。

## 执行流程

1. 默认只扫描 `apps/backend/src`（生产代码）。测试代码、E2E、prisma seed、脚本等非生产路径全部排除。只有在用户明确要求评估测试债务时，才传 `--scope e2e` 扫描测试代码。
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

## 审计命令（rg 快速复核）

以下 rg 命令用于手工复核，将 `<SRC_DIR>` 替换为步骤 0 探索到的实际路径：

```bash
rg "new (BadRequestException|UnauthorizedException|ForbiddenException|NotFoundException|HttpException|InternalServerErrorException)\(" \
  <SRC_DIR> \
  --glob '!*spec.ts' --glob '!*test.ts' \
  --glob '!*exception.ts' \
  --glob '!*/filters/**' \
  --glob '!*main.ts'
```

```bash
rg "new Error\(" <SRC_DIR> --glob '!*spec.ts' --glob '!*test.ts'
```

```bash
rg "new DomainException\([^)]*$" -A3 <SRC_DIR>
```

```bash
rg "DomainException\([^)]*[\u4e00-\u9fa5]" <SRC_DIR> \
  --glob '!*spec.ts' \
  --glob '!*/common/exceptions/**'
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
