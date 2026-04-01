# 修复指南：文件/文件夹重命名与引用更新

## 核心原则

1. **目录优先于文件**：先重命名目录，再处理其下的文件
2. **git mv 保留历史**：所有重命名必须用 `git mv`，不要用 `mv` + `git add`
3. **引用同步更新**：每次重命名后立即更新所有 import/require 引用
4. **增量验证**：每完成一个模块的重命名，立即运行 lint + build 验证

## 修复流程

### Step 1: 目录重命名

目录重命名影响最大，优先处理。

```bash
# 示例：重命名 NestJS 模块目录
git mv apps/backend/src/modules/ai.model apps/backend/src/modules/ai-model
```

重命名后，使用 Grep 搜索所有引用该目录路径的导入语句：

```
# 搜索模式
from '.*/ai\.model/    →  更新为 /ai-model/
from '.*/ai\.usecase/  →  更新为 /ai-usecase/
```

### Step 2: 文件重命名（按模块分批）

每次处理一个模块目录下的所有违规文件：

```bash
# 示例：重命名 DTO 文件
git mv "apps/backend/src/modules/chat/dto/requests/send.message.request.dto.ts" \
       "apps/backend/src/modules/chat/dto/requests/send-message-request.dto.ts"
```

### Step 3: 更新导入引用

对每个被重命名的文件，搜索并更新所有导入：

1. 用 Grep 搜索旧文件名（不含扩展名）的 import 语句
2. 用 Edit 逐一更新为新文件名
3. 注意 barrel export（index.ts）中的 re-export 也需要更新

### Step 4: 验证

```bash
# NestJS 后端
dx lint
dx build backend --dev

# 前端
dx build front --dev
dx build admin --dev
```

## 各框架规范速查

### NestJS

| 元素 | 规范 | 示例 |
|------|------|------|
| 文件 | `kebab-name.type.ts` | `user-activity.service.ts` |
| 目录 | kebab-case | `user-statistics/` |
| DTO | `kebab-name.request.dto.ts` | `send-message.request.dto.ts` |
| Exception | `kebab-name.exception.ts` | `message-not-found.exception.ts` |
| Spec | `kebab-name.type.spec.ts` | `user.service.spec.ts` |
| E2E | `kebab-name.e2e-spec.ts` | `activity-admin.e2e-spec.ts` |

### Next.js + React

| 元素 | 规范 | 示例 |
|------|------|------|
| 组件 .tsx | PascalCase | `ChatPanel.tsx` |
| 工具 .ts | kebab-case | `sort-mappings.ts` |
| Hook .ts | camelCase | `useChat.ts` |
| 路由文件 | 小写 | `page.tsx`, `layout.tsx` |
| 目录 | kebab-case | `character/`（单数） |
| ui/ | kebab-case | `button.tsx` |

### Vite + React

与 Next.js 相同，但无路由文件约束。

## 高风险操作注意

- **barrel export (index.ts)**：重命名后检查是否有 `export * from './old-name'`
- **动态 import**：`import()` 表达式中的路径也需要更新
- **tsconfig paths**：如果 tsconfig 中配置了路径别名指向具体文件，也需更新
- **测试文件**：jest.config 或 vitest.config 中的 testMatch / include 模式可能引用目录名
- **Prisma schema**：`schema/` 下的 `.prisma` 文件名通常与模块名对应，但 Prisma 不强制命名规范
