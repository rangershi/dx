import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import os from 'node:os'

import { logger } from './logger.js'

const REQUIRED_CODEX_CONFIG = [
  {
    section: 'features',
    values: {
      multi_agent: 'true',
    },
  },
  {
    section: 'agents',
    values: {
      max_threads: '15',
    },
  },
  {
    section: 'agents.fixer',
    values: {
      description: '"bugfix 代理"',
      config_file: '"agents/fixer.toml"',
    },
  },
  {
    section: 'agents.orchestrator',
    values: {
      description: '"pr 修复流程编排代理"',
      config_file: '"agents/orchestrator.toml"',
    },
  },
  {
    section: 'agents.reviewer',
    values: {
      description: '"代码评审代理"',
      config_file: '"agents/reviewer.toml"',
    },
  },
  {
    section: 'agents.spark',
    values: {
      description: '"通用执行代理"',
      config_file: '"agents/spark.toml"',
    },
  },
]

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

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ensureTrailingNewline(text) {
  if (!text) return ''
  return text.endsWith('\n') ? text : `${text}\n`
}

function upsertTomlSection(content, { section, values }) {
  const header = `[${section}]`
  const sectionPattern = new RegExp(`^\\[${escapeRegExp(section)}\\]\\s*$`, 'm')
  const sectionHeaderMatch = content.match(sectionPattern)
  let nextContent = content
  let changedKeys = 0
  let createdSection = false

  if (!sectionHeaderMatch) {
    const blockLines = [header, ...Object.entries(values).map(([key, value]) => `${key} = ${value}`), '']
    nextContent = ensureTrailingNewline(content)
    if (nextContent.length > 0 && !nextContent.endsWith('\n\n')) {
      nextContent += '\n'
    }
    nextContent += `${blockLines.join('\n')}\n`
    return {
      content: nextContent,
      changedKeys: Object.keys(values).length,
      createdSection: true,
    }
  }

  const sectionStart = sectionHeaderMatch.index
  const sectionBodyStart = sectionStart + sectionHeaderMatch[0].length
  const remaining = content.slice(sectionBodyStart)
  const nextHeaderMatch = remaining.match(/\n(?=\[[^\]]+\]\s*$)/m)
  const sectionEnd =
    nextHeaderMatch && typeof nextHeaderMatch.index === 'number'
      ? sectionBodyStart + nextHeaderMatch.index + 1
      : content.length

  const beforeSection = content.slice(0, sectionStart)
  const originalSectionText = content.slice(sectionStart, sectionEnd)
  const trailing = content.slice(sectionEnd)
  const sectionLines = originalSectionText.split('\n')

  for (const [key, value] of Object.entries(values)) {
    const desiredLine = `${key} = ${value}`
    const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*=`, 'm')
    const lineIndex = sectionLines.findIndex(line => keyPattern.test(line.trim()))

    if (lineIndex === -1) {
      let insertIndex = sectionLines.length
      while (insertIndex > 1 && sectionLines[insertIndex - 1] === '') {
        insertIndex--
      }
      sectionLines.splice(insertIndex, 0, desiredLine)
      changedKeys++
      continue
    }

    if (sectionLines[lineIndex].trim() !== desiredLine) {
      sectionLines[lineIndex] = desiredLine
      changedKeys++
    }
  }

  const updatedSectionText = ensureTrailingNewline(sectionLines.join('\n'))
  nextContent = `${beforeSection}${updatedSectionText}${trailing}`

  return { content: nextContent, changedKeys, createdSection }
}

async function ensureCodexConfig({ codexDir }) {
  const configPath = join(codexDir, 'config.toml')
  let content = ''

  try {
    content = await fs.readFile(configPath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  let changedKeys = 0
  let createdSections = 0
  let nextContent = content

  for (const sectionConfig of REQUIRED_CODEX_CONFIG) {
    const result = upsertTomlSection(nextContent, sectionConfig)
    nextContent = result.content
    changedKeys += result.changedKeys
    if (result.createdSection) createdSections++
  }

  if (nextContent !== content || content === '') {
    await fs.writeFile(configPath, ensureTrailingNewline(nextContent), 'utf8')
  }

  return {
    configPath,
    changedKeys,
    createdSections,
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

export async function runCodexInitial(options = {}) {
  const packageRoot = options.packageRoot
  if (!packageRoot) throw new Error('runCodexInitial: 缺少 packageRoot')

  const homeDir = options.homeDir || os.homedir()
  const codexDir = join(homeDir, '.codex')
  const srcSkills = join(packageRoot, 'codex', 'skills')
  const dstSkills = join(codexDir, 'skills')
  const srcCodexAgents = join(packageRoot, 'codex', 'agents')
  const dstCodexAgents = join(codexDir, 'agents')

  await assertDirExists(srcSkills, '模板目录 codex/skills')
  await assertDirExists(srcCodexAgents, '模板目录 codex/agents')

  await ensureDir(dstSkills)
  await ensureDir(dstCodexAgents)

  const skillsStats = await copySkillsDirectories({ srcSkillsDir: srcSkills, dstSkillsDir: dstSkills })
  const codexAgentsStats = await copyDirMerge({ srcDir: srcCodexAgents, dstDir: dstCodexAgents })
  const configStats = await ensureCodexConfig({ codexDir })

  logger.success(`已初始化 Codex 模板到: ${codexDir}`)
  logger.info(`skills: ${skillsStats.copiedDirs} 个目录，覆盖复制 ${skillsStats.copiedFiles} 个文件 -> ${dstSkills}`)
  logger.info(`codex agents: 覆盖复制 ${codexAgentsStats.fileCount} 个文件 -> ${dstCodexAgents}`)
  logger.info(
    `config.toml: 修复 ${configStats.changedKeys} 个配置项，新增 ${configStats.createdSections} 个分组 -> ${configStats.configPath}`,
  )
}
