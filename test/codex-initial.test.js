import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
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

  test('copies root skills into ~/.codex/skills and ~/.claude/skills with merge-overwrite semantics', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a', 'references'), { recursive: true })
    mkdirSync(join(packageRoot, 'skills', 'skill-b', 'agents'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# new skill a')
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'config.yaml'), 'k: new')
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'references', 'readme.md'), 'new ref')
    writeFileSync(join(packageRoot, 'skills', 'skill-b', 'agents', 'openai.yaml'), 'model: gpt')

    mkdirSync(join(homeDir, '.codex', 'skills', 'skill-a', 'references'), { recursive: true })
    mkdirSync(join(homeDir, '.codex', 'skills', 'skill-existing-only'), { recursive: true })
    writeFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'SKILL.md'), '# old skill a')
    writeFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'references', 'keep.md'), 'keep me')
    writeFileSync(join(homeDir, '.codex', 'skills', 'skill-existing-only', 'SKILL.md'), '# existing only')

    mkdirSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references'), { recursive: true })
    mkdirSync(join(homeDir, '.claude', 'skills', 'skill-existing-only'), { recursive: true })
    writeFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'SKILL.md'), '# old claude skill a')
    writeFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references', 'keep.md'), 'keep claude')
    writeFileSync(join(homeDir, '.claude', 'skills', 'skill-existing-only', 'SKILL.md'), '# existing claude only')

    await runCodexInitial({ packageRoot, homeDir })

    expect(readFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'SKILL.md'), 'utf8')).toBe('# new skill a')
    expect(readFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'config.yaml'), 'utf8')).toBe('k: new')
    expect(readFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'references', 'readme.md'), 'utf8')).toBe('new ref')
    expect(readFileSync(join(homeDir, '.codex', 'skills', 'skill-b', 'agents', 'openai.yaml'), 'utf8')).toBe('model: gpt')
    expect(readFileSync(join(homeDir, '.codex', 'skills', 'skill-a', 'references', 'keep.md'), 'utf8')).toBe('keep me')
    expect(readFileSync(join(homeDir, '.codex', 'skills', 'skill-existing-only', 'SKILL.md'), 'utf8')).toBe('# existing only')

    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'SKILL.md'), 'utf8')).toBe('# new skill a')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'config.yaml'), 'utf8')).toBe('k: new')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references', 'readme.md'), 'utf8')).toBe('new ref')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-b', 'agents', 'openai.yaml'), 'utf8')).toBe('model: gpt')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-a', 'references', 'keep.md'), 'utf8')).toBe('keep claude')
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'skill-existing-only', 'SKILL.md'), 'utf8')).toBe('# existing claude only')
  })

  test('creates ~/.codex/skills and ~/.claude/skills when missing', async () => {
    mkdirSync(join(packageRoot, 'skills', 'skill-a'), { recursive: true })
    writeFileSync(join(packageRoot, 'skills', 'skill-a', 'SKILL.md'), '# skill a')

    await runCodexInitial({ packageRoot, homeDir })

    expect(existsSync(join(homeDir, '.codex', 'skills', 'skill-a', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(homeDir, '.claude', 'skills', 'skill-a', 'SKILL.md'))).toBe(true)
  })

  test('throws when root skills directory is missing', async () => {
    await expect(runCodexInitial({ packageRoot, homeDir })).rejects.toThrow('模板目录 skills')

    expect(existsSync(join(homeDir, '.codex', 'skills'))).toBe(false)
    expect(existsSync(join(homeDir, '.claude', 'skills'))).toBe(false)
  })
})
