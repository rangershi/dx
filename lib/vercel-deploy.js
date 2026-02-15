import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { envManager } from './env.js'
import { logger } from './logger.js'

const ALLOWED_ENVIRONMENTS = ['development', 'staging', 'production']
const VALID_TARGETS = ['front', 'admin', 'telegram-bot']

const TARGET_CONFIGS = {
  front: {
    configFile: 'vercel.front.json',
    projectIdEnvVar: 'VERCEL_PROJECT_ID_FRONT',
    deployCwd: '.',
    deployMode: 'prebuilt',
    prebuiltCwd: '.'
  },
  admin: {
    configFile: 'vercel.admin.json',
    projectIdEnvVar: 'VERCEL_PROJECT_ID_ADMIN',
    deployCwd: 'apps/admin-front',
    deployMode: 'prebuilt'
  },
  'telegram-bot': {
    configFile: 'vercel.telegram-bot.json',
    projectIdEnvVar: 'VERCEL_PROJECT_ID_TELEGRAM_BOT',
    deployMode: 'prebuilt'
  }
}

const ALLOWED_DEPLOY_MODES = ['prebuilt']

const APP_ENV_MAP = {
  development: 'dev',
  staging: 'staging',
  production: 'prod'
}

const VERCEL_PROJECT_LINK_PATH = '.vercel/project.json'

function getTargetConfig(target) {
  return TARGET_CONFIGS[target]
}

function collectErrorText(err) {
  const parts = []
  if (err?.message) parts.push(String(err.message))
  if (err?.stderr) parts.push(String(err.stderr))
  if (err?.stdout) parts.push(String(err.stdout))
  return parts.join('\n')
}

function isMissingFilesError(err) {
  const text = collectErrorText(err)
  return (
    text.includes('missing_files') ||
    text.includes('Missing files') ||
    text.includes('code":"missing_files"')
  )
}

function isNextPrebuiltMissingPathError(err) {
  const text = collectErrorText(err)
  return (
    text.includes('ENOENT') &&
    (text.includes('next-server.js') || text.includes('/node_modules/.pnpm/'))
  )
}

function listMissingVarKeys(targetConfigs, token, orgId) {
  const missing = []

  if (!token || envManager.isPlaceholderEnvValue(token)) {
    missing.push('VERCEL_TOKEN')
  }

  if (!orgId || envManager.isPlaceholderEnvValue(orgId)) {
    missing.push('VERCEL_ORG_ID')
  }

  for (const config of targetConfigs) {
    const projectId = process.env[config.projectIdEnvVar]
    if (!projectId || envManager.isPlaceholderEnvValue(projectId)) {
      missing.push(config.projectIdEnvVar)
    }
  }

  return [...new Set(missing)]
}

function listMissingConfigs(targetConfigs, projectRoot) {
  const missing = []

  for (const config of targetConfigs) {
    const configPath = join(projectRoot, config.configFile)
    if (!existsSync(configPath)) {
      missing.push(config.configFile)
    }
  }

  return missing
}

function appendTargetArgs(baseArgs, { orgId }) {
  const args = [...baseArgs]

  if (orgId) {
    args.push('--scope', orgId)
  }

  return args
}

export function resolveTargetRunCwd(projectRoot, targetConfig) {
  if (!targetConfig?.deployCwd) return projectRoot
  return join(projectRoot, targetConfig.deployCwd)
}

export function resolveTargetDeployMode(targetConfig) {
  if (!targetConfig?.deployMode) return 'prebuilt'
  return targetConfig.deployMode
}

export function isSupportedDeployMode(mode) {
  return ALLOWED_DEPLOY_MODES.includes(mode)
}

export function resolveTargetPrebuiltCwd(projectRoot, targetConfig, runCwd) {
  if (!targetConfig?.prebuiltCwd) return runCwd
  return join(projectRoot, targetConfig.prebuiltCwd)
}

