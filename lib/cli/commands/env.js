import { logger } from '../../logger.js'
import {
  describeEnvProfiles,
  executeWithEnvProfile,
  validateEnvProfile,
} from '../../env-profile.js'
import { getPassthroughArgs } from '../args.js'
import { COMMAND_NOT_HANDLED } from '../command-result.js'

function hasExplicitEnvironment(flags = {}) {
  return Boolean(flags.dev || flags.staging || flags.prod || flags.test || flags.e2e)
}

function normalizeDxEnvironmentFlag(flag) {
  switch (flag) {
    case '--dev':
      return 'development'
    case '--staging':
      return 'staging'
    case '--prod':
      return 'production'
    case '--test':
      return 'test'
    case '--e2e':
      return 'e2e'
    default:
      return null
  }
}

function prepareChildCommand(cli, command, args, environment) {
  if (command !== 'dx') return { command, args }

  const explicit = args
    .map(normalizeDxEnvironmentFlag)
    .filter(Boolean)
  const mismatched = explicit.find(value => value !== environment)
  if (mismatched) {
    throw new Error(`env profile 环境为 ${environment}，但内部 dx 命令指定了 ${mismatched}`)
  }
  if (explicit.length > 0) return { command, args }

  const separator = args.indexOf('--')
  const flag = cli.getEnvironmentFlag(environment)
  if (separator === -1) return { command, args: [...args, flag] }
  return {
    command,
    args: [...args.slice(0, separator), flag, ...args.slice(separator)],
  }
}

function requireExplicitEnvironment(cli, action) {
  if (!hasExplicitEnvironment(cli.flags)) {
    throw new Error(`dx env ${action} 必须显式指定 --staging 或 --prod（也可使用 --dev）`)
  }
  const environment = cli.determineEnvironment()
  if (environment === 'test' || environment === 'e2e') {
    throw new Error(`dx env ${action} 不支持 ${environment} profile`)
  }
  return environment
}

export async function handleEnv(cli, args = []) {
  const [action, profile, ...extras] = args

  if (action === 'status') {
    if (profile || extras.length > 0) throw new Error('用法: dx env status')
    const rows = describeEnvProfiles({ projectRoot: cli.projectRoot, configDir: cli.configDir })
    logger.table(
      rows.map(row => [
        row.profile,
        row.label,
        row.environment,
        row.exists ? '存在' : '缺失',
        row.mode,
        row.active ? '当前已装配' : '-',
      ]),
      ['PROFILE', '名称', '环境', '私有配置', '权限', '状态'],
    )
    return
  }

  if (action !== 'validate' && action !== 'exec') {
    return COMMAND_NOT_HANDLED
  }
  if (!profile || extras.length > 0) throw new Error(`dx env ${action} 需要且仅需要一个 profile 名称`)
  const environment = requireExplicitEnvironment(cli, action)

  if (action === 'validate') {
    const result = validateEnvProfile({
      projectRoot: cli.projectRoot,
      configDir: cli.configDir,
      profile,
      environment,
    })
    logger.success(
      `env profile 校验通过: ${result.profile}/${result.environment}（${result.keyCount} 个本地键）`,
    )
    return
  }

  const passthrough = getPassthroughArgs(cli.args)
  if (passthrough.length === 0) throw new Error('dx env exec 必须在 -- 后提供要执行的命令')
  const prepared = prepareChildCommand(cli, passthrough[0], passthrough.slice(1), environment)
  logger.command([prepared.command, ...prepared.args].join(' '))
  const code = await executeWithEnvProfile({
    projectRoot: cli.projectRoot,
    configDir: cli.configDir,
    profile,
    environment,
    command: prepared.command,
    args: prepared.args,
  })
  if (code !== 0) {
    process.exitCode = code
    logger.error(`env profile 命令执行失败，退出码 ${code}；根目录 env 已恢复`)
    return
  }
  logger.success('env profile 命令执行成功，根目录 env 已恢复')
}
