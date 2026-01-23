#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

function parseConfigDir(argv) {
  const envValue = process.env.DX_CONFIG_DIR
  if (envValue) return String(envValue)

  const args = Array.isArray(argv) ? argv : []
  const idx = args.indexOf('--config-dir')
  if (idx !== -1 && idx + 1 < args.length) return String(args[idx + 1])
  for (const token of args) {
    if (token.startsWith('--config-dir=')) return String(token.slice('--config-dir='.length))
  }
  return null
}

function stripConfigDirArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : []
  const out = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--config-dir') {
      i++
      continue
    }
    if (token.startsWith('--config-dir=')) continue
    out.push(token)
  }
  return out
}

function findProjectRootFrom(startDir) {
  let current = resolve(startDir)
  while (true) {
    const marker = join(current, 'dx', 'config', 'commands.json')
    if (existsSync(marker)) return current

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const overrideConfigDir = parseConfigDir(rawArgs)
  const filteredArgs = stripConfigDirArgs(rawArgs)

  const startDir = process.cwd()
  const projectRoot = findProjectRootFrom(startDir)
  if (!projectRoot) {
    console.error('dx: 未找到项目配置目录: dx/config/commands.json')
    console.error('dx: 请在项目目录内执行 dx，或先创建 dx/config 并放置 commands.json')
    console.error('dx: 也可通过 DX_CONFIG_DIR 或 --config-dir 指定配置目录')
    process.exit(1)
  }

  process.env.DX_PROJECT_ROOT = projectRoot

  const defaultConfigDir = join(projectRoot, 'dx', 'config')
  process.env.DX_CONFIG_DIR = overrideConfigDir ? resolve(projectRoot, overrideConfigDir) : defaultConfigDir

  process.chdir(projectRoot)

  process.argv = [process.argv[0], process.argv[1], ...filteredArgs]

  const [{ logger }, { DxCli }] = await Promise.all([
    import('../lib/logger.js'),
    import('../lib/cli/dx-cli.js'),
  ])

  const cli = new DxCli({ projectRoot, configDir: process.env.DX_CONFIG_DIR, invocation: 'dx' })
  await cli.run().catch(error => {
    logger.error('CLI启动失败')
    logger.error(error?.message || String(error))
    process.exit(1)
  })
}

main().catch(error => {
  console.error('dx: CLI启动失败')
  console.error(error?.message || String(error))
  process.exit(1)
})
