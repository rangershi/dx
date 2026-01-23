import { logger } from '../../logger.js'

export async function handleStart(cli, args) {
  const service = args[0] || 'dev'

  // 处理 stack 子命令 - PM2 交互式管理
  if (service === 'stack') {
    await import('./stack.js')
    return  // stack.js 会接管执行流程
  }

  const environment = cli.determineEnvironment()
  const envKey = cli.normalizeEnvKey(environment)

  let rawConfig = cli.commands.start[service]
  let configNamespace = 'start'

  if (!rawConfig && cli.commands.dev?.[service]) {
    if (envKey !== 'dev') {
      logger.error(`目标 ${service} 仅支持开发环境启动，请使用 --dev 或省略环境标志。`)
      process.exitCode = 1
      return
    }
    rawConfig = cli.commands.dev[service]
    configNamespace = 'dev'
    logger.info(`检测到 legacy "dev" 配置，已自动回退至 ${service} 开发脚本。`)
  }

  if (!rawConfig) {
    logger.error(`未找到启动配置: ${service}`)
    process.exitCode = 1
    return
  }

  let startConfig = rawConfig
  if (configNamespace === 'start' && rawConfig && typeof rawConfig === 'object') {
    if (rawConfig[envKey]) startConfig = rawConfig[envKey]
    else if (envKey === 'staging' && rawConfig?.prod) startConfig = rawConfig.prod
  }

  if (!startConfig) {
    logger.error(`启动目标 ${service} 未提供 ${environment} 环境配置。`)
    process.exitCode = 1
    return
  }

  logger.step(`启动 ${service} 服务 (${environment})`)

  if (startConfig.concurrent && Array.isArray(startConfig.commands)) {
    await cli.handleConcurrentCommands(startConfig.commands, configNamespace, envKey)
    return
  }

  if (startConfig.sequential && Array.isArray(startConfig.commands)) {
    await cli.handleSequentialCommands(startConfig.commands, envKey)
    return
  }

  const ports = cli.collectStartPorts(service, startConfig, envKey)

  if (envKey === 'dev' && ports.length > 0) {
    logger.info(`开发环境自动清理端口: ${ports.join(', ')}`)
  }

  const configToExecute = {
    ...startConfig,
    ...(ports.length > 0 ? { ports } : {}),
    ...(envKey === 'dev' ? { forcePortCleanup: true } : {}),
  }

  // 为执行阶段构造环境标志，确保 dotenv 选择正确层
  const execFlags = { ...cli.flags }
  ;['dev', 'development', 'prod', 'production', 'test', 'e2e', 'staging', 'stage'].forEach(
    key => delete execFlags[key]
  )
  if (envKey === 'prod') execFlags.prod = true
  else if (envKey === 'dev') execFlags.dev = true
  else if (envKey === 'test') execFlags.test = true
  else if (envKey === 'e2e') execFlags.e2e = true
  else if (envKey === 'staging') execFlags.staging = true

  await cli.executeCommand(configToExecute, execFlags)
}
