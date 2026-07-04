---
name: online-debug-guard
description: 仅在用户显式调用 $online-debug-guard 或明确要求使用 online-debug-guard 技能时使用；不要通过关键词、任务类型或上下文自动触发。
---

# 在线调试安全护栏

## 概览

在线调试先确认环境，再按环境选择门禁。只有 `production` 需要检查当前是否为 Plan 模式；其他环境不做 Plan 模式门禁。

调试默认只读取证。需要改变远程状态、数据状态或进程状态时，先停下并取得用户明确授权。

## 执行流程

1. 识别目标环境。
2. 如果目标环境是 `production`，校验当前会话是否为 Plan 模式。
3. 使用 SSH config 连接远程机器。
4. 通过远程运行时、pm2、shared 环境变量目录和当前代码目录取证。
5. 汇总目标环境、门禁结果、关键证据和下一步建议。

## 1. 识别目标环境

只接受 `development`、`staging`、`production` 三种值。

如果用户未显式给出环境：
- 先询问用户当前环境。
- 若无法确认，则默认 `development`，并明确告知本次按 `development` 执行。

如果用户给了其他环境名，例如 `prod1`、`test`：
- 立即终止。
- 提示：`环境无效，仅支持 development/staging/production。`

## 2. Production 门禁

当且仅当目标环境是 `production` 时，必须确认当前处于 Plan 模式。

如果不是 Plan 模式，立即终止并提示：

```text
已终止：当前为 production 环境，但会话不在 Plan 模式。
请切换到 Plan 模式后再继续在线调试。
```

`development` 和 `staging` 不需要检查 Plan 模式，也不需要检查本地 `.env.*` 文件是否存在。

## 3. 远程连接规范

调试或查找问题时，通过本机 SSH config 中已有的 Host 配置连接远程机器。

远程连接参数固定来自以下 SSH config Host：
- `production` 环境：`ai-prod`
- `staging` 环境：`ai-staging`

```bash
ssh ai-prod
ssh ai-staging
```

连接后如果需要 root 权限，运行：

```bash
sudo -s
```

不要手写散落的 IP、用户名、私钥路径或临时 SSH 参数；优先复用 SSH config，避免连错机器。

## 4. 远程取证规范

远程服务通常由 pm2 管理。优先使用 pm2 的只读命令获取信息，例如：

```bash
pm2 list
pm2 describe <app>
pm2 logs <app> --lines 200
pm2 env <id>
```

远程环境变量通常在：

```text
/home/ubuntu/work/{$project_name}/shared
```

需要数据库、Redis、第三方服务等连接参数时，到该目录读取对应环境文件或配置。读取机密时只用于定位问题，不在最终回复中暴露完整密钥、密码或 token。

## 5. 代码与产物边界

本地运行代码一般在当前目录下执行。

远程机器上运行的是编译后的产物。排查时区分：
- 本地源码：用于阅读、复现、运行测试和定位实现逻辑。
- 远程产物：用于确认线上实际运行版本、pm2 进程、日志、环境变量和部署状态。

不要假设远程源码与本地源码完全一致；需要时用版本号、提交 SHA、构建时间、pm2 环境或部署目录内容交叉确认。

## 安全规则

- 默认只读：优先查询、检查、对比、日志分析。
- 未获用户明确授权前，禁止写库、删键、迁移、重启、reload、发布、修改远程文件或改环境变量。
- 需要执行写操作时，先说明操作对象、影响范围、回滚方式和为什么必须这么做。
- 输出结论必须包含：目标环境、Plan 门禁是否适用与结果、关键证据、下一步建议。

## 标准开场模板

```text
开始在线调试前先执行安全门禁：
1) 确认环境（development/staging/production）
2) 只有 production 需要校验当前是否为 Plan 模式
3) 门禁通过后，通过 SSH config 连接远程机器，并优先用 pm2、shared 环境目录和日志只读取证
```
