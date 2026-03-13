import { isAbsolute } from 'node:path'
import { resolveWithinBase } from './path-utils.js'

function requireString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`缺少必填配置: ${fieldPath}`)
  }
  return value.trim()
}

function requirePositiveInteger(value, fieldPath) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`缺少必填配置: ${fieldPath}`)
  }
  return parsed
}

function resolveVerifyConfig(verifyConfig = {}) {
  const healthCheckConfig = verifyConfig?.healthCheck
  if (healthCheckConfig == null) {
    return {
      healthCheck: null,
    }
  }

  const url = requireString(healthCheckConfig.url, 'verify.healthCheck.url')
  try {
    new URL(url)
  } catch {
    throw new Error(`缺少必填配置: verify.healthCheck.url`)
  }

  return {
    healthCheck: {
      url,
      timeoutSeconds:
        healthCheckConfig.timeoutSeconds == null
          ? 10
          : requirePositiveInteger(healthCheckConfig.timeoutSeconds, 'verify.healthCheck.timeoutSeconds'),
    },
  }
}

function resolveBuildCommand(buildConfig, environment) {
  if (buildConfig?.commands && typeof buildConfig.commands === 'object') {
    const selected = buildConfig.commands[environment]
    if (!selected || typeof selected !== 'string' || selected.trim() === '') {
      throw new Error(`缺少必填配置: build.commands.${environment}`)
    }
    return selected.trim()
  }

  return requireString(buildConfig?.command, 'build.command')
}

function resolveProjectPath(projectRoot, relativePath, fieldPath) {
  return resolveWithinBase(projectRoot, requireString(relativePath, fieldPath), fieldPath)
}

function requireRemoteBaseDir(value, fieldPath) {
  const baseDir = requireString(value, fieldPath)
  if (!isAbsolute(baseDir)) {
    throw new Error(`${fieldPath} 必须是绝对路径: ${baseDir}`)
  }
  if (!/^\/[A-Za-z0-9._/-]*$/.test(baseDir)) {
    throw new Error(`${fieldPath} 包含非法字符: ${baseDir}`)
  }
  return baseDir.replace(/\/+$/, '') || '/'
}

export function resolveBackendDeployConfig({ cli, targetConfig, environment, flags = {} }) {
  const deployConfig = targetConfig?.backendDeploy
  if (!deployConfig || typeof deployConfig !== 'object') {
    throw new Error('缺少必填配置: backendDeploy')
  }

  const buildConfig = deployConfig.build || {}
  const runtimeConfig = deployConfig.runtime || {}
  const artifactConfig = deployConfig.artifact || {}
  const remoteConfig = deployConfig.remote || null
  const startupConfig = deployConfig.startup || {}
  const runConfig = deployConfig.deploy || {}
  const verifyConfig = deployConfig.verify || {}
  const buildOnly = Boolean(flags.buildOnly)
  const startupMode = String(startupConfig.mode || 'pm2').trim()
  const prismaGenerate = runConfig.prismaGenerate !== false
  const prismaMigrateDeploy = runConfig.prismaMigrateDeploy !== false

  const normalized = {
    projectRoot: cli.projectRoot,
    environment,
    build: {
      app: typeof buildConfig.app === 'string' && buildConfig.app.trim() ? buildConfig.app.trim() : null,
      command: resolveBuildCommand(buildConfig, environment),
      distDir: resolveProjectPath(cli.projectRoot, buildConfig.distDir, 'build.distDir'),
      versionFile: resolveProjectPath(cli.projectRoot, buildConfig.versionFile, 'build.versionFile'),
    },
    runtime: {
      appPackage: resolveProjectPath(cli.projectRoot, runtimeConfig.appPackage, 'runtime.appPackage'),
      rootPackage: resolveProjectPath(cli.projectRoot, runtimeConfig.rootPackage, 'runtime.rootPackage'),
      lockfile: resolveProjectPath(cli.projectRoot, runtimeConfig.lockfile, 'runtime.lockfile'),
      prismaSchemaDir: runtimeConfig.prismaSchemaDir
        ? resolveProjectPath(cli.projectRoot, runtimeConfig.prismaSchemaDir, 'runtime.prismaSchemaDir')
        : null,
      prismaConfig: runtimeConfig.prismaConfig
        ? resolveProjectPath(cli.projectRoot, runtimeConfig.prismaConfig, 'runtime.prismaConfig')
        : null,
      ecosystemConfig: runtimeConfig.ecosystemConfig
        ? resolveProjectPath(cli.projectRoot, runtimeConfig.ecosystemConfig, 'runtime.ecosystemConfig')
        : null,
    },
    artifact: {
      outputDir: resolveProjectPath(cli.projectRoot, artifactConfig.outputDir, 'artifact.outputDir'),
      bundleName: requireString(artifactConfig.bundleName, 'artifact.bundleName'),
    },
    remote: buildOnly
      ? null
      : {
          host: requireString(remoteConfig?.host, 'remote.host'),
          port: remoteConfig?.port == null ? 22 : requirePositiveInteger(remoteConfig.port, 'remote.port'),
          user: requireString(remoteConfig?.user, 'remote.user'),
          baseDir: requireRemoteBaseDir(remoteConfig?.baseDir, 'remote.baseDir'),
        },
    startup: {
      mode: startupMode,
      serviceName:
        typeof startupConfig.serviceName === 'string' && startupConfig.serviceName.trim()
          ? startupConfig.serviceName.trim()
          : null,
      entry:
        typeof startupConfig.entry === 'string' && startupConfig.entry.trim()
          ? startupConfig.entry.trim()
          : null,
    },
    deploy: {
      keepReleases:
        runConfig.keepReleases == null ? 5 : requirePositiveInteger(runConfig.keepReleases, 'deploy.keepReleases'),
      installCommand: requireString(
        runConfig.installCommand || 'pnpm install --prod --no-frozen-lockfile --ignore-workspace',
        'deploy.installCommand',
      ),
      prismaGenerate,
      prismaMigrateDeploy,
      skipMigration: Boolean(flags.skipMigration),
    },
    verify: resolveVerifyConfig(verifyConfig),
  }

  if (!['pm2', 'direct'].includes(normalized.startup.mode)) {
    throw new Error('缺少必填配置: startup.mode')
  }
  if (normalized.startup.mode === 'pm2') {
    requireString(normalized.startup.serviceName, 'startup.serviceName')
    requireString(normalized.runtime.ecosystemConfig, 'runtime.ecosystemConfig')
  } else {
    requireString(normalized.startup.entry, 'startup.entry')
  }

  if (normalized.deploy.prismaGenerate || normalized.deploy.prismaMigrateDeploy) {
    requireString(normalized.runtime.prismaSchemaDir, 'runtime.prismaSchemaDir')
    requireString(normalized.runtime.prismaConfig, 'runtime.prismaConfig')
  }

  return normalized
}
