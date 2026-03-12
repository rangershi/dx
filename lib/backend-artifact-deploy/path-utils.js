import { basename, resolve, sep } from 'node:path'

export function resolveWithinBase(baseDir, targetPath, label = 'path') {
  const absoluteBase = resolve(baseDir)
  const absoluteTarget = resolve(absoluteBase, targetPath)
  if (absoluteTarget !== absoluteBase && !absoluteTarget.startsWith(`${absoluteBase}${sep}`)) {
    throw new Error(`${label} 越界，已拒绝: ${absoluteTarget}`)
  }
  return absoluteTarget
}

export function basenameOrThrow(filePath, label = 'path') {
  const name = basename(String(filePath || '').trim())
  if (!name || name === '.' || name === '..') {
    throw new Error(`无效的 ${label}: ${filePath}`)
  }
  return name
}
