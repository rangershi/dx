# 分页标准参考

## 请求 DTO 标准

```typescript
import { BasePaginationRequestDto } from '@/common/dto/base.pagination.request.dto'

export class ListItemsDto extends BasePaginationRequestDto {
  // 额外查询参数
}
```

## 响应 DTO 标准

```typescript
import { BasePaginationResponseDto } from '@/common/dto/base.pagination.response.dto'
import { ItemResponseDto } from './item.response.dto'

export class ItemPaginationResponseDto extends BasePaginationResponseDto<ItemResponseDto> {
  @ApiProperty({
    description: '数据列表',
    type: ItemResponseDto,
    isArray: true,
  })
  items: ItemResponseDto[]
}
```

## 工厂写法

```typescript
export const ItemPaginationResponseDto =
  BasePaginationResponseDto.createPaginationResponseDto(ItemResponseDto)
```

## 典型反例

```typescript
export class CustomListResponseDto {
  data: Item[]
  total: number
  pageSize: number
  currentPage: number
}
```

```typescript
return {
  items: results,
  total: count,
  page: query.page,
  limit: query.limit,
}
```

## 修复建议

- 自定义分页 DTO：改为继承 `BasePaginationResponseDto`
- 手工返回对象：替换为统一分页 DTO 实例或工厂产物
- 请求参数 DTO：改为继承 `BasePaginationRequestDto`
- OpenAPI 注解：补齐 `items` 的具体类型注解

## 兼容策略

- 历史字段为 `data` 时，优先评估是否允许切换为 `items`
- 若短期不能切换，保留兼容字段并在代码中显式注释过渡原因
- 不要一边保留旧字段，一边继续新增新的手工分页结构
