---
name: pagination-dto-audit-fixer
description: Use when backend 或 NestJS 接口涉及分页列表，需要检查或修复分页 Request DTO 未继承 BasePaginationRequestDto、分页 Response DTO 未继承 BasePaginationResponseDto、Controller/Service 手工拼装分页返回结构，或需要输出不符合统一分页规范的文件清单并按标准改造。
---

# 分页 DTO 规范检查与修复

## 概览

对后端分页接口执行统一规范审计，先稳定识别非标准分页 DTO 和手工分页返回，再按统一基类完成改造。优先使用随技能提供的扫描脚本作为问题清单真值源，再根据结果实施代码修复。

## 快速开始

1. 先运行扫描脚本：

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
python "$CODEX_HOME/skills/pagination-dto-audit-fixer/scripts/pagination_dto_audit.py" \
  --workspace /Users/a1/work/ai-monorepo
```

2. 需要结构化结果时输出 JSON：

```bash
python "$CODEX_HOME/skills/pagination-dto-audit-fixer/scripts/pagination_dto_audit.py" \
  --workspace /Users/a1/work/ai-monorepo \
  --output-json /tmp/pagination-dto-audit.json
```

3. 根据扫描结果逐项修复，再重新运行扫描确认问题是否消失。

## 执行流程

1. 扫描 `apps/backend/src/**/*.ts`，必要时用 `--include-glob` 扩大范围。
2. 优先识别三类问题：
   - 请求 DTO 自己声明 `page/limit/pageSize/currentPage`，但未继承 `BasePaginationRequestDto`
   - 响应 DTO 命中 `items/data/total/page/limit/pageSize/currentPage` 等分页字段，但未继承 `BasePaginationResponseDto`
   - Controller / Service / UseCase 直接 `return { ... }` 手工拼装分页结构
3. 输出问题清单后，再阅读 [references/pagination-standard.md](./references/pagination-standard.md) 对照修复。
4. 修复时保持接口兼容性；若历史字段名不是标准字段，显式说明保留策略或转换策略。
5. 修复完成后重新扫描，并按项目常规命令补跑测试或最小验证。

## 修复准则

- 请求 DTO：改为继承 `BasePaginationRequestDto`，仅保留额外查询参数。
- 响应 DTO：优先改为 `extends BasePaginationResponseDto<ItemResponseDto>`，或改用工厂 `createPaginationResponseDto(ItemResponseDto)`。
- 返回构造：优先返回统一分页 DTO 实例，不继续在 Controller 中拼 `{ items, total, page, limit }`。
- OpenAPI：补齐 `@ApiProperty`，确保 `items` 的元素类型明确。
- 兼容处理：若线上消费者依赖 `data/currentPage/pageSize`，在过渡期显式映射，不要静默删字段。

## 判断原则

- 同时出现 `total` 且出现 `items` 或 `data`，再叠加 `page/limit/pageSize/currentPage` 中任一字段，可视为强分页信号。
- 若类名或返回变量名包含 `Pagination`、`Paginated`、`ListResponse`、`PageResult`，优先人工复核。
- 若只是普通列表返回且没有总数或页码字段，不归入本技能。

## 输出要求

执行这个技能时，最终输出至少包含：

1. 问题文件清单
2. 每个问题的类型与定位
3. 建议修复方式
4. 已应用的修改与剩余风险

## 资源

- 扫描脚本：`scripts/pagination_dto_audit.py`
- 参考规范：`references/pagination-standard.md`
