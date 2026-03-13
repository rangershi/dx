import { describe, expect, jest, test } from '@jest/globals'
import { runBackendArtifactDeploy } from '../lib/backend-artifact-deploy.js'

describe('runBackendArtifactDeploy', () => {
  test('build-only runs config resolution and artifact build without remote calls', async () => {
    const cli = {
      commands: {
        deploy: {
          backend: {
            backendDeploy: {},
          },
        },
      },
      flags: { buildOnly: true },
    }
    const config = { artifact: {}, build: {}, runtime: {}, deploy: {}, startup: {}, remote: null }
    const bundle = { bundlePath: '/repo/release/backend/backend-bundle-v1.2.3-20260312-010203.tgz' }
    const deps = {
      resolveConfig: jest.fn(() => config),
      buildArtifact: jest.fn(async () => bundle),
      deployRemotely: jest.fn(async () => {
        throw new Error('should not run')
      }),
    }

    const result = await runBackendArtifactDeploy({
      cli,
      target: 'backend',
      args: ['backend'],
      environment: 'development',
      deps,
    })

    expect(result).toBe(bundle)
    expect(deps.resolveConfig).toHaveBeenCalled()
    expect(deps.buildArtifact).toHaveBeenCalledWith(config, deps)
    expect(deps.deployRemotely).not.toHaveBeenCalled()
  })

  test('full deploy invokes artifact build before remote transport', async () => {
    const callOrder = []
    const cli = {
      commands: {
        deploy: {
          backend: {
            backendDeploy: {},
          },
        },
      },
      flags: {},
    }
    const config = { artifact: {}, build: {}, runtime: {}, deploy: {}, startup: {}, remote: {} }
    const bundle = { bundlePath: '/repo/release/backend/backend-bundle-v1.2.3-20260312-010203.tgz' }
    const remoteResult = { ok: true }
    const deps = {
      resolveConfig: jest.fn(() => {
        callOrder.push('resolve')
        return config
      }),
      buildArtifact: jest.fn(async () => {
        callOrder.push('build')
        return bundle
      }),
      deployRemotely: jest.fn(async () => {
        callOrder.push('remote')
        return remoteResult
      }),
    }

    const result = await runBackendArtifactDeploy({
      cli,
      target: 'backend',
      args: ['backend'],
      environment: 'production',
      deps,
    })

    expect(result).toBe(remoteResult)
    expect(callOrder).toEqual(['resolve', 'build', 'remote'])
  })

  test('full deploy prints a concise success summary when remote verification returns details', async () => {
    const cli = {
      commands: {
        deploy: {
          backend: {
            backendDeploy: {},
          },
        },
      },
      flags: {},
    }
    const config = { artifact: {}, build: {}, runtime: {}, deploy: {}, startup: {}, remote: {}, verify: {} }
    const bundle = { bundlePath: '/repo/release/backend/backend-bundle-v1.2.3-20260312-010203.tgz' }
    const logger = {
      success: jest.fn(),
      info: jest.fn(),
    }
    const deps = {
      logger,
      resolveConfig: jest.fn(() => config),
      buildArtifact: jest.fn(async () => bundle),
      deployRemotely: jest.fn(async () => ({
        ok: true,
        phase: 'cleanup',
        message: 'ok',
        rollbackAttempted: false,
        rollbackSucceeded: null,
        summary: {
          releaseName: 'backend-v1.2.3-20260312-010203',
          currentRelease: '/srv/example-app/releases/backend-v1.2.3-20260312-010203',
          serviceName: 'backend',
          serviceStatus: 'online',
          appEnv: 'staging',
          nodeEnv: 'production',
          healthUrl: 'http://127.0.0.1:3005/api/v1/health',
        },
      })),
    }

    await runBackendArtifactDeploy({
      cli,
      target: 'backend',
      args: ['backend'],
      environment: 'staging',
      deps,
    })

    expect(logger.success).toHaveBeenCalledWith('后端部署成功: backend-v1.2.3-20260312-010203')
    expect(logger.info).toHaveBeenCalledWith(
      '[deploy-summary] current=/srv/example-app/releases/backend-v1.2.3-20260312-010203',
    )
    expect(logger.info).toHaveBeenCalledWith('[deploy-summary] service=backend status=online')
    expect(logger.info).toHaveBeenCalledWith('[deploy-summary] APP_ENV=staging NODE_ENV=production')
    expect(logger.info).toHaveBeenCalledWith('[deploy-summary] health=http://127.0.0.1:3005/api/v1/health')
  })

  test('build failure stops before any remote seam is invoked', async () => {
    const cli = {
      commands: {
        deploy: {
          backend: {
            backendDeploy: {},
          },
        },
      },
      flags: {},
    }
    const deps = {
      resolveConfig: jest.fn(() => ({ artifact: {}, build: {}, runtime: {}, deploy: {}, startup: {}, remote: {} })),
      buildArtifact: jest.fn(async () => {
        throw new Error('build failed')
      }),
      deployRemotely: jest.fn(async () => ({ ok: true })),
    }

    await expect(
      runBackendArtifactDeploy({
        cli,
        target: 'backend',
        args: ['backend'],
        environment: 'production',
        deps,
      }),
    ).rejects.toThrow('build failed')

    expect(deps.deployRemotely).not.toHaveBeenCalled()
  })
})
