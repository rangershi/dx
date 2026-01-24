import { spawn, execSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { existsSync } from 'node:fs'

const allowedApps = ['backend', 'front', 'admin']

function findWorkspaceRoot(startDir) {
  let current = resolve(startDir)
  while (true) {
    if (existsSync(join(current, 'dx', 'config', 'commands.json'))) return current
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) return startDir
    current = parent
  }
}

function parseArgs(argv) {
  const args = [...argv]
  let app = null
  const extraEnv = {}
  while (args.length > 0) {
    const current = args.shift()
    if (current === '--') {
      return { app, command: args, extraEnv }
    }
    if ((current === '--app' || current === '-a') && args.length > 0) {
      app = args.shift()
      continue
    }
    if (current.startsWith('--set=')) {
      const pair = current.slice('--set='.length)
      const [key, ...rest] = pair.split('=')
      extraEnv[key] = rest.join('=') ?? ''
      continue
    }
    throw new Error(`无法识别的参数 ${current}`)
  }
  throw new Error('缺少命令分隔符 --')
}

async function readPackageVersion(app) {
  const root = process.env.DX_PROJECT_ROOT || findWorkspaceRoot(process.cwd())
  const appDirMap = {
    backend: 'apps/backend/package.json',
    front: 'apps/front/package.json',
    admin: 'apps/admin-front/package.json'
  }
  const pkgPath = appDirMap[app]
  if (!pkgPath) return '0.0.0'
  const absPath = resolve(root, pkgPath)
  try {
    const raw = await readFile(absPath, 'utf8')
    const pkg = JSON.parse(raw)
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch (error) {
    console.warn(`[with-version-env] 读取 ${pkgPath} 失败，使用默认版本 0.0.0`, error)
    return '0.0.0'
  }
}

function resolveGitSha() {
  try {
    const root = process.env.DX_PROJECT_ROOT || findWorkspaceRoot(process.cwd())
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: root }).trim()
    return sha
  } catch (error) {
    console.warn('[with-version-env] 获取 Git SHA 失败，使用 unknown', error)
    return 'unknown'
  }
}

function buildEnv(app, baseEnv, extraEnv) {
  const now = new Date().toISOString()
  const gitSha = resolveGitSha()
  const gitShort = gitSha && gitSha !== 'unknown' ? gitSha.slice(0, 7) : 'unknown'
  const buildNumber =
    process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || process.env.CI_PIPELINE_IID || ''

  const result = { ...baseEnv, ...extraEnv }

  const assign = (entries = []) => {
    entries.forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        result[key] = String(value)
      }
    })
  }

  switch (app) {
    case 'backend': {
      const version = baseEnv.__APP_VERSION__
      assign([
        ['APP_VERSION', version],
        ['APP_BUILD_VERSION', version],
        ['GIT_SHA', gitSha],
        ['GIT_SHORT_SHA', gitShort],
        ['BUILD_GIT_SHA', gitSha],
        ['BUILD_TIME', now],
        ['BUILD_TIMESTAMP', now],
        ['BUILD_NUMBER', buildNumber]
      ])
      break
    }
    case 'front': {
      const version = baseEnv.__APP_VERSION__
      assign([
        ['NEXT_PUBLIC_APP_VERSION', version],
        ['NEXT_PUBLIC_GIT_SHA', gitSha],
        ['NEXT_PUBLIC_GIT_SHORT_SHA', gitShort],
        ['NEXT_PUBLIC_BUILD_TIME', now],
        ['NEXT_PUBLIC_BUILD_NUMBER', buildNumber]
      ])
      break
    }
    case 'admin': {
      const version = baseEnv.__APP_VERSION__
      assign([
        ['VITE_APP_VERSION', version],
        ['VITE_GIT_SHA', gitSha],
        ['VITE_GIT_SHORT_SHA', gitShort],
        ['VITE_BUILD_TIME', now],
        ['VITE_BUILD_NUMBER', buildNumber]
      ])
      break
    }
    default:
      break
  }

  delete result.__APP_VERSION__
  return result
}

export async function runWithVersionEnv(argv = []) {
  const { app, command, extraEnv } = parseArgs(Array.isArray(argv) ? argv : [])
  if (!app || !allowedApps.includes(app)) {
    throw new Error(`必须使用 --app 指定 ${allowedApps.join(', ')} 之一`)
  }
  if (!command || command.length === 0) {
    throw new Error('缺少待执行命令')
  }

  const version = await readPackageVersion(app)
  const env = buildEnv(app, { ...process.env, __APP_VERSION__: version }, extraEnv)

  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    env,
    shell: false
  })

  child.on('exit', code => {
    process.exit(code ?? 0)
  })

  child.on('error', error => {
    console.error('[with-version-env] 启动命令失败', error)
    process.exit(1)
  })
}
