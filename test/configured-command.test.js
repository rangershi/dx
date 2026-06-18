import { describe, expect, test } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function runDxWithConfig(config, args) {
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
})
