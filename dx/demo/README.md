# dx Demo

这个目录是一份给同事直接参考的 `dx` 配置示例。

目标只有一个：
把 `dx` 在项目里的最小可用配置讲清楚，并且只展示当前已经采用的严格新规范，不保留任何旧兼容写法。

## 这份 Demo 的边界

- 这是 `dx` 配置示例，不是完整业务项目。
- 这里只演示 `dx/config/*` 应该怎么组织。
- 这里的环境键只使用：
  - `development`
  - `staging`
  - `production`
- CLI 环境标志只使用：
  - `--dev`
  - `--staging`
  - `--prod`

不再支持也不推荐以下旧写法：

- `dev` / `prod` 作为配置节点名
- `--development` / `--production` / `--stage`
- 任何“自动回退到旧配置”的行为

如果配置不符合规范，当前 `dx` 会直接报错，而不是帮你兼容。

## 目录结构

```text
dx/demo/
  README.md
  config/
    commands.json
    env-layers.json
    env-policy.jsonc
```

三份配置各自负责：

- [commands.json](/Users/a1/work/dx/dx/demo/config/commands.json)：定义命令树、执行方式、帮助信息
- [env-layers.json](/Users/a1/work/dx/dx/demo/config/env-layers.json)：定义每个环境加载哪些 `.env` 文件
- [env-policy.jsonc](/Users/a1/work/dx/dx/demo/config/env-policy.jsonc)：定义环境变量布局、机密字段和 required 规则

## `commands.json` 怎么看

[commands.json](/Users/a1/work/dx/dx/demo/config/commands.json) 是核心文件。

这里有两类内容：

1. 命令执行配置

例如：

```json
{
  "start": {
    "backend": {
      "development": {
        "command": "npx nx dev backend",
        "app": "backend"
      },
      "production": {
        "command": "npx nx start backend",
        "app": "backend"
      }
    }
  }
}
```

这表示：

- `dx start backend --dev` 走 `start.backend.development`
- `dx start backend --prod` 走 `start.backend.production`

2. 帮助信息配置

例如：

```json
{
  "help": {
    "summary": "dx demo 配置（严格新规范示例）",
    "commands": {
      "start": {
        "summary": "启动示例服务"
      }
    }
  }
}
```

这表示：

- `dx --help`
- `dx help start`

这些帮助输出会从配置动态生成，而不是从代码里的硬编码文案生成。

## `commands.json` 的规则

这份 demo 里有几个关键约束：

### 1. 环境分支必须写完整名

要写：

```json
"development": { ... }
"staging": { ... }
"production": { ... }
```

不要写：

```json
"dev": { ... }
"prod": { ... }
```

### 2. CLI 入口统一用短环境标志

命令行里统一写：

```bash
dx start backend --dev
dx build all --staging
dx build backend --prod
```

### 3. 默认开发套件显式落在 `start.development`

这份 demo 里专门保留了：

```json
"start": {
  "development": {
    "concurrent": true,
    "commands": [
      "start.backend.development",
      "start.front.development",
      "start.admin.development"
    ]
  }
}
```

这样：

- `dx start`
- `dx start --dev`

都能明确落到默认开发套件，而不是依赖任何旧兼容分支。

### 4. `stack` 只支持 `dx start stack`

这份 demo 里演示的是：

```bash
dx start stack
```

不再使用任何 `dx start stack front` / `stack admin` 这种旧式兼容入口。

### 5. 帮助信息也必须跟真实命令树一致

帮助里的示例必须是真能执行的命令，不能写“帮助里有、配置里没有”的形式。

## `env-layers.json` 怎么看

[env-layers.json](/Users/a1/work/dx/dx/demo/config/env-layers.json) 只负责一件事：
定义每个环境加载哪些 `.env` 文件。

当前 demo 是最简单的三层环境：

```json
{
  "development": [".env.development", ".env.development.local"],
  "staging": [".env.staging", ".env.staging.local"],
  "production": [".env.production", ".env.production.local"]
}
```

含义是：

- committed 文件放默认值或占位值
- `.local` 文件放本机真实值

## `env-policy.jsonc` 怎么看

[env-policy.jsonc](/Users/a1/work/dx/dx/demo/config/env-policy.jsonc) 负责环境变量治理。

这份 demo 展示了三件事：

1. 哪些环境存在
2. 哪些 key 是机密
3. 每个 target 在不同环境下要求哪些变量

重点看这几段：

- `environments`
- `keys.secret`
- `appToTarget`
- `targets.*.required`

如果同事要接入新项目，通常最先要改的是：

- `appToTarget`
- `targets`
- `keys`

## 最小试跑步骤

在仓库根目录执行：

```bash
node ./bin/dx.js --config-dir ./dx/demo/config --help
node ./bin/dx.js --config-dir ./dx/demo/config help start
```

如果想体验命令解析而不真正接入业务项目，优先看帮助输出即可。

如果要在真实项目里接入：

1. 把 `dx/demo/config` 复制成项目自己的 `dx/config`
2. 按项目实际 app 名称修改 `commands.json`
3. 按项目实际环境变量修改 `env-policy.jsonc`
4. 按项目实际 `.env` 组织修改 `env-layers.json`

## 建议同事怎么改

### 新增一个命令目标

例如新增 `start.worker`：

1. 在 `commands.json` 的 `start` 下增加 `worker`
2. 明确写出 `development` / `production` 分支
3. 如果这个目标需要帮助说明，再在 `help.commands.start` 或后续 `help.targets.start.worker` 中补说明

### 新增一个环境变量

1. 先决定这个变量属于哪个 target
2. 更新 `env-policy.jsonc` 的 `targets.<target>.required`
3. 如果是机密，再加入 `keys.secret`

### 新增一个帮助示例

直接改 [commands.json](/Users/a1/work/dx/dx/demo/config/commands.json) 里的 `help` 区域，不要去改 CLI 代码。

## 给同事的结论

如果你要在新项目里接 `dx`，直接照着这个 demo 配：

- 命令树看 [commands.json](/Users/a1/work/dx/dx/demo/config/commands.json)
- 环境层看 [env-layers.json](/Users/a1/work/dx/dx/demo/config/env-layers.json)
- 环境变量治理看 [env-policy.jsonc](/Users/a1/work/dx/dx/demo/config/env-policy.jsonc)

不要引入任何旧兼容写法。

项目需要什么，就把配置写清楚；写错了就让 `dx` 直接报错，然后改配置。
