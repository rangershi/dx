import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
  renameSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  promises as fsPromises,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { runCodexInitial } from '../lib/codex-initial.js'
import { logger } from '../lib/logger.js'

describe('runCodexInitial', () => {
  let tempDir
  let packageRoot
  let homeDir

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dx-codex-initial-'))
    packageRoot = join(tempDir, 'pkg')
    homeDir = join(tempDir, 'home')

    mkdirSync(packageRoot, { recursive: true })
    mkdirSync(homeDir, { recursive: true })

    jest.spyOn(logger, 'success').mockImplementation(() => {})
    jest.spyOn(logger, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  test('syncs packaged skill directories into ~/.agents/skills and links them into ~/.claude/skills', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a', 'references'), { recursive: true })
    mkdirSync(join(packageRoot, 'skills', 'skill-b', 'agents'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# new skill a')
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'config.yaml'), 'k: new')
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'references', 'readme.md'), 'new ref')
    writeFileSync(join(packageRoot, 'skills', 'skill-b', 'agents', 'openai.yaml'), 'model: gpt')

    mkdirSync(join(homeDir, '.codex', 'skills', 'skill-a', 'references'), { recursive: true })
    mkdirSync(join(homeDir, '.codex', 'skills', 'skill-existing-only'), { recursive: true })
    mkdirSync(join(homeDir, '.agents', 'external-symlink-target'), { recursive: true })
    writeFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'SKILL.md'), '# old skill a')
    writeFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'references', 'keep.md'), 'keep me')
    writeFileSync(join(homeDir, '.codex', 'skills', 'skill-existing-only', 'SKILL.md'), '# existing only')
    symlinkSync(join(homeDir, '.agents', 'external-symlink-target'), join(homeDir, '.codex', 'skills', 'skill-b'), 'dir')

    mkdirSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references'), { recursive: true })
    mkdirSync(join(homeDir, '.claude', 'skills', 'skill-existing-only'), { recursive: true })
    writeFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'SKILL.md'), '# old claude skill a')
    writeFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references', 'keep.md'), 'keep claude')
    writeFileSync(join(homeDir, '.claude', 'skills', 'skill-existing-only', 'SKILL.md'), '# existing claude only')

    await runCodexInitial({ packageRoot, homeDir })

    expect(readFileSync(join(homeDir, '.agents', 'skills', 'skill-a', 'SKILL.md'), 'utf8')).toBe('# new skill a')
    expect(readFileSync(join(homeDir, '.agents', 'skills', 'skill-a', 'config.yaml'), 'utf8')).toBe('k: new')
    expect(readFileSync(join(homeDir, '.agents', 'skills', 'skill-a', 'references', 'readme.md'), 'utf8')).toBe('new ref')
    expect(readFileSync(join(homeDir, '.agents', 'skills', 'skill-b', 'agents', 'openai.yaml'), 'utf8')).toBe('model: gpt')
    expect(existsSync(join(homeDir, '.agents', 'skills', 'skill-a', 'references', 'keep.md'))).toBe(false)

    expect(existsSync(join(homeDir, '.codex', 'skills', 'skill-a'))).toBe(false)
    expect(lstatSync(join(homeDir, '.codex', 'skills', 'skill-b')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(homeDir, '.codex', 'skills', 'skill-existing-only', 'SKILL.md'), 'utf8')).toBe('# existing only')

    expect(lstatSync(join(homeDir, '.claude', 'skills', 'skill-a')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(homeDir, '.claude', 'skills', 'skill-b')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(homeDir, '.claude', 'skills', 'skill-a'))).toBe(join(homeDir, '.agents', 'skills', 'skill-a'))
    expect(readlinkSync(join(homeDir, '.claude', 'skills', 'skill-b'))).toBe(join(homeDir, '.agents', 'skills', 'skill-b'))
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'SKILL.md'), 'utf8')).toBe('# new skill a')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'config.yaml'), 'utf8')).toBe('k: new')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references', 'readme.md'), 'utf8')).toBe('new ref')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-b', 'agents', 'openai.yaml'), 'utf8')).toBe('model: gpt')
    expect(existsSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references', 'keep.md'))).toBe(false)
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-existing-only', 'SKILL.md'), 'utf8')).toBe('# existing claude only')
  })

  test('creates ~/.agents/skills, ~/.codex/skills, and ~/.claude/skills when missing', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# skill a')

    await runCodexInitial({ packageRoot, homeDir })

    expect(existsSync(join(homeDir, '.agents', 'skills', 'skill-a', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(homeDir, '.codex', 'skills'))).toBe(true)
    expect(existsSync(join(homeDir, '.codex', 'skills', 'skill-a'))).toBe(false)
    expect(lstatSync(join(homeDir, '.claude', 'skills', 'skill-a')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(homeDir, '.claude', 'skills', 'skill-a', 'SKILL.md'))).toBe(true)
  })

  test('removes old non-symlink managed skill directories from ~/.codex/skills and ~/.claude/skills', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a'), { recursive: true })
    mkdirSync(join(packageRoot, 'skills', 'pr-review-loop'), { recursive: true })
    mkdirSync(join(packageRoot, 'skills', 'git-commit-and-pr'), { recursive: true })
    mkdirSync(join(packageRoot, 'skills', 'skill-c'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# skill a')
    writeFileSync(join(packageRoot, 'skills', 'pr-review-loop', 'SKILL.md'), '# source deprecated')
    writeFileSync(join(packageRoot, 'skills', 'git-commit-and-pr', 'SKILL.md'), '# source deprecated')
    writeFileSync(join(packageRoot, 'skills', 'skill-c', 'SKILL.md'), '# source skill c')

    mkdirSync(join(homeDir, '.codex', 'skills', 'pr-review-loop'), { recursive: true })
    mkdirSync(join(homeDir, '.codex', 'skills', 'git-commit-and-pr'), { recursive: true })
    mkdirSync(join(homeDir, '.codex', 'skills', 'skill-c'), { recursive: true })
    mkdirSync(join(homeDir, '.codex', 'skills', 'keep-skill'), { recursive: true })
    writeFileSync(join(homeDir, '.codex', 'skills', 'pr-review-loop', 'SKILL.md'), '# deprecated')
    writeFileSync(join(homeDir, '.codex', 'skills', 'git-commit-and-pr', 'SKILL.md'), '# deprecated')
    writeFileSync(join(homeDir, '.codex', 'skills', 'skill-c', 'SKILL.md'), '# old skill c')
    writeFileSync(join(homeDir, '.codex', 'skills', 'keep-skill', 'SKILL.md'), '# keep')

    mkdirSync(join(homeDir, '.claude', 'skills', 'pr-review-loop'), { recursive: true })
    mkdirSync(join(homeDir, '.claude', 'skills', 'git-commit-and-pr'), { recursive: true })
    mkdirSync(join(homeDir, '.claude', 'skills', 'skill-c'), { recursive: true })
    mkdirSync(join(homeDir, '.claude', 'skills', 'keep-skill'), { recursive: true })
    writeFileSync(join(homeDir, '.claude', 'skills', 'pr-review-loop', 'SKILL.md'), '# deprecated')
    writeFileSync(join(homeDir, '.claude', 'skills', 'git-commit-and-pr', 'SKILL.md'), '# deprecated')
    writeFileSync(join(homeDir, '.claude', 'skills', 'skill-c', 'SKILL.md'), '# old skill c')
    writeFileSync(join(homeDir, '.claude', 'skills', 'keep-skill', 'SKILL.md'), '# keep')

    await runCodexInitial({ packageRoot, homeDir })

    expect(existsSync(join(homeDir, '.codex', 'skills', 'pr-review-loop'))).toBe(false)
    expect(existsSync(join(homeDir, '.codex', 'skills', 'git-commit-and-pr'))).toBe(false)
    expect(existsSync(join(homeDir, '.codex', 'skills', 'skill-c'))).toBe(false)
    expect(readFileSync(join(homeDir, '.codex', 'skills', 'keep-skill', 'SKILL.md'), 'utf8')).toBe('# keep')

    expect(lstatSync(join(homeDir, '.claude', 'skills', 'pr-review-loop')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(homeDir, '.claude', 'skills', 'git-commit-and-pr')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(homeDir, '.claude', 'skills', 'skill-c')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'keep-skill', 'SKILL.md'), 'utf8')).toBe('# keep')
    expect(readFileSync(join(homeDir, '.agents', 'skills', 'pr-review-loop', 'SKILL.md'), 'utf8')).toBe('# source deprecated')
    expect(readFileSync(join(homeDir, '.agents', 'skills', 'git-commit-and-pr', 'SKILL.md'), 'utf8')).toBe('# source deprecated')
    expect(readFileSync(join(homeDir, '.agents', 'skills', 'skill-c', 'SKILL.md'), 'utf8')).toBe('# source skill c')
  })

  test('purges historically deleted skills from ~/.agents, ~/.claude, and ~/.codex (real dirs and symlinks)', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# skill a')

    // autospec 是硬编码的历史已删除 skill
    // agents: 真实目录副本
    mkdirSync(join(homeDir, '.agents', 'skills', 'autospec'), { recursive: true })
    writeFileSync(join(homeDir, '.agents', 'skills', 'autospec', 'SKILL.md'), '# stale agents')
    // codex: 真实目录副本
    mkdirSync(join(homeDir, '.codex', 'skills', 'autospec'), { recursive: true })
    writeFileSync(join(homeDir, '.codex', 'skills', 'autospec', 'SKILL.md'), '# stale codex')
    // claude: 指向 agents 的软链（agents target 同样是已删除 skill，会被 purgeAgents 删）
    mkdirSync(join(homeDir, '.claude', 'skills'), { recursive: true })
    symlinkSync(
      join(homeDir, '.agents', 'skills', 'autospec'),
      join(homeDir, '.claude', 'skills', 'autospec'),
      'dir',
    )

    // 第二个已删除 skill omc-reference：claude 软链指向 agents 之外的独立目录，
    // 用以独立验证"软链本身被删除"而非依赖 purgeAgents 巧合删掉 target。
    const externalTarget = join(homeDir, 'external-omc-reference')
    mkdirSync(externalTarget, { recursive: true })
    writeFileSync(join(externalTarget, 'SKILL.md'), '# external target')
    symlinkSync(externalTarget, join(homeDir, '.claude', 'skills', 'omc-reference'), 'dir')

    await runCodexInitial({ packageRoot, homeDir })

    expect(existsSync(join(homeDir, '.agents', 'skills', 'autospec'))).toBe(false)
    expect(existsSync(join(homeDir, '.codex', 'skills', 'autospec'))).toBe(false)
    // autospec 软链本身被删除（lstat 应抛 ENOENT）
    expect(existsSync(join(homeDir, '.claude', 'skills', 'autospec'))).toBe(false)
    let autospecLink = true
    try {
      lstatSync(join(homeDir, '.claude', 'skills', 'autospec'))
    } catch {
      autospecLink = false
    }
    expect(autospecLink).toBe(false)

    // omc-reference 软链被独立删除（lstat 抛 ENOENT），而其外部 target 不受影响——
    // 证明 purge 删的是软链本身，不依赖 target 恰好也在 agents 被删。
    let omcLink = true
    try {
      lstatSync(join(homeDir, '.claude', 'skills', 'omc-reference'))
    } catch {
      omcLink = false
    }
    expect(omcLink).toBe(false)
    expect(existsSync(join(externalTarget, 'SKILL.md'))).toBe(true)

    // 现存 skill 仍正常同步
    expect(existsSync(join(homeDir, '.agents', 'skills', 'skill-a', 'SKILL.md'))).toBe(true)
  })

  test('throws when DELETED_SKILLS overlaps an existing packaged skill', async () => {
    // autospec 在 DELETED_SKILLS 名单内；若它又出现在 skills/ 现存模板中，
    // 必须抛错而非把刚同步的 skill 又删掉。
    mkdirSync(join(packageRoot, 'skills', 'autospec'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'autospec', 'SKILL.md'), '# resurrected')

    await expect(runCodexInitial({ packageRoot, homeDir })).rejects.toThrow('DELETED_SKILLS')
  })

  test('removes stale temporary skill directories before syncing', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# skill a')

    mkdirSync(join(homeDir, '.agents', 'skills', '.skill-a.tmp-123-456'), { recursive: true })
    mkdirSync(join(homeDir, '.agents', 'skills', '.skill-a.backup-123-456'), { recursive: true })

    await runCodexInitial({ packageRoot, homeDir })

    expect(existsSync(join(homeDir, '.agents', 'skills', '.skill-a.tmp-123-456'))).toBe(false)
    expect(existsSync(join(homeDir, '.agents', 'skills', '.skill-a.backup-123-456'))).toBe(false)
  })

  test('restores existing skill directory when replacement fails after backup', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# new skill a')

    mkdirSync(join(homeDir, '.agents', 'skills', 'skill-a'), { recursive: true })
    writeFileSync(join(homeDir, '.agents', 'skills', 'skill-a', 'SKILL.md'), '# old skill a')

    const originalRename = renameSync
    const renameSpy = jest.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('/skill-a') && String(from).includes('.skill-a.tmp-')) {
        throw new Error('rename failed')
      }
      originalRename(from, to)
    })

    try {
      await expect(runCodexInitial({ packageRoot, homeDir })).rejects.toThrow('rename failed')
    } finally {
      renameSpy.mockRestore()
    }

    expect(readFileSync(join(homeDir, '.agents', 'skills', 'skill-a', 'SKILL.md'), 'utf8')).toBe('# old skill a')
  })

  test('throws when root skills directory is missing', async () => {
    await expect(runCodexInitial({ packageRoot, homeDir })).rejects.toThrow('模板目录 skills')

    expect(existsSync(join(homeDir, '.codex', 'skills'))).toBe(false)
    expect(existsSync(join(homeDir, '.claude', 'skills'))).toBe(false)
    expect(existsSync(join(homeDir, '.agents', 'skills'))).toBe(false)
  })
})
