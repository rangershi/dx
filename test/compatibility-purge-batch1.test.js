import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const logger = {
  error: jest.fn(),
  info: jest.fn(),
  step: jest.fn(),
  warn: jest.fn(),
}

jest.unstable_mockModule('../lib/logger.js', () => ({
  logger,
}))

const { DxCli } = await import('../lib/cli/dx-cli.js')
const { handleStart } = await import('../lib/cli/commands/start.js')
const { handleBuild } = await import('../lib/cli/commands/core.js')
const { handleDatabase } = await import('../lib/cli/commands/db.js')
const { handleExport } = await import('../lib/cli/commands/export.js')

function createCli({ commands, flags = {}, executeCommand, args } = {}) {
  return Object.assign(Object.create(DxCli.prototype), {
    commands,
    flags,
    invocation: 'dx',
    args: args || ['dx'],
    executeCommand: executeCommand || jest.fn(),
    handleConcurrentCommands: jest.fn(),
    handleSequentialCommands: jest.fn(),
  })
}

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

describe('compatibility purge batch 1', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.exitCode
  })

  test('dx dev is treated as an unknown command instead of a compatibility alias', () => {
    const result = runDx(['dev', 'backend'])

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('未知命令: dev')
    expect(result.output).not.toContain('`dx dev` 命令已移除，统一使用 `dx start`。')
  })

  test('legacy environment flag aliases are rejected', () => {
    const cases = ['--development', '--production', '--stage']

    for (const flag of cases) {
      const result = runDx(['start', 'backend', flag])

      expect(result.code).not.toBe(0)
      expect(result.output).toContain(`检测到未识别的选项: ${flag}`)
    }
  })

  test('handleStart no longer falls back to legacy commands.dev entries', async () => {
    const executeCommand = jest.fn()
    const cli = createCli({
      commands: {
        start: {},
        dev: {
          backend: {
            command: 'echo legacy backend',
            ports: [3001],
          },
        },
      },
      flags: { dev: true },
      executeCommand,
    })

    await handleStart(cli, ['backend'])

    expect(executeCommand).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('未找到启动配置: backend')
    expect(process.exitCode).toBe(1)
  })

  test('collectStartPorts only uses the selected start config ports', () => {
    const cli = createCli({
      commands: {
        dev: {
          backend: {
            ports: [3999],
          },
        },
      },
    })

    const envKey = cli.normalizeEnvKey('development')

    expect(envKey).toBe('development')
    expect(cli.collectStartPorts('backend', { ports: [3000] }, envKey)).toEqual([3000])
  })

  test('build uses strict full environment keys', async () => {
    const executeCommand = jest.fn()
    const cli = createCli({
      commands: {
        build: {
          backend: {
            production: {
              command: 'echo build production',
              app: 'backend',
            },
          },
        },
      },
      flags: { prod: true },
      executeCommand,
    })

    await handleBuild(cli, ['backend'])

    expect(executeCommand).toHaveBeenCalledWith({
      command: 'echo build production',
      app: 'backend',
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('build no longer falls back from staging to prod config', async () => {
    const executeCommand = jest.fn()
    const cli = createCli({
      commands: {
        build: {
          backend: {
            prod: {
              command: 'echo legacy prod build',
              app: 'backend',
            },
          },
        },
      },
      flags: { staging: true },
      executeCommand,
    })

    await handleBuild(cli, ['backend'])

    expect(executeCommand).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('构建目标 backend 不支持 --staging 环境')
    expect(process.exitCode).toBe(1)
  })

  test('db deploy uses strict full environment keys', async () => {
    const executeCommand = jest.fn()
    const cli = createCli({
      commands: {
        db: {
          deploy: {
            production: {
              command: 'echo db deploy production',
              app: 'backend',
            },
          },
        },
      },
      flags: { prod: true },
      executeCommand,
      args: ['db', 'deploy', '--prod'],
    })

    await handleDatabase(cli, ['deploy'])

    expect(executeCommand).toHaveBeenCalledWith(
      {
        command: 'echo db deploy production',
        app: 'backend',
        env: { NX_CACHE: 'false' },
      },
      { prod: true },
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('db deploy no longer falls back from staging to prod config', async () => {
    const executeCommand = jest.fn()
    const cli = createCli({
      commands: {
        db: {
          deploy: {
            prod: {
              command: 'echo legacy prod db deploy',
              app: 'backend',
            },
          },
        },
      },
      flags: { staging: true },
      executeCommand,
      args: ['db', 'deploy', '--staging'],
    })

    await handleDatabase(cli, ['deploy'])

    expect(executeCommand).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('数据库操作 deploy 未提供 --staging 环境配置')
    expect(process.exitCode).toBe(1)
  })

  test('export uses strict full environment keys', async () => {
    const executeCommand = jest.fn()
    const cli = createCli({
      commands: {
        export: {
          openapi: {
            production: {
              command: 'echo export production',
              app: 'backend',
            },
          },
        },
      },
      flags: { prod: true },
      executeCommand,
    })

    await handleExport(cli, ['openapi'])

    expect(executeCommand).toHaveBeenCalledWith({
      command: 'echo export production',
      app: 'backend',
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('export no longer falls back from staging to prod config', async () => {
    const executeCommand = jest.fn()
    const cli = createCli({
      commands: {
        export: {
          openapi: {
            prod: {
              command: 'echo legacy prod export',
              app: 'backend',
            },
          },
        },
      },
      flags: { staging: true },
      executeCommand,
    })

    await handleExport(cli, ['openapi'])

    expect(executeCommand).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('导出目标 openapi 未提供 --staging 环境配置')
    expect(process.exitCode).toBe(1)
  })
})
