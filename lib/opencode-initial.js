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

  const srcAgents = join(existingRoot, 'agents')
  const srcCommands = join(existingRoot, 'commands')
  const dstAgents = join(dstRoot, 'agents')
  const dstCommands = join(dstRoot, 'commands')

  await assertDirExists(srcAgents, '模板目录 agents')
  await assertDirExists(srcCommands, '模板目录 commands')

  await ensureDir(dstAgents)
  await ensureDir(dstCommands)

  const agentsStats = await copyTemplateTree({ srcDir: srcAgents, dstDir: dstAgents })
  const commandsStats = await copyTemplateTree({ srcDir: srcCommands, dstDir: dstCommands })

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
}
