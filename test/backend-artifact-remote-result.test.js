import { describe, expect, test } from '@jest/globals'
import { parseRemoteResult } from '../lib/backend-artifact-deploy/remote-result.js'

describe('parseRemoteResult', () => {
  test('parses final DX_REMOTE_RESULT line from ssh output', () => {
    const result = parseRemoteResult({
      stdout: [
        'DX_REMOTE_PHASE=startup',
        'DX_REMOTE_RESULT={"ok":false,"phase":"startup","message":"boom","rollbackAttempted":true,"rollbackSucceeded":false}',
      ].join('\n'),
      stderr: '',
      exitCode: 1,
    })

    expect(result).toEqual({
      ok: false,
      phase: 'startup',
      message: 'boom',
      rollbackAttempted: true,
      rollbackSucceeded: false,
    })
  })

  test('falls back to unstructured remote failure when result line is missing', () => {
    const result = parseRemoteResult({
      stdout: 'DX_REMOTE_PHASE=extract\nsome logs',
      stderr: 'tar failed',
      exitCode: 1,
    })

    expect(result.ok).toBe(false)
    expect(result.phase).toBe('extract')
    expect(result.message).toContain('tar failed')
    expect(result.rollbackAttempted).toBe(false)
    expect(result.rollbackSucceeded).toBeNull()
  })
})
