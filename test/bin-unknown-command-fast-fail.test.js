import { describe, test, expect } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('dx unknown command fast-fail', () => {
  test('unknown command exits immediately without startup checks', () => {
    const binPath = resolve(process.cwd(), 'bin', 'dx.js')
    const configDir = mkdtempSync(join(tmpdir(), 'dx-unknown-help-'))
    writeFileSync(
      join(configDir, 'commands.json'),
      JSON.stringify(
        {
          help: {
            summary: 'Scoped DX help',
            commands: {
              start: { summary: 'Start summary' },
            },
          },
          start: {},
          ghost: {},
        },
        null,
        2,
      ),
    )

    let output = ''
    try {
      execFileSync('node', [binPath, '--config-dir', configDir, 'inital'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      output = `${error.stdout || ''}${error.stderr || ''}`
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }

    expect(output).toContain('未知命令: inital')
    expect(output).toContain('Start summary')
    expect(output).not.toContain('检测到 Prisma Client 未生成')
    expect(output).not.toContain('环境变量验证失败')
  })
})
