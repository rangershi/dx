import { describe, expect, test } from '@jest/globals'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureNxIgnoreToolDirs, isNxCommand } from '../lib/nx-ignore.js'

describe('nx ignore helpers', () => {
  test('detects Nx commands', () => {
    expect(isNxCommand('npx nx run-many -t lint')).toBe(true)
    expect(isNxCommand('pnpm exec dotenv -- npx nx build backend')).toBe(true)
    expect(isNxCommand('pnpm test')).toBe(false)
  })

  test('creates .nxignore with tool metadata directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'dx-nxignore-'))

    try {
      const result = ensureNxIgnoreToolDirs(root)
      const text = readFileSync(join(root, '.nxignore'), 'utf8')

      expect(result.changed).toBe(true)
      expect(text).toContain('.claude/')
      expect(text).toContain('.codex/')
      expect(text).toContain('.omc/')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('preserves existing entries and is idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'dx-nxignore-'))

    try {
      writeFileSync(join(root, '.nxignore'), 'coverage/\n.claude/\n')

      const first = ensureNxIgnoreToolDirs(root)
      const second = ensureNxIgnoreToolDirs(root)
      const text = readFileSync(join(root, '.nxignore'), 'utf8')

      expect(first.changed).toBe(true)
      expect(second.changed).toBe(false)
      expect(text).toContain('coverage/')
      expect(text.match(/\.claude\//g)).toHaveLength(1)
      expect(text).toContain('.opencode/')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
