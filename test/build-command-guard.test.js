import { describe, expect, test } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

function runDx(args) {
  const binPath = resolve(process.cwd(), 'bin', 'dx.js')

  try {
    return {
      code: 0,
      output: execFileSync('node', [binPath, ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          AI_SKIP_ENV_CHECK: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    }
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout || ''}${error.stderr || ''}`,
    }
  }
}

describe('dx build command guard', () => {
  test('rejects unsupported explicit environment for backend build', () => {
    const result = runDx(['build', 'backend', '--test'])

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('构建目标 backend 不支持 --test 环境')
    expect(result.output).toContain('dx build backend --dev')
    expect(result.output).toContain('dx build backend --prod')
  })

  test('build help explains explicit env must be supported by target', () => {
    const result = runDx(['help', 'build'])

    expect(result.code).toBe(0)
    expect(result.output).toContain('显式传入环境标志时，必须是该 target 实际支持的环境')
  })
})
