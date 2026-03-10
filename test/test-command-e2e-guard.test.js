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

describe('dx test e2e backend guard', () => {
  test('rejects backend e2e without file or directory path', () => {
    const result = runDx(['test', 'e2e', 'backend'])

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e backend 必须提供测试文件或目录路径')
    expect(result.output).toContain('dx test e2e backend apps/backend/e2e/auth')
  })

  test('help output only shows path-based backend e2e examples', () => {
    const result = runDx(['--help'])

    expect(result.code).toBe(0)
    expect(result.output).toContain('path: 测试文件或目录路径 (必填，仅支持 e2e backend)')
    expect(result.output).toContain('dx test e2e backend apps/backend/e2e/auth')
    expect(result.output).not.toContain('dx test e2e backend                           # 运行后端E2E测试')
  })
})
