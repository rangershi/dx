# 维度：E2E 测试可维护性（e2e）

脚本：`scripts/e2e_audit.py`。规则来源：`ruler/e2e-audit.md`。

默认只检测+插 TODO 注释，不动业务逻辑；自动修复仅对中文测试名做真实替换。

## 触发场景

- 检查 `apps/backend/e2e/**/*.e2e-spec.ts` 用例是否符合英文命名。
- 识别直接操作 Prisma、手工 JWT、手工 API URL、手工请求实现，区分哪些改全局 fixture、哪些抽本地 helper。

## 运行

```bash
SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"
python "$SKILL_HOME/backend-audit-fixer/scripts/e2e_audit.py" \
  --workspace /Users/a1/work/ai-monorepo \
  --output-json /tmp/audit-e2e.json
```

路径参数（全部可覆盖，禁止硬编码）：
- `--workspace`：代码根目录，默认当前目录。
- `--e2e-glob`：扫描模式，默认 `apps/backend/e2e/**/*.e2e-spec.ts`。
- `--fixtures`：fixtures 路径，默认 `${workspace}/apps/backend/e2e/fixtures/fixtures.ts`。

## 检查规则

- `e2e-chinese`：`describe/it/test/context` 名称含中文字符。
- `e2e-fixtures`：`prisma.user.*`、`prisma.userCredential.*`、`jwtService.sign/jwt.sign`、未用 `buildApiUrl()` 的 API URL 片段、未用 `createAuthRequest/createAdminAuthRequest/createPublicRequest` 的手工请求。
- `e2e-local-helper`：其他 `prisma.*.create*` / `upsert` 重复实现，默认只建议当前文件内抽本地 helper，不上收全局 fixtures。

## 修复策略

1. 中文测试名：先翻译英文。可提供翻译映射后 `--apply`：
   ```bash
   python "$SKILL_HOME/backend-audit-fixer/scripts/e2e_audit.py" \
     --workspace /Users/a1/work/ai-monorepo \
     --translation-map /tmp/name-map.json --apply
   ```
   翻译三选一：`--translation-map`（JSON `{"中文":"English"}`，推荐）/ `--translate-service openai`（需 `OPENAI_API_KEY`）/ 不提供（仅输出不改写）。
2. fixture 重复实现：自动加注释+替换建议，保留原逻辑。仅 `user`/`userCredential` 为全局 fixture 候选，其余建议本地 helper。
3. 复扫确认无回归。

## 注意

- 扫描不改业务逻辑，只检测+可控注释插入。
- fixture/请求构造类问题仅插 TODO 注释，不宣称已重构。
- 翻译服务仅处理测试名称。

## 返回给主 agent 的 findings

```json
{
  "dimension": "e2e",
  "total": 0,
  "by_rule": {"e2e-chinese":0,"e2e-fixtures":0,"e2e-local-helper":0},
  "violations": [{"file":"","rule":"e2e-chinese","line":0,"note":""}]
}
```
通过标准：`count: 0` / `by_type: {}`。
