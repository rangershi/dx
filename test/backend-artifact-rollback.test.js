import { describe, expect, test } from '@jest/globals'
import { shouldAttemptRollback } from '../lib/backend-artifact-deploy/rollback.js'

describe('shouldAttemptRollback', () => {
  test('allows rollback before migration in pm2 mode', () => {
    expect(shouldAttemptRollback({ migrationExecuted: false, startupMode: 'pm2' })).toBe(true)
  })

  test('disables rollback after migration', () => {
    expect(shouldAttemptRollback({ migrationExecuted: true, startupMode: 'pm2' })).toBe(false)
  })

  test('disables rollback in direct mode', () => {
    expect(shouldAttemptRollback({ migrationExecuted: false, startupMode: 'direct' })).toBe(false)
  })
})
