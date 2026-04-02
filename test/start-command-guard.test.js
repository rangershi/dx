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

describe('dx start command guard', () => {
  test('rejects default dev suite in production environment', () => {
    const result = runDx(['start', '--prod'])

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx start 在未指定服务时仅允许使用开发环境')
    expect(result.output).toContain('dx start --dev')
    expect(result.output).toContain('dx start backend --prod')
  })

  test('rejects stagewise bridge in production environment', () => {
    const result = runDx(['start', 'stagewise-front', '--prod'])

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('启动目标 stagewise-front 仅支持开发环境')
    expect(result.output).toContain('dx start stagewise-front --dev')
  })
})