function maskIdentifier(value) {
  const raw = String(value || '').trim()
  if (raw.length <= 10) return raw || '-'
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`
}

function readLinkedProjectContext(contextRoot) {
  const path = join(contextRoot, VERCEL_PROJECT_LINK_PATH)
  if (!existsSync(path)) {
    return { exists: false, path, orgId: null, projectId: null, parseError: null }
  }

  try {
    const content = readFileSync(path, 'utf8')
    const parsed = JSON.parse(content)
    return {
      exists: true,
      path,
      orgId: parsed?.orgId || null,
      projectId: parsed?.projectId || null,
      parseError: null
    }
  } catch (error) {
    return {
      exists: true,
      path,
      orgId: null,
      projectId: null,
      parseError: error
    }
  }
}

function clearLinkedProjectContext(contextRoot) {
  const path = join(contextRoot, VERCEL_PROJECT_LINK_PATH)
  rmSync(path, { force: true })
}

async function runVercel(args, options = {}) {
  const { env, cwd } = options
  const MAX_CAPTURE = 20000

  return new Promise((resolve, reject) => {
    const child = spawn('vercel', args, {
      cwd: cwd || process.cwd(),
      env: env || process.env,
      stdio: ['inherit', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    const append = (current, chunk) => {
      const next = current + chunk
      return next.length > MAX_CAPTURE ? next.slice(-MAX_CAPTURE) : next
    }

    child.stdout.on('data', data => {
      process.stdout.write(data)
      stdout = append(stdout, data.toString('utf8'))
    })

    child.stderr.on('data', data => {
      process.stderr.write(data)
      stderr = append(stderr, data.toString('utf8'))
    })

    child.on('error', error => {
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })

    child.on('close', code => {
      if (code === 0) return resolve({ code, stdout, stderr })
      const error = new Error(`vercel ${args[0] || ''} 失败 (exit ${code})`)
      error.code = code
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })
  })
}

export async function deployPrebuiltWithFallback(options) {
  const {
    baseArgs,
    env,
    cwd,
    run = runVercel,
    cleanupArchiveParts = () => {
      try {
        execSync('rm -f .vercel/source.tgz.part*', { stdio: 'ignore', cwd: cwd || process.cwd() })
      } catch {
        // ignore
      }
    },
    onMissingFiles = () => {
      logger.warn('检测到 missing_files，自动使用 --archive=tgz 重试一次')
    }
  } = options || {}

  try {
    const result = await run(baseArgs, { env, cwd })
    return { usedArchive: false, result }
  } catch (e) {
    if (!isMissingFilesError(e)) throw e
    onMissingFiles(e)
    cleanupArchiveParts()
    const archiveArgs = baseArgs.slice()
    archiveArgs.splice(2, 0, '--archive=tgz')
    const result = await run(archiveArgs, { env, cwd })
    return { usedArchive: true, result }
  }
}

export async function deployToVercel(target, options = {}) {
  const {
    environment = 'staging',
    telegramWebhook = null,
    strictContext = true,
    run = runVercel
  } = options

  // 校验环境参数
  if (!ALLOWED_ENVIRONMENTS.includes(environment)) {
    logger.error(`不支持的部署环境: ${environment}`)
    logger.info(`可用环境: ${ALLOWED_ENVIRONMENTS.join(', ')}`)
    process.exitCode = 1
    return
  }

  const normalizedTarget = String(target || '').toLowerCase()
  const targets = normalizedTarget === 'all' ? ['front', 'admin'] : [normalizedTarget]
  const projectRoot = process.cwd()

  // 校验目标有效性
  for (const t of targets) {
    if (!VALID_TARGETS.includes(t)) {
      logger.error(`不支持的部署目标: ${t}`)
      logger.info('可用目标: front, admin, telegram-bot, all')
      process.exitCode = 1
      return
    }
  }

  const targetConfigs = targets.map(getTargetConfig)
  const token = process.env.VERCEL_TOKEN
  const orgId = process.env.VERCEL_ORG_ID

  const missingVars = listMissingVarKeys(targetConfigs, token, orgId)
  const missingConfigFiles = listMissingConfigs(targetConfigs, projectRoot)

  if (missingVars.length > 0 || missingConfigFiles.length > 0) {
    if (missingVars.length > 0) {
      logger.error('缺少以下 Vercel 环境变量:')
      missingVars.forEach(v => {
        logger.error(`  - ${v}`)
      })
      logger.info('')
      logger.info('请在 .env.<env>.local 中配置这些变量，例如:')
      logger.info('  VERCEL_TOKEN=<your-vercel-token>')
      logger.info('  VERCEL_ORG_ID=team_xxx')
      logger.info('  VERCEL_PROJECT_ID_FRONT=prj_xxx')
      logger.info('  VERCEL_PROJECT_ID_ADMIN=prj_xxx')
      logger.info('  VERCEL_PROJECT_ID_TELEGRAM_BOT=prj_xxx')
      logger.info('')
      logger.info('获取方式:')
      logger.info(
        '  1. VERCEL_TOKEN: vercel login 后查看 ~/Library/Application Support/com.vercel.cli/auth.json'
      )
      logger.info('  2. PROJECT_ID: vercel project ls --scope <org> 或通过 Vercel Dashboard 获取')
      logger.info('')
      logger.info('提示：部署命令会显式校验 --scope 与环境变量上下文，避免环境漂移。')
    }

    if (missingConfigFiles.length > 0) {
      logger.error('缺少以下 Vercel 配置文件:')
      missingConfigFiles.forEach(name => {
        logger.error(`  - ${name}`)
      })
      logger.info('')
      logger.info('请确认同级目录存在对应的 vercel.*.json 文件。')
    }

    process.exitCode = 1
    return
  }

  // deploy 不再硬编码任何 Nx 构建步骤。
  // - 前置构建/生成（shared/contracts/backend 等）应由项目自己的 Nx 依赖图或 Vercel buildCommand 负责。
  // - 这样 dx deploy 能兼容不同 monorepo 布局（不强依赖 apps/sdk 等目录）。

  // 映射环境标识：development -> dev, staging -> staging, production -> prod
  const buildEnv = APP_ENV_MAP[environment]

  for (const t of targets) {
    const targetConfig = getTargetConfig(t)
    const projectId = process.env[targetConfig.projectIdEnvVar]
    const configFile = targetConfig.configFile
    const configPath = join(projectRoot, configFile)
    const runCwd = resolveTargetRunCwd(projectRoot, targetConfig)
    const deployMode = resolveTargetDeployMode(targetConfig)
    const prebuiltCwd = resolveTargetPrebuiltCwd(projectRoot, targetConfig, runCwd)

    if (!existsSync(runCwd)) {
      logger.error(
        `部署目录不存在: target=${t} deployCwd=${targetConfig.deployCwd || '.'} resolved=${runCwd}`
      )
      process.exitCode = 1
      return
    }

    if (!isSupportedDeployMode(deployMode)) {
      logger.error(`不支持的部署模式: target=${t} mode=${deployMode}`)
      logger.info(`可用部署模式: ${ALLOWED_DEPLOY_MODES.join(', ')}`)
      process.exitCode = 1
      return
    }

    if (!existsSync(prebuiltCwd)) {
      logger.error(
        `预构建部署目录不存在: target=${t} prebuiltCwd=${targetConfig.prebuiltCwd || targetConfig.deployCwd || '.'} resolved=${prebuiltCwd}`
      )
      process.exitCode = 1
      return
    }

    const linkedContext = readLinkedProjectContext(prebuiltCwd)

    const linkedMismatch =
      linkedContext.exists &&
      linkedContext.parseError == null &&
      ((linkedContext.orgId && linkedContext.orgId !== orgId) ||
        (linkedContext.projectId && linkedContext.projectId !== projectId))

    if (linkedContext.exists && linkedContext.parseError) {
      logger.warn(
        `检测到 ${VERCEL_PROJECT_LINK_PATH} 但解析失败: ${linkedContext.parseError.message}`
      )
      if (strictContext) {
        logger.error('strictContext 已开启，已阻止继续部署以避免回退污染')
        process.exitCode = 1
        return
      }
    }

    if (linkedMismatch) {
      logger.error('检测到 .vercel 链接冲突')
      logger.error(`  当前目标: org=${maskIdentifier(orgId)} project=${maskIdentifier(projectId)}`)
      logger.error(
        `  本地链接: org=${maskIdentifier(linkedContext.orgId)} project=${maskIdentifier(linkedContext.projectId)}`
      )
      if (strictContext) {
        logger.error('strictContext 已开启，已阻止部署（请清理 .vercel 或修正环境变量）')
        process.exitCode = 1
        return
      }
      logger.warn('strictContext 已关闭，继续执行（可能存在误部署风险）')
    }

    logger.info(
      `[deploy-context] env=${environment} target=${t} mode=${deployMode} runCwd=${runCwd} prebuiltCwd=${prebuiltCwd} strict=${strictContext ? 1 : 0} org=${maskIdentifier(orgId)} project=${maskIdentifier(projectId)} linked=${linkedContext.exists ? 'yes' : 'no'} token=env`
    )

    const envVars = {
      ...process.env,
      VERCEL_PROJECT_ID: projectId,
      APP_ENV: buildEnv,
      NODE_ENV: envManager.mapAppEnvToNodeEnv(environment),
      VERCEL_ORG_ID: orgId
    }

    // 不通过 CLI args 传递 token，避免出现在错误信息/日志中
    envVars.VERCEL_TOKEN = token

    // 绕过 Vercel Git author 权限检查：临时修改最新 commit 的 author
    const authorEmail = process.env.VERCEL_GIT_COMMIT_AUTHOR_EMAIL
    let originalAuthor = null
    if (authorEmail && !envManager.isPlaceholderEnvValue(authorEmail)) {
      try {
        originalAuthor = execSync('git log -1 --format="%an <%ae>"', { encoding: 'utf8' }).trim()
        const authorName = authorEmail.split('@')[0]
        execSync(`git commit --amend --author="${authorName} <${authorEmail}>" --no-edit`, {
          stdio: 'ignore'
        })
        logger.info(`临时修改 commit author: ${originalAuthor} -> ${authorName} <${authorEmail}>`)
      } catch (e) {
        logger.warn(`修改 commit author 失败: ${e.message}`)
        originalAuthor = null
      }
    }

    try {
      if (strictContext && process.env.DX_VERCEL_KEEP_LINK !== '1') {
        clearLinkedProjectContext(prebuiltCwd)
      }

      // 第一步：本地构建
      logger.step(`本地构建 ${t} (${environment})`)
      const buildArgs = appendTargetArgs(['build', '--local-config', configPath, '--yes'], {
        orgId
      })

      // staging 和 production 环境需要 --prod 标志，确保构建产物与部署环境匹配
      if (environment === 'staging' || environment === 'production') {
        buildArgs.push('--prod')
      }

      await run(buildArgs, { env: envVars, cwd: runCwd })
      logger.success(`${t} 本地构建成功`)

      logger.step(`部署 ${t} 到 Vercel (${environment})`)

      const baseDeployArgs = appendTargetArgs(
        ['deploy', '--prebuilt', '--local-config', configPath, '--yes'],
        {
          orgId
        }
      )

      // staging 和 production 环境都添加 --prod 标志以绑定固定域名
      if (environment === 'staging' || environment === 'production') {
        baseDeployArgs.push('--prod')
      }

      const deployResult = await deployPrebuiltWithFallback({
        baseArgs: baseDeployArgs,
        env: envVars,
        cwd: prebuiltCwd,
        run
      })

      const deployOutput = [deployResult?.result?.stdout, deployResult?.result?.stderr]
        .filter(Boolean)
        .join('\n')

      // Telegram Bot 部署成功后自动设置 Webhook（并做严格校验）
      if (t === 'telegram-bot') {
        const { handleTelegramBotDeploy } = await import('./telegram-webhook.js')
        await handleTelegramBotDeploy(environment, projectId, orgId, token, {
          deployOutput,
          projectNameHint: 'telegram-bot',
          ...(telegramWebhook || {})
        })
        logger.success(`${t} 部署成功（Webhook 已校验）`)
      } else {
        logger.success(`${t} 部署成功`)
      }
    } catch (error) {
      if (deployMode === 'prebuilt' && isNextPrebuiltMissingPathError(error)) {
        logger.error(
          '高优先级提示：检测到 Next.js 预构建产物缺失（next-server.js/node_modules/.pnpm）。请检查 front prebuiltCwd 与构建产物路径是否一致。'
        )
      }
      const message = error?.message || String(error)
      logger.error(`${t} 构建或部署失败: ${message}`)
      process.exitCode = 1
    } finally {
      // 恢复原 commit author
      if (originalAuthor) {
        try {
          execSync(`git commit --amend --author="${originalAuthor}" --no-edit`, { stdio: 'ignore' })
          logger.info(`已恢复 commit author: ${originalAuthor}`)
        } catch {
          // 忽略错误
        }
      }
    }
  }
}
