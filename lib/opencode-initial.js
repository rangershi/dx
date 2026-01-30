import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import os from 'node:os'

import { logger } from './logger.js'

async function collectMarkdownFiles(dir) {
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
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.md')) continue
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

async function copyMarkdownTree({ srcDir, dstDir }) {
  const files = await collectMarkdownFiles(srcDir)
  for (const file of files) {
    const rel = relative(srcDir, file)
    const target = join(dstDir, rel)
    await ensureDir(dirname(target))
    await fs.copyFile(file, target)
  }
  return files.length
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

  const agentsCount = await copyMarkdownTree({ srcDir: srcAgents, dstDir: dstAgents })
  const commandsCount = await copyMarkdownTree({ srcDir: srcCommands, dstDir: dstCommands })

  logger.success(`已初始化 OpenCode 模板到: ${dstRoot}`)
  logger.info(`agents: ${agentsCount} 个 .md 文件`)
  logger.info(`commands: ${commandsCount} 个 .md 文件`)
}
