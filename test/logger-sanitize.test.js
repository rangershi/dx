import { sanitizeForLog } from '../lib/logger.js'

describe('logger sanitizeForLog()', () => {
  test('redacts --token=... and --token ...', () => {
    const raw =
      'vercel deploy --prebuilt --token=abc123 --scope team_x; vercel build --token "xyz"'
    const safe = sanitizeForLog(raw)
    expect(safe).not.toContain('abc123')
    expect(safe).not.toContain('xyz')
    expect(safe).toContain('--token=***')
    expect(safe).toContain('--token ***')
  })

  test('redacts VERCEL_TOKEN env assignment', () => {
    const raw = 'VERCEL_TOKEN=secret_value'
    const safe = sanitizeForLog(raw)
    expect(safe).toBe('VERCEL_TOKEN=***')
  })

  test('redacts Authorization: Bearer token', () => {
    const raw = 'Authorization: Bearer super.secret.jwt'
    const safe = sanitizeForLog(raw)
    expect(safe).toBe('Authorization: Bearer ***')
  })

  test('redacts Telegram bot token in URL and secret_token in JSON', () => {
    const raw =
      'curl https://api.telegram.org/bot123456:ABCDEF/setWebhook -d "{\"secret_token\":\"shh\"}"'
    const safe = sanitizeForLog(raw)
    expect(safe).not.toContain('123456:ABCDEF')
    expect(safe).not.toContain('shh')
    expect(safe).toContain('api.telegram.org/bot***')
    expect(safe).toContain('"secret_token":"***"')
  })
})
