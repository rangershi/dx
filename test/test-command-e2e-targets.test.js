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
  const tempDir = mkdtempSync(join(tmpdir(), 'dx-config-targets-test-'))
  tempDirs.push(tempDir)
  mkdirSync(tempDir, { recursive: true })
  writeFileSync(join(tempDir, 'commands.json'), JSON.stringify(commands, null, 2))
  return tempDir
}

function createRunnableWorkspace() {
  const tempDir = mkdtempSync(join(tmpdir(), 'dx-workspace-targets-test-'))
  tempDirs.push(tempDir)
  mkdirSync(join(tempDir, 'node_modules', '.pnpm'), { recursive: true })
  mkdirSync(join(tempDir, 'node_modules', '@prisma', 'client'), { recursive: true })
  writeFileSync(join(tempDir, 'node_modules', '@prisma', 'client', 'default.js'), 'module.exports = {}')
  return tempDir
}

function createCommandsFixture() {
  return {
    test: {
      e2e: {
        backend: {
          command: 'node -e "console.log(\'backend full run\')"',
          fileCommand:
            'node -e "console.log(\'backend path run\'); console.log(\'TEST_PATH=\' + process.argv[1]); const i = process.argv.indexOf(\'-t\'); if (i >= 0) console.log(\'TEST_NAME=\' + process.argv[i + 1]);" -- {TEST_PATH}',
          requiresPath: true,
          description: 'backend e2e',
        },
        quantify: {
          command: 'node -e "console.log(\'quantify full run\')"',
          fileCommand:
            'node -e "console.log(\'quantify path run\'); console.log(\'TEST_PATH=\' + process.argv[1]);" -- {TEST_PATH}',
          requiresPath: true,
          description: 'quantify e2e',
        },
        guardedNoFile: {
          command: 'node -e "console.log(\'guarded no file full run\')"',
          requiresPath: true,
          description: 'guarded target without fileCommand',
        },
        guardedMissingPlaceholder: {
          command: 'node -e "console.log(\'guarded placeholder full run\')"',
          fileCommand: 'node -e "console.log(\'missing placeholder\')"',
          requiresPath: true,
          description: 'guarded target without TEST_PATH placeholder',
        },
        smoke: {
          command: 'node -e "console.log(\'smoke full run\')"',
          description: 'smoke e2e',
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

describe('dx test e2e target-specific fileCommand', () => {
  test('backend path run uses configured fileCommand', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    const testPath = 'apps/backend/e2e/auth/auth.login.e2e-spec.ts'

    const result = runDx(['--config-dir', configDir, 'test', 'e2e', 'backend', testPath], {
      cwd: workspaceDir,
    })

    expect(result.code).toBe(0)
    expect(result.output).toContain('backend path run')
    expect(result.output).toContain(`TEST_PATH=${testPath}`)
    expect(result.output).not.toContain('backend full run')
  })

  test('quantify path run uses configured fileCommand', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    const testPath = 'apps/quantify/e2e/core/quantify.e2e-spec.ts'

    const result = runDx(['--config-dir', configDir, 'test', 'e2e', 'quantify', testPath], {
      cwd: workspaceDir,
    })

    expect(result.code).toBe(0)
    expect(result.output).toContain('quantify path run')
    expect(result.output).toContain(`TEST_PATH=${testPath}`)
    expect(result.output).not.toContain('quantify full run')
  })

  test('-t pattern is appended and escaped correctly', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()
    const testPath = 'apps/backend/e2e/auth/auth login.e2e-spec.ts'
    const pattern = `case "A" $USER \`tick\` 'single'`

    const result = runDx(
      ['--config-dir', configDir, 'test', 'e2e', 'backend', testPath, '-t', pattern],
      { cwd: workspaceDir },
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain(`TEST_PATH=${testPath}`)
    expect(result.output).toContain(`TEST_NAME=${pattern}`)
  })

  test('guarded target without fileCommand fails with a configuration error', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()

    const result = runDx(
      ['--config-dir', configDir, 'test', 'e2e', 'guardedNoFile', 'apps/guarded/e2e/health'],
      { cwd: workspaceDir },
    )

    expect(result.code).not.toBe(0)
    expect(result.output).toContain(
      '测试配置错误: test.e2e.guardedNoFile 已启用 requiresPath，必须配置 fileCommand',
    )
  })

  test('guarded target without TEST_PATH placeholder fails with a configuration error', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()

    const result = runDx(
      ['--config-dir', configDir, 'test', 'e2e', 'guardedMissingPlaceholder', 'apps/guarded/e2e/health'],
      { cwd: workspaceDir },
    )

    expect(result.code).not.toBe(0)
    expect(result.output).toContain(
      '测试配置错误: test.e2e.guardedMissingPlaceholder 的 fileCommand 必须包含 {TEST_PATH}',
    )
  })

  test('unknown target still reports 未找到测试配置', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()

    const result = runDx(['--config-dir', configDir, 'test', 'e2e', 'missingTarget'], {
      cwd: workspaceDir,
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('未找到测试配置: e2e.missingTarget')
  })

  test('unguarded E2E target keeps old behavior', () => {
    const configDir = createTempConfigDir(createCommandsFixture())
    const workspaceDir = createRunnableWorkspace()

    const result = runDx(['--config-dir', configDir, 'test', 'e2e', 'smoke'], {
      cwd: workspaceDir,
    })

    expect(result.code).toBe(0)
    expect(result.output).toContain('smoke full run')
  })
})
