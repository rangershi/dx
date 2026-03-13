import { describe, expect, test } from '@jest/globals'
import { parseRemoteResult } from '../lib/backend-artifact-deploy/remote-result.js'

describe('parseRemoteResult', () => {
  test('parses final DX_REMOTE_RESULT line from ssh output', () => {
    const result = parseRemoteResult({
      stdout: [
        'DX_REMOTE_PHASE=startup',
        'DX_REMOTE_RESULT={"ok":false,"phase":"startup","message":"boom","rollbackAttempted":true,"rollbackSucceeded":false,"summary":{"releaseName":"backend-v1","currentRelease":"/srv/app/releases/backend-v1","serviceName":"backend","serviceStatus":"errored","appEnv":"staging","nodeEnv":"production","healthUrl":"http://127.0.0.1:3005/api/v1/health"}}',
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
      summary: {
        releaseName: 'backend-v1',
        currentRelease: '/srv/app/releases/backend-v1',
        serviceName: 'backend',
        serviceStatus: 'errored',
        appEnv: 'staging',
        nodeEnv: 'production',
        healthUrl: 'http://127.0.0.1:3005/api/v1/health',
      },
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
    expect(result.summary).toBeNull()
  })
})
