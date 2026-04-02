# Dynamic CLI Help: 基于 `commands.json` 的单一事实源设计

## 概述

将 dx CLI 的帮助系统从“`lib/cli/help.js` 中硬编码文案”重构为“基于 `dx/config/commands.json` 动态渲染”。执行配置与帮助配置统一放在 `commands.json` 中，CLI 代码只负责读取、校验与渲染。

目标是让 `commands.json` 成为 CLI help 的唯一事实源，避免帮助文档与真实命令配置漂移。

## 背景与问题

当前帮助系统存在两个结构性问题：

1. `showHelp()` / `showCommandHelp()` 维护了大量手写字符串，与真实配置脱节。
2. 真实可执行 target 来自 `commands.json`，但帮助示例、可用 service、约束说明散落在代码里，容易出现“帮助写了、配置没接上”或“配置改了、帮助没更新”。

这类漂移已经在 `start stack front/admin` 这类别名用法中暴露风险：帮助层与配置层不能保证同步。

## 设计目标

- `commands.json` 成为帮助文案与 target 说明的唯一事实源
- 帮助内容支持配置化维护：摘要、参数说明、示例、提示文案都可在配置中定义
- CLI 代码不再手写各命令帮助正文，只负责动态渲染
- 保持现有命令执行模型不变，帮助系统只读取配置，不改变执行语义
- 帮助配置具备 schema 校验能力，缺失或错误时快速失败
- 为后续新增命令/target 提供低维护成本的帮助扩展路径

## 非目标

- 本次设计不修改现有命令执行协议
- 本次设计不引入新的配置文件，仍复用 `commands.json`
- 本次设计不尝试自动从 shell command 字符串反推高级语义说明
- 本次设计不在第一阶段把 flag 定义、命令路由与位置参数校验整体迁入 `commands.json`

## 真实来源边界

本设计需要明确区分“帮助文案来源”和“CLI 语义来源”，否则只会把漂移从 `help.js` 搬到 `commands.json`。

### 第一阶段的来源分工

- `commands.json`
  - 负责：帮助文案、target 摘要、示例、提示、命令级/target 级说明
  - 负责：可执行 target 树以及与 target 关联的结构化事实
- `lib/cli/flags.js`
  - 负责：真实支持的 flags 与是否需要值
- `lib/cli/dx-cli.js`
  - 负责：顶层命令集合、命令路由、位置参数校验、未知参数处理
- `lib/cli/commands/*.js`
  - 负责：命令运行时语义与特殊规则

### 对“单一事实源”的修正定义

第一阶段里，“单一事实源”仅指：

- 帮助正文与帮助示例不再写死在 `help.js`
- target 级帮助描述只在 `commands.json` 维护

以下内容在第一阶段仍以代码为准，帮助系统只能读取和校验，不可自行发明：

- 顶层可用命令集合
- 可用 flags 集合
- 位置参数规则
- 某些命令的特殊运行时限制

### 第二阶段可选演进

若后续希望做到更严格的单一事实源，可再把以下元数据逐步迁入配置：

- 顶层命令注册表
- flag 定义
- 位置参数 schema

但这不属于本次设计的首批落地范围。

## 方案选择

### 方案 A：纯推导帮助

只保留执行配置，由 CLI 根据 `command` / `internal` / 环境分支自动推导帮助。

问题：
- 很多关键语义无法可靠推导，例如默认环境、风险提示、推荐示例
- 一旦存在别名、隐式规则、限制说明，仍需回到代码里手写

结论：不采用。

### 方案 B：结构化帮助元数据

在 `commands.json` 中引入结构化 `help` 元数据。执行配置与帮助配置共存，CLI 根据统一 schema 渲染帮助页。

优点：
- 单一事实源
- 表达力足够
- 可校验、可测试、可渐进迁移

结论：采用。

### 方案 C：整段帮助全文配置化

把当前 `help.js` 中的大段文本原样迁移到 JSON 中。

问题：
- 只是把硬编码从 JS 挪到 JSON
- 结构化价值低，难以做一致性校验

结论：不采用。

## 配置模型

