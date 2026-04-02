import { logger } from '../../logger.js'

export async function handleStart(cli, args) {
  const service = args[0] || 'development'

  const environment = cli.determineEnvironment()
  const envKey = cli.normalizeEnvKey(environment)
  const rawConfig = cli.commands.start[service]

  if (!rawConfig) {
    logger.error(`未找到启动配置: ${service}`)
    process.exitCode = 1
    return
  }

  let startConfig = rawConfig
  const isRunnableConfig =
    rawConfig &&
    typeof rawConfig === 'object' &&
    (rawConfig.command || rawConfig.internal || rawConfig.concurrent || rawConfig.sequential)

  if (!isRunnableConfig && rawConfig && typeof rawConfig === 'object') {
    startConfig = rawConfig[envKey] || null
  }

  if (!startConfig) {
    logger.error(`启动目标 ${service} 未提供 ${cli.getEnvironmentFlagExample(envKey) || envKey} 环境配置。`)
    process.exitCode = 1
    return
  }

  logger.step(`启动 ${service} 服务 (${environment})`)

  if (startConfig.concurrent && Array.isArray(startConfig.commands)) {
    await cli.handleConcurrentCommands(startConfig.commands, 'start', envKey)
    return
  }

  if (startConfig.sequential && Array.isArray(startConfig.commands)) {
    await cli.handleSequentialCommands(startConfig.commands, envKey)
    return
  }

  const ports = cli.collectStartPorts(service, startConfig, envKey)

  if (envKey === 'development' && ports.length > 0) {
    logger.info(`开发环境自动清理端口: ${ports.join(', ')}`)
  }

  const configToExecute = {
    ...startConfig,
    ...(ports.length > 0 ? { ports } : {}),
    ...(envKey === 'development' ? { forcePortCleanup: true } : {}),
  }

  // 为执行阶段构造环境标志，确保 dotenv 选择正确层
  await cli.executeCommand(configToExecute, cli.createExecutionFlags(environment))
}
