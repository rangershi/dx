import { describe, test, expect } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

describe('dx unknown command fast-fail', () => {
  test('unknown command exits immediately without startup checks', () => {
    const binPath = resolve(process.cwd(), 'bin', 'dx.js')

    let output = ''
    try {
      execFileSync('node', [binPath, 'inital'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      output = `${error.stdout || ''}${error.stderr || ''}`
    }

    expect(output).toContain('未知命令: inital')
    expect(output).not.toContain('检测到 Prisma Client 未生成')
    expect(output).not.toContain('环境变量验证失败')
  })
})
