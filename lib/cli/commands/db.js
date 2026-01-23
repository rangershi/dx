import { logger } from '../../logger.js'
import { confirmManager } from '../../confirm.js'
import { envManager } from '../../env.js'
import { getPassthroughArgs } from '../args.js'

export async function handleDatabase(cli, args) {
  const action = args[0]
  if (!action) {
    logger.error('请指定数据库操作: generate, migrate, deploy, reset, seed, format, script')
    process.exitCode = 1
    return
  }

  const dbConfig = cli.commands.db[action]
  if (!dbConfig) {
    logger.error(`未找到数据库操作: ${action}`)
    process.exitCode = 1
    return
  }

  const environment = cli.determineEnvironment()
  const envKey = cli.normalizeEnvKey(environment)

  // 兼容旧用法：非 dev 环境使用 migrate 时给出明确提示，推荐改用 deploy
  if (action === 'migrate' && envKey && envKey !== 'dev') {
    const envFlag = cli.getEnvironmentFlagExample(envKey) || `--${envKey}`
    logger.warn(`检测到在非开发环境执行 migrate: ${environment || envKey}`)
    logger.info('建议仅在开发环境使用 `dx db migrate --dev --name <migration-name>` 创建迁移。')
    logger.info(`如需在当前环境应用已有迁移，请使用: ${cli.invocation} db deploy ${envFlag}`)
  }

  // 处理 script 子命令
  if (action === 'script') {
    const scriptName = args[1]
    if (!scriptName) {
      logger.error('请指定要运行的脚本名称')
      logger.info('用法: dx db script <script-name> [环境标志]')
      logger.info('示例: dx db script fix-email-verified-status --dev')
      process.exitCode = 1
      return
    }
    return await handleDatabaseScript(cli, scriptName, envKey, dbConfig)
  }

  logger.step(`执行数据库操作: ${action} (${environment})`)

  // 处理嵌套配置
  let config = dbConfig
  if (typeof config === 'object' && !config.command) {
    // 如果是嵌套配置，尝试获取环境特定的配置（兼容 dev/prod 与 development/production 命名）
    if (config[envKey]) config = config[envKey]
    else if (envKey === 'staging' && config.prod) config = config.prod
    else config = config.dev || config
  }

  // 危险操作确认
  if (config.dangerous) {
    const confirmed = await confirmManager.confirmDatabaseOperation(
      action,
      envManager.getEnvironmentDescription(environment),
      cli.flags.Y,
    )

    if (!confirmed) {
      logger.info('操作已取消')
      return
    }
  }

  // 支持为 migrate 传入迁移名：--name/-n
  let command = config.command
  if (action === 'migrate' && envKey === 'dev') {
    const allArgs = cli.args
    let migrationName = null
    // 优先解析显式标志 --name/-n
    const nameIdx = allArgs.indexOf('--name')
    const shortIdx = allArgs.indexOf('-n')
    if (nameIdx !== -1 && nameIdx + 1 < allArgs.length) {
      migrationName = allArgs[nameIdx + 1]
    } else if (shortIdx !== -1 && shortIdx + 1 < allArgs.length) {
      migrationName = allArgs[shortIdx + 1]
    }

    if (!migrationName) {
      logger.error('开发环境执行 migrate 时必须通过 --name 或 -n 指定迁移名称（禁止位置参数）')
      logger.info('原因: 缺少迁移名会进入 Prisma 的交互式输入流程，脚本将被阻塞。')
      logger.info(`正确示例: ${cli.invocation} db migrate --dev --name init-user-table`)
      logger.info(`如仅需应用已有迁移，请使用 ${cli.invocation} db deploy --dev。`)
      logger.info(`提示: 执行 ${cli.invocation} help db 查看完整用法与更多示例。`)
      process.exitCode = 1
      return
    }

    const escaped = String(migrationName).replace(/(["`\\$])/g, '\\$1')
    // 将参数传递给 Nx 下游 prisma：需要通过 -- 分割
    command = `${command} -- --name "${escaped}"`
    logger.info(`使用迁移名: ${migrationName}`)
  }

  // 对以下数据库操作固定禁用 Nx 缓存，避免命中缓存导致未实际执行：generate/migrate/deploy/reset/seed
  const disableCacheActions = new Set(['generate', 'migrate', 'deploy', 'reset', 'seed'])
  const extraEnv = disableCacheActions.has(action) ? { NX_CACHE: 'false' } : {}
  if (disableCacheActions.has(action)) {
    logger.info('为数据库操作禁用 Nx 缓存: NX_CACHE=false')
    // 为每个子命令注入 --skip-nx-cache（支持 && || ; 拼接的多命令）
    command = command
      .split(/(\s*&&\s*|\s*\|\|\s*|\s*;\s*)/)
      .map(part => {
        // 保留分隔符原样
        if (/^(\s*&&\s*|\s*\|\|\s*|\s*;\s*)$/.test(part)) return part
        // 跳过空字符串
        if (!part.trim()) return part
        // 只对 npx nx 命令注入
        if (!part.includes('npx nx')) return part
        // 在 -- 之前插入，或追加到末尾
        if (part.includes(' -- ')) {
          return part.replace(' -- ', ' --skip-nx-cache -- ')
        }
        return `${part} --skip-nx-cache`
      })
      .join('')
  }

  if (action === 'reset' && envKey !== 'prod') {
    extraEnv.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION = 'yes'
    logger.info('非生产环境重置数据库，已自动确认危险操作: PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=yes')
  }

  const execFlags = { ...cli.flags }
  ;['dev', 'development', 'prod', 'production', 'test', 'e2e', 'staging', 'stage'].forEach(
    key => delete execFlags[key],
  )
  if (envKey === 'prod') execFlags.prod = true
  else if (envKey === 'dev') execFlags.dev = true
  else if (envKey === 'test') execFlags.test = true
  else if (envKey === 'e2e') execFlags.e2e = true
  else if (envKey === 'staging') execFlags.staging = true

  await cli.executeCommand(
    { ...config, command, env: { ...(config.env || {}), ...extraEnv } },
    execFlags,
  )
}

export async function handleDatabaseScript(cli, scriptName, envKey, dbConfig) {
  // 自动去除 .ts 扩展名（如果用户提供了）
  const cleanScriptName = scriptName.endsWith('.ts') ? scriptName.slice(0, -3) : scriptName

  // 基础路径校验，避免路径遍历
  if (
    cleanScriptName.includes('/') ||
    cleanScriptName.includes('\\') ||
    cleanScriptName.includes('..')
  ) {
    logger.error(`脚本名称不能包含路径分隔符或父目录引用: ${cleanScriptName}`)
    process.exitCode = 1
    return
  }

  const { existsSync } = await import('fs')
  const { join, resolve, relative } = await import('path')
  const scriptsRoot = join(process.cwd(), 'apps/backend/prisma/scripts')
  const scriptPath = resolve(scriptsRoot, `${cleanScriptName}.ts`)

  if (relative(scriptsRoot, scriptPath).startsWith('..')) {
    logger.error(`脚本路径解析结果已超出允许目录: ${scriptPath}`)
    process.exitCode = 1
    return
  }

  if (!existsSync(scriptPath)) {
    logger.error(`脚本文件不存在: ${scriptPath}`)
    logger.info('可用的脚本文件位于: apps/backend/prisma/scripts/')
    process.exitCode = 1
    return
  }

  const environment = envKey === 'dev' ? 'development' : envKey === 'prod' ? 'production' : envKey
  logger.step(`执行数据库脚本: ${cleanScriptName} (${environment})`)
  logger.info(`脚本路径: ${scriptPath}`)

  // 处理嵌套配置
  let config = dbConfig
  if (typeof config === 'object' && !config.command) {
    if (config[envKey]) config = config[envKey]
    else if (envKey === 'staging' && config.prod) config = config.prod
    else config = config.dev || config
  }

  // 危险操作确认
  if (config.dangerous && envKey === 'prod') {
    const confirmed = await confirmManager.confirmDatabaseOperation(
      `script: ${cleanScriptName}`,
      envManager.getEnvironmentDescription(environment),
      cli.flags.Y,
    )

    if (!confirmed) {
      logger.info('操作已取消')
      return
    }
  }

  // 替换命令中的脚本名称占位符
  let command = config.command.replace('{SCRIPT_NAME}', cleanScriptName)

  // 获取 -- 后面的 passthrough 参数并追加到命令
  const passthroughArgs = getPassthroughArgs(cli.args)
  if (passthroughArgs.length > 0) {
    const escapedArgs = passthroughArgs.map(arg => {
      // 对包含空格或特殊字符的参数加引号
      if (/[\s"'`$\\]/.test(arg)) {
        return `"${arg.replace(/(["`\\$])/g, '\\$1')}"`
      }
      return arg
    })
    command = `${command} ${escapedArgs.join(' ')}`
    logger.info(`传递给脚本的参数: ${passthroughArgs.join(' ')}`)
  }

  // 为脚本执行禁用 Nx 缓存
  const extraEnv = { NX_CACHE: 'false' }
  logger.info('为数据库脚本禁用 Nx 缓存: NX_CACHE=false')

  const execFlags = { ...cli.flags }
  ;['dev', 'development', 'prod', 'production', 'test', 'e2e', 'staging', 'stage'].forEach(
    key => delete execFlags[key],
  )
  if (envKey === 'prod') execFlags.prod = true
  else if (envKey === 'dev') execFlags.dev = true
  else if (envKey === 'test') execFlags.test = true
  else if (envKey === 'e2e') execFlags.e2e = true
  else if (envKey === 'staging') execFlags.staging = true

  await cli.executeCommand(
    { ...config, command, env: { ...(config.env || {}), ...extraEnv } },
    execFlags,
  )
}
