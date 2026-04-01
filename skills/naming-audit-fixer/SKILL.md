---
name: naming-audit-fixer
description: 审计并修复任意 JS/TS 项目的文件和文件夹命名规范。由模型判断框架、源码目录和自定义约定，再调用脚本执行扫描。当用户提到"命名规范"、"文件命名检查"、"naming convention"、"rename files"、"文件名不规范"、"命名审计"，或讨论文件/文件夹命名最佳实践时触发。即使用户只是问"检查一下命名"也应触发。
---

# 文件/文件夹命名规范审计与修复

模型负责决策（判断框架、确定扫描范围、识别项目自定义约定），脚本负责执行（按规则遍历文件树、匹配违规、输出报告）。

## 执行流程

```
模型分析项目 → 生成扫描配置 → 调用脚本 → 解读报告 → 展示给用户 → [用户确认] → 分批修复
```

### Step 1: 分析项目（模型完成）

阅读以下文件来判断项目技术栈和目录结构：

1. **`package.json`**（根目录和各 app 目录）— 识别依赖的框架
2. **`pnpm-workspace.yaml`** 或 `package.json` 的 `workspaces` 字段 — 确定 monorepo 结构
3. **`tsconfig.json`** — 确认源码目录（`rootDir`、`include`）
4. **`CLAUDE.md` / `AGENTS.md`** — 识别项目自定义命名约定（优先级最高）
5. **项目目录结构**（`ls` 快速浏览）— 确认实际源码位置

根据分析结果，确定：
- 每个 app 使用什么框架
- 每个 app 的源码根目录
- 是否有 Next.js app 目录（路由文件豁免需要）
- 需要额外跳过的目录（如 `generated/`、`__generated__/`）
- 需要额外豁免的文件（如项目特有的入口文件）

### Step 2: 生成扫描配置并调用脚本

构造 JSON 配置，通过 stdin 传给脚本：

```bash
echo '{
  "scans": [
    {
      "root": "apps/backend/src",
      "framework": "nestjs",
      "extra_skip_dirs": [],
      "extra_ok_files": []
    },
    {
      "root": "apps/backend/e2e",
      "framework": "nestjs",
      "extra_skip_dirs": [],
      "extra_ok_files": []
    },
    {
      "root": "apps/front/src",
      "framework": "nextjs-react",
      "app_dir": "app",
      "extra_skip_dirs": [],
      "extra_ok_files": []
    },
    {
      "root": "apps/admin/src",
      "framework": "react",
      "extra_skip_dirs": [],
      "extra_ok_files": []
    }
  ]
}' | python ~/.claude/skills/naming-audit-fixer/scripts/audit_naming.py
```

**配置字段说明：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `root` | 是 | 要扫描的目录（相对于项目根目录） |
| `framework` | 是 | 命名规则集，见下方 |
| `app_dir` | 否 | Next.js app 目录名（默认 `app`），仅 `nextjs-react` 需要 |
| `extra_skip_dirs` | 否 | 额外要跳过的目录名 |
| `extra_ok_files` | 否 | 额外要豁免的文件名 |

**支持的 framework 值：**

| 值 | 适用场景 | 核心规则 |
|----|---------|---------|
| `nestjs` | NestJS 后端 | `kebab-name.type.ts`，目录 kebab-case |
| `nextjs-react` | Next.js + React | .tsx PascalCase，.ts kebab-case，路由文件豁免 |
| `react` | React SPA / Vite | .tsx PascalCase，.ts kebab-case |
| `vue` | Vue | .vue PascalCase 或 kebab-case，.ts kebab-case |
| `angular` | Angular | `kebab-name.type.ts`，类似 NestJS |
| `generic-ts` | 通用 TypeScript | 全 kebab-case |

### Step 3: 解读并展示报告

脚本输出 JSON，包含：
- `total_violations` — 违规总数
- `summary_by_rule` — 按规则分类的计数
- `violations[]` — 每条违规（path / rule / current / suggested）
- `fix_plan[]` — 可执行的 `git mv` 命令

向用户展示：
1. 按规则分类的汇总表
2. 按目录分组的详细列表（当前名 → 建议名）
3. 询问是否进入修复

**不要在审计阶段自动改代码。**

### Step 4: 修复（用户确认后）

阅读 [references/fix-guide.md](./references/fix-guide.md) 获取详细步骤。要点：

1. **目录优先** — 先 `git mv` 重命名目录
2. **按模块分批** — 每次处理一个模块下的文件
3. **同步引用** — 每次重命名后用 Grep 找所有 import/require 引用，用 Edit 更新
4. **检查 barrel** — 更新 `index.ts` 的 re-export
5. **增量验证** — 每个模块改完跑 lint + build
6. **最终测试** — 全部完成后跑受影响的测试

## 命名规则速查

### NestJS

| 正确 | 错误 | 原因 |
|------|------|------|
| `send-message.request.dto.ts` | `send.message.request.dto.ts` | name 部分用连字符 |
| `ai-model/` | `ai.model/` | 目录用 kebab-case |
| `message-not-found.exception.ts` | `message.not.found.exception.ts` | name 部分用连字符 |

### Next.js + React

| 文件类型 | 规范 | 示例 |
|---------|------|------|
| 组件 .tsx | PascalCase | `ChatPanel.tsx` |
| 工具 .ts | kebab-case | `sort-mappings.ts` |
| Hook .ts | camelCase | `useChat.ts` |
| 路由文件 | 小写（豁免） | `page.tsx`, `layout.tsx` |
| 目录 | kebab-case | `character/` |

### Vue

| 文件类型 | 规范 | 示例 |
|---------|------|------|
| 组件 .vue | PascalCase 或 kebab-case | `UserCard.vue` 或 `user-card.vue` |
| 工具 .ts | kebab-case | `format-date.ts` |

## 注意事项

- **项目约定优先**：如果 CLAUDE.md / AGENTS.md 定义了自己的命名规范，以项目为准
- 脚本结果可能有误报，展示前应抽查
- 目录重命名影响大，建议单独 commit
- 入口文件、声明文件、动态路由自动豁免
- `node_modules/`、`dist/`、`migrations/` 等自动跳过
