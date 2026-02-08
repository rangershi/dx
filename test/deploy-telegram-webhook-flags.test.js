import { parseTelegramWebhookFlags } from '../lib/cli/commands/deploy.js'

describe('deploy telegram webhook flags', () => {
  test('parses --webhook-path value', () => {
    const flags = parseTelegramWebhookFlags([
      'deploy',
      'telegram-bot',
      '--staging',
      '--webhook-path',
      '/webhook',
    ])

    expect(flags.webhookPath).toBe('/webhook')
    expect(flags.dryRun).toBeUndefined()
    expect(flags.strict).toBeUndefined()
  })

  test('parses --webhook-dry-run', () => {
    const flags = parseTelegramWebhookFlags(['deploy', 'telegram-bot', '--webhook-dry-run'])
    expect(flags.dryRun).toBe(true)
  })

  test('parses strict overrides', () => {
    expect(parseTelegramWebhookFlags(['--strict-webhook']).strict).toBe(true)
    expect(parseTelegramWebhookFlags(['--no-strict-webhook']).strict).toBe(false)
  })
})
