import { describe, expect, test } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function createTempConfigDir(mutator) {
  const commandsPath = resolve(process.cwd(), 'dx', 'config', 'commands.json')
  const commands = JSON.parse(readFileSync(commandsPath, 'utf8'))
  mutator(commands)

  const tempDir = mkdtempSync(join(tmpdir(), 'dx-config-test-'))
  tempDirs.push(tempDir)
  mkdirSync(tempDir, { recursive: true })
  writeFileSync(join(tempDir, 'commands.json'), JSON.stringify(commands, null, 2))
  return tempDir
}

function createRunnableWorkspace() {
  const tempDir = mkdtempSync(join(tmpdir(), 'dx-workspace-test-'))
  tempDirs.push(tempDir)
  mkdirSync(join(tempDir, 'node_modules', '.pnpm'), { recursive: true })
  mkdirSync(join(tempDir, 'node_modules', '@prisma', 'client'), { recursive: true })
  writeFileSync(join(tempDir, 'node_modules', '@prisma', 'client', 'default.js'), 'module.exports = {}')
  return tempDir
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('dx test e2e backend guard', () => {
  test('rejects backend e2e without file or directory path', () => {
    const configDir = createTempConfigDir(commands => {
      commands.test.e2e.backend.requiresPath = true
    })
    const result = runDx(['test', 'e2e', 'backend'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e backend 必须提供测试文件或目录路径')
  })

  test('help output only shows path-based backend e2e examples', () => {
    const result = runDx(['--help'])

    expect(result.code).toBe(0)
    expect(result.output).not.toContain('target: backend, all (默认: all)')
    expect(result.output).toContain('path: 测试文件或目录路径 (guarded e2e target 必填，例如 backend/quantify)')
    expect(result.output).toContain('dx test e2e backend apps/backend/e2e/auth')
    expect(result.output).toContain('dx test e2e quantify apps/quantify/e2e/health/health.e2e-spec.ts')
    expect(result.output).toContain('dx test e2e all          # 不受支持，必须指定 target 和 path')
    expect(result.output).not.toContain('dx test e2e backend                           # 运行后端E2E测试')
  })
})

describe('dx test e2e config-driven guard', () => {
  function createConfigWithGuardedTargets() {
    return createTempConfigDir(commands => {
      commands.test.e2e.backend.requiresPath = true
      commands.test.e2e.quantify = {
        command: 'node -e "console.log(\'quantify full run\')"',
        fileCommand: 'node -e "console.log(\'quantify path run\')"',
        requiresPath: true,
        description: '运行 quantify E2E 测试',
      }
      commands.test.e2e.smoke = {
        command: 'node -e "console.log(\'smoke e2e\')"',
        description: '运行 smoke E2E 测试',
      }
    })
  }

  test('rejects `dx test e2e backend`', () => {
    const configDir = createConfigWithGuardedTargets()
    const result = runDx(['test', 'e2e', 'backend'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e backend 必须提供测试文件或目录路径')
  })

  test('rejects `dx test e2e backend all`', () => {
    const configDir = createConfigWithGuardedTargets()
    const result = runDx(['test', 'e2e', 'backend', 'all'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e backend 不支持 all，必须提供测试文件或目录路径')
  })

  test('rejects `dx test e2e quantify`', () => {
    const configDir = createConfigWithGuardedTargets()
    const result = runDx(['test', 'e2e', 'quantify'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e quantify 必须提供测试文件或目录路径')
  })

  test('rejects `dx test e2e quantify all`', () => {
    const configDir = createConfigWithGuardedTargets()
    const result = runDx(['test', 'e2e', 'quantify', 'all'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e quantify 不支持 all，必须提供测试文件或目录路径')
  })

  test('rejects `dx test e2e all`', () => {
    const configDir = createConfigWithGuardedTargets()
    const result = runDx(['test', 'e2e', 'all'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e all 不受支持，请指定 target 和测试文件或目录路径')
  })

  test('rejects bare `dx test`', () => {
    const configDir = createConfigWithGuardedTargets()
    const result = runDx(['test'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e all 不受支持，请指定 target 和测试文件或目录路径')
  })

  test('rejects `dx test e2e`', () => {
    const configDir = createConfigWithGuardedTargets()
    const result = runDx(['test', 'e2e'], {
      env: { DX_CONFIG_DIR: configDir },
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('dx test e2e all 不受支持，请指定 target 和测试文件或目录路径')
  })

  test('keeps unguarded e2e targets behavior', () => {
    const configDir = createConfigWithGuardedTargets()
    const workspaceDir = createRunnableWorkspace()
    const result = runDx(['test', 'e2e', 'smoke'], {
      env: { DX_CONFIG_DIR: configDir },
      cwd: workspaceDir,
    })

    expect(result.code).toBe(0)
    expect(result.output).toContain('smoke e2e')
  })
})
