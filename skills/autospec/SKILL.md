---
name: autospec
description: 设计文档到实施计划的全自动流水线。仅在用户显式调用时触发（如 /autospec），不通过关键词自动触发。将已讨论好的设计方案依次执行：写设计文档 → critic 审核修复 → 写实施计划 → critic 审核修复 → 自动开始 subagent-driven 执行 → git-pr-ship 交付 PR。
---

# spec-to-plan：设计文档 → 审核 → 实施计划 → 审核 → 执行 → 交付 PR

六步全自动流水线。用户在 brainstorming 阶段讨论好目标和方案后显式调用，后续全部自动完成，无需人工干预。

## 输入

`/spec-to-plan <topic-slug>`

- `topic-slug`：文件命名用，如 `chat-instruction-admin`
- 当前对话中必须已包含充分的设计上下文（目标、方案、数据模型、API、技术决策等）

## 输出

- 审核后的设计文档：`docs/superpowers/specs/YYYY-MM-DD-<topic-slug>-design.md`
- 审核后的实施计划：`docs/superpowers/plans/YYYY-MM-DD-<topic-slug>.md`
- 自动进入 subagent-driven 执行模式

## 执行流程

严格按顺序执行五步，中间不暂停、不询问用户。

---

### Step 1：撰写设计文档

从当前对话上下文中提取所有已确认的设计决策，写入设计文档。不臆造未讨论过的需求。

**路径**：`docs/superpowers/specs/YYYY-MM-DD-<topic-slug>-design.md`

**结构**（按需裁剪，无内容的章节不写）：

```markdown
# <功能名称>

## 背景
## 数据模型
## API 设计
## 缓存策略
## 前端改造
## 必要的集成步骤
## Seed 数据
## 模块结构
## 不做的事
```

**自检**：写完后扫描——无 TBD/TODO、章节不矛盾、范围聚焦、无歧义。发现问题直接修。

---

### Step 2：审核设计文档

派出 `oh-my-claudecode:critic` subagent 审核。

**Prompt**：

```
请以挑刺的角度审核这份设计文档，结合项目实际代码验证每一个设计决策。

文档路径：<spec-path>

审核要点：
1. 数据模型：字段命名、ID 策略、@map/@@map 是否匹配项目惯例
2. 模块结构：目录组织是否与现有模块一致
3. API 设计：路由前缀、鉴权、分页 DTO 继承是否符合惯例
4. 缓存：CacheService 方法签名是否正确
5. 前端：store 组织、API 调用模式、组件层级是否匹配实际代码
6. 集成步骤：是否遗漏 ErrorCode、Swagger、RBAC、api-contracts、菜单注册等
7. Seed：入口注册、幂等策略是否正确

每个发现给出具体文件路径和代码证据。
分为：错误（必须修复）、遗漏（建议补充）、建议（可选优化）。
```

**处理结果**：读取 critic 返回，逐一修复设计文档。错误和遗漏全部修复，建议类酌情采纳。不改变已与用户确认的设计决策，只修事实性错误和惯例偏差。

---

### Step 3：撰写实施计划

基于审核后的设计文档写实施计划。

**路径**：`docs/superpowers/plans/YYYY-MM-DD-<topic-slug>.md`

**头部**（固定格式）：

```markdown
# <功能名称> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 一句话
**Architecture:** 2-3 句
**Tech Stack:** 关键技术
**Spec:** <spec-path>

---
```

**Task 结构**：

```markdown
### Task N: <组件名>

**Files:**
- Create: `exact/path`
- Modify: `exact/path`

- [ ] **Step 1: 描述**
（完整代码块）

- [ ] **Step 2: 验证**
Run: `命令`
Expected: 预期

- [ ] **Step 3: Commit**
```

**要求**：
- 每步完整代码，禁止 TBD/TODO/"类似 Task N"
- import 路径准确（基于 Step 2 审核已验证的惯例）
- Task 按依赖顺序排列
- 粒度 2-5 分钟每 Task

**自检**：spec 每个章节有对应 Task、无占位符、类型和方法名前后一致。

---

### Step 4：审核实施计划

派出 `oh-my-claudecode:critic` subagent 审核。

**Prompt**：

```
请以挑刺的角度审核这份实施计划，结合项目实际代码验证每一个代码片段。

计划路径：<plan-path>
设计文档：<spec-path>

审核要点：
1. Import 路径：每个 import 在项目中是否真实存在
2. 路由冲突：参数路由 (:id) 和固定路由的顺序
3. API 方法名：Zodios 等生成的方法命名是否匹配惯例
4. 测试基建：E2E setup 是否匹配项目 fixtures
5. Seed 入口：注册方式是否匹配项目结构
6. Store 注册：前端 store 根注册方式是否正确
7. 页面路由：文件路径能否自动注册路由
8. DTO/Exception：构造函数签名、方法名是否匹配实际 API
9. 遗漏：spec 中的需求是否全部覆盖

每个发现给出具体文件路径和代码证据。
分为：错误（必须修复）、遗漏（建议补充）、建议（可选优化）。
```

**处理结果**：读取 critic 返回，逐一修复实施计划。错误和遗漏全部修复。

---

### Step 5：自动开始执行

四步文档工作完成后，直接调用 `superpowers:subagent-driven-development` skill，传入实施计划路径，开始 Task-by-Task 的 subagent 执行。

不询问用户选择执行方式，直接以 subagent-driven 模式启动。

输出简短状态通知：

```
设计文档：<spec-path>（已审核修复）
实施计划：<plan-path>（已审核修复，共 N 个 Task）
正在以 subagent-driven 模式开始执行...
```

---

### Step 6：调用 git-pr-ship 交付 PR

subagent-driven 执行全部 Task 完成并通过验证后，直接调用 `git-pr-ship` skill，进入 PR 交付流程。

前置条件（执行阶段应已满足，若未满足先补齐）：
- 全部 Task 已完成并勾选
- 代码变更已提交到当前功能分支
- lint、构建、相关测试已通过

不询问用户，直接以 `git-pr-ship` 流程收口：整理提交、推送分支、创建 PR。

输出简短状态通知：

```
实施已全部完成并验证通过。
正在调用 git-pr-ship 交付 PR...
```

## 注意事项

- 设计文档内容完全来自对话上下文，不臆造未讨论过的需求
- critic 修复只改事实错误和惯例偏差，不改变用户已确认的设计决策
- 如果 critic 发现的问题数量极多（>10 个错误级），在修复后可考虑再跑一轮 critic 确认
- 整个流程对用户透明——每步开始时输出一行状态（如"正在撰写设计文档..."），但不等待确认
