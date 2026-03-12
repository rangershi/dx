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
