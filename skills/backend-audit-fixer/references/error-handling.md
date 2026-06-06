# 维度：错误处理（error-handling）

脚本：`scripts/error_handling_audit.py`。规则来源：`ruler/conventions.md` §9 统一错误码。

先判断是否已具备统一错误处理基础设施，再扫业务代码是否绕过 `DomainException` / `ErrorCode`。默认只输出审计+建议，用户明确要求才自动修复。

## 扫描范围

脚本不预设路径，需 `--src-dir` / `--e2e-dir` 显式传入。以下始终排除：
单测 `*.spec.ts`/`*.test.ts`/`*.e2e-spec.ts`；测试辅助 `*.mock.ts`/`*.stub.ts`/`*.fixture.ts`/`fixtures/`/`test-utils/`/`testing/`/`__tests__/`；基础设施 `*/filters/`/`prisma/`/`scripts/`；异常定义 `*.exception.ts`；入口 `main.ts`。

仅用户**明确要求**评估测试债务时才传 `--e2e-dir` + `--scope e2e`。

## 运行

步骤 0 先探索项目（识别生产代码与测试目录，monorepo 多服务各传一个 `--src-dir`）。

```bash
SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"
python "$SKILL_HOME/backend-audit-fixer/scripts/error_handling_audit.py" \
  --workspace "$PWD" \
  --src-dir apps/backend/src \
  --output-json /tmp/audit-error.json
```

仅在用户要求时审计测试代码：`--e2e-dir apps/backend/e2e --scope e2e`。

## 识别四类问题

1. 直接实例化 Nest 标准异常（`BadRequestException`、`HttpException` 等）。
2. `throw new Error(...)` 或 `Promise.reject(new Error(...))`。
3. 直接 `new DomainException(...)` 但 payload 未显式带 `code`。
4. `DomainException` 直接返回中文 message。

## 合法 raw-error 判定（强制复核，别原样转发脚本结果）

脚本 `raw-error` 规则误报率极高（实测一次 18 命中，复核后 17 个是误报）。**每条 `raw-error` 命中必须打开源码定位，按下表判定 `real` 还是 `false-positive`，禁止把脚本命中直接当 violation 报、禁止给误报写"建议改 XXX"。** 下列模式属合法 raw-error，不算违规：

| 合法模式 | 识别特征 | 实例 |
|---------|---------|------|
| 本地 catch 控制流 | `try` 内 `throw new Error` 紧接着被**同函数本地 `catch`** 捕获（吞掉 / 返回 null / 重试下一候选），不向 HTTP 上抛 | metadata 解析校验后 `catch { return null }`；候选循环 `lastError` 重试 |
| 内部不变量断言 | programmer invariant / 生命周期断言，触发即代码 bug，非用户可达业务错误 | `called before onModuleInit`、`Character missing in RequestContext`、`rows must match delete window`、启动期常量自检 |
| 运维脚本/非 HTTP 路径 | backfill、dry-run、CLI、Cron 等非 HTTP 业务请求路径的参数/SOP 校验 | `backfill window exceeds max`、`refuse to overwrite missing row` |
| 控制流信号 | `Promise.race` 超时、迭代终止等把 Error 当信号用，非异常上抛 | `setTimeout(() => reject(new Error('timeout')))` |

真违规特征：**走 HTTP 业务请求路径（Controller→Service→Repository）、资源不存在 / 参数非法 / 状态冲突等用户可达错误、错误会冒泡到响应**。这类才报 `real` 并建议领域异常。

`domain-exception-missing-code` 同样要复核：若 `code` 是变量（如 `classify400()` 返回值）赋给 payload，脚本静态匹配不到但实际带了 code，属误报。

## 修复准则（优先级固定）

1. **优先复用现有领域异常**：模块 `exceptions/` 已有语义匹配类直接复用。
2. **缺少则新增领域异常类**：在模块 `exceptions/` 下继承 `DomainException`，构造函数显式指定 `ErrorCode`，上下文放 `args`（不写死文案到 message），补最小单测。
3. **临时直接用 DomainException**：仅在未抽专用类但必须推进时；payload 必含 `code`，`args` 保留排障上下文。
4. **基础设施缺失判断**：无 `DomainException`/`ErrorCode` → 先补基础设施，别发散新增几十个本地异常；有 `DomainException` 无统一 `ErrorCode` → 先统一错误码源；有类有码缺结构化输出链路 → 先补过滤器/输出映射，保证 `code`/`args`/`requestId` 稳定透出。

详见 [error-handling-standard.md](./error-handling-standard.md) 与 [error-handling-foundation-bootstrap.md](./error-handling-foundation-bootstrap.md)。

## 注意

- 明确区分 `src` 与 `e2e` 命中数量，别让测试噪音淹没生产风险。
- 脚本结果与实际不一致时，抽样打开命中文件复核，别当绝对真相。
- **每条命中必带 `verdict`**：`real`（已开源码确认走 HTTP 业务路径、用户可达错误）或 `false-positive`（命中"合法 raw-error 判定"表任一模式，`note` 写明哪类）。未开源码确认不准报 `real`。

## 返回给主 agent 的 findings

`total` 是脚本原始命中数；`real_total` 是复核后真违规数。两者都要给，让主 agent 看到误报比例。

```json
{
  "dimension": "error-handling",
  "infra_status": {"DomainException":false,"ErrorCode":false,"filter":false},
  "src": {"total":0,"real_total":0,"by_rule":{}},
  "e2e": {"total":0,"real_total":0,"by_rule":{}},
  "violations": [{"file":"","scope":"src","rule":"","line":0,"verdict":"real|false-positive","note":"real 写建议领域异常；false-positive 写命中哪类合法模式"}]
}
```
