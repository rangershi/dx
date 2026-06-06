# 维度：分页 DTO（pagination-dto）

脚本：`scripts/pagination_dto_audit.py`。规则来源：`ruler/conventions.md` §12 分页响应约定。

先识别非标准分页 DTO 和手工分页返回，再按统一基类改造。脚本输出为问题清单真值源。

## 运行

```bash
SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"
python "$SKILL_HOME/backend-audit-fixer/scripts/pagination_dto_audit.py" \
  --workspace /Users/a1/work/ai-monorepo \
  --output-json /tmp/audit-pagination.json
```

## 执行流程

1. 扫 `apps/backend/src/**/*.ts`，必要时 `--include-glob` 扩范围。
2. 识别三类：
   - 请求 DTO 声明 `page/limit/pageSize/currentPage` 但未继承 `BasePaginationRequestDto`
   - 响应 DTO 命中 `items/data/total/page/limit/pageSize/currentPage` 但未继承 `BasePaginationResponseDto`
   - Controller/Service/UseCase 直接 `return { ... }` 手工拼装分页结构
3. 对照 [pagination-standard.md](./pagination-standard.md) 修复。
4. 保持接口兼容；历史非标准字段名显式说明保留/转换策略。
5. 复扫确认。

## 修复准则

- 请求 DTO：继承 `BasePaginationRequestDto`，仅保留额外查询参数。
- 响应 DTO：改 `extends BasePaginationResponseDto<ItemResponseDto>`。
- 返回构造：在 **Controller 层** `new BasePaginationResponseDto(total, page, limit, items)`；Service/Repository 只返回 `{ total, items }` 等原始对象。
- 装饰器：用 `@ApiOkResponsePaginated(ItemDto)`，禁止手动 `@ApiExtraModels(BasePaginationResponseDto, ...)`。
- 兼容：线上依赖 `data/currentPage/pageSize` 时过渡期显式映射，不静默删字段。

> 注意：`ruler/conventions.md` §12 已禁用 `createPaginationResponseDto` 动态工厂与 `*PaginationResponseDto` 子类。修复一律走 `new BasePaginationResponseDto(...)` + `@ApiOkResponsePaginated`。

## 判断原则

- 同时出现 `total` 且 `items`/`data`，再叠加 `page/limit/pageSize/currentPage` 任一 → 强分页信号。
- 类名/变量名含 `Pagination`/`Paginated`/`ListResponse`/`PageResult` → 优先人工复核。
- 只是普通列表无总数/页码 → 不归入本维度。

## 返回给主 agent 的 findings

```json
{
  "dimension": "pagination-dto",
  "total": 0,
  "by_rule": {"request-dto":0,"response-dto":0,"manual-return":0},
  "violations": [{"file":"","rule":"","line":0,"note":""}]
}
```
