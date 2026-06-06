# 维度：文件/文件夹命名规范（naming）

脚本：`scripts/naming_audit.py`。规则来源：`ruler/conventions.md` §10 前端目录与命名。

**特例**：此维度脚本不裸跑，需 model 先分析项目拼 JSON config 经 stdin 喂脚本。模型决策（判框架/范围/项目约定），脚本执行（遍历匹配输出）。

> ⚠️ **脚本只给候选，定性靠 model**。本仓实测脚本原始命中 95 → 真违规仅 21（误报率 78%）。脚本不懂「项目真源说哪条算合规」，所有命中**必须**逐条对照 §10 复核后再报。下方「§10 命中复核」是硬门槛，跳过即产出错误 issue。

## Step 1：分析项目（subagent 先做）

读以下判定技术栈与目录结构：
1. `package.json`（根+各 app）— 识别框架
2. `pnpm-workspace.yaml` / `workspaces` — monorepo 结构
3. `tsconfig.json` — 源码目录（`rootDir`/`include`）
4. `CLAUDE.md` / `AGENTS.md` — 项目自定义命名约定（优先级最高）
5. `ls` 浏览实际源码位置

确定：每个 app 框架、源码根目录、是否有 Next.js app 目录（路由豁免）、额外跳过目录（`generated/`）、额外豁免文件。

### 范围裁剪（本仓实测，先裁再扫）

`ruler/conventions.md` §10 标题即「**前端**目录与命名规范」，全部条款/示例均为前端风格、**无后端条款**。据此：

| 目录 | 是否扫 | 原因 |
|------|--------|------|
| `apps/backend/src` `apps/backend/e2e` | **不扫** | §10 不约束后端。`x.service.spec.ts` 等点号是 NestJS 官方惯例，全是误报（本仓 33 条全假）。除非项目另有后端命名真源，否则别把 backend 塞进 config |
| `apps/front/src` | 扫 `nextjs-react` | §10 主战场 |
| `apps/admin-front/src` | **谨慎/默认不改** | 见下「vite-plugin-pages 路由陷阱」。可审计出报告，但 `pages/**` 的 `.tsx` 改名属破坏性，默认排除、单独评估 |
| `packages/shared/src` `packages/api-contracts/src` | 扫 `generic-ts`（api-contracts 加 `extra_skip_dirs:["generated"]`） | codegen 产物豁免 |

> 没有后端命名真源就别扫后端。脚本能扫不代表该扫——真源边界决定范围。

### vite-plugin-pages 路由陷阱（admin-front 高危）

admin-front 用 `vite-plugin-pages`（`~react-pages`），`pages/**` **按文件名生成路由 URL**。把 `pages/comment/reports.tsx` 改成 `Reports.tsx` 会把 URL 从 `/comment/reports` 变成 `/comment/Reports`，且这类文件常**无任何 import**（纯靠文件路由存活），改名即路由失联。

→ 扫到 admin-front 前先 `rg "vite-plugin-pages|react-pages" apps/admin-front`。命中则 `pages/**/*.tsx` 默认**不纳入改名**（写进 issue out-of-scope），需治理时必须同步处理 Pages 的 `exclude` 或确认 URL 可变更并加路由可达回归。`pages/` 外的组件/工具文件不受此限。

## Step 2：拼 config 喂脚本

> config **必须**与上方「范围裁剪表」一致：**不要**把 `apps/backend` 写进 scans（§10 不约束后端，扫了全是误报）。admin-front 可扫出报告但 `pages/**` 改名走 out-of-scope。

```bash
SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"
echo '{
  "scans": [
    {"root": "apps/front/src", "framework": "nextjs-react", "app_dir": "app"},
    {"root": "apps/admin-front/src", "framework": "react"},
    {"root": "packages/shared/src", "framework": "generic-ts"},
    {"root": "packages/api-contracts/src", "framework": "generic-ts", "extra_skip_dirs": ["generated"]}
  ]
}' | python "$SKILL_HOME/backend-audit-fixer/scripts/naming_audit.py"
```

> 上面是本仓（无后端命名真源）的正确 config 形态。其他仓若确有后端命名真源，再按真源加 backend scan。

config 字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `root` | 是 | 扫描目录（相对项目根） |
| `framework` | 是 | 规则集，见下 |
| `app_dir` | 否 | Next.js app 目录名（默认 `app`），仅 `nextjs-react` 需要 |
| `extra_skip_dirs` | 否 | 额外跳过目录名 |
| `extra_ok_files` | 否 | 额外豁免文件名 |

支持 framework：`nestjs` / `nextjs-react` / `react` / `vue` / `angular` / `generic-ts`。

## Step 2.5：§10 命中复核（硬门槛，逐条过）

脚本命中后，**每条**按下表判定，剔除误报与脏建议名再报。本仓实测命中 95→真违规 21，全栽在这几类：