帮助配置分为四层。

### 1. 顶层 `help`

用于 `dx --help` 的全局帮助页。

建议字段：

```json
{
  "help": {
    "summary": "统一开发环境管理工具",
    "commandOrder": ["start", "build", "deploy", "db", "test", "worktree"],
    "globalOptions": [
      {
        "flags": ["--dev", "--development"],
        "description": "使用开发环境"
      }
    ],
    "examples": [
      {
        "command": "dx start backend --dev",
        "description": "启动后端开发服务"
      }
    ]
  }
}
```

字段说明：
- `summary`: 顶层摘要
- `commandOrder`: 一级命令展示顺序
- `globalOptions`: 全局 flags 展示
- `examples`: 总帮助页示例

### 2. 一级命令的 `help`

为避免与现有执行树冲突，phase 1 的命令级帮助元数据不直接写入 `start.help` / `deploy.help` 这类运行时可遍历节点，而是放在顶层 `help.commands.<command>` 下。

建议字段：

```json
{
  "help": {
    "commands": {
      "start": {
      "summary": "启动/桥接服务",
      "usage": "dx start <service> [环境标志]",
      "args": [
        {
          "name": "service",
          "required": false,
          "description": "由 start.* 配置决定，默认 dev"
        }
      ],
      "notes": [
        "未指定 service 时默认使用 dev 套件，仅允许 --dev"
      ],
      "examples": [
        {
          "command": "dx start backend --staging",
          "description": "使用 staging 环境启动后端"
        }
      ]
      }
    }
  }
}
```

字段说明：
- `summary`: 命令摘要
- `usage`: 用法字符串
- `args`: 位置参数说明
- `notes`: 补充规则与限制说明
- `examples`: 命令级示例

原因：
- 当前 CLI 会直接遍历并执行 `start.*` / `deploy.*` 下的节点
- 若把帮助元数据直接放在这些命令树下，会被误当成可执行 target
- 因此 phase 1 必须使用不会影响运行语义的安全挂载点

### 3. target 节点的 `help`

phase 1 中，target 级帮助元数据也采用安全挂载点，避免污染现有执行树。推荐挂载在顶层 `help.targets.<command>.<target>` 下；若某 target 节点本身不会被运行时误读，也可在后续阶段评估内嵌形式。

建议字段：

```json
{
  "help": {
    "targets": {
      "deploy": {
        "backend": {
        "summary": "构建并部署 backend 制品到远端主机",
        "notes": [
          "backend 制品发布目标默认使用 --dev"
        ],
        "options": [
          {
            "flags": ["--build-only"],
            "description": "仅构建制品，不执行远端部署"
          }
        ],
        "examples": [
          {
            "command": "dx deploy backend --build-only",
            "description": "仅构建 backend 制品"
          }
        ]
        }
      }
    }
  }
}
```

字段说明：
- `summary`: target 摘要
- `notes`: target 特有提示
- `options`: target 级额外选项
- `examples`: target 级示例

### 4. 可执行配置本身

现有字段继续保留，用于帮助渲染时提取事实信息：
- `command`
- `internal`
- `app`
- `dangerous`
- `ports`
- `dev` / `staging` / `prod` / `test` / `e2e`

CLI 通过这些字段自动渲染：
- 支持的环境
- 是否危险
- 执行类型（shell/internal）
- target 列表

## 节点类型模型

当前 `commands.json` 并不是规则的两层树，而是“异构命令树”。在实现 `help-model` 之前，必须先定义节点 taxonomy。

### 节点类型

#### 1. `command-root`

顶层命令节点，例如：
- `start`
- `build`
- `deploy`
- `db`

职责：
- 挂载该命令的 `help`
- 挂载其下一级 target / 分类节点

#### 2. `target-leaf`

直接可执行的 target 叶子节点，例如：
- `build.shared`
- `start.stagewise-front`
- `db.generate`

识别特征：
- 含 `command` 或 `internal`
- 不只是环境容器

#### 3. `env-container`

按环境分支的 target 容器节点，例如：
- `build.backend`
- `start.backend`
- `db.migrate`

