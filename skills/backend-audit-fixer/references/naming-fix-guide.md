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
| ui/ | kebab-case（shadcn 原生，**豁免 PascalCase**） | `button.tsx` |
| 点号描述符 | 保留，仅 base 段 kebab | `announcement-popup.storage.ts` ✅ |

### Vite + React（admin-front）

组件/工具命名同 Next.js。但 **`pages/**` 走 vite-plugin-pages 文件路由**：文件名即 URL，`.tsx` 改名属破坏性，默认不动（见高风险注意）。

## 高风险操作注意

- **vite-plugin-pages 文件路由（admin-front 最高危）**：`pages/**` 文件名即 URL。改名前 `rg "vite-plugin-pages|react-pages"`；命中则 `pages/**/*.tsx` 默认不改（改名 = 改 URL，且常无 import 纯靠路由存活，改完直接失联）。确需改：同步改 Pages `exclude` 或确认 URL 可变更并手测路由可达。
- **点号是描述符不是违规**：§10 认可 `.storage`/`.toggle`/`.core` 等描述符点号。改名**只动 base 段大小写**，保留点号（`CharactersPane.sub-normalize.ts`→`characters-pane.sub-normalize.ts`，不要拍平成 `characters-pane-sub-normalize.ts`）。
- **macOS 大小写不敏感**：`git mv MessageCenter message-center` 仅改大小写可能失败，需中间名过渡（`MessageCenter`→`message-center-tmp`→`message-center`）。
- **深引用 vs barrel**：改目录名前先 `rg` 确认外部走深路径还是 barrel——别假设走 index.ts，本仓实测外部全是 `Dir/Component` 深引用、barrel 零外部消费。
- **barrel export (index.ts)**：重命名后检查是否有 `export * from './old-name'`
- **动态 import**：`import()` 表达式中的路径也需要更新
- **tsconfig paths**：如果 tsconfig 中配置了路径别名指向具体文件，也需更新
- **测试文件**：jest.config 或 vitest.config 中的 testMatch / include 模式可能引用目录名
- **Prisma schema**：`schema/` 下的 `.prisma` 文件名通常与模块名对应，但 Prisma 不强制命名规范
