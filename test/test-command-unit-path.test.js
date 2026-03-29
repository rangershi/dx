import { afterAll, describe, expect, test } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const tempDirs = []

function runDx(args, options = {}) {
  const binPath = resolve(process.cwd(), 'bin', 'dx.js')
  const extraEnv = options.env || {}
  const runCwd = options.cwd || process.cwd()

  try {
    return {
      code: 0,
      output: execFileSync('node', [binPath, ...args], {
        cwd: runCwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          AI_SKIP_ENV_CHECK: 'true',
          ...extraEnv,
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

function createTempConfigDir(commands) {
  const tempDir = mkdtempSync(join(tmpdir(), 'dx-config-unit-test-'))
  tempDirs.push(tempDir)
  mkdirSync(tempDir, { recursive: true })
  writeFileSync(join(tempDir, 'commands.json'), JSON.stringify(commands, null, 2))
  return tempDir
}

function createRunnableWorkspace() {
  const tempDir = mkdtempSync(join(tmpdir(), 'dx-workspace-unit-test-'))
  tempDirs.push(tempDir)
  mkdirSync(join(tempDir, 'node_modules', '.pnpm'), { recursive: true })
  mkdirSync(join(tempDir, 'node_modules', '@prisma', 'client'), { recursive: true })
  writeFileSync(join(tempDir, 'node_modules', '@prisma', 'client', 'default.js'), 'module.exports = {}')
  return tempDir
}

function writeProjectConfig(workspaceDir, target, config) {
  const projectDir = join(workspaceDir, 'apps', target)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(config, null, 2))
}

function createCommandsFixture() {
  return {
    test: {
      unit: {
        backend: {
          command:
            'node -e "console.log(process.argv.slice(1).join(\'\\n\'))" -- backend:test',
          description: 'backend unit',
        },
        nxBackend: {
          command:
            'node -e "console.log(process.argv.slice(1).join(\'\\n\'))" -- nx test backend',
          description: 'nx backend unit',
        },
        front: {
          command:
            'node -e "console.log(process.argv.slice(1).join(\'\\n\'))" -- nx test front',
          description: 'nx front unit',
        },
        vitestFront: {
          command:
            'node -e "console.log(process.argv.slice(1).join(\'\\n\'))" -- vitest run',
          description: 'vitest front unit',
        },
      },
    },
  }
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('dx test unit path forwarding', () => {
  test('unit target with path appends --runTestsByPath', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    const testPath = 'apps/backend/src/modules/chat/chat.service.spec.ts'

    const result = runDx(['--config-dir', configDir, 'test', 'unit', 'backend', testPath], {
      cwd: workspaceDir,
    })

    expect(result.code).toBe(0)
    expect(result.output).toContain('backend:test')
    expect(result.output).toContain('--runTestsByPath')
    expect(result.output).toContain(testPath)
  })

  test('unit target with path and -t appends both filters', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    const testPath = 'apps/backend/src/modules/chat/chat.service.spec.ts'
    const pattern = '只跑这一个 case'

    const result = runDx(
      ['--config-dir', configDir, 'test', 'unit', 'backend', testPath, '-t', pattern],
      { cwd: workspaceDir },
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain('--runTestsByPath')
    expect(result.output).toContain(testPath)
    expect(result.output).toContain('-t')
    expect(result.output).toContain(pattern)
  })

  test('nx unit command appends file path as positional argument', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    const testPath = 'apps/backend/src/modules/chat/chat.service.spec.ts'
    const pattern = '只跑这一个 case'

    const result = runDx(
      ['--config-dir', configDir, 'test', 'unit', 'nxBackend', testPath, '-t', pattern],
      { cwd: workspaceDir },
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain('nx')
    expect(result.output).toContain('test')
    expect(result.output).toContain('backend')
    expect(result.output).toContain(testPath)
    expect(result.output).toContain('-t')
    expect(result.output).toContain(pattern)
    expect(result.output).not.toContain('--testPathPattern')
    expect(result.output).not.toContain('--runTestsByPath')
  })

  test('vitest unit command appends file path as positional argument', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    const testPath = 'apps/front/src/lib/url-param-persistence.test.ts'
    const pattern = '只跑这一个 case'

    const result = runDx(
      ['--config-dir', configDir, 'test', 'unit', 'vitestFront', testPath, '-t', pattern],
      { cwd: workspaceDir },
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain('vitest')
    expect(result.output).toContain('run')
    expect(result.output).toContain(testPath)
    expect(result.output).toContain('-t')
    expect(result.output).toContain(pattern)
    expect(result.output).not.toContain('--testPathPattern')
    expect(result.output).not.toContain('--runTestsByPath')
  })

  test('nx vitest target rewrites workspace path to target cwd relative path', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    writeProjectConfig(workspaceDir, 'front', {
      targets: {
        test: {
          options: {
            command: 'vitest run',
            cwd: 'apps/front',
          },
        },
      },
    })
    const testPath = 'apps/front/src/lib/url-param-persistence.test.ts'

    const result = runDx(
      ['--config-dir', configDir, 'test', 'unit', 'front', testPath],
      { cwd: workspaceDir },
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain(`nx test front 'src/lib/url-param-persistence.test.ts'`)
  })
})
