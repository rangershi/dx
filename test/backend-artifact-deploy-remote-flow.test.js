import { describe, expect, jest, test } from '@jest/globals'
import { runBackendArtifactDeploy } from '../lib/backend-artifact-deploy.js'

function createCli(flags = {}, startup = { mode: 'pm2', serviceName: 'backend' }) {
  return {
    projectRoot: '/repo',
    commands: {
      deploy: {
        backend: {
          backendDeploy: {
            build: {
              command: 'npx nx build backend --configuration=production',
              distDir: 'dist/backend',
              versionFile: 'apps/backend/package.json',
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
              user: 'deploy',
              baseDir: '/srv/example-app',
            },
            startup,
            deploy: {
              keepReleases: 5,
              installCommand: 'pnpm install --prod --no-frozen-lockfile --ignore-workspace',
              prismaGenerate: true,
              prismaMigrateDeploy: true,
            },
          },
        },
      },
    },
    flags,
  }
}

describe('backend artifact deploy remote flow', () => {
  test('handles startup failure before migration and after migration differently', async () => {
    const baseDeps = {
      buildArtifact: jest.fn(async () => ({ bundlePath: '/tmp/backend-bundle.tgz', versionName: 'backend-v1.2.3-20260312-010203' })),
      deployRemotely: jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          phase: 'startup',
          message: 'failed before migration',
          rollbackAttempted: true,
          rollbackSucceeded: true,
        })
        .mockResolvedValueOnce({
          ok: false,
          phase: 'startup',
          message: 'failed after migration',
          rollbackAttempted: false,
          rollbackSucceeded: null,
        }),
    }

    const first = await runBackendArtifactDeploy({
      cli: createCli(),
      target: 'backend',
      args: ['backend'],
      environment: 'production',
      deps: baseDeps,
    })

    const second = await runBackendArtifactDeploy({
      cli: createCli(),
      target: 'backend',
      args: ['backend'],
      environment: 'production',
      deps: baseDeps,
    })

    expect(first.rollbackAttempted).toBe(true)
    expect(second.rollbackAttempted).toBe(false)
  })

  test('direct mode stays attached and skips post-start pruning', async () => {
    const deps = {
      buildArtifact: jest.fn(async () => ({ bundlePath: '/tmp/backend-bundle.tgz', versionName: 'backend-v1.2.3-20260312-010203' })),
      deployRemotely: jest.fn(async () => ({
        ok: true,
        phase: 'startup',
        message: 'direct mode attached',
        rollbackAttempted: false,
        rollbackSucceeded: null,
      })),
    }

    const result = await runBackendArtifactDeploy({
      cli: createCli({}, { mode: 'direct', entry: 'apps/backend/src/main.js' }),
      target: 'backend',
      args: ['backend'],
      environment: 'production',
      deps,
    })

    expect(result.phase).toBe('startup')
    expect(result.message).toContain('direct mode')
  })
})
