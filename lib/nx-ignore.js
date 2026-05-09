import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const NX_IGNORE_TOOL_DIR_PATTERNS = [
  '.cache/',
  '.claude/',
  '.codex/',
  '.idea/',
  '.omc/',
  '.omx/',
  '.opencode/',
  '.pytest_cache/',
]

const MANAGED_BLOCK_START = '# dx managed tool metadata ignores'

export function isNxCommand(command) {
  return /\bnx(?:\.js)?\b/.test(String(command || ''))
}

export function ensureNxIgnoreToolDirs(projectRoot = process.cwd()) {
  const root = String(projectRoot || process.cwd())
  const nxIgnorePath = join(root, '.nxignore')
  const existing = existsSync(nxIgnorePath) ? readFileSync(nxIgnorePath, 'utf8') : ''
  const existingLines = new Set(
    existing
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean),
  )
  const missing = NX_IGNORE_TOOL_DIR_PATTERNS.filter(pattern => !existingLines.has(pattern))

  if (missing.length === 0) {
    return { changed: false, path: nxIgnorePath, added: [] }
  }

  const prefix = existing.trimEnd()
  const blockLines = existingLines.has(MANAGED_BLOCK_START)
    ? missing
    : [MANAGED_BLOCK_START, ...missing]
  const next = `${prefix ? `${prefix}\n\n` : ''}${blockLines.join('\n')}\n`

  writeFileSync(nxIgnorePath, next)
  return { changed: true, path: nxIgnorePath, added: missing }
}
