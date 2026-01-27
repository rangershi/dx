#!/usr/bin/env node

/**
 * 后端部署包构建脚本
 *
 * 功能概览：
 * 1. 根据当前环境构建 NestJS 后端 dist 产物
 * 2. 收集 Prisma schema/migrations、运行时配置等运行所需文件
 * 3. 安装并裁剪生产依赖，生成可直接部署的目录结构
 * 4. 打包为 backend-<version>-<sha>.tar.gz，提供 bin/start.sh 启动脚本
 */

import { tmpdir } from 'node:os'
import { mkdir, rm, writeFile, chmod, stat } from 'node:fs/promises'
import { existsSync, cpSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import crypto from 'node:crypto'
import * as child_process from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { logger } from './logger.js'
import { execManager } from './exec.js'
import { envManager } from './env.js'
import {
  loadEnvPolicy,
  resolvePolicyTargetId,
  resolveTargetRequiredVars,
} from './env-policy.js'

class BackendPackager {
  constructor(options = {}) {
    this.projectRoot = process.env.DX_PROJECT_ROOT || process.cwd()
    this.backendRoot = join(this.projectRoot, 'apps/backend')
    this.distRoot = join(this.projectRoot, 'dist/backend')
    this.prismaSrc = join(this.backendRoot, 'prisma')
    this.targetEnv = options.environment || process.env.APP_ENV || 'development'
    this.skipBuild = Boolean(options.skipBuild)
    this.disableCleanup = Boolean(options.keepWorkdir)
    this.layerEnv = envManager.mapAppEnvToLayerEnv(this.targetEnv)
    const { version, packageManager, pnpmConfig, nxVersion } = this.resolveRootMetadata()
    this.repoVersion = version
    this.packageManager = packageManager
    this.rootPnpmConfig = pnpmConfig
    this.rootNxVersion = nxVersion
    this.gitSha = this.runGitCommand('git rev-parse HEAD') || 'unknown'
    this.gitShortSha = this.gitSha === 'unknown' ? 'unknown' : this.gitSha.slice(0, 7)
    this.buildTimestamp = new Date().toISOString()
    this.envSlug = this.createEnvironmentSlug(this.targetEnv)
    this.artifactBase = `backend-${this.repoVersion}-${this.envSlug}-${this.gitShortSha}`
    this.artifactFile = `${this.artifactBase}.tar.gz`
    this.tmpRoot = null
    this.outputRoot = null
    this.outputAppDir = null
    this.nodeVersionConstraint = this.resolveNodeConstraint()
    this.envSnapshot = {}
    this.buildConfiguration = 'skipped'
    this.pnpmVersion = this.resolvePnpmVersion()
    this.workspacePackagesInfo = null
    this.copiedWorkspacePackages = new Set()
  }

  resolveRootMetadata() {
    try {
      const pkg = JSON.parse(readFileSync(join(this.projectRoot, 'package.json'), 'utf8'))
      const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
      const packageManager = pkg.packageManager || 'pnpm'
      const pnpmConfig = pkg.pnpm ? structuredClone(pkg.pnpm) : undefined
      const nxVersion = pkg.devDependencies?.nx || pkg.dependencies?.nx || null
      return { version, packageManager, pnpmConfig, nxVersion }
    } catch (error) {
      logger.warn(`读取根 package.json 失败: ${error.message}`)
      return {
        version: '0.0.0',
        packageManager: 'pnpm',
        pnpmConfig: undefined,
        nxVersion: null,
      }
    }
  }

  resolvePnpmVersion() {
    try {
      return child_process
        .execSync('pnpm --version', { cwd: this.projectRoot, encoding: 'utf8' })
        .trim()
    } catch (error) {
      logger.warn(`无法获取 pnpm 版本信息: ${error.message}`)
      return null
    }
  }

  loadWorkspacePackageInfo() {
    if (this.workspacePackagesInfo) return this.workspacePackagesInfo

    const map = new Map()
    try {
      const workspaceFile = join(this.projectRoot, 'pnpm-workspace.yaml')
      let patterns = ['apps/*', 'packages/*']
      if (existsSync(workspaceFile)) {
        const raw = readFileSync(workspaceFile, 'utf8')
        const parsed = parseYaml(raw)
        if (parsed?.packages && Array.isArray(parsed.packages)) patterns = parsed.packages
      }

      const collectFromDir = dir => {
        if (!existsSync(dir) || !statSync(dir).isDirectory()) return
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const child = join(dir, entry.name)
          const pkgPath = join(child, 'package.json')
          if (!existsSync(pkgPath)) continue
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
            if (pkg?.name && pkg?.version) {
              map.set(pkg.name, {
                version: pkg.version,
                path: relative(this.projectRoot, child),
              })
            }
          } catch {}
        }
      }

      patterns.forEach(pattern => {
        if (!pattern) return
        const normalized = pattern.replace(/\\/g, '/').trim()
        if (normalized.endsWith('/*')) {
          const base = normalized.slice(0, -2)
          collectFromDir(join(this.projectRoot, base))
        } else {
          const absDir = join(this.projectRoot, normalized)
          const pkgPath = join(absDir, 'package.json')
          if (!existsSync(pkgPath)) return
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
            if (pkg?.name && pkg?.version) {
              map.set(pkg.name, {
                version: pkg.version,
                path: relative(this.projectRoot, absDir),
              })
            }
          } catch {}
        }
      })
    } catch (error) {
      logger.warn(`解析 pnpm workspace 失败: ${error.message}`)
    }

    this.workspacePackagesInfo = map
    return map
  }

  createEnvironmentSlug(env) {
    const raw = String(env || 'unknown').toLowerCase()
    const normalized = raw
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
    return normalized || 'unknown'
  }

  async copyWorkspacePackage(name, info) {
    if (this.copiedWorkspacePackages.has(name)) return
    this.copiedWorkspacePackages.add(name)

    const sourceDir = join(this.projectRoot, info.path)
    if (!existsSync(sourceDir)) {
      logger.warn(`未找到 workspace 包路径: ${sourceDir}`)
      return
    }

    try {
      await execManager.executeCommand(`pnpm --filter ${name} build`, {
        cwd: this.projectRoot,
        skipEnvValidation: true,
      })
    } catch (error) {
      logger.warn(`workspace 包 ${name} 构建失败: ${error.message}`)
    }

    const targetDir = join(this.outputAppDir, 'dist', info.path)
    await mkdir(targetDir, { recursive: true })

    const packageJsonPath = join(sourceDir, 'package.json')
    if (existsSync(packageJsonPath)) {
      cpSync(packageJsonPath, join(targetDir, 'package.json'))
    }

    const distDir = join(sourceDir, 'dist')
    if (existsSync(distDir)) {
      cpSync(distDir, join(targetDir, 'dist'), { recursive: true })
    }
  }

  resolveNodeConstraint() {
    try {
      const pkg = JSON.parse(readFileSync(join(this.projectRoot, 'package.json'), 'utf8'))
      const engines = pkg.engines || {}
      const nodeConstraint = engines.node || '>=20.11.0'
      return String(nodeConstraint)
    } catch {
      return '>=20.11.0'
    }
  }

  runGitCommand(command) {
    try {
      return child_process.execSync(command, { cwd: this.projectRoot, encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  }

  async run() {
    logger.step(`后端部署包构建 (${this.targetEnv})`)

    try {
      envManager.syncEnvironments(this.targetEnv)
      await this.prepareEnvSnapshot()
      await this.prepareWorkdir()
      if (!this.skipBuild) await this.buildBackend()
      await this.ensureDistArtifacts()
      await this.stageRuntimeFiles()
      await this.installProductionDependencies()
      await this.writeManifest()
      await this.createArchive()
      logger.success(`部署包已生成: ${this.getArtifactPath()}`)
    } catch (error) {
      if (envManager.latestEnvWarnings?.length) {
        envManager.latestEnvWarnings.forEach(message => logger.warn(message))
      }
      logger.error(`后端打包失败: ${error.message}`)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  async prepareEnvSnapshot() {
    logger.info('校验并快照环境变量')
    const policy = loadEnvPolicy(envManager.configDir)
    const targetId = resolvePolicyTargetId(policy, 'backend')
    if (!targetId) {
      throw new Error('缺少 appToTarget.backend 配置（dx 内置逻辑需要 backend target）')
    }
    const requiredVars = resolveTargetRequiredVars(policy, targetId, this.layerEnv)
    const collected = envManager.collectEnvFromLayers('backend', this.layerEnv)
    const effectiveEnv = { ...collected, ...process.env }
    const { valid, missing, placeholders } = envManager.validateRequiredVars(
      requiredVars,
      effectiveEnv,
    )
    if (!valid) {
      const problems = []
      if (missing.length > 0) problems.push(`缺少必填环境变量: ${missing.join(', ')}`)
      if (placeholders.length > 0) problems.push(`以下变量仍为占位值: ${placeholders.join(', ')}`)
      const message = problems.length > 0 ? problems.join('\n') : '环境变量校验未通过'
      throw new Error(message)
    }
    const snapshotKeys = new Set([
      ...Object.keys(collected),
      ...requiredVars,
      'APP_ENV',
      'NODE_ENV',
    ])

    const snapshot = {}
    snapshotKeys.forEach(key => {
      const value = effectiveEnv[key]
      if (value !== undefined && value !== null) {
        snapshot[key] = String(value)
      }
    })

    snapshot.APP_ENV = this.targetEnv
    snapshot.NODE_ENV = envManager.mapAppEnvToNodeEnv(this.targetEnv)

    this.envSnapshot = this.stripUndefined(snapshot)
    this.envSnapshot.APP_VERSION = this.repoVersion
    this.envSnapshot.BUILD_GIT_SHA = this.gitSha
    this.envSnapshot.BUILD_TIME = this.buildTimestamp
  }

  stripUndefined(record) {
    const result = {}
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined || value === null) continue
      result[key] = String(value)
    }
    return result
  }

  async prepareWorkdir() {
    const randomSuffix = crypto.randomBytes(6).toString('hex')
    const tmpBase = join(tmpdir(), `backend-package-${randomSuffix}`)
    await mkdir(tmpBase, { recursive: true })
    this.tmpRoot = tmpBase
    this.outputRoot = join(tmpBase, this.artifactBase)
    this.outputAppDir = join(this.outputRoot, 'backend')
    await mkdir(this.outputAppDir, { recursive: true })
  }

  async buildBackend() {
    logger.step('构建后端产物')
    const configuration = ['production', 'staging'].includes(this.targetEnv)
      ? 'production'
      : 'development'
    this.buildConfiguration = configuration
    await execManager.executeCommand(`npx nx build backend --configuration=${configuration}`, {
      app: 'backend',
    })
  }

  async ensureDistArtifacts() {
    const expectedMain = join(this.distRoot, 'apps/backend/src/main.js')
    try {
      await stat(expectedMain)
    } catch (error) {
      throw new Error(
        `缺少编译产物 ${relative(this.projectRoot, expectedMain)}，请检查 build 步骤。`,
      )
    }
  }

  async stageRuntimeFiles() {
    logger.step('收集运行所需文件')

    // dist
    await this.copyDistTree()

    // prisma schema/migrations
    if (existsSync(this.prismaSrc)) {
      cpSync(this.prismaSrc, join(this.outputAppDir, 'prisma'), { recursive: true })
    }

    // package.json
    const distPackagePath = join(this.distRoot, 'package.json')
    const distPackage = JSON.parse(readFileSync(distPackagePath, 'utf8'))
    const backendPackage = JSON.parse(readFileSync(join(this.backendRoot, 'package.json'), 'utf8'))

    const runtimeDeps = { ...(distPackage.dependencies || {}) }
    const workspacePackages = this.loadWorkspacePackageInfo()

    for (const [name, version] of Object.entries(backendPackage.dependencies || {})) {
      if (typeof version !== 'string') continue
      if (version.startsWith('workspace:')) {
        const info = workspacePackages.get(name)
        if (info) {
          await this.copyWorkspacePackage(name, info)
          const relPath = join('dist', info.path).replace(/\\/g, '/')
          runtimeDeps[name] = `file:./${relPath}`
        } else {
          logger.warn(`未能解析 workspace 依赖 ${name}，请检查工作区配置`)
        }
        continue
      }
      runtimeDeps[name] = version
    }
    if (backendPackage.devDependencies?.prisma) {
      runtimeDeps.prisma = backendPackage.devDependencies.prisma
    }

    const devOnlyPackages = new Set([
      'husky',
      'lint-staged',
      '@nestjs/cli',
      'ts-node',
      'ts-jest',
      'supertest',
    ])

    const sanitizedDeps = Object.fromEntries(
      Object.entries(runtimeDeps)
        .filter(([name]) => !name.startsWith('@types/') && !devOnlyPackages.has(name))
        .sort(([a], [b]) => a.localeCompare(b)),
    )

    const packageJson = {
      name: backendPackage.name || distPackage.name || '@ai/backend',
      version: this.repoVersion,
      private: true,
      type: 'commonjs',
      dependencies: sanitizedDeps,
      scripts: {
        start: 'node dist/apps/backend/src/main.js',
        'prisma:migrate': 'prisma migrate deploy',
      },
      engines: { node: this.nodeVersionConstraint },
      ...(this.rootPnpmConfig ? { pnpm: this.rootPnpmConfig } : {}),
    }

    await writeFile(
      join(this.outputAppDir, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      'utf8',
    )

    const rootLockfile = join(this.projectRoot, 'pnpm-lock.yaml')
    if (existsSync(rootLockfile)) {
      cpSync(rootLockfile, join(this.outputAppDir, 'pnpm-lock.yaml'))
    }

    await this.writeRuntimeEnv()
    await this.writeStartScript()
    await this.writeHealthcheckScript()
    await this.writeDeployReadme()
  }

  async copyDistTree() {
    const targetDist = join(this.outputAppDir, 'dist')
    await mkdir(targetDist, { recursive: true })
    cpSync(this.distRoot, targetDist, {
      recursive: true,
      filter: (source, destination) => {
        const rel = relative(this.distRoot, source)
        if (!rel || rel === '' || rel === 'package.json') return rel !== 'package.json'
        return true
      },
    })
  }

  async writeRuntimeEnv() {
    const configDir = join(this.outputAppDir, 'config')
    await mkdir(configDir, { recursive: true })
    const lines = Object.entries(this.envSnapshot)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${this.escapeEnvValue(value)}`)
    await writeFile(join(configDir, '.env.runtime'), `${lines.join('\n')}\n`, 'utf8')
  }

  escapeEnvValue(value) {
    if (value === '') return "''"
    if (/[^\w\-./:@]/.test(value)) {
      return `'${value.replace(/'/g, "'\\''")}'`
    }
    return value
  }

  async writeStartScript() {
    const binDir = join(this.outputAppDir, 'bin')
    await mkdir(binDir, { recursive: true })
    const scriptPath = join(binDir, 'start.sh')
    const script = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="\${SCRIPT_DIR%/bin}"
ENV_FILE="$APP_ROOT/config/.env.runtime"
NODE_BIN="$(command -v node || true)"
REQUIRED_NODE_RAW="${this.nodeVersionConstraint}"

if [[ -z "$NODE_BIN" ]]; then
  echo "❌ 未找到 node 命令，请先安装 Node.js (${this.nodeVersionConstraint})" >&2
  exit 1
fi

trim_constraint() {
  local raw="$1"
  echo "\${raw#>=}"
}

version_ge() {
  local current="$1"
  local required="$2"
  local IFS=.
  read -r c1 c2 c3 <<<"\${current//v/}"
  read -r r1 r2 r3 <<<"\${required}"
  c2=\${c2:-0}; c3=\${c3:-0}
  r2=\${r2:-0}; r3=\${r3:-0}
  if (( c1 > r1 )); then return 0; fi
  if (( c1 < r1 )); then return 1; fi
  if (( c2 > r2 )); then return 0; fi
  if (( c2 < r2 )); then return 1; fi
  if (( c3 >= r3 )); then return 0; fi
  return 1
}

CURRENT_NODE_VERSION="$(node -v 2>/dev/null || true)"
REQUIRED_NODE_VERSION="$(trim_constraint "$REQUIRED_NODE_RAW")"

if [[ -z "$CURRENT_NODE_VERSION" ]]; then
  echo "❌ 无法检测到 Node.js 版本，请确认已正确安装" >&2
  exit 1
fi

if ! version_ge "$CURRENT_NODE_VERSION" "$REQUIRED_NODE_VERSION"; then
  echo "❌ 当前 Node.js 版本 $CURRENT_NODE_VERSION 不满足要求 (>= $REQUIRED_NODE_VERSION)" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ 缺少运行时环境文件 $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export NODE_ENV="${envManager.mapAppEnvToNodeEnv(this.targetEnv)}"
export APP_ENV="${this.targetEnv}"

echo "🚀 执行 Prisma 数据库迁移"
npx --yes prisma migrate deploy --schema "$APP_ROOT/prisma/schema" >/dev/null

echo "✅ 数据库迁移完成，启动后端服务"
exec node "$APP_ROOT/dist/apps/backend/src/main.js"
`

    await writeFile(scriptPath, script, 'utf8')
    await chmod(scriptPath, 0o755)
  }

  async writeHealthcheckScript() {
    const binDir = join(this.outputAppDir, 'bin')
    await mkdir(binDir, { recursive: true })
    const scriptPath = join(binDir, 'healthcheck.sh')
    const port = this.envSnapshot.PORT || '3000'
    const apiPrefix = (this.envSnapshot.API_PREFIX || 'api/v1').replace(/^\//, '')
    const script = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="\${SCRIPT_DIR%/bin}"
ENV_FILE="$APP_ROOT/config/.env.runtime"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ 缺少运行时环境文件 $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

BASE_URL="http://localhost:${port}"
ENDPOINT="${apiPrefix}/health"

curl -sf --connect-timeout 2 --max-time 3 "\${BASE_URL%/}/\${ENDPOINT#/}"
`
    await writeFile(scriptPath, script, 'utf8')
    await chmod(scriptPath, 0o755)
  }

  async writeDeployReadme() {
    const content = [
      '# 后端部署包',
      '',
      '## 目录结构',
      '',
      '- bin/start.sh: 启动脚本（自动加载环境变量、执行 migrate deploy、启动服务）',
      '- config/.env.runtime: 打包时固化的环境变量',
      '- dist/: NestJS 编译后的 JavaScript 产物',
      '- node_modules/: 生产依赖',
      '- prisma/: Prisma schema 与 migrations',
      '- manifest.json: 元数据记录（版本、git、环境）',
      '',
      '## 使用步骤',
      '',
      `1. 解压 ${this.artifactFile} 后进入目录:`,
      `   tar -xzf ${this.artifactFile}`,
      '   cd backend',
      '',
      '2. 如需覆盖环境变量，可编辑 config/.env.runtime。',
      '',
      '3. 执行 bin/start.sh 启动服务。脚本会检查 Node 版本、执行 prisma migrate deploy 并启动后端。',
      '',
      '4. （可选）使用进程管理工具（如 pm2/systemd）托管 bin/start.sh。',
      '',
      '## 注意事项',
      '',
      '- 包内已包含生产依赖，无需再执行 pnpm install。',
      '- 如需更新环境变量，请重新执行打包命令或手动维护 config/.env.runtime。',
      '- 启动脚本需在具备数据库与 Redis 连通性的环境下执行。',
      '',
    ].join('\n')
    await writeFile(join(this.outputAppDir, 'README_DEPLOY.md'), content, 'utf8')
  }

  async installProductionDependencies() {
    logger.step('安装生产依赖')
    const installEnv = { ...process.env }
    installEnv.NX_SKIP_NX_CACHE = 'true'
    const installBaseCmd =
      'pnpm install --prod --config.node-linker=hoisted --config.package-import-method=copy'

    await execManager.executeCommand(`${installBaseCmd} --lockfile-only`, {
      cwd: this.outputAppDir,
      skipEnvValidation: true,
      env: installEnv,
    })

    await execManager.executeCommand(`${installBaseCmd} --frozen-lockfile`, {
      cwd: this.outputAppDir,
      skipEnvValidation: true,
      env: installEnv,
    })
  }

  async writeManifest() {
    const manifest = {
      app: '@ai/backend',
      version: this.repoVersion,
      gitSha: this.gitSha,
      gitShortSha: this.gitShortSha,
      environment: this.targetEnv,
      buildTime: this.buildTimestamp,
      node: {
        required: this.nodeVersionConstraint,
        runtime: process.version,
      },
      packageManager: this.packageManager,
      tooling: {
        nx: this.rootNxVersion || 'unknown',
        pnpm: this.pnpmVersion || 'unknown',
      },
      build: {
        configuration: this.buildConfiguration || 'unknown',
      },
    }
    await writeFile(
      join(this.outputAppDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    )
  }

  async createArchive() {
    const artifactPath = this.getArtifactPath()
    await mkdir(dirname(artifactPath), { recursive: true })
    const tarCommand = `tar -czf "${artifactPath}" -C "${this.outputRoot}" backend`
    await execManager.executeCommand(tarCommand, {
      skipEnvValidation: true,
    })
  }

  getArtifactPath() {
    return join(this.projectRoot, 'dist', 'backend', this.artifactFile)
  }

  async cleanup() {
    if (this.disableCleanup || !this.tmpRoot) return
    try {
      await rm(this.tmpRoot, { recursive: true, force: true })
    } catch (error) {
      logger.warn(`清理临时目录失败: ${error.message}`)
    }
  }
}

function parseArgs(argv) {
  const options = {}
  for (const arg of argv) {
    if (arg === '--skip-build') options.skipBuild = true
    else if (arg === '--keep-workdir') options.keepWorkdir = true
    else if (arg.startsWith('--env=')) options.environment = arg.slice('--env='.length)
  }
  return options
}

export async function runBackendPackage(argv = []) {
  const options = parseArgs(Array.isArray(argv) ? argv : [])
  const packager = new BackendPackager(options)
  await packager.run()
}

async function main() {
  await runBackendPackage(process.argv.slice(2))
}

main().catch(error => {
  logger.error(`后端部署包构建异常: ${error.message}`)
  process.exit(1)
})
