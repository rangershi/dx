import { describe, expect, jest, test } from '@jest/globals'

jest.unstable_mockModule('../lib/backend-artifact-deploy.js', () => ({
  runBackendArtifactDeploy: jest.fn(),
}))

jest.unstable_mockModule('../lib/vercel-deploy.js', () => ({
  deployToVercel: jest.fn(),
}))

jest.unstable_mockModule('../lib/validate-env.js', () => ({
  validateEnvironment: jest.fn(),
}))

jest.unstable_mockModule('../lib/env.js', () => ({
  envManager: {
    collectEnvFromLayers: jest.fn(() => ({})),
    latestEnvWarnings: [],
    syncEnvironments: jest.fn(),
    isPlaceholderEnvValue: jest.fn(() => false),
  },
}))

const { parseFlags } = await import('../lib/cli/flags.js')
const { showCommandHelp, showHelp } = await import('../lib/cli/help.js')
const { handleDeploy } = await import('../lib/cli/commands/deploy.js')
const { runBackendArtifactDeploy } = await import('../lib/backend-artifact-deploy.js')
const { deployToVercel } = await import('../lib/vercel-deploy.js')

describe('backend artifact deploy routing', () => {
  test('parseFlags reads build-only and skip-migration for backend deploy', () => {
    const flags = parseFlags(['deploy', 'backend', '--build-only', '--skip-migration'])

    expect(flags.buildOnly).toBe(true)
    expect(flags.skipMigration).toBe(true)
  })

  test('deploy backend internal target dispatches to backend artifact runner', async () => {
    const cli = {
      invocation: 'dx',
      commands: {
        deploy: {
          backend: {
            internal: 'backend-artifact-deploy',
          },
        },
      },
      flags: {},
      args: ['deploy', 'backend'],
      ensureRepoRoot: jest.fn(),
    }

    await handleDeploy(cli, ['backend'])

    expect(runBackendArtifactDeploy).toHaveBeenCalledWith({
      cli,
      target: 'backend',
      args: ['backend'],
      environment: 'development',
    })
    expect(deployToVercel).not.toHaveBeenCalled()
  })

  test('deploy backend defaults to development while Vercel targets keep staging default', async () => {
    const backendCli = {
      invocation: 'dx',
      commands: {
        deploy: {
          backend: {
            internal: 'backend-artifact-deploy',
          },
        },
      },
      flags: {},
      args: ['deploy', 'backend'],
      ensureRepoRoot: jest.fn(),
    }

    const frontCli = {
      invocation: 'dx',
      commands: {
        deploy: {
          front: {
            description: 'vercel front deploy',
          },
        },
      },
      flags: {},
      args: ['deploy', 'front'],
      ensureRepoRoot: jest.fn(),
    }

    await handleDeploy(backendCli, ['backend'])
    await handleDeploy(frontCli, ['front'])

    expect(runBackendArtifactDeploy).toHaveBeenLastCalledWith({
      cli: backendCli,
      target: 'backend',
      args: ['backend'],
      environment: 'development',
    })
    expect(deployToVercel).toHaveBeenCalledWith('front', expect.objectContaining({ environment: 'staging' }))
  })

  test('deploy help documents backend artifact mode and different defaults', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    showHelp()
    showCommandHelp('deploy')

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('dx deploy backend --prod')
    expect(output).toContain('--build-only')
    expect(output).toContain('--skip-migration')
    expect(output).toContain('默认 --staging')
    expect(output).toContain('backend 制品发布目标默认 --dev')

    logSpy.mockRestore()
  })
})
