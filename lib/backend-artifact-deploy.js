import { buildBackendArtifact } from './backend-artifact-deploy/artifact-builder.js'
import { resolveBackendDeployConfig } from './backend-artifact-deploy/config.js'
import { deployBackendArtifactRemotely } from './backend-artifact-deploy/remote-transport.js'

export async function runBackendArtifactDeploy({
  cli,
  target,
  args,
  environment,
  deps = {},
}) {
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

  return deployRemotely(config, bundle, deps)
}
