import { describe, expect, test } from '@jest/globals'
import { resolveBackendDeployConfig } from '../lib/backend-artifact-deploy/config.js'

function createTargetConfig(overrides = {}) {
  return {
    internal: 'backend-artifact-deploy',
    backendDeploy: {
      build: {
        app: 'backend',
        distDir: 'dist/backend',
        versionFile: 'apps/backend/package.json',
        commands: {
          development: 'npx nx build backend --configuration=development',
          staging: 'npx nx build backend --configuration=production',
          production: 'npx nx build backend --configuration=production',
        },
      },
      runtime: {
        appPackage: 'apps/backend/package.json',
        rootPackage: 'package.json',
        lockfile: 'pnpm-lock.yaml',
        prismaSchemaDir: 'apps/backend/prisma/schema',
        prismaConfig: 'apps/backend/prisma.config.ts',
        ecosystemConfig: 'ecosystem.config.cjs',
      },
      artifact: {
        outputDir: 'release/backend',
        bundleName: 'backend-bundle',
      },
      remote: {
        host: 'deploy.example.com',
        port: 22,
        user: 'deploy',
        baseDir: '/srv/example-app',
      },
      startup: {
        mode: 'pm2',
        serviceName: 'backend',
      },
      deploy: {
        keepReleases: 5,
        installCommand: 'pnpm install --prod --no-frozen-lockfile --ignore-workspace',
        prismaGenerate: true,
        prismaMigrateDeploy: true,
      },
      verify: {
        healthCheck: {
          url: 'http://127.0.0.1:3005/api/v1/health',
          timeoutSeconds: 10,
          maxWaitSeconds: 24,
          retryIntervalSeconds: 2,
        },
      },
    },
    ...overrides,
  }
}

function createCli(flags = {}) {
  return {
    projectRoot: '/repo',
    flags,
  }
}

