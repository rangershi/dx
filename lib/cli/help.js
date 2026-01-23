export function showHelp() {
  console.log(`
DX CLI - 统一开发环境管理工具

用法:
  dx <命令> [选项] [参数...]

命令:
  start [service] [环境标志]  启动/桥接服务
    service: backend, front, admin, all, dev, stack, stagewise-front, stagewise-admin (默认: dev)
    stack: PM2 交互式服务栈管理（推荐）- 同时启动三个服务并提供交互式命令
    环境标志: --dev, --staging, --prod, --test, --e2e（支持别名 --development、--production 等）
    说明: 传入 --staging 时会加载 '.env.staging(.local)' 层，同时复用生产构建/启动流程

  build [target] [环境标志]   构建应用
    target: backend, shared, front, admin, mobile, all, sdk, affected (默认: all)
    环境标志: --dev, --staging, --prod, --test, --e2e（未指定时默认 --dev）

  deploy <target> [环境标志]  部署前端到 Vercel
    target: front, admin, telegram-bot, all
    环境标志: --dev, --staging, --prod（默认 --staging）

  install                  安装依赖（使用 frozen-lockfile 确保版本一致）

  package backend [环境标志]  构建后端部署包（生成 backend-<version>-<sha>.tar.gz）
    环境标志: --dev, --staging, --prod, --test, --e2e（默认 --dev）
    产物位置: dist/backend/backend-*.tar.gz
    内含: dist/、node_modules(生产依赖)、prisma/、config/.env.runtime、bin/start.sh

  db [action] [环境标志]      数据库操作
    action: generate, migrate, deploy, reset, seed, format, script
    用法示例:
      dx db migrate --dev --name add_user_table   # 创建新的迁移（开发环境需指定名称）
      dx db deploy --dev                          # 应用开发环境已有迁移
      dx db deploy --prod                         # 生产环境迁移（复用 deploy 流程，需确认）
      dx db script fix-email-verified-status --dev  # 运行数据库脚本（开发环境）
      dx db script fix-pending-transfer-status --prod  # 运行数据库脚本（生产环境，需确认）
      dx db script my-script --dev -- --arg1 --arg2  # 向脚本传递额外参数（-- 后面的部分）

  test [type] [target] [path] [-t pattern]  运行测试
    type: e2e, unit (默认: e2e)
    target: backend, all (默认: all)
    path: 测试文件路径 (可选，仅支持e2e backend)
    -t pattern: 指定测试用例名称模式 (可选，需要和path一起使用)

  worktree [action] [num...] Git Worktree管理
    action: make, del, list, clean
    num: issue编号 (make时需要1个，del时支持多个)
    支持批量删除: dx worktree del 123 456 789
    支持非交互式: dx worktree del 123 -Y
  注意：该封装与原生 git worktree 行为不同，勿混用

  lint                   运行代码检查

  clean [target]         清理操作
    target: all, deps (默认: all)

  cache [action]         缓存清理
    action: clear (默认: clear)

  status                 查看系统状态

选项:
 --dev, --development   使用开发环境
 --prod, --production   使用生产环境
  --staging, --stage    使用预发环境（加载 .env.staging*.，复用生产流程）
  --test                 使用测试环境
  --e2e                  使用E2E测试环境
  -Y, --yes              跳过所有确认提示
  -v, --verbose          详细输出
  -h, --help             显示此帮助信息

示例:
  dx start stack            # PM2 交互式服务栈（推荐）- 同时管理三个服务
  dx start backend --dev    # 启动后端开发服务
  dx start front --dev      # 启动用户前端开发服务
  dx start admin --dev      # 启动管理后台开发服务
  dx start all              # 同时启动所有开发服务（默认 --dev）
  dx build all --prod       # 构建所有应用(生产环境)
  dx db deploy --dev       # 应用开发环境数据库迁移
  dx db reset --prod -Y     # 重置生产数据库(跳过确认)
  dx test e2e backend                           # 运行后端E2E测试
  dx test e2e backend e2e/activity/activity.admin.e2e-spec.ts  # 运行单个E2E测试文件
  dx test e2e backend e2e/activity/activity.admin.e2e-spec.ts -t "should list all activity definitions"  # 运行特定测试用例
  dx deploy front --staging # 部署前端到 Vercel（staging）
  dx worktree make 88       # 为issue #88创建worktree
  dx worktree del 88        # 删除issue #88的worktree
  dx worktree del 88 89 90 -Y  # 批量删除多个worktree（非交互式）
  dx worktree list          # 列出所有worktree
  dx clean deps             # 清理并重新安装依赖
  dx cache clear            # 清除 Nx 与依赖缓存

  # Stagewise 桥接（固定端口，自动清理占用）
  dx start stagewise-front      # 桥接 front: 3001 -> 3002（工作目录 apps/front）
  dx start stagewise-admin      # 桥接 admin-front: 3500 -> 3501（工作目录 apps/admin-front）

  # Start 用法示例
  dx start backend --prod       # 以生产环境变量启动后端
  dx start backend --dev        # 以开发环境变量启动后端
  dx start backend --e2e        # 以 E2E 环境变量启动后端


`)
}