识别特征：
- 子节点以 `dev/prod/staging/test/e2e` 为主
- 当前层本身通常不直接执行

#### 4. `orchestration-node`

用于并发/顺序编排的节点，例如：
- `build.parallelWeb.dev`
- `build.all.dev`
- `dev.all`

识别特征：
- 含 `concurrent` 或 `sequential`
- 含 `commands`

#### 5. `category-node`

纯分类节点，不直接对应用户 target，例如：
- `test.e2e`
- `test.unit`

识别特征：
- 主要用于第二层分组
- 下层才是实际 target

#### 6. `internal-config-bag`

internal handler 的私有配置包，例如：
- `start.stack.stack`
- `deploy.backend.backendDeploy`

识别特征：
- 不应直接暴露为帮助 target
- 只为某个 `internal` 节点提供执行细节

### 渲染规则约束

- `command-root` 一定出现在帮助页导航中
- `target-leaf` 与 `env-container` 可以作为用户可见 target 展示
- `orchestration-node` 默认不单独作为推荐 target 展示，除非显式配置 `help.expose = true`
- `category-node` 用于帮助页分组，不作为最终 target 名称输出
- `internal-config-bag` 永远不直接展示给用户

### 必要的显式标记

为了避免纯启发式识别出错，建议允许少量显式 help 元数据：

```json
{
  "parallelWeb": {
    "help": {
      "expose": false
    }
  }
}
```

```json
{
  "e2e": {
    "help": {
      "nodeType": "category"
    }
  }
}
```

默认仍可启发式识别，但当两者冲突时以显式 `help.nodeType` / `help.expose` 为准。

## 推荐的统一字段约定

为避免配置风格失控，建议统一约束如下：

- 所有帮助文案使用结构化字段，不存储整段预排版文本
- `examples` 必须是对象数组，不允许直接写字符串
- `args` / `options` 中每一项必须显式包含 `description`
- `summary` 保持一句话，避免过长段落
- `notes` 用于限制、约束、默认行为，不用于重复 `summary`

## 字段优先级与回退规则

为避免 `description`、`help.summary`、`usage`、`args` 等字段形成多源冲突，必须定义明确优先级。

### `summary`

- 首选：`help.summary`
- 回退：`description`
- 禁止：同时维护两套语义不同的摘要

规则：
- 若同时存在 `help.summary` 与 `description`，两者语义必须一致
- 渲染器优先显示 `help.summary`
- 一致性测试需要校验两者不冲突

### `usage`

- 首选：`help.usage`
- 回退：由命令注册信息与位置参数规则生成

规则：
- 若存在 `help.usage`，必须通过位置参数规则校验
- 若未配置 `help.usage`，渲染器应基于真实命令形态自动生成基础 usage，避免纯手写漂移

### `args`

- 首选：`help.args`
- 回退：空

规则：
- `help.args` 负责解释参数含义
- 参数是否允许、是否必填，不以 `help.args` 为准，而以真实位置参数规则为准

### `options`

- 首选：`help.options` / 顶层 `help.globalOptions`
- 回退：由 `flags.js` 生成基础 flag 列表

规则：
- 帮助页中的 option 描述来自配置
- 可接受哪些 flag、是否需要值，仍以 `flags.js` 为准
- 若配置中声明了未知 flag，应在 schema/一致性测试中报错

### `examples`

- 首选：`help.examples`
- 不提供自动推导回退

规则：
- `example.command` 必须能通过真实命令/flag/位置参数规则的基础校验
- 示例描述允许自由文案，但示例命令本身必须可解析

## 帮助渲染规则

### `dx --help`

动态展示：
- CLI 标题与版本
- 顶层 `help.summary`
- 顶层命令注册表中的一级命令列表
- 每个命令的 `help.summary`
- 全局选项
- 顶层示例

### `dx help <command>`

动态展示：
- `usage`
- `summary`
- `args`
- 环境说明
- target 列表
- 每个 target 的 `help.summary` 或 `description`
- `notes`
- `examples`

### `dx help <command> <target>`

第二阶段支持，动态展示：
- target 摘要
- 支持的环境
- target 级 options
- target 级 notes
- target 级 examples