| 复核项 | 规则（§10 真源） | 处理 |
|--------|------------------|------|
| **点号 ≠ 违规** | §10 把 `announcement-popup.storage.ts` 列为**合规**示例 → 描述性点号（`.storage`/`.toggle`/`.sub-normalize`/`.core`/`.middleware`/`.slice` 等）是认可的。违规的**只是 base 段大小写** | base 已 kebab 的点号文件（`share-story.toggle.test.ts`/`unified-error-handler.core.ts`）→ **不报**。只报 base 段是 camelCase/PascalCase 的（`CharactersPane.sub-normalize.ts`→`characters-pane.sub-normalize.ts`，保留点号） |
| **ui/ 豁免** | §10：「`ui/` 仅存放 shadcn 原生组件，保持 kebab-case」 | `components/ui/*.tsx` 的 kebab 命中**全部剔除**（本仓 26 条误报） |
| **hook 文件** | §10：hooks `.ts`/`.tsx` 用 camelCase | `useXxx.tsx`/`useXxx.ts` 被脚本判 PascalCase 的→剔除 |
| **多导出模块文件** | 文件导出 Provider+hook+类型+常量混合（非单一组件）→ 非「组件文件」，PascalCase 改名语义存疑 | 标 out-of-scope，不强改（如 theme 模块 `yuzu.tsx`） |
| **纯多组件文件**（区别于上行） | 文件只导出多个组件、无 hook/类型/Provider（如 `skeletons.tsx` 5 个 skeleton、`v7-sections.tsx` 组件+常量） | **算真违规**（仍是组件文件），按 PascalCase 报；建议名取主导出或文件语义（`Skeletons.tsx`），标注「多导出、命名取语义」 |
| **spec/test 文件名** | 测试文件名跟随**被测对象**命名，不独立判定 | 被测是组件（`ThemeProvider.tsx` PascalCase 合规）→ 其 `ThemeProvider.spec.ts` 跟随 PascalCase，**剔除**；被测是 kebab 文件 → spec 也 kebab |
| **工具函数文件** | 导出纯函数（非组件非 hook）的 `.tsx`/`.ts` | 按工具文件走 kebab（`focusOnMount.ts`→`focus-on-mount.ts`），**不要**按 .tsx 后缀套 PascalCase |
| **建议名脏数据** | 脚本对 camelCase 源生成的 `suggested` 可能是乱码（`renderWithYuzu.tsx`→`Renderwithyuzu.tsx`） | 建议名一律人工核，勿照搬脚本 `suggested` |
| **文件名 vs 导出名** | 单组件文件名应对齐其默认导出 | `page-router.tsx` 默认导出 `CharacterPageRouter`→建议 `CharacterPageRouter.tsx` 而非 `PageRouter.tsx` |

复核产出：把脚本原始 N 条标注为「真违规 / 误报(原因) / out-of-scope(原因)」三类，findings 只含真违规。

## Step 3：解读报告

脚本输出 JSON：`total_violations` / `summary_by_rule` / `violations[]`（path/rule/current/suggested）/ `fix_plan[]`（`git mv` 命令）。

展示：按规则汇总表 + 按目录分组列表（当前名→建议名）+ 询问是否修复。**审计阶段不自动改码。**

## Step 4：修复（用户确认后）

详见 [naming-fix-guide.md](./naming-fix-guide.md)。要点：
1. 目录优先 `git mv`
2. 按模块分批
3. 每次重命名后 Grep 找所有 import/require 引用，Edit 更新
4. 检查 barrel `index.ts` re-export
5. 增量验证 lint + build
6. 全部完成跑受影响测试

## 命名规则速查

| framework | 核心规则 |
|----|---------|
| `nestjs` | `kebab-name.type.ts`（name 部分连字符），目录 kebab-case |
| `nextjs-react` | .tsx PascalCase，.ts kebab-case，hook camelCase，路由文件（`page.tsx`/`layout.tsx`）豁免，目录 kebab-case |
| `react` | .tsx PascalCase，.ts kebab-case，hook camelCase |
| `vue` | .vue PascalCase 或 kebab-case，.ts kebab-case |
| `angular` | `kebab-name.type.ts` |
| `generic-ts` | 全 kebab-case |

## 注意

- 项目约定优先（CLAUDE.md/AGENTS.md 定义则以项目为准）。
- 脚本结果可能误报，展示前抽查。
- 目录重命名影响大，建议单独 commit。
- 入口文件、声明文件、动态路由自动豁免；`node_modules/`/`dist/`/`migrations/` 自动跳过。

## 返回给主 agent 的 findings

`total` / `violations` 只含 **Step 2.5 复核后的真违规**；脚本原始数与剔除情况放 `triage`，让主 agent 知道范围怎么裁的。

```json
{
  "dimension": "naming",
  "raw_hits": 0,
  "total": 0,
  "by_rule": {},
  "violations": [{"file":"","rule":"","current":"","suggested":""}],
  "triage": {
    "excluded_false_positive": [{"file":"","reason":"ui/ shadcn 保留 kebab"}],
    "excluded_out_of_scope": [{"file":"","reason":"vite-plugin-pages 路由 / 多导出模块 / 后端非 §10 范围"}]
  }
}
```

> `suggested` 必经人工核（脚本可能给乱码名）；单组件文件名对齐默认导出名。
