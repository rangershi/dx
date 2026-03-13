import { buildBackendArtifact } from './backend-artifact-deploy/artifact-builder.js'
import { resolveBackendDeployConfig } from './backend-artifact-deploy/config.js'
import { deployBackendArtifactRemotely } from './backend-artifact-deploy/remote-transport.js'
import { logger as defaultLogger } from './logger.js'

function printSuccessfulDeploySummary(result, logger) {
  const summary = result?.summary
  if (!summary) return

  logger.success(`后端部署成功: ${summary.releaseName || 'unknown-release'}`)
  if (summary.currentRelease) {
    logger.info(`[deploy-summary] current=${summary.currentRelease}`)
  }
  if (summary.serviceName || summary.serviceStatus) {
    logger.info(
      `[deploy-summary] service=${summary.serviceName || 'unknown'} status=${summary.serviceStatus || 'unknown'}`,
    )
  }
  if (summary.appEnv || summary.nodeEnv) {
    logger.info(
      `[deploy-summary] APP_ENV=${summary.appEnv || '<empty>'} NODE_ENV=${summary.nodeEnv || '<empty>'}`,
    )
  }
  if (summary.healthUrl) {
    logger.info(`[deploy-summary] health=${summary.healthUrl}`)
  }
}

export async function runBackendArtifactDeploy({
  cli,
  target,
  args,
  environment,
  deps = {},
}) {
  const logger = deps.logger || defaultLogger
  const resolveConfig = deps.resolveConfig || resolveBackendDeployConfig
  const buildArtifact = deps.buildArtifact || buildBackendArtifact
  const deployRemotely =
    deps.deployRemotely || deployBackendArtifactRemotely

  const targetConfig = cli?.commands?.deploy?.[target]
  const config = resolveConfig({
    cli,
    targetConfig,
    environment,
    flags: cli?.flags || {},
    args,
  })

  const bundle = await buildArtifact(config, deps)
  if (cli?.flags?.buildOnly) {
    return bundle
  }

  const result = await deployRemotely(config, bundle, deps)
  if (result?.ok) {
    printSuccessfulDeploySummary(result, logger)
  }
  return result
}