## 顶层命令注册表

由于当前可用顶层命令并不完全等价于 `commands.json` 顶层 key，本设计不允许直接枚举配置根节点作为帮助命令列表。

### 第一阶段方案

顶层命令列表继续以 CLI 注册表为准，即：

- `DxCli.commandHandlers`
- 以及必要的兼容命令过滤规则

帮助系统从这里拿到真实可见命令列表，再去 `commands.json` 中查找对应帮助配置。

### 过滤规则

- `dev` 虽然存在 handler，但属于兼容入口，不应出现在主帮助命令列表中
- `help` 自身是系统命令，不需要从 `commands.json` 提供 target 树
- 某些顶层命令如 `worktree`、`contracts`、`release` 当前没有完整 target 树，也必须能显示帮助

### 第二阶段可选演进

若未来引入显式命令注册配置，可将顶层命令注册表迁入配置。但第一阶段不这么做。

## CLI 代码职责

重构后 CLI 帮助相关逻辑建议拆为三个模块。

### `lib/cli/help-schema.js`

职责：
- 校验 `commands.json` 中的 help 元数据是否合法
- 对缺失关键字段、非法字段类型、示例缺少说明等情况快速报错

### `lib/cli/help-model.js`

职责：
- 将原始 `commands.json` 转换为统一的帮助中间模型
- 对命令、target、环境支持、危险标记进行归一化
- 结合真实命令注册表与 flag 定义做一致性校验前预处理

示例接口：

```js
getGlobalHelpModel(commands)
getCommandHelpModel(commands, 'start')
getTargetHelpModel(commands, 'deploy', 'backend')
```

建议新增：

```js
getRegisteredCommands(cli)
classifyCommandNode(node)
resolveVisibleTargets(commandName, commandConfig)
```

### `lib/cli/help-renderer.js`

职责：
- 将中间模型渲染为 CLI 文本输出
- 控制分节、排序、缩进与展示风格

### `lib/cli/help.js`

职责：
- 保留为轻量入口
- 调用 schema/model/renderer
- 不再维护命令正文字符串

### `lib/cli/dx-cli.js`

第一阶段需要的最小改动：
- 允许 `help` 命令继续走动态渲染入口
- 不改变普通命令执行协议
- 如需支持 `dx help <command> <target>`，必须同步调整：
  - `handleHelp`
  - `validatePositionalArgs('help')`
  - 对应帮助入口参数解析

## 一致性与校验规则

为了避免“配置化后只是把问题搬到 JSON”，建议加以下硬性校验：

1. 每个一级命令必须有 `help.summary`
2. 每个 `help.examples[]` 必须包含 `command` 与 `description`
3. `help.args[]` / `help.options[]` 每项必须包含 `name` 或 `flags` 以及 `description`
4. 标记为 `dangerous: true` 的节点，其帮助输出必须带有统一风险提示
5. 帮助里引用的 target 必须真实存在于命令树中
6. 由环境分支推导出的“支持环境”必须与帮助展示一致，不能手写冲突结果
7. `help.options` / `help.globalOptions` 中声明的 flags 必须都存在于真实 flag 定义中
8. `help.usage` 必须能通过真实位置参数规则校验
9. `help.summary` 与 `description` 若同时存在，不得语义冲突
10. 示例命令必须通过“命令存在 + flag 合法 + 位置参数合法”的基础解析

## 迁移策略

采用渐进迁移，避免一次性重写所有帮助逻辑。

### 第一阶段：建立 schema 与渲染器

- 引入 `help-schema.js`
- 引入 `help-model.js`
- 引入 `help-renderer.js`
- 在顶层 `commands.json` 添加最小 `help` 结构
- 接入真实命令注册表与 flag 定义，避免帮助系统自行发明 CLI 语义

### 第二阶段：优先迁移复杂命令

优先迁移：
- `start`
- `deploy`
- `db`

原因：
- 这三类命令约束最多
- 最容易发生帮助漂移
- 对新模型的覆盖最完整

### 第三阶段：迁移剩余命令

