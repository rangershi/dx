import { jest } from '@jest/globals'
import {
  handleTelegramBotDeploy,
  parseDeployUrlFromDeployOutput,
  parseDeployUrlFromVercelListOutput,
  pickDeploymentUrlFromVercelApiResponse,
} from '../lib/telegram-webhook.js'

describe('telegram-webhook URL parsing', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    Object.assign(process.env, ORIGINAL_ENV)
  })

  afterEach(() => {
    console.log.mockRestore()
  })

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    Object.assign(process.env, ORIGINAL_ENV)
  })

  test('parseDeployUrlFromDeployOutput() picks the last *.vercel.app', () => {
    const output = [
      'Vercel CLI output',
      'Inspect: https://vercel.com/acme/foo/abc123',
      'Preview: https://first-preview.vercel.app',
      'More logs...',
      'Ready: second-ready.vercel.app',
    ].join('\n')

    expect(parseDeployUrlFromDeployOutput(output)).toBe('https://second-ready.vercel.app')
  })

  test('parseDeployUrlFromVercelListOutput() prefers project name + Ready', () => {
    const output = [
      'Name    Status   URL',
      'other   Ready    other-123.vercel.app',
      'telegram-bot   Ready   tg-bot-999.vercel.app',
    ].join('\n')

    expect(parseDeployUrlFromVercelListOutput(output, 'telegram-bot')).toBe('https://tg-bot-999.vercel.app')
  })

  test('parseDeployUrlFromVercelListOutput() falls back to first Ready + vercel.app', () => {
    const output = [
      'Name    Status   URL',
      'x       Building x-1.vercel.app',
      'y       READY    y-2.vercel.app',
      'z       Ready    z-3.vercel.app',
    ].join('\n')

    expect(parseDeployUrlFromVercelListOutput(output, 'unknown-project')).toBe('https://y-2.vercel.app')
  })

  test('pickDeploymentUrlFromVercelApiResponse() returns first READY deployment url', () => {
    const json = {
      deployments: [
        { uid: 'dpl_1', url: null, state: 'READY' },
        { uid: 'dpl_2', url: 'bad.example.com', state: 'READY' },
        { uid: 'dpl_3', url: 'not-ready.vercel.app', state: 'BUILDING' },
        { uid: 'dpl_4', url: 'good-123.vercel.app', state: 'READY' },
      ],
    }

    expect(pickDeploymentUrlFromVercelApiResponse(json)).toBe('https://good-123.vercel.app')
  })

  test('handleTelegramBotDeploy() is strict by default in staging/prod', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.TELEGRAM_BOT_WEBHOOK_SECRET = 'secret'
    process.env.DX_TELEGRAM_WEBHOOK_DRY_RUN = '1'

    await expect(
      handleTelegramBotDeploy('staging', 'prj_123', 'team_x', 'token_x', {
        deployOutput: 'done: https://x-1.vercel.app',
        projectNameHint: 'telegram-bot',
      }),
    ).rejects.toThrow('缺少必需环境变量')
  })

  test('handleTelegramBotDeploy() is non-strict by default in development', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_BOT_WEBHOOK_SECRET
    process.env.DX_TELEGRAM_WEBHOOK_DRY_RUN = '1'

    await expect(
      handleTelegramBotDeploy('development', 'prj_123', 'team_x', 'token_x', {
        deployOutput: 'done: https://x-1.vercel.app',
        projectNameHint: 'telegram-bot',
      }),
    ).resolves.toBeUndefined()
  })
})
