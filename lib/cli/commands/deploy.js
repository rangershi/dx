import { logger } from '../../logger.js'
import { envManager } from '../../env.js'
import { validateEnvironment } from '../../validate-env.js'

export async function handleDeploy(cli, args) {
  const target = args[0]
  if (!target) {
    logger.error('请指定部署目标: front, admin, all')
    logger.info(`用法: ${cli.invocation} deploy <target> [环境标志]`)
    logger.info(`示例: ${cli.invocation} deploy front --staging`)
    process.exitCode = 1
    return
  }

  const normalizedTarget = String(target).toLowerCase()
  const deployTargets = Object.keys(cli.commands.deploy || {})
  if (!cli.commands.deploy?.[normalizedTarget]) {
    logger.error(`未找到部署目标: ${target}`)
    if (deployTargets.length > 0) {
      logger.info(`可用目标: ${deployTargets.join(', ')}`)
    }
    logger.info(`用法: ${cli.invocation} deploy <target> [环境标志]`)
    process.exitCode = 1
    return
  }

  if (cli.flags.test || cli.flags.e2e) {
    logger.error('deploy 命令仅支持 --dev/--staging/--prod 环境标志')
    process.exitCode = 1
    return
  }

  const selectedEnvs = []
  if (cli.flags.dev) selectedEnvs.push('development')
  if (cli.flags.staging) selectedEnvs.push('staging')
  if (cli.flags.prod) selectedEnvs.push('production')

  if (selectedEnvs.length > 1) {
    logger.error('deploy 命令不支持同时传入多个环境标志')
    logger.info('请使用 --dev、--staging 或 --prod 中的一个')
    process.exitCode = 1
    return
  }

  const environment = selectedEnvs[0] || 'staging'

  cli.ensureRepoRoot()

  // 只执行基础环境校验（检查 .env 文件结构），跳过后端环境变量校验
  // Vercel 部署所需的环境变量由 vercel-deploy.js 自行校验
  try {
    validateEnvironment()
  } catch (error) {
    logger.error(error.message)
    process.exitCode = 1
    return
  }

  // 加载环境变量层，但不校验后端必需变量
  const layeredEnv = envManager.collectEnvFromLayers(null, environment)
  if (envManager.latestEnvWarnings && envManager.latestEnvWarnings.length > 0) {
    envManager.latestEnvWarnings.forEach(message => logger.warn(message))
  }

  // 仅在目标变量不存在或是占位符时才使用 .env 文件的值
  for (const [key, value] of Object.entries(layeredEnv)) {
    const currentValue = process.env[key]
    if (!currentValue || envManager.isPlaceholderEnvValue(currentValue)) {
      process.env[key] = value
    }
  }
  envManager.syncEnvironments(environment)

  const { deployToVercel } = await import('../../vercel-deploy.js')
  await deployToVercel(normalizedTarget, { environment })
}
