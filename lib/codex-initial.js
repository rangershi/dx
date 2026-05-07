import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import os from 'node:os'

import { logger } from './logger.js'

const DEPRECATED_SKILL_DIRS = ['pr-review-loop', 'git-commit-and-pr', 'autospec']
const TEMP_DIR_PATTERN = /^\..+\.(tmp|backup)-\d+-\d+$/

async function collectAllFiles(dir) {
  const out = []

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true })

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

async function pathExists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
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
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  let fileCount = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (DEPRECATED_SKILL_DIRS.includes(entry.name)) continue

    const srcSkillDir = join(srcDir, entry.name)
    const dstSkillDir = join(dstDir, entry.name)
    const token = `${process.pid}-${Date.now()}`
    const tmpSkillDir = join(dstDir, `.${entry.name}.tmp-${token}`)
    const backupSkillDir = join(dstDir, `.${entry.name}.backup-${token}`)
    let hasBackup = false

    try {
      const files = await collectAllFiles(srcSkillDir)
      fileCount += files.length
      await ensureDir(tmpSkillDir)
      for (const file of files) {
        const rel = relative(srcSkillDir, file)
        const target = join(tmpSkillDir, rel)
        await ensureDir(dirname(target))
        await fs.copyFile(file, target)
      }

      if (await pathExists(dstSkillDir)) {
        await fs.rename(dstSkillDir, backupSkillDir)
        hasBackup = true
      }
      await fs.rename(tmpSkillDir, dstSkillDir)
      if (hasBackup) {
        await fs.rm(backupSkillDir, { recursive: true, force: true })
      }
    } catch (error) {
      await fs.rm(tmpSkillDir, { recursive: true, force: true })
      if (hasBackup && !(await pathExists(dstSkillDir))) {
        await fs.rename(backupSkillDir, dstSkillDir)
        hasBackup = false
      }
      if (hasBackup) {
        await fs.rm(backupSkillDir, { recursive: true, force: true })
      }
      throw error
    }
  }

  return { fileCount }
}

async function removeDeprecatedSkillDirs(skillsDir) {
  for (const dirName of DEPRECATED_SKILL_DIRS) {
    await fs.rm(join(skillsDir, dirName), { recursive: true, force: true })
  }
}

async function removeStaleTempDirs(skillsDir) {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!TEMP_DIR_PATTERN.test(entry.name)) continue
    await fs.rm(join(skillsDir, entry.name), { recursive: true, force: true })
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
    await removeStaleTempDirs(target.dir)
    await removeDeprecatedSkillDirs(target.dir)
    const copyStats = await copyDirMerge({ srcDir: srcSkillsDir, dstDir: target.dir })
    await removeStaleTempDirs(target.dir)
    await removeDeprecatedSkillDirs(target.dir)
    stats.push({ ...target, ...copyStats })
  }

  logger.success('已初始化 skills 模板')
  for (const target of stats) {
    logger.info(`${target.name} skills: 覆盖复制 ${target.fileCount} 个文件 -> ${target.dir}`)
  }
}
