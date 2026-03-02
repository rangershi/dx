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

test('copies codex skills and agents into ~/.codex with merge-overwrite semantics', async () => {
    mkdirSync(join(packageRoot, 'codex/skills/skill-a/references'), { recursive: true })
    mkdirSync(join(packageRoot, 'codex/skills/skill-b/agents'), { recursive: true })
    mkdirSync(join(packageRoot, 'codex/agents/reviewer/prompts'), { recursive: true })
    mkdirSync(join(packageRoot, 'codex/agents/fixer'), { recursive: true })
    writeFileSync(join(packageRoot, 'codex/skills/skill-a/SKILL.md'), '# new skill a')
    writeFileSync(join(packageRoot, 'codex/skills/skill-a/config.yaml'), 'k: new')
    writeFileSync(join(packageRoot, 'codex/skills/skill-a/references/readme.md'), 'new ref')
    writeFileSync(join(packageRoot, 'codex/skills/skill-b/agents/openai.yaml'), 'model: gpt')
    writeFileSync(join(packageRoot, 'codex/agents/reviewer/SYSTEM.md'), '# new reviewer')
    writeFileSync(join(packageRoot, 'codex/agents/reviewer/prompts/base.md'), 'new reviewer prompt')
    writeFileSync(join(packageRoot, 'codex/agents/fixer/SYSTEM.md'), '# new fixer')

    mkdirSync(join(homeDir, '.codex/skills/skill-a/references'), { recursive: true })
    mkdirSync(join(homeDir, '.codex/skills/skill-existing-only'), { recursive: true })
    mkdirSync(join(homeDir, '.codex/agents/reviewer/prompts'), { recursive: true })
    mkdirSync(join(homeDir, '.codex/agents/existing-only'), { recursive: true })
    writeFileSync(join(homeDir, '.codex/skills/skill-a/SKILL.md'), '# old skill a')
    writeFileSync(join(homeDir, '.codex/skills/skill-a/references/keep.md'), 'keep me')
    writeFileSync(join(homeDir, '.codex/skills/skill-existing-only/SKILL.md'), '# existing only')
    writeFileSync(join(homeDir, '.codex/agents/reviewer/SYSTEM.md'), '# old reviewer')
    writeFileSync(join(homeDir, '.codex/agents/reviewer/prompts/keep.md'), 'keep reviewer prompt')
    writeFileSync(join(homeDir, '.codex/agents/existing-only/SYSTEM.md'), '# existing-only agent')

    await runCodexInitial({ packageRoot, homeDir })

    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/SKILL.md'), 'utf8')).toBe('# new skill a')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/config.yaml'), 'utf8')).toBe('k: new')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/references/readme.md'), 'utf8')).toBe('new ref')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-b/agents/openai.yaml'), 'utf8')).toBe('model: gpt')

    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/references/keep.md'), 'utf8')).toBe('keep me')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-existing-only/SKILL.md'), 'utf8')).toBe('# existing only')

    expect(readFileSync(join(homeDir, '.codex/agents/reviewer/SYSTEM.md'), 'utf8')).toBe('# new reviewer')
    expect(readFileSync(join(homeDir, '.codex/agents/reviewer/prompts/base.md'), 'utf8')).toBe('new reviewer prompt')
    expect(readFileSync(join(homeDir, '.codex/agents/fixer/SYSTEM.md'), 'utf8')).toBe('# new fixer')

    expect(readFileSync(join(homeDir, '.codex/agents/reviewer/prompts/keep.md'), 'utf8')).toBe('keep reviewer prompt')
    expect(readFileSync(join(homeDir, '.codex/agents/existing-only/SYSTEM.md'), 'utf8')).toBe('# existing-only agent')
  })

  test('throws when codex skills directory is missing', async () => {
    await expect(runCodexInitial({ packageRoot, homeDir })).rejects.toThrow('模板目录 codex/skills')

    expect(existsSync(join(homeDir, '.codex/skills'))).toBe(false)
  })
})
