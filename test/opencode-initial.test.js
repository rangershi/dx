import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { runOpenCodeInitial } from '../lib/opencode-initial.js'
import { logger } from '../lib/logger.js'

describe('runOpenCodeInitial', () => {
  let tempDir
  let packageRoot
  let homeDir

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dx-opencode-initial-'))
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

  test('copies codex skills into ~/.codex/skills and overwrites existing files inside matching skill folders', async () => {
    mkdirSync(join(packageRoot, '@opencode/agents'), { recursive: true })
    mkdirSync(join(packageRoot, '@opencode/commands'), { recursive: true })
    writeFileSync(join(packageRoot, '@opencode/agents/a.md'), '# agent')
    writeFileSync(join(packageRoot, '@opencode/commands/c.md'), '# command')

    mkdirSync(join(packageRoot, 'codex/skills/skill-a/references'), { recursive: true })
    mkdirSync(join(packageRoot, 'codex/skills/skill-b/agents'), { recursive: true })
    writeFileSync(join(packageRoot, 'codex/skills/skill-a/SKILL.md'), '# new skill a')
    writeFileSync(join(packageRoot, 'codex/skills/skill-a/config.yaml'), 'k: new')
    writeFileSync(join(packageRoot, 'codex/skills/skill-a/references/readme.md'), 'new ref')
    writeFileSync(join(packageRoot, 'codex/skills/skill-b/agents/openai.yaml'), 'model: gpt')

    mkdirSync(join(homeDir, '.codex/skills/skill-a/references'), { recursive: true })
    mkdirSync(join(homeDir, '.codex/skills/skill-existing-only'), { recursive: true })
    writeFileSync(join(homeDir, '.codex/skills/skill-a/SKILL.md'), '# old skill a')
    writeFileSync(join(homeDir, '.codex/skills/skill-a/references/keep.md'), 'keep me')
    writeFileSync(join(homeDir, '.codex/skills/skill-existing-only/SKILL.md'), '# existing only')

    await runOpenCodeInitial({ packageRoot, homeDir })

    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/SKILL.md'), 'utf8')).toBe('# new skill a')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/config.yaml'), 'utf8')).toBe('k: new')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/references/readme.md'), 'utf8')).toBe('new ref')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-b/agents/openai.yaml'), 'utf8')).toBe('model: gpt')

    expect(readFileSync(join(homeDir, '.codex/skills/skill-a/references/keep.md'), 'utf8')).toBe('keep me')
    expect(readFileSync(join(homeDir, '.codex/skills/skill-existing-only/SKILL.md'), 'utf8')).toBe('# existing only')
  })

  test('throws when codex skills directory is missing', async () => {
    mkdirSync(join(packageRoot, '@opencode/agents'), { recursive: true })
    mkdirSync(join(packageRoot, '@opencode/commands'), { recursive: true })
    writeFileSync(join(packageRoot, '@opencode/agents/a.md'), '# agent')
    writeFileSync(join(packageRoot, '@opencode/commands/c.md'), '# command')

    await expect(runOpenCodeInitial({ packageRoot, homeDir })).rejects.toThrow('模板目录 codex/skills')

    expect(existsSync(join(homeDir, '.codex/skills'))).toBe(false)
  })
})
