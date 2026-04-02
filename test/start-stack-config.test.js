import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const logger = {
  error: jest.fn(),
  info: jest.fn(),
  step: jest.fn(),
}

jest.unstable_mockModule('../lib/logger.js', () => ({
  logger,
}))

const { handleStart } = await import('../lib/cli/commands/start.js')
const { DxCli } = await import('../lib/cli/dx-cli.js')
const { FLAG_DEFINITIONS } = await import('../lib/cli/flags.js')
const { showCommandHelp } = await import('../lib/cli/help.js')

describe('start stack configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('handleStart no longer hard-codes stack branch', () => {
    const file = join(process.cwd(), 'lib', 'cli', 'commands', 'start.js')
    const source = readFileSync(file, 'utf8')

    expect(source.includes("service === 'stack'")).toBe(false)
    expect(source.includes("import('./stack.js')")).toBe(false)
  })

  test('default commands config provides start.stack internal runner', () => {
    const file = join(process.cwd(), 'dx', 'config', 'commands.json')
    const commands = JSON.parse(readFileSync(file, 'utf8'))

    expect(commands?.start?.stack).toBeDefined()
    expect(commands.start.stack.internal).toBe('pm2-stack')
    expect(Array.isArray(commands.start.stack?.stack?.services)).toBe(true)
  })

  test('DxCli positional validation rejects stack subcommands as extra parameters', () => {
    const argvBackup = process.argv
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit:${code}`)
    })

    try {
      process.argv = ['node', 'dx', 'start', 'stack', 'front']
      const cli = new DxCli({
        configDir: resolve(process.cwd(), 'example', 'dx', 'config'),
      })

      expect(() => cli.validatePositionalArgs('start', ['stack', 'front'])).toThrow('process.exit:1')
      expect(logger.error).toHaveBeenCalledWith('命令 start 存在未识别的额外参数: front')
    } finally {
      process.argv = argvBackup
      exitSpy.mockRestore()
    }
  })

  test('dynamic start help includes stack notes from config help metadata', async () => {
    const file = join(process.cwd(), 'dx', 'config', 'commands.json')
    const commands = JSON.parse(readFileSync(file, 'utf8'))
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const cli = {
      invocation: 'dx',
      commands,
      commandHandlers: {
        start: () => {},
      },
      flagDefinitions: FLAG_DEFINITIONS,
    }

    try {
      showCommandHelp('start', cli)

      const output = logSpy.mock.calls.flat().join('\n')
      expect(output).toContain('启动/桥接服务')
      expect(output).toContain('dx start <service> [环境标志]')
      expect(output).toContain('未指定 service 时默认使用开发套件，仅允许 --dev')
      expect(output).toContain('dx start backend --dev')
      expect(output).toContain('dx start stack')
    } finally {
      logSpy.mockRestore()
    }
  })

})
