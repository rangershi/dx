#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function isVersionInvocation(argv) {
  const raw = Array.isArray(argv) ? argv : []
  const filtered = stripConfigDirArgs(raw)

  const flags = []
  const positionals = []
  for (const token of filtered) {
    if (token === '--') break
    if (token.startsWith('-')) flags.push(token)
    else positionals.push(token)
  }

  // Keep current semantics:
  // - -V/--version always prints version and exits.
  // - -v is verbose in commands, but `dx -v` is commonly expected to show version.
  const hasCanonicalVersionFlag = flags.includes('-V') || flags.includes('--version')
  if (hasCanonicalVersionFlag) return true

  const isBareLowerV = flags.length === 1 && flags[0] === '-v' && positionals.length === 0
  if (isBareLowerV) return true

  const isVersionCommand = positionals.length === 1 && positionals[0] === 'version'
  if (isVersionCommand) return true

  return false
}

function isInitialInvocation(argv) {
  const raw = Array.isArray(argv) ? argv : []
  const filtered = stripConfigDirArgs(raw)

  for (const token of filtered) {
    if (token === '--') break
    if (token.startsWith('-')) continue
    return token === 'initial'
  }

  return false
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

function findRepoRootFrom(startDir) {
  let current = resolve(startDir)
  while (true) {
    // ai-monorepo style marker
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    // fallback marker
    if (existsSync(join(current, 'package.json'))) return current

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function inferProjectRootFromConfigDir(configDir, startDir) {
  const normalized = String(configDir).replace(/\\/g, '/')
  if (normalized.endsWith('/dx/config')) return resolve(configDir, '..', '..')
  if (normalized.endsWith('/scripts/config')) return resolve(configDir, '..', '..')

  return findRepoRootFrom(configDir) || findRepoRootFrom(startDir) || resolve(startDir)
}

async function main() {
  const rawArgs = process.argv.slice(2)

  if (isVersionInvocation(rawArgs)) {
    const { getPackageVersion } = await import('../lib/version.js')
    console.log(getPackageVersion())
    return
  }

  if (isInitialInvocation(rawArgs)) {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const [{ logger }, { runOpenCodeInitial }] = await Promise.all([
      import('../lib/logger.js'),
      import('../lib/opencode-initial.js'),
    ])

    try {
      await runOpenCodeInitial({ packageRoot })
      return
    } catch (error) {
      logger.error('initial 执行失败')
      logger.error(error?.message || String(error))
      process.exit(1)
    }
  }

  const overrideConfigDir = parseConfigDir(rawArgs)
  const filteredArgs = stripConfigDirArgs(rawArgs)

  const startDir = process.cwd()
  let projectRoot
  let configDir

  if (overrideConfigDir) {
    // When dx is installed globally, users may prefer providing DX_CONFIG_DIR/--config-dir.
    // In that case, do not require dx/config marker discovery.
    configDir = resolve(startDir, overrideConfigDir)
    if (!existsSync(join(configDir, 'commands.json'))) {
      console.error(`dx: 配置目录无效: ${configDir}`)
      console.error('dx: 期望存在 commands.json')
      process.exit(1)
    }
    projectRoot = inferProjectRootFromConfigDir(configDir, startDir)
  } else {
    projectRoot = findProjectRootFrom(startDir)
    if (!projectRoot) {
      console.error('dx: 未找到项目配置目录: dx/config/commands.json')
      console.error('dx: 请在项目目录内执行 dx，或先创建 dx/config 并放置 commands.json')
      console.error('dx: 也可通过 DX_CONFIG_DIR 或 --config-dir 指定配置目录')
      process.exit(1)
    }
    configDir = join(projectRoot, 'dx', 'config')
  }

  process.env.DX_PROJECT_ROOT = projectRoot
  process.env.DX_CONFIG_DIR = configDir

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
