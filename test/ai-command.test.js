import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'

const spawnMock = jest.fn()
const spawnSyncMock = jest.fn()

jest.unstable_mockModule('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}))

// Import after mocking node:child_process
const { handleAi } = await import('../lib/cli/commands/ai.js')

function makeCli(overrides = {}) {
  return {
    invocation: 'dx',
    // raw argv after node/bin (used by getPassthroughArgs)
    args: [],
    flags: { Y: true },
    commands: {},
    determineEnvironment: () => 'development',
    normalizeEnvKey: () => 'dev',
    ...overrides,
  }
}

describe('dx ai command', () => {
  let tempDir
  let previousCwd
  let logSpy
  let errorSpy

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    tempDir = mkdtempSync(join(tmpdir(), 'dx-ai-test-'))
    previousCwd = process.cwd()
    process.chdir(tempDir)
    process.exitCode = undefined
    spawnMock.mockReset()
    spawnSyncMock.mockReset()

    // default: opencode available
    spawnSyncMock.mockReturnValue({ status: 0 })
  })

  afterEach(() => {
    process.chdir(previousCwd)
    rmSync(tempDir, { recursive: true, force: true })
    logSpy?.mockRestore()
    errorSpy?.mockRestore()
  })

  it('should run opencode with prompt file content and inject OPENCODE_PERMISSION', async () => {
    const promptDir = join(tempDir, 'prompts')
    mkdirSync(promptDir, { recursive: true })
    const promptFile = join(promptDir, 'review.md')
    writeFileSync(promptFile, 'Hello from prompt\nSecond line\n', 'utf8')

    const child = new EventEmitter()
    child.kill = jest.fn()
    spawnMock.mockImplementation((_cmd, _args, _opts) => {
      // Resolve the awaited promise
      setTimeout(() => child.emit('exit', 0), 0)
      return child
    })

    const cli = makeCli({
      args: ['ai', 'review', '--', '--title', 'my run'],
      commands: {
        ai: {
          review: {
            promptFile: './prompts/review.md',
            model: 'openai/gpt-4.1',
            agent: 'general',
            format: 'json',
            attach: 'http://localhost:4096',
            passthrough: ['--share'],
          },
        },
      },
    })

    await handleAi(cli, ['review'])

    expect(spawnMock).toHaveBeenCalledTimes(1)

    const [cmd, args, opts] = spawnMock.mock.calls[0]
    expect(cmd).toBe('opencode')

    // Basic arg structure
    expect(args[0]).toBe('run')
    expect(args).toEqual(
      expect.arrayContaining([
        '--model',
        'openai/gpt-4.1',
        '--agent',
        'general',
        '--format',
        'json',
        '--attach',
        'http://localhost:4096',
        '--share',
        '--title',
        'my run',
      ]),
    )

    // Prompt content is passed after `--` to prevent yargs from parsing it as flags.
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toContain('Hello from prompt')
    expect(args[args.length - 1]).toContain('Second line')

    expect(opts.cwd).toBe(process.cwd())
    expect(opts.stdio).toBe('inherit')
    expect(opts.env.OPENCODE_PERMISSION).toBe('"allow"')
  })

  it('should set exitCode when opencode exits non-zero', async () => {
    const promptFile = join(tempDir, 'p.md')
    writeFileSync(promptFile, 'hi', 'utf8')

    const child = new EventEmitter()
    child.kill = jest.fn()
    spawnMock.mockImplementation(() => {
      setTimeout(() => child.emit('exit', 7), 0)
      return child
    })

    const cli = makeCli({
      args: ['ai', 'x'],
      commands: { ai: { x: { promptFile: './p.md' } } },
    })

    await handleAi(cli, ['x'])
    expect(process.exitCode).toBe(7)
  })

  it('should fail when name is missing', async () => {
    const cli = makeCli({ args: ['ai'] })
    await handleAi(cli, [])
    expect(process.exitCode).toBe(1)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('should fail when ai task config missing', async () => {
    const cli = makeCli({
      args: ['ai', 'nope'],
      commands: { ai: {} },
    })
    await handleAi(cli, ['nope'])
    expect(process.exitCode).toBe(1)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('should fail when promptFile is missing in config', async () => {
    const cli = makeCli({
      args: ['ai', 'x'],
      commands: { ai: { x: { model: 'openai/gpt-4.1' } } },
    })
    await handleAi(cli, ['x'])
    expect(process.exitCode).toBe(1)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('should fail when opencode is not installed', async () => {
    spawnSyncMock.mockReturnValue({ error: { code: 'ENOENT' } })

    const promptFile = join(tempDir, 'p.md')
    writeFileSync(promptFile, 'hi', 'utf8')

    const cli = makeCli({
      args: ['ai', 'x'],
      commands: { ai: { x: { promptFile: './p.md' } } },
    })

    await handleAi(cli, ['x'])
    expect(process.exitCode).toBe(1)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('should support env-specific branch selection (dev)', async () => {
    const promptFile = join(tempDir, 'p-dev.md')
    writeFileSync(promptFile, 'dev prompt', 'utf8')

    const child = new EventEmitter()
    child.kill = jest.fn()
    spawnMock.mockImplementation(() => {
      setTimeout(() => child.emit('exit', 0), 0)
      return child
    })

    const cli = makeCli({
      args: ['ai', 'x'],
      determineEnvironment: () => 'development',
      normalizeEnvKey: () => 'dev',
      commands: {
        ai: {
          x: {
            dev: { promptFile: './p-dev.md', passthrough: ['--share'] },
            prod: { promptFile: './p-prod.md' },
          },
        },
      },
    })

    await handleAi(cli, ['x'])
    const [_cmd, args] = spawnMock.mock.calls[0]
    expect(args).toEqual(expect.arrayContaining(['--share']))
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toContain('dev prompt')
  })

  it('should expand ~ in promptFile', async () => {
    const home = homedir()
    const promptDir = join(home, 'dx-ai-test-prompts')
    mkdirSync(promptDir, { recursive: true })

    const promptFile = join(promptDir, 'prompt.md')
    writeFileSync(promptFile, 'home prompt', 'utf8')

    const child = new EventEmitter()
    child.kill = jest.fn()
    spawnMock.mockImplementation(() => {
      setTimeout(() => child.emit('exit', 0), 0)
      return child
    })

    const cli = makeCli({
      args: ['ai', 'x'],
      commands: { ai: { x: { promptFile: `~/dx-ai-test-prompts/prompt.md` } } },
    })

    await handleAi(cli, ['x'])
    const [_cmd, args] = spawnMock.mock.calls[0]
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toContain('home prompt')

    // best-effort cleanup
    rmSync(promptDir, { recursive: true, force: true })
  })

  it('should fallback to dx/prompts for relative promptFile when not found in project root', async () => {
    const promptDir = join(tempDir, 'dx', 'prompts')
    mkdirSync(promptDir, { recursive: true })
    const promptFile = join(promptDir, 'git-commit-and-pr.md')
    writeFileSync(promptFile, 'dx prompts fallback', 'utf8')

    const child = new EventEmitter()
    child.kill = jest.fn()
    spawnMock.mockImplementation(() => {
      setTimeout(() => child.emit('exit', 0), 0)
      return child
    })

    const cli = makeCli({
      args: ['ai', 'pr'],
      commands: { ai: { pr: { promptFile: './prompts/git-commit-and-pr.md' } } },
    })

    await handleAi(cli, ['pr'])
    const [_cmd, args] = spawnMock.mock.calls[0]
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toContain('dx prompts fallback')
  })

  it('should prefer dx/prompts for bare filename promptFile', async () => {
    const promptDir = join(tempDir, 'dx', 'prompts')
    mkdirSync(promptDir, { recursive: true })
    const promptFile = join(promptDir, 'prompt.md')
    writeFileSync(promptFile, 'bare filename prompt', 'utf8')

    const child = new EventEmitter()
    child.kill = jest.fn()
    spawnMock.mockImplementation(() => {
      setTimeout(() => child.emit('exit', 0), 0)
      return child
    })

    const cli = makeCli({
      args: ['ai', 'x'],
      commands: { ai: { x: { promptFile: 'prompt.md' } } },
    })

    await handleAi(cli, ['x'])
    const [_cmd, args] = spawnMock.mock.calls[0]
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toContain('bare filename prompt')
  })

  it("should allow prompt starting with '---' (frontmatter) without being parsed as flags", async () => {
    const promptDir = join(tempDir, 'dx', 'prompts')
    mkdirSync(promptDir, { recursive: true })
    const promptFile = join(promptDir, 'frontmatter.md')
    writeFileSync(promptFile, '---\ntitle: test\n---\n\nbody\n', 'utf8')

    const child = new EventEmitter()
    child.kill = jest.fn()
    spawnMock.mockImplementation(() => {
      setTimeout(() => child.emit('exit', 0), 0)
      return child
    })

    const cli = makeCli({
      args: ['ai', 'x'],
      commands: { ai: { x: { promptFile: 'frontmatter.md' } } },
    })

    await handleAi(cli, ['x'])
    const [_cmd, args] = spawnMock.mock.calls[0]
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toContain('---')
    expect(args[args.length - 1]).toContain('body')
  })
})
