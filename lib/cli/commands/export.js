import { logger } from '../../logger.js'

export async function handleExport(cli, args) {
  const target = args[0]
  if (!target) {
    logger.error('请指定导出目标')
    logger.info(`用法: ${cli.invocation} export <target> [环境标志]`)
    process.exitCode = 1
    return
  }

  const exportConfig = cli.commands.export?.[target]
  if (!exportConfig) {
    const targets = Object.keys(cli.commands.export || {})
    logger.error(`未找到导出目标: ${target}`)
    if (targets.length > 0) {
      logger.info(`可用目标: ${targets.join(', ')}`)
    }
    process.exitCode = 1
    return
  }

  const environment = cli.determineEnvironment()
  const envKey = cli.normalizeEnvKey(environment)
  let config = exportConfig
  if (typeof config === 'object' && !config.command) {
    if (config[envKey]) config = config[envKey]
    else if (envKey === 'staging' && config.prod) config = config.prod
    else config = config.dev || config
  }

  logger.step(`导出 ${target} (${environment})`)
  await cli.executeCommand(config)
}
