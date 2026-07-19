import { describe, expect, test } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function runDxWithConfig(config, args, env = {}) {
  const binPath = resolve(process.cwd(), 'bin', 'dx.js')
  const configDir = mkdtempSync(join(tmpdir(), 'dx-configured-command-'))
  writeFileSync(join(configDir, 'commands.json'), `${JSON.stringify(config, null, 2)}\n`)

  try {
    return {
      code: 0,
      output: execFileSync('node', [binPath, '--config-dir', configDir, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          AI_SKIP_ENV_CHECK: 'true',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    }
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout || ''}${error.stderr || ''}`,
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

describe('configured top-level commands', () => {
  test('runs a configured nested command without a built-in handler', () => {
    const result = runDxWithConfig(
      {
        help: {
          summary: 'Scoped DX help',
          commands: {
            toolbox: {
              summary: 'Toolbox commands',
              examples: [
                {
                  command: 'dx toolbox verify',
                  description: 'Run toolbox verification',
                },
              ],
            },
          },
        },
        toolbox: {
          verify: {
            command: 'node -e "console.log(\'configured command ok\')"',
            skipEnvValidation: true,
          },
        },
      },
      ['toolbox', 'verify'],
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain('configured command ok')
    expect(result.output).not.toContain('未知命令: toolbox')
  })

  test('extends a built-in command namespace without replacing built-in actions', () => {
    const config = {
      release: {
        plan: {
          production: {
            command: 'node -e "console.log(\'release plan production\')"',
            skipEnvValidation: true,
          },
        },
      },
    }

    const result = runDxWithConfig(config, ['release', 'plan', '--prod'])

    expect(result.code).toBe(0)
    expect(result.output).toContain('release plan production')
  })

  test('reports unknown built-in extension actions when no project command exists', () => {
    const result = runDxWithConfig({ release: {} }, ['release', 'missing'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('未找到命令: release missing')
  })

  test('honors dangerous metadata for configured built-in extensions', () => {
    const result = runDxWithConfig(
      {
        release: {
          run: {
            production: {
              command: 'node -e "console.log(\'release dispatched\')"',
              description: 'dispatch production release',
              dangerous: true,
              skipEnvValidation: true,
            },
          },
        },
      },
      ['release', 'run', '--prod', '-Y'],
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain('跳过危险操作确认')
    expect(result.output).toContain('release dispatched')
  })
})
