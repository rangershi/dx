import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import os from 'node:os'

import { logger } from './logger.js'

async function collectTemplateFiles(dir) {
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
        // 跳过 __pycache__ 和其他缓存目录
        if (entry.name === '__pycache__' || entry.name === '.pytest_cache') {
          continue
        }
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const lowerName = entry.name.toLowerCase()
      // 拷贝 .md / .py / .json 文件
      if (!lowerName.endsWith('.md') && !lowerName.endsWith('.py') && !lowerName.endsWith('.json')) continue
      // 跳过 Python 编译文件
      if (lowerName.endsWith('.pyc') || lowerName.endsWith('.pyo') || lowerName.endsWith('.pyd')) continue
      out.push(full)
    }
  }

  await walk(dir)
  return out
}

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

async function copyTemplateTree({ srcDir, dstDir }) {
  const files = await collectTemplateFiles(srcDir)
  let mdCount = 0
  let pyCount = 0
  let jsonCount = 0
  
  for (const file of files) {
    const rel = relative(srcDir, file)
    const target = join(dstDir, rel)
    await ensureDir(dirname(target))
    await fs.copyFile(file, target)
    
    if (file.endsWith('.md')) {
      mdCount++
    } else if (file.endsWith('.py')) {
      pyCount++
      try {
        await fs.chmod(target, 0o755)
      } catch {
        // 忽略权限设置失败
      }
    } else if (file.endsWith('.json')) {
      jsonCount++
    }
  }
  
  return { total: files.length, md: mdCount, py: pyCount, json: jsonCount }
}

async function copyDirMerge({ srcDir, dstDir }) {
  const files = await collectAllFiles(srcDir)

  for (const file of files) {
    const rel = relative(srcDir, file)
    const target = join(dstDir, rel)
    await ensureDir(dirname(target))
    await fs.copyFile(file, target)
  }

  return { fileCount: files.length }
}

async function copySkillsDirectories({ srcSkillsDir, dstSkillsDir }) {
  const entries = await fs.readdir(srcSkillsDir, { withFileTypes: true })
  let copiedDirs = 0
  let copiedFiles = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const srcDir = join(srcSkillsDir, entry.name)
    const dstDir = join(dstSkillsDir, entry.name)
    await ensureDir(dstDir)
    const stats = await copyDirMerge({ srcDir, dstDir })
    copiedDirs++
    copiedFiles += stats.fileCount
  }

  return { copiedDirs, copiedFiles }
}

function resolveTemplateRoot(packageRoot) {
  return [join(packageRoot, '@opencode')]
}

export async function runOpenCodeInitial(options = {}) {
  const packageRoot = options.packageRoot
  if (!packageRoot) throw new Error('runOpenCodeInitial: 缺少 packageRoot')

  const homeDir = options.homeDir || os.homedir()
  const dstRoot = join(homeDir, '.opencode')

  const roots = resolveTemplateRoot(packageRoot)
  const existingRoot = await (async () => {
    for (const p of roots) {
      try {
        const st = await fs.stat(p)
        if (st.isDirectory()) return p
      } catch {
        // ignore
      }
    }
    return null
  })()

  if (!existingRoot) {
    const tried = roots.map(p => `- ${p}`).join('\n')
    throw new Error(`未找到 opencode 模板目录，已尝试路径:\n${tried}`)
  }

  const srcOpenCodeAgents = join(existingRoot, 'agents')
  const srcCommands = join(existingRoot, 'commands')
  const dstOpenCodeAgents = join(dstRoot, 'agents')
  const dstCommands = join(dstRoot, 'commands')
  const srcSkills = join(packageRoot, 'codex', 'skills')
  const dstSkills = join(homeDir, '.codex', 'skills')
  const srcCodexAgents = join(packageRoot, 'codex', 'agents')
  const dstCodexAgents = join(homeDir, '.codex', 'agents')

  await assertDirExists(srcOpenCodeAgents, '模板目录 agents')
  await assertDirExists(srcCommands, '模板目录 commands')
  await assertDirExists(srcSkills, '模板目录 codex/skills')
  await assertDirExists(srcCodexAgents, '模板目录 codex/agents')

  await ensureDir(dstOpenCodeAgents)
  await ensureDir(dstCommands)
  await ensureDir(dstSkills)
  await ensureDir(dstCodexAgents)

  const agentsStats = await copyTemplateTree({ srcDir: srcOpenCodeAgents, dstDir: dstOpenCodeAgents })
  const commandsStats = await copyTemplateTree({ srcDir: srcCommands, dstDir: dstCommands })
  const skillsStats = await copySkillsDirectories({ srcSkillsDir: srcSkills, dstSkillsDir: dstSkills })
  const codexAgentsStats = await copyDirMerge({ srcDir: srcCodexAgents, dstDir: dstCodexAgents })

  logger.success(`已初始化 OpenCode 模板到: ${dstRoot}`)
  logger.info(
    `agents: ${agentsStats.md} 个 .md 文件` +
      `${agentsStats.py > 0 ? ` + ${agentsStats.py} 个 .py 文件` : ''}` +
      `${agentsStats.json > 0 ? ` + ${agentsStats.json} 个 .json 文件` : ''}`
  )
  logger.info(
    `commands: ${commandsStats.md} 个 .md 文件` +
      `${commandsStats.py > 0 ? ` + ${commandsStats.py} 个 .py 文件` : ''}` +
      `${commandsStats.json > 0 ? ` + ${commandsStats.json} 个 .json 文件` : ''}`
  )
  logger.info(`skills: ${skillsStats.copiedDirs} 个目录，覆盖复制 ${skillsStats.copiedFiles} 个文件 -> ${dstSkills}`)
  logger.info(`codex agents: 覆盖复制 ${codexAgentsStats.fileCount} 个文件 -> ${dstCodexAgents}`)
}