export function showCommandHelp(command) {
  const name = String(command || '').toLowerCase()

  switch (name) {
    case 'build':
      console.log(`
build 命令用法:
  dx build <target> [环境标志]

参数说明:
  target: backend, front, admin, shared, mobile, sdk, all, affected
  环境标志: --dev、--staging、--prod、--test、--e2e（默认 --dev）

常见示例:
  dx build backend --staging    # 使用 staging 环境变量构建后端 (prod 流程)
  dx build front --prod         # 强制以生产配置构建前端
  dx build mobile --staging     # 构建移动端 APK (staging 环境)
  dx build mobile --prod        # 构建移动端 APK (生产环境)
  dx build affected --dev       # 针对受影响项目执行开发态构建

提示: 可通过 dx build <target> 分别构建受影响应用。
`)
      return

    case 'db':
      console.log(`
db 命令用法:
  dx db <action> [options]

可选 action:
  generate | migrate | deploy | reset | seed | format | script

环境说明:
  通过 --dev、--staging、--prod、--test、--e2e 指定 APP_ENV（默认 --dev）
  --staging 会加载 .env.staging*. 文件，并复用 prod 的 Prisma / Nx 流程

附加参数:
  --name/-n <migration-name>    # 开发环境执行 migrate 必填，禁止通过位置参数传递

帮助提示:
  - 未提供迁移名称时命令会直接报错退出，避免 Prisma 进入交互式输入
  - 使用模式示例: dx db migrate --dev --name init-user-table
  - 如需仅执行已有迁移（本地/CI/生产），请使用 dx db deploy（无需 --name）

script 子命令:
  dx db script <script-name> [环境标志] [-- <脚本参数>...]
  运行位于 apps/backend/prisma/scripts/ 目录下的数据库脚本

  脚本参数说明:
    使用 -- 分隔符后可传递任意参数给目标脚本
    例如: dx db script my-script --dev -- --skip-cleanup --note="test"

示例:
  dx db migrate --dev --name init-user-table     # 创建新迁移（开发环境）
  dx db deploy --dev                             # 应用开发环境已有迁移
  dx db deploy --staging                         # 复用生产命令，加载 staging 环境变量
  dx db reset --prod -Y                          # 生产环境重置 (需确认)
  dx db script fix-email-verified-status --dev   # 运行数据库脚本（开发环境）
  dx db script fix-pending-transfer-status --prod -Y  # 运行数据库脚本（生产环境，跳过确认）
  dx db script guest-cleanup-verification --dev -- --help  # 查看脚本帮助
  dx db script guest-cleanup-verification --dev -- --skip-cleanup --note="dry run"  # 传递脚本参数
`)
      return

    case 'deploy':
      console.log(`
deploy 命令用法:
  dx deploy <target> [环境标志]

参数说明:
  target: front, admin, telegram-bot, all
  环境标志: --dev、--staging、--prod（默认 --staging）

常见示例:
  dx deploy front --staging           # 部署用户前端（staging）
  dx deploy admin --prod              # 部署管理后台（生产）
  dx deploy telegram-bot --staging    # 部署 Telegram Bot + 自动配置 Webhook
  dx deploy all --staging             # 串行部署 front + admin
`)
      return

    case 'start':
      console.log(`
start 命令用法:
  dx start <service> [环境标志]

服务说明:
  service: backend, dev, stagewise-front, stagewise-admin

环境说明:
  支持 --dev、--staging、--prod、--test、--e2e。--staging 会注入 .env.staging*. 层并复用 prod 启动流程

常见示例:
  dx start backend --staging    # 使用 staging 配置启动后端 (生产模式流程)
  dx start stagewise-front      # Stagewise 桥接用户前端，端口 3001 -> 3002

提示: service 省略时默认启动 dev 套件，可结合 --dev/--staging/--prod 标志使用。
`)
      return

    default:
      showHelp()
  }
}
