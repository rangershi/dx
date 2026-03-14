import { describe, expect, test } from '@jest/globals'

import { sanitizeChildEnv } from '../lib/exec.js'

describe('sanitizeChildEnv', () => {
  test('移除会与 FORCE_COLOR 语义冲突的 NO_COLOR', () => {
    const sanitized = sanitizeChildEnv({
      NO_COLOR: '1',
      FORCE_COLOR: '1',
      PATH: '/tmp/bin',
    })

    expect(sanitized.NO_COLOR).toBeUndefined()
    expect(sanitized.FORCE_COLOR).toBe('1')
    expect(sanitized.PATH).toBe('/tmp/bin')
  })

  test('清理空的 FORCE_COLOR 值', () => {
    const sanitized = sanitizeChildEnv({
      FORCE_COLOR: '',
      PATH: '/tmp/bin',
    })

    expect('FORCE_COLOR' in sanitized).toBe(false)
    expect(sanitized.PATH).toBe('/tmp/bin')
  })
})
