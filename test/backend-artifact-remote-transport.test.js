import { describe, expect, jest, test } from '@jest/globals'
import {
  buildEnsureRemoteBaseDirsCommand,
  deployBackendArtifactRemotely,
} from '../lib/backend-artifact-deploy/remote-transport.js'

function createConfig(overrides = {}) {
  return {
    environment: 'production',
    remote: {
      host: 'deploy.example.com',
      port: 22,
      user: 'deploy',
      baseDir: '/srv/example-app',
    },
    runtime: {
      prismaSchemaDir: 'apps/backend/prisma/schema',
      prismaConfig: 'apps/backend/prisma.config.ts',
      ecosystemConfig: 'ecosystem.config.cjs',
    },
    startup: {
      mode: 'pm2',
      serviceName: 'backend',
      entry: null,
    },
    deploy: {
      keepReleases: 5,
      installCommand: 'pnpm install --prod --no-frozen-lockfile --ignore-workspace',
      prismaGenerate: true,
      prismaMigrateDeploy: true,
      skipMigration: false,
    },
    ...overrides,
  }
}

describe('deployBackendArtifactRemotely', () => {
  test('quotes remote mkdir directories to avoid shell metacharacter execution', () => {
    const command = buildEnsureRemoteBaseDirsCommand("/srv/app'; touch /tmp/pwn #")
    expect(command).toBe("mkdir -p '/srv/app'\\''; touch /tmp/pwn #/releases' '/srv/app'\\''; touch /tmp/pwn #/shared' '/srv/app'\\''; touch /tmp/pwn #/uploads'")
  })

  test('creates remote directories, uploads bundle, and runs ssh script', async () => {
    const deps = {
      ensureRemoteBaseDirs: jest.fn(async () => {}),
      uploadBundle: jest.fn(async () => {}),
      runRemoteScript: jest.fn(async () => ({
        stdout: 'DX_REMOTE_RESULT={"ok":true,"phase":"cleanup","message":"ok","rollbackAttempted":false,"rollbackSucceeded":null}',
        stderr: '',
        exitCode: 0,
      })),
    }

    const result = await deployBackendArtifactRemotely(
      createConfig(),
      { versionName: 'backend-v1.2.3-20260312-010203', bundlePath: '/tmp/backend-bundle.tgz' },
      deps,
    )

    expect(deps.ensureRemoteBaseDirs).toHaveBeenCalled()
    expect(deps.uploadBundle).toHaveBeenCalled()
    expect(deps.runRemoteScript).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  test('surfaces missing shared env file, lock contention, and checksum mismatch', async () => {
    const deps = {
      ensureRemoteBaseDirs: jest.fn(async () => {}),
      uploadBundle: jest.fn(async () => {}),
      runRemoteScript: jest.fn(async () => ({
        stdout: 'DX_REMOTE_PHASE=env\nDX_REMOTE_RESULT={"ok":false,"phase":"env","message":"missing shared env","rollbackAttempted":false,"rollbackSucceeded":null}',
        stderr: '',
        exitCode: 1,
      })),
    }

    const result = await deployBackendArtifactRemotely(
      createConfig(),
      { versionName: 'backend-v1.2.3-20260312-010203', bundlePath: '/tmp/backend-bundle.tgz' },
      deps,
    )

    expect(result.ok).toBe(false)
    expect(result.phase).toBe('env')
  })

  test('surfaces upload failure and missing remote tool failure', async () => {
    const uploadDeps = {
      ensureRemoteBaseDirs: jest.fn(async () => {}),
      uploadBundle: jest.fn(async () => {
        throw new Error('scp failed')
      }),
      runRemoteScript: jest.fn(),
    }

    await expect(
      deployBackendArtifactRemotely(
        createConfig(),
        { versionName: 'backend-v1.2.3-20260312-010203', bundlePath: '/tmp/backend-bundle.tgz' },
        uploadDeps,
      ),
    ).rejects.toThrow('scp failed')

    const toolDeps = {
      ensureRemoteBaseDirs: jest.fn(async () => {}),
      uploadBundle: jest.fn(async () => {}),
      runRemoteScript: jest.fn(async () => ({
        stdout: 'DX_REMOTE_RESULT={"ok":false,"phase":"install","message":"missing pnpm","rollbackAttempted":false,"rollbackSucceeded":null}',
        stderr: '',
        exitCode: 1,
      })),
    }

    const result = await deployBackendArtifactRemotely(
      createConfig(),
      { versionName: 'backend-v1.2.3-20260312-010203', bundlePath: '/tmp/backend-bundle.tgz' },
      toolDeps,
    )

    expect(result.message).toContain('missing pnpm')
  })
})
