import { logger } from '../../logger.js'

export async function handlePackage(cli, args) {
  const target = args[0] || 'backend'
  if (target !== 'backend') {
    logger.error(`暂不支持打包目标: ${target}`)
    logger.info(`当前仅支持 ${cli.invocation} package backend`)
    process.exitCode = 1
    return
  }

  cli.ensureRepoRoot()

  const environment = cli.determineEnvironment()
  const passthroughFlags = cli.args.filter(token =>
    ['--skip-build', '--keep-workdir'].includes(token),
  )

  logger.step(`打包 ${target} (${environment})`)
  const { runBackendPackage } = await import('../../backend-package.js')
  await runBackendPackage([`--env=${environment}`, ...passthroughFlags])
}
