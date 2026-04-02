import { beforeEach, describe, expect, jest, test } from '@jest/globals'

const logger = {
  error: jest.fn(),
  info: jest.fn(),
  step: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
}

const confirmManager = {
  confirm: jest.fn(),
}

const execSync = jest.fn()

const fsMock = {
  cpSync: jest.fn(),
  copyFileSync: jest.fn(),
  existsSync: jest.fn(() => false),
  lstatSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  rmSync: jest.fn(),
  symlinkSync: jest.fn(),
}

jest.unstable_mockModule('../lib/logger.js', () => ({
  logger,
}))

jest.unstable_mockModule('../lib/confirm.js', () => ({
  confirmManager,
}))

jest.unstable_mockModule('node:child_process', () => ({
  execSync,
}))

jest.unstable_mockModule('node:fs', () => ({
  default: fsMock,
}))

const worktreeManagerModule = await import('../lib/worktree.js')
const worktreeManager = worktreeManagerModule.default
const { handleWorktree } = await import('../lib/cli/commands/worktree.js')

function createCli({ flags = {}, args = [], getWorktreeManager } = {}) {
  return {
    args,
    flags,
    getWorktreeManager: getWorktreeManager || jest.fn(async () => worktreeManager),
  }
}

describe('compatibility purge batch 3', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fsMock.existsSync.mockImplementation(() => false)
    delete process.exitCode
  })

  test('handleWorktree rejects legacy action aliases instead of mapping them to strict commands', async () => {
    const manager = {
      clean: jest.fn(),
      del: jest.fn(),
      getAllIssueWorktrees: jest.fn(async () => []),
      list: jest.fn(),
      make: jest.fn(),
    }

    const cases = ['delete', 'rm', 'ls', 'prune']

    for (const action of cases) {
      const cli = createCli({
        args: ['dx', 'worktree', action, '88'],
        getWorktreeManager: jest.fn(async () => manager),
      })

      await handleWorktree(cli, [action, '88'])

      expect(logger.error).toHaveBeenCalledWith(`未知的 worktree 操作: ${action}`)
    }

    expect(manager.del).not.toHaveBeenCalled()
    expect(manager.list).not.toHaveBeenCalled()
    expect(manager.clean).not.toHaveBeenCalled()
  })

  test('del rejects the legacy single-issue scalar interface', async () => {
    const result = await worktreeManager.del('123')

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('请提供 issue 编号数组')
  })

  test('del rejects guessed issue identifiers instead of accepting arbitrary values', async () => {
    const result = await worktreeManager.del(['issue-123', 'abc'])

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('issue 编号必须为纯数字字符串')
  })

  test('list displays issue numbers using the current repo prefix instead of the legacy hard-coded prefix', async () => {
    execSync.mockReturnValueOnce(`worktree /tmp/dx_issue_42
HEAD abcdef
branch refs/heads/issue-42

`)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    let renderedRows = []

    try {
      await worktreeManager.list()
      renderedRows = consoleSpy.mock.calls.map(call => call.join(' '))
    } finally {
      consoleSpy.mockRestore()
    }

    expect(renderedRows).toContainEqual(expect.stringContaining('#42\trefs/heads/issue-42\t/tmp/dx_issue_42'))
  })

  test('getAllIssueWorktrees no longer falls back to the legacy ai_monorepo path naming', async () => {
    execSync.mockReturnValueOnce(`worktree /tmp/ai_monorepo_issue_99
HEAD abcdef

worktree /tmp/dx_issue_42
HEAD 123456

`)

    await expect(worktreeManager.getAllIssueWorktrees()).resolves.toEqual(['42'])
  })
})
