import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

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

const { FLAG_DEFINITIONS, parseFlags } = await import('../lib/cli/flags.js')
const { handleDeploy } = await import('../lib/cli/commands/deploy.js')
const { deployToVercel } = await import('../lib/vercel-deploy.js')

const previousFrontI18nProfile = process.env.FRONT_I18N_PROFILE

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.FRONT_I18N_PROFILE
})

afterEach(() => {
  if (previousFrontI18nProfile === undefined) {
    delete process.env.FRONT_I18N_PROFILE
  } else {
    process.env.FRONT_I18N_PROFILE = previousFrontI18nProfile
  }
})

function createDeployCli(target, rawArgs) {
  return {
    invocation: 'dx',
    commands: {
      deploy: {
        [target]: {
          description: `deploy ${target}`,
        },
      },
    },
    flags: parseFlags(rawArgs),
    args: rawArgs,
    ensureRepoRoot: jest.fn(),
  }
}

describe('deploy front i18n profile', () => {
  test('allows deploy --BR and parses it into flags.BR', () => {
    expect(FLAG_DEFINITIONS.deploy).toContainEqual({ flag: '--BR' })
    expect(parseFlags(['deploy', 'front', '--BR']).BR).toBe(true)
  })

  test('sets br profile when deploying front with --BR', async () => {
    const cli = createDeployCli('front', ['deploy', 'front', '--BR'])

    await handleDeploy(cli, ['front'])

    expect(process.env.FRONT_I18N_PROFILE).toBe('br')
    expect(deployToVercel).toHaveBeenCalledWith(
      'front',
      expect.objectContaining({ environment: 'staging' }),
    )
  })

  test('sets default profile when deploying front without --BR', async () => {
    process.env.FRONT_I18N_PROFILE = 'br'
    const cli = createDeployCli('front', ['deploy', 'front'])

    await handleDeploy(cli, ['front'])

    expect(process.env.FRONT_I18N_PROFILE).toBe('default')
    expect(deployToVercel).toHaveBeenCalledWith(
      'front',
      expect.objectContaining({ environment: 'staging' }),
    )
  })

  test('does not change profile for non-front deploy targets', async () => {
    process.env.FRONT_I18N_PROFILE = 'existing'
    const cli = createDeployCli('admin', ['deploy', 'admin', '--BR'])

    await handleDeploy(cli, ['admin'])

    expect(process.env.FRONT_I18N_PROFILE).toBe('existing')
    expect(deployToVercel).toHaveBeenCalledWith(
      'admin',
      expect.objectContaining({ environment: 'staging' }),
    )
  })
})
