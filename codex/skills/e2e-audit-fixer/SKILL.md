---
name: e2e-audit-fixer
description: 对 backend 的 E2E 用例进行中文名称、通用 fixture 重复实现与测试请求构建规范检查，并按可配置路径输出修复建议与可选自动修复。适用于需要审计或修复 E2E 测试中的中文用例名、手工请求构造、手工 JWT、以及本应复用通用测试基建的重复实现。
---

# E2E 测试可维护性检查与修复

## 触发场景

- 需要检查 `apps/backend/e2e/**/*.e2e-spec.ts` 的 E2E 用例是否符合英文命名规范。
- 需要识别直接操作 Prisma、手工 JWT、手工 API URL、手工请求实现，并区分哪些适合改用全局通用 fixture，哪些更适合抽成本地 helper。
- 需要一次性生成问题清单并按规则应用可控修复。

## 准备

执行前确认项目有可读权限，并准备以下路径参数（全部可覆盖，避免硬编码）：

1. `--workspace`：代码根目录，默认当前目录。
2. `--e2e-glob`：扫描文件模式，默认 `apps/backend/e2e/**/*.e2e-spec.ts`。
3. `--fixtures`：fixtures 文件路径，默认 `${workspace}/apps/backend/e2e/fixtures/fixtures.ts`。

## 执行流程

1. 先扫描问题：

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
python "$CODEX_HOME/skills/e2e-audit-fixer/scripts/e2e_e2e_audit.py" \
  --workspace /Users/a1/work/ai-monorepo
```

2. 生成输出 JSON 用于复核：

```bash
python "$CODEX_HOME/skills/e2e-audit-fixer/scripts/e2e_e2e_audit.py" \
  --workspace /Users/a1/work/ai-monorepo \
  --output-json /tmp/e2e-audit.json
```

3. 按修复策略应用：

   1. 中文测试名：先翻译为英文。可直接提供翻译映射：

   ```bash
   python "$CODEX_HOME/skills/e2e-audit-fixer/scripts/e2e_e2e_audit.py" \
     --workspace /Users/a1/work/ai-monorepo \
     --translation-map /tmp/name-map.json \
     --apply
   ```

   2. fixture 重复实现：自动加注释提示并给出替换建议，保留原有逻辑不变。仅 `user` / `userCredential` 作为全局通用 fixture 候选，其余默认建议抽成本地 helper。

4. 必要时清理：对比扫描结果再次运行，确保无回归。

## 检查规则（脚本输出）

- `e2e-chinese`：`describe/it/test/context` 名称包含中文字符。
- `e2e-fixtures`：检测 `prisma.user.*`、`prisma.userCredential.*`、`jwtService.sign/jwt.sign`、未使用 `buildApiUrl()` 的 API URL 片段、未使用 `createAuthRequest/createAdminAuthRequest/createPublicRequest` 的手工请求调用。
- `e2e-local-helper`：检测其他 `prisma.*.create*` / `upsert` 类重复实现，默认只建议在当前测试文件内抽成本地 helper，不建议直接上收为全局 fixtures。

## 可选翻译入口

支持三种方式之一：

1. `--translation-map`：JSON 映射文件 `{ "中文原文": "English text" }`（推荐，稳定、可审计）。
2. `--translate-service openai`：提供 `OPENAI_API_KEY` 后自动调用 OpenAI 批量翻译。
3. 不提供翻译参数：仅输出中文字符串与建议，不改写文件。

## 注意

- 扫描不改变业务逻辑，只做问题检测与可控注释插入。
- 自动修复默认只对中文测试名称做真实替换。
- `user` / `userCredential` 以外的重复造数默认视为“本地 helper 候选”，不默认建议进入全局 fixtures。
- fixture 与请求构造类问题仅插入 TODO 注释，不宣称已完成重构。
- 翻译服务仅处理测试名称，不处理其他文本。
- 扫描路径来源全部来自参数，不会固定死为 `apps/backend/e2e/**/*.e2e-spec.ts`。
