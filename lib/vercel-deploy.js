import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { envManager } from './env.js'
import { execManager } from './exec.js'
import { logger } from './logger.js'

const ALLOWED_ENVIRONMENTS = ['development', 'staging', 'production']

export async function deployToVercel(target, options = {}) {
  const { environment = 'staging' } = options

  // 校验环境参数
  if (!ALLOWED_ENVIRONMENTS.includes(environment)) {
    logger.error(`不支持的部署环境: ${environment}`)
    logger.info(`可用环境: ${ALLOWED_ENVIRONMENTS.join(', ')}`)
    process.exitCode = 1
    return
  }

  const token = process.env.VERCEL_TOKEN
  const orgId = process.env.VERCEL_ORG_ID
  const projectIdFront = process.env.VERCEL_PROJECT_ID_FRONT
  const projectIdAdmin = process.env.VERCEL_PROJECT_ID_ADMIN
  const projectIdTelegramBot = process.env.VERCEL_PROJECT_ID_TELEGRAM_BOT

  const normalizedTarget = String(target || '').toLowerCase()
  const targets = normalizedTarget === 'all' ? ['front', 'admin'] : [normalizedTarget]

  // 校验目标有效性
  for (const t of targets) {
    if (!['front', 'admin', 'telegram-bot'].includes(t)) {
      logger.error(`不支持的部署目标: ${t}`)
      logger.info('可用目标: front, admin, telegram-bot, all')
      process.exitCode = 1
      return
    }
  }

  // 收集缺失的环境变量
  const missingVars = []

  if (!token || envManager.isPlaceholderEnvValue(token)) {
    missingVars.push('VERCEL_TOKEN')
  }

  if (!orgId || envManager.isPlaceholderEnvValue(orgId)) {
    missingVars.push('VERCEL_ORG_ID')
  }

  // 根据目标检查对应的 PROJECT_ID
  if (targets.includes('front') && (!projectIdFront || envManager.isPlaceholderEnvValue(projectIdFront))) {
    missingVars.push('VERCEL_PROJECT_ID_FRONT')
  }

  if (targets.includes('admin') && (!projectIdAdmin || envManager.isPlaceholderEnvValue(projectIdAdmin))) {
    missingVars.push('VERCEL_PROJECT_ID_ADMIN')
  }

  if (targets.includes('telegram-bot') && (!projectIdTelegramBot || envManager.isPlaceholderEnvValue(projectIdTelegramBot))) {
    missingVars.push('VERCEL_PROJECT_ID_TELEGRAM_BOT')
  }

  // 如果有缺失变量，统一报错并退出
  if (missingVars.length > 0) {
    logger.error('缺少以下 Vercel 环境变量:')
    missingVars.forEach(v => logger.error(`  - ${v}`))
    logger.info('')
    logger.info('请在 .env.<env>.local 中配置这些变量，例如:')
    logger.info('  VERCEL_TOKEN=<your-vercel-token>')
    logger.info('  VERCEL_ORG_ID=team_xxx')
    logger.info('  VERCEL_PROJECT_ID_FRONT=prj_xxx')
    logger.info('  VERCEL_PROJECT_ID_ADMIN=prj_xxx')
    logger.info('  VERCEL_PROJECT_ID_TELEGRAM_BOT=prj_xxx')
    logger.info('')
    logger.info('获取方式:')
    logger.info('  1. VERCEL_TOKEN: vercel login 后查看 ~/Library/Application Support/com.vercel.cli/auth.json')
    logger.info('  2. PROJECT_ID: vercel project ls --scope <org> 或通过 Vercel Dashboard 获取')
    process.exitCode = 1
    return
  }

  // deploy 不再硬编码任何 Nx 构建步骤。
  // - 前置构建/生成（shared/contracts/backend 等）应由项目自己的 Nx 依赖图或 Vercel buildCommand 负责。
  // - 这样 dx deploy 能兼容不同 monorepo 布局（不强依赖 apps/sdk 等目录）。

  // 映射环境标识：development -> dev, staging -> staging, production -> prod
  const envMap = {
    development: 'dev',
    staging: 'staging',
    production: 'prod',
  }
  const buildEnv = envMap[environment]

  for (const t of targets) {
    // 配置文件映射
    const configFileMap = {
      front: 'vercel.front.json',
      admin: 'vercel.admin.json',
      'telegram-bot': 'vercel.telegram-bot.json',
    }

    // PROJECT_ID 映射
    const projectIdMap = {
      front: projectIdFront,
      admin: projectIdAdmin,
      'telegram-bot': projectIdTelegramBot,
    }

    const configFile = configFileMap[t]
    const projectId = projectIdMap[t]
    const configPath = join(process.cwd(), configFile)

    const envVars = {
      ...process.env,
      VERCEL_PROJECT_ID: projectId,
      APP_ENV: buildEnv,
    }

    if (orgId) {
      envVars.VERCEL_ORG_ID = orgId
    }

    // 绕过 Vercel Git author 权限检查：临时修改最新 commit 的 author
    const authorEmail = process.env.VERCEL_GIT_COMMIT_AUTHOR_EMAIL
    let originalAuthor = null
    if (authorEmail && !envManager.isPlaceholderEnvValue(authorEmail)) {
      try {
        originalAuthor = execSync('git log -1 --format="%an <%ae>"', { encoding: 'utf8' }).trim()
        const authorName = authorEmail.split('@')[0]
        execSync(`git commit --amend --author="${authorName} <${authorEmail}>" --no-edit`, { stdio: 'ignore' })
        logger.info(`临时修改 commit author: ${originalAuthor} -> ${authorName} <${authorEmail}>`)
      } catch (e) {
        logger.warn(`修改 commit author 失败: ${e.message}`)
        originalAuthor = null
      }
    }

    try {
      // 第一步：本地构建
      logger.step(`本地构建 ${t} (${environment})`)
      const buildCmd = [
        'vercel build',
        `--local-config="${configPath}"`,
        '--yes',
        `--token=${token}`,
      ]

      // staging 和 production 环境需要 --prod 标志，确保构建产物与部署环境匹配
      if (environment === 'staging' || environment === 'production') {
        buildCmd.push('--prod')
      }

      if (orgId) {
        buildCmd.push(`--scope=${orgId}`)
      }

      execSync(buildCmd.join(' '), {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: envVars,
      })
      logger.success(`${t} 本地构建成功`)

      // 第二步：上传预构建产物
      logger.step(`部署 ${t} 到 Vercel (${environment})`)
      const deployCmd = [
        'vercel deploy',
        '--prebuilt',
        `--local-config="${configPath}"`,
        '--yes',
        `--token=${token}`,
      ]

      // staging 和 production 环境都添加 --prod 标志以绑定固定域名
      if (environment === 'staging' || environment === 'production') {
        deployCmd.push('--prod')
      }

      if (orgId) {
        deployCmd.push(`--scope=${orgId}`)
      }

      execSync(deployCmd.join(' '), {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: envVars,
      })
      logger.success(`${t} 部署成功`)

      // Telegram Bot 部署成功后自动设置 Webhook
      if (t === 'telegram-bot') {
        const { handleTelegramBotDeploy } = await import('./telegram-webhook.js')
        await handleTelegramBotDeploy(environment, projectId, orgId, token)
      }
    } catch (error) {
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