describe('resolveBackendDeployConfig', () => {
  test('normalizes build commands by environment', () => {
    const config = resolveBackendDeployConfig({
      cli: createCli(),
      targetConfig: createTargetConfig(),
      environment: 'production',
      flags: {},
    })

    expect(config.build.command).toBe('npx nx build backend --configuration=production')
    expect(config.verify).toEqual({
      healthCheck: {
        url: 'http://127.0.0.1:3005/api/v1/health',
        timeoutSeconds: 10,
        maxWaitSeconds: 24,
        retryIntervalSeconds: 2,
      },
    })
  })

  test('allows remote config to be omitted for build-only', () => {
    const targetConfig = createTargetConfig()
    delete targetConfig.backendDeploy.remote

    const config = resolveBackendDeployConfig({
      cli: createCli({ buildOnly: true }),
      targetConfig,
      environment: 'development',
      flags: { buildOnly: true },
    })

    expect(config.remote).toBeNull()
  })

  test('supports single build.command form for all environments', () => {
    const targetConfig = createTargetConfig()
    targetConfig.backendDeploy.build = {
      app: 'backend',
      distDir: 'dist/backend',
      versionFile: 'apps/backend/package.json',
      command: 'npx nx build backend --configuration=production',
    }

    const config = resolveBackendDeployConfig({
      cli: createCli(),
      targetConfig,
      environment: 'staging',
      flags: {},
    })

    expect(config.build.command).toBe('npx nx build backend --configuration=production')
  })

  test('fails on unsupported startup/prisma combinations', () => {
    const directConfig = createTargetConfig()
    directConfig.backendDeploy.startup = { mode: 'direct' }

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig: directConfig,
        environment: 'development',
        flags: {},
      }),
    ).toThrow('startup.entry')

    const pm2Config = createTargetConfig()
    delete pm2Config.backendDeploy.runtime.ecosystemConfig

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig: pm2Config,
        environment: 'development',
        flags: {},
      }),
    ).toThrow('runtime.ecosystemConfig')

    const prismaConfig = createTargetConfig()
    delete prismaConfig.backendDeploy.runtime.prismaConfig

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig: prismaConfig,
        environment: 'development',
        flags: {},
      }),
    ).toThrow('runtime.prismaConfig')
  })

  test.each([
    'build.distDir',
    'build.versionFile',
    'runtime.appPackage',
    'runtime.rootPackage',
    'runtime.lockfile',
    'artifact.outputDir',
    'artifact.bundleName',
  ])('requires %s for all local build flows including build-only', fieldPath => {
    const targetConfig = createTargetConfig()
    const parts = fieldPath.split('.')
    let cursor = targetConfig.backendDeploy
    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]]
    delete cursor[parts.at(-1)]

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli({ buildOnly: true }),
        targetConfig,
        environment: 'development',
        flags: { buildOnly: true },
      }),
    ).toThrow(fieldPath)
  })

  test('fails when selected environment command is missing from build.commands', () => {
    const targetConfig = createTargetConfig()
    delete targetConfig.backendDeploy.build.commands.production

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('build.commands.production')
  })

  test('defaults prismaSeed to false', () => {
    const config = resolveBackendDeployConfig({
      cli: createCli(),
      targetConfig: createTargetConfig(),
      environment: 'production',
      flags: {},
    })

    expect(config.deploy.prismaSeed).toBe(false)
  })

  test('enables prismaSeed when explicitly set to true', () => {
    const targetConfig = createTargetConfig()
    targetConfig.backendDeploy.deploy.prismaSeed = true

    const config = resolveBackendDeployConfig({
      cli: createCli(),
      targetConfig,
      environment: 'production',
      flags: {},
    })

    expect(config.deploy.prismaSeed).toBe(true)
  })

  test('requires prisma paths when only prismaSeed is enabled', () => {
    const targetConfig = createTargetConfig()
    targetConfig.backendDeploy.deploy.prismaGenerate = false
    targetConfig.backendDeploy.deploy.prismaMigrateDeploy = false
    targetConfig.backendDeploy.deploy.prismaSeed = true
    delete targetConfig.backendDeploy.runtime.prismaConfig

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('runtime.prismaConfig')
  })

  test('rejects local paths that escape projectRoot', () => {
    const targetConfig = createTargetConfig()
    targetConfig.backendDeploy.runtime.prismaSchemaDir = '../outside/schema'

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('runtime.prismaSchemaDir')
  })

  test('rejects remote.baseDir containing unsafe shell characters', () => {
    const targetConfig = createTargetConfig()
    targetConfig.backendDeploy.remote.baseDir = '/srv/example;rm -rf /'

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('remote.baseDir')
  })

  test('allows verify.healthCheck to be omitted entirely', () => {
    const targetConfig = createTargetConfig()
    delete targetConfig.backendDeploy.verify

    const config = resolveBackendDeployConfig({
      cli: createCli(),
      targetConfig,
      environment: 'production',
      flags: {},
    })

    expect(config.verify).toEqual({
      healthCheck: null,
    })
  })

  test('rejects invalid verify.healthCheck values', () => {
    const missingUrl = createTargetConfig()
    delete missingUrl.backendDeploy.verify.healthCheck.url

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig: missingUrl,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('verify.healthCheck.url')

    const invalidTimeout = createTargetConfig()
    invalidTimeout.backendDeploy.verify.healthCheck.timeoutSeconds = 0

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig: invalidTimeout,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('verify.healthCheck.timeoutSeconds')

    const invalidMaxWait = createTargetConfig()
    invalidMaxWait.backendDeploy.verify.healthCheck.maxWaitSeconds = 0

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig: invalidMaxWait,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('verify.healthCheck.maxWaitSeconds')

    const invalidRetryInterval = createTargetConfig()
    invalidRetryInterval.backendDeploy.verify.healthCheck.retryIntervalSeconds = 0

    expect(() =>
      resolveBackendDeployConfig({
        cli: createCli(),
        targetConfig: invalidRetryInterval,
        environment: 'production',
        flags: {},
      }),
    ).toThrow('verify.healthCheck.retryIntervalSeconds')
  })

})