逐步迁移：
- `build`
- `test`
- `worktree`
- `clean`
- `cache`
- `status`
- `release`
- `contracts`
- `package`
- `export`

### 第四阶段：删除旧硬编码帮助

- 删除 `help.js` 中大段静态字符串
- 所有帮助渲染统一走新模型
- 若决定支持 `dx help <command> <target>`，在此阶段一并收敛 help 参数校验逻辑

## 兼容性策略

- 初始迁移期允许“新旧并存”：若某命令尚未配置 `help` 元数据，可暂时回退到旧帮助逻辑
- 当核心命令迁移完成后，再移除旧逻辑
- 顶层帮助页应优先展示已配置 `help.summary` 的命令；缺失时可回退到通用占位文本，但同时输出配置警告
- 对于当前没有配置树、但已存在顶层 handler 的命令，允许以“代码注册 + 配置帮助”混合模式过渡

## 测试策略

### 1. Schema 测试

验证：
- `commands.json` 的帮助结构合法
- 关键字段存在
- 非法示例、缺失说明、错误字段类型会触发报错

### 2. 帮助模型测试

验证：
- target 列表提取正确
- 支持环境推导正确
- `dangerous` / `internal` / `command` 等事实信息归一化正确
- 异构节点分类正确，不会把 `category-node` / `internal-config-bag` 误暴露为 target

### 3. 渲染测试

验证：
- `dx --help`
- `dx help start`
- `dx help deploy`
- `dx help contracts`
- `dx help release`

输出包含预期 summary、usage、示例、说明。

### 4. 一致性测试

验证：
- 帮助示例引用的命令与 target 在当前配置中可解析
- 标记危险的命令输出风险提示
- target 的帮助摘要与执行节点存在对应关系
- `help.options` 与真实 flag 定义一致
- `help.usage` 与真实位置参数规则一致

## 风险与权衡

### 风险 1：`commands.json` 体积增大

帮助元数据进入配置后，文件会更大。

权衡：
- 增大是可接受代价，因为换来单一事实源
- 后续若体积过大，可考虑在保持入口不变的前提下按命令拆分配置

### 风险 2：配置灵活度过高导致风格不统一

如果不限制字段风格，帮助结构会逐渐失控。

权衡：
- 必须配合 schema 和约束测试
- 保持 `summary / usage / args / notes / examples` 这一最小结构，不鼓励自由扩展

### 风险 3：迁移期新旧逻辑并存

短期内会存在双轨逻辑。

权衡：
- 这是渐进迁移的必要成本
- 应在核心命令迁移完成后尽快删除旧逻辑

### 风险 4：异构节点树导致模型误判

如果没有 node taxonomy，帮助系统会把编排节点、分类节点、internal config bag 错当成用户可选目标。

权衡：
- 必须先实现节点分类，再做目标渲染
- 必要时允许 `help.nodeType` / `help.expose` 做显式覆盖

### 风险 5：帮助文案与 CLI 真实语义继续分叉

如果 `usage`、`options`、`examples` 只做存在性校验，长期仍会漂移。

权衡：
- 必须引入基于真实 flag/参数规则的帮助一致性测试
- 第一阶段不把语义元数据迁入配置，但要把这些代码来源纳入验证链路

## 最终结论

采用“结构化帮助元数据 + 动态渲染”的方案。

具体原则：
- `commands.json` 承载帮助文案与 target 说明，且与执行配置共存
- 帮助内容不再在 `help.js` 中硬编码
- 帮助配置必须结构化、可校验、可测试
- 命令集合、flag 集合、位置参数规则在第一阶段仍以代码为准
- CLI 负责读取配置、结合真实命令语义来源做归一化与渲染

phase 1 的重要约束：
- 命令级帮助元数据放在 `help.commands.<command>`
- target 级帮助元数据优先放在 `help.targets.<command>.<target>`
- 不直接向现有执行树节点内嵌 `help`，除非明确验证该节点不会被运行时误执行

该方案能在不改变现有执行模型的前提下，解决帮助系统与真实命令配置漂移的问题，并为后续新增命令/target 提供可维护的扩展路径。
