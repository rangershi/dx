import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import os from 'node:os'

import { logger } from './logger.js'

const DEPRECATED_SKILL_DIRS = ['pr-review-loop', 'git-commit-and-pr']

async function collectAllFiles(dir) {
  const out = []

  async function walk(current) {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__' || entry.name === '.pytest_cache') {
          continue
        }
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue

      const lowerName = entry.name.toLowerCase()
      if (lowerName.endsWith('.pyc') || lowerName.endsWith('.pyo') || lowerName.endsWith('.pyd')) continue
      out.push(full)
    }
  }

  await walk(dir)
  return out
}

async function ensureDir(path) {
  await fs.mkdir(path, { recursive: true })
}

async function assertDirExists(path, label) {
  try {
    const st = await fs.stat(path)
    if (!st.isDirectory()) {
      throw new Error(`${label} 不是目录: ${path}`)
    }
  } catch (error) {
    const message = error?.message || String(error)
    throw new Error(`${label} 不存在或不可访问: ${path}\n${message}`)
  }
}

async function copyDirMerge({ srcDir, dstDir }) {
  const files = await collectAllFiles(srcDir)

  for (const file of files) {
    const rel = relative(srcDir, file)
    const topLevelDir = rel.split('/')[0]
    if (DEPRECATED_SKILL_DIRS.includes(topLevelDir)) continue
    const target = join(dstDir, rel)
    await ensureDir(dirname(target))
    await fs.copyFile(file, target)
  }

  return { fileCount: files.length }
}

async function removeDeprecatedSkillDirs(skillsDir) {
  for (const dirName of DEPRECATED_SKILL_DIRS) {
    await fs.rm(join(skillsDir, dirName), { recursive: true, force: true })
  }
}

export async function runCodexInitial(options = {}) {
  const packageRoot = options.packageRoot
  if (!packageRoot) throw new Error('runCodexInitial: 缺少 packageRoot')

  const homeDir = options.homeDir || os.homedir()
  const srcSkillsDir = join(packageRoot, 'skills')
  const targets = [
    { name: 'codex', dir: join(homeDir, '.codex', 'skills') },
    { name: 'claude', dir: join(homeDir, '.claude', 'skills') },
  ]

  await assertDirExists(srcSkillsDir, '模板目录 skills')

  const stats = []
  for (const target of targets) {
    await ensureDir(target.dir)
    await removeDeprecatedSkillDirs(target.dir)
    const copyStats = await copyDirMerge({ srcDir: srcSkillsDir, dstDir: target.dir })
    await removeDeprecatedSkillDirs(target.dir)
    stats.push({ ...target, ...copyStats })
  }

  logger.success('已初始化 skills 模板')
  for (const target of stats) {
    logger.info(`${target.name} skills: 覆盖复制 ${target.fileCount} 个文件 -> ${target.dir}`)
  }
}
