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

describe('dx db migrate guard', () => {
  test('rejects migrate outside development environment', () => {
    const result = runDx(['db', 'migrate', '--prod', '--name', 'add-users'])

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx db migrate 仅允许在 --dev 环境下创建迁移')
    expect(result.output).toContain('dx db deploy --prod')
  })

  test('db help explains migrate is development-only', () => {
    const result = runDx(['help', 'db'])

    expect(result.code).toBe(0)
    expect(result.output).toContain('仅允许在开发环境使用 `dx db migrate --dev --name <migration-name>` 创建迁移')
    expect(result.output).toContain('非开发环境请使用 dx db deploy')
  })
})
