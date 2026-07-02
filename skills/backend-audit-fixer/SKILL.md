---
name: backend-audit-fixer
description: 仅在用户显式调用 $backend-audit-fixer 或明确要求使用 backend-audit-fixer 技能时使用；不要通过关键词、任务类型或上下文自动触发。
---

# 后端规范审计与修复（伞 skill）

## 概览

7 个后端审计维度的统一入口。规则太多，**一维度一 subagent，每次只跑一个**：用户每次选一个维度，派一个 subagent 只载那份 reference、只跑那个脚本，回来出该维度报告，再询问是否继续下一个。**不并行扇出、不一次跑全部。**

默认只审计出报告；用户明确说"修复/直接改"才进落代码阶段。

## 维度表

| 维度 | reference | 脚本 | 规则来源 |
|------|-----------|------|---------|
| backend-layering | references/backend-layering.md | 无（纯 rg） | conventions §4/§5/§6 |
| e2e | references/e2e.md | scripts/e2e_audit.py | ruler/e2e-audit.md |
| env-accessor | references/env-accessor.md | scripts/env_accessor_audit.py | conventions §2 |
| enum-single-source | references/enum-single-source.md | scripts/enum_single_source_audit.py | 枚举唯一真源约定 |
| error-handling | references/error-handling.md | scripts/error_handling_audit.py | conventions §9 |
| naming | references/naming.md | scripts/naming_audit.py（需先拼 config） | conventions §10 |
| pagination-dto | references/pagination-dto.md | scripts/pagination_dto_audit.py | conventions §12 |

## 执行流程

### Step 1：询问要跑哪个维度

**每次只跑一个维度。** 进入 skill 后：

- 用户已点名某维度（"检查命名"/"分页规范"）→ 直接跑该维度，跳到 Step 2。
- 用户说"全量审计/扫一遍/检查合规"或没点名 → **用纯文本列出下面 7 个维度的编号菜单**，让用户回复编号或维度名再继续。别默认全跑、别并行。

> ⚠️ 不要用 AskUserQuestion 列维度：它每题最多 4 个选项，7 个维度会被截断。必须用文本菜单。

```
请选择要审计的维度（每次只跑一个，回复编号或名字）：
1. backend-layering  — 三层架构/事务/Repository 越层（conventions §4/§5/§6）
2. e2e               — E2E 中文标题/手工 JWT/请求 helper/fixture 复用（ruler/e2e-audit.md）
3. env-accessor      — 业务代码直读 process.env（conventions §2）
4. enum-single-source — 枚举类型唯一真源/DB enum 生成链路/重复字面量
5. error-handling    — 裸 BadRequestException/无 code HttpException（conventions §9）
6. naming            — 文件/文件夹命名规范（conventions §10）
7. pagination-dto    — 分页 DTO 未继承基类/手工拼装分页返回（conventions §12）
```

### Step 2：派 1 个 subagent 跑选中的维度

只为这一个维度派一个 subagent。prompt 模板：

```
你负责后端审计的「<维度名>」维度。
1. 只读 ~/.claude/skills/backend-audit-fixer/references/<维度>.md
2. 按其中说明运行该维度的脚本/命令（workspace=<绝对路径>）
3. 不要读其他维度的 reference，不要跑其他维度的脚本
4. 默认只审计，除非主任务明确要求修复
5. 严格按 reference 末尾的 findings JSON 契约返回结果（把脚本原始输出归一化成该契约）
```

关键约定：
- 脚本路径统一 `SKILL_HOME="${SKILL_HOME:-$HOME/.claude/skills}"` → `$SKILL_HOME/backend-audit-fixer/scripts/<name>.py`。
- naming 维度特殊：subagent 要先分析项目拼 JSON config 再喂脚本（见 references/naming.md）。
- backend-layering 无脚本：subagent 跑 rg + 读代码判定。

### Step 3：出该维度报告

subagent 把脚本原始输出**归一化**成自己 reference 末尾的 findings 契约返回（脚本原始 JSON 顶层结构各异，契约是统一汇报格式，非脚本原样输出）。主 agent 据此出该维度报告：

```
## <维度> 审计报告
- 基础设施：...
- 命中数：N
- 规则分布：...

### 详细列表
（展开 violations，标注脚本结果 vs 源码复核）
```

区分清楚：脚本命中 vs 已抽样复核；src vs e2e（error-handling）；疑似误报标"脚本规则限制"。

### Step 4：询问下一步

出完报告后，用 AskUserQuestion 问用户：

- 修复本维度（仅用户明确要求才落代码）
- 跑下一个维度（回 Step 1 再选一个）
- 结束

**不要出完一个维度就自动跑下一个。** 每个维度之间都要停下来等用户决定。

### 修复（仅用户明确要求）

按维度修复，照该维度 reference 的修复策略改码。修复后该维度复扫确认归零，再跑项目验证命令（`dx lint` / `dx build` / 受影响测试）。作者 pass 改码、复扫 pass 验证分两 lane，别自审自批。

## 注意

- **每次只跑一个维度**，维度之间用 AskUserQuestion 停顿，不并行、不自动连跑。
- 各 reference 自包含（触发/命令/规则/修复/排除/findings 契约），subagent 不需要回看本 SKILL.md。
- 旧的 6 个独立 skill（*-audit-fixer）过渡期并存；新工作走本伞 skill。
