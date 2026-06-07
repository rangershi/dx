import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import os from 'node:os'

import { logger } from './logger.js'

const TEMP_DIR_PATTERN = /^\..+\.(tmp|backup)-\d+-\d+$/

// 历史上曾在 skills/ 目录托管、但后续已删除的 skill 名称。
// 来源：git log --all --diff-filter=A --name-only -- 'skills/*' | sed -n 's#^skills/\([^/]*\)/.*#\1#p' | sort -u
// 再减去当前 skills/ 现存名单。
// 这些名字需要在 ~/.agents、~/.claude、~/.codex 三处彻底清理（软链或真实目录都清）。
// 将来从 skills/ 删除新的 skill 时，把它追加到这里即可。
const DELETED_SKILLS = [
  'autospec',
  'backend-layering-audit-fixer',
  'e2e-audit-fixer',
  'env-accessor-audit-fixer',
  'error-handling-audit-fixer',
  'multi-pr-feature-delivery',
  'naming-convention-audit',
  'omc-reference',
  'pagination-dto-audit-fixer',
  'pr-ship',
]

async function collectSkillNames(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

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

async function lstatIfExists(path) {
  try {
    return await fs.lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function assertDirExists(path, label) {
  try {
    const st = await fs.stat(path)
    if (!st.isDirectory()) {
      throw new Error(`${label} 不是目录: ${path}`)
    }
  } catch (error) {
    if (error?.message?.startsWith(`${label} 不是目录:`)) {
      throw error
    }
    const message = error?.message || String(error)
    throw new Error(`${label} 不存在或不可访问: ${path}\n${message}`)
  }
}

async function copyDirMerge({ srcDir, dstDir }) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  let fileCount = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

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

async function removeManagedNonSymlinkSkills(skillsDir, skillNames) {
  for (const skillName of skillNames) {
    const target = join(skillsDir, skillName)
    const stat = await lstatIfExists(target)
    if (!stat) continue
    if (stat.isSymbolicLink()) continue
    await fs.rm(target, { recursive: true, force: true })
  }
}

// 彻底清理指定名称的 skill：无论是软链还是真实目录/文件都删除。
// 用于历史上已从 skills/ 删除的 skill，需在各目标目录连根拔除。
// 这是尽力而为的清理：单个名字清理失败（如权限问题）只记录并继续，
// 不抛出，避免一个陈旧副本的异常阻断整个 skill 同步主流程。
async function purgeSkills(skillsDir, skillNames) {
  let purged = 0
  let failed = 0
  for (const skillName of skillNames) {
    const target = join(skillsDir, skillName)
    let stat
    try {
      stat = await lstatIfExists(target)
    } catch (error) {
      logger.warn(`清理历史 skill 失败（跳过）: ${target} — ${error?.message || String(error)}`)
      failed++
      continue
    }
    if (!stat) continue
    try {
      await fs.rm(target, { recursive: true, force: true })
      purged++
    } catch (error) {
      logger.warn(`清理历史 skill 失败（跳过）: ${target} — ${error?.message || String(error)}`)
      failed++
    }
  }
  return { purged, failed }
}

async function removeStaleTempDirs(skillsDir) {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!TEMP_DIR_PATTERN.test(entry.name)) continue
    await fs.rm(join(skillsDir, entry.name), { recursive: true, force: true })
  }
}

async function linkSkillsToClaude({ skillNames, agentsSkillsDir, claudeSkillsDir }) {
  for (const skillName of skillNames) {
    const srcSkillDir = join(agentsSkillsDir, skillName)
    const claudeSkillPath = join(claudeSkillsDir, skillName)

    let stat
    try {
      stat = await fs.lstat(claudeSkillPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    if (stat?.isSymbolicLink()) {
      const currentTarget = await fs.readlink(claudeSkillPath)
      if (currentTarget === srcSkillDir) continue
      await fs.rm(claudeSkillPath, { recursive: true, force: true })
    } else if (stat) {
      await fs.rm(claudeSkillPath, { recursive: true, force: true })
    }

    await fs.symlink(srcSkillDir, claudeSkillPath, 'dir')
  }
}

export async function runCodexInitial(options = {}) {
  const packageRoot = options.packageRoot
  if (!packageRoot) throw new Error('runCodexInitial: 缺少 packageRoot')

  const homeDir = options.homeDir || os.homedir()
  const srcSkillsDir = join(packageRoot, 'skills')
  const agentsSkillsDir = join(homeDir, '.agents', 'skills')
  const claudeSkillsDir = join(homeDir, '.claude', 'skills')
  const codexSkillsDir = join(homeDir, '.codex', 'skills')

  await assertDirExists(srcSkillsDir, '模板目录 skills')
  const skillNames = await collectSkillNames(srcSkillsDir)

  // 护栏：已删除名单不得与现存 skill 重叠，否则会把刚同步的 skill 又清掉（自相矛盾）。
  const overlap = DELETED_SKILLS.filter((name) => skillNames.includes(name))
  if (overlap.length > 0) {
    throw new Error(`DELETED_SKILLS 与现存 skills/ 重叠，需修正名单: ${overlap.join(', ')}`)
  }

  await ensureDir(codexSkillsDir)
  await ensureDir(claudeSkillsDir)
  await ensureDir(agentsSkillsDir)

  await removeManagedNonSymlinkSkills(codexSkillsDir, skillNames)
  await removeManagedNonSymlinkSkills(claudeSkillsDir, skillNames)

  // 清理历史上已删除的 skill：在 agents/claude/codex 三处连根拔除（含 agents 真实副本与软链）。
  // 先清 claude（指向 agents 的软链宿主），再清 agents/codex（真实副本），
  // 避免中途失败时留下指向已删除 agents target 的悬空软链。
  const purgeClaude = await purgeSkills(claudeSkillsDir, DELETED_SKILLS)
  const purgeAgents = await purgeSkills(agentsSkillsDir, DELETED_SKILLS)
  const purgeCodex = await purgeSkills(codexSkillsDir, DELETED_SKILLS)

  await removeStaleTempDirs(agentsSkillsDir)
  const copyStats = await copyDirMerge({ srcDir: srcSkillsDir, dstDir: agentsSkillsDir })
  await removeStaleTempDirs(agentsSkillsDir)
  await linkSkillsToClaude({ skillNames, agentsSkillsDir, claudeSkillsDir })

  logger.success('已初始化 skills 模板')
  logger.info(`agents skills: 覆盖复制 ${copyStats.fileCount} 个文件 -> ${agentsSkillsDir}`)
  logger.info(`claude skills: 已创建 ${skillNames.length} 个软链接 -> ${claudeSkillsDir}`)
  logger.info(`codex skills: 已清理 ${skillNames.length} 个包内托管 skill 的旧副本 -> ${codexSkillsDir}`)
  logger.info(
    `已删除 skill 清理: agents ${purgeAgents.purged} / claude ${purgeClaude.purged} / codex ${purgeCodex.purged}`,
  )
  const purgeFailed = purgeClaude.failed + purgeAgents.failed + purgeCodex.failed
  if (purgeFailed > 0) {
    logger.warn(`已删除 skill 清理: ${purgeFailed} 个目标清理失败（已跳过，详见上方告警）`)
  }
}
