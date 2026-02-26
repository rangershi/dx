import { execSync } from 'node:child_process'
import { logger } from './logger.js'
import { envManager } from './env.js'

function normalizeWebhookPath(raw) {
  const s = String(raw || '').trim()
  if (!s) return '/api/webhook'
  if (s.startsWith('/')) return s
  return `/${s}`
}

function normalizeDeployUrl(raw) {
  const s = String(raw || '')
  const m = s.match(/(https?:\/\/)?([a-z0-9-]+\.vercel\.app)\b/i)
  if (!m) return null
  return `https://${m[2]}`
}

export function parseDeployUrlFromDeployOutput(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map(line => String(line || '').trim())
    .filter(Boolean)

  const pickUrl = line => {
    const m = line.match(/(https?:\/\/)?([a-z0-9-]+\.vercel\.app)\b/i)
    return m ? `https://${m[2]}` : null
  }

  for (const line of lines) {
    if (!/^production\s*:/i.test(line)) continue
    const url = pickUrl(line)
    if (url) return url
  }

  for (const line of lines) {
    if (!/^preview\s*:/i.test(line)) continue
    const url = pickUrl(line)
    if (url) return url
  }

  for (const line of lines) {
    if (/to deploy to production/i.test(line)) continue
    const url = pickUrl(line)
    if (url) return url
  }

  return null
}

export function parseDeployUrlFromVercelListOutput(output, projectNameHint) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)

  const isReady = line => /\b(Ready|READY)\b/.test(line)
  const hasUrl = line => /\b[a-z0-9-]+\.vercel\.app\b/i.test(line)
  const pickUrl = line => {
    const m = line.match(/(https?:\/\/)?([a-z0-9-]+\.vercel\.app)\b/i)
    return m ? `https://${m[2]}` : null
  }

  const hint = projectNameHint ? String(projectNameHint) : ''
  if (hint) {
    for (const line of lines) {
      if (!line.includes(hint)) continue
      if (!isReady(line)) continue
      if (!hasUrl(line)) continue
      const url = pickUrl(line)
      if (url) return url
    }
  }

  for (const line of lines) {
    if (!isReady(line)) continue
    if (!hasUrl(line)) continue
    const url = pickUrl(line)
    if (url) return url
  }

  return null
}

/**
 * 处理 Telegram Bot 部署后的 Webhook 配置
 */
export async function handleTelegramBotDeploy(environment, projectId, orgId, token, options = {}) {
  logger.step('配置 Telegram Webhook...')

  const {
    deployOutput,
    projectNameHint,
    webhookPath: webhookPathOverride,
    dryRun: dryRunOverride,
    strict: strictOverride,
  } = options || {}

  const strictDefault = true

  const strictEnv = process.env.DX_TELEGRAM_WEBHOOK_STRICT != null
    ? !['0', 'false', 'no'].includes(String(process.env.DX_TELEGRAM_WEBHOOK_STRICT).toLowerCase())
    : undefined

  const strict = strictOverride ?? strictEnv ?? strictDefault

  const dryRunEnv = ['1', 'true', 'yes'].includes(String(process.env.DX_TELEGRAM_WEBHOOK_DRY_RUN || '').toLowerCase())
  const dryRun = dryRunOverride ?? (dryRunEnv ? true : false)

  const webhookPath = normalizeWebhookPath(webhookPathOverride ?? process.env.DX_TELEGRAM_WEBHOOK_PATH ?? '/api/webhook')

  // 1. 验证必需环境变量
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const webhookSecret = process.env.TELEGRAM_BOT_WEBHOOK_SECRET

  const missingVars = []
  if (!botToken || envManager.isPlaceholderEnvValue(botToken)) {
    missingVars.push('TELEGRAM_BOT_TOKEN')
  }
  if (!webhookSecret || envManager.isPlaceholderEnvValue(webhookSecret)) {
    missingVars.push('TELEGRAM_BOT_WEBHOOK_SECRET')
  }

  if (missingVars.length > 0) {
    logger.error('缺少以下 Telegram Bot 环境变量:')
    missingVars.forEach(v => {
      logger.error(`  - ${v}`)
    })

    const message = 'Telegram Webhook 配置失败：缺少必需环境变量'
    if (strict) {
      return {
        status: 'failed',
        reason: 'missing_env_vars',
        strict,
        message,
        missingVars,
      }
    }

    logger.warn('跳过 Webhook 配置，请手动设置')
    return {
      status: 'warning',
      reason: 'missing_env_vars',
      strict,
      message,
      missingVars,
    }
  }

  try {
    // 2. 获取 Vercel 部署 URL
    const deploymentUrl = await getLatestDeploymentUrl({
      projectId,
      orgId,
      token,
      environment,
      deployOutput,
      projectNameHint,
    })
    if (!deploymentUrl) {
      const message = '无法获取 Vercel 部署 URL'
      if (strict) {
        return {
          status: 'failed',
          reason: 'missing_deploy_url',
          strict,
          message,
        }
      }
      logger.error('无法获取 Vercel 部署 URL，跳过 Webhook 配置')
      return {
        status: 'warning',
        reason: 'missing_deploy_url',
        strict,
        message,
      }
    }

    const webhookUrl = `${deploymentUrl}${webhookPath}`
    logger.info(`Webhook URL: ${webhookUrl}`)

    if (dryRun) {
      logger.warn('DX_TELEGRAM_WEBHOOK_DRY_RUN=1，已跳过 setWebhook/getWebhookInfo 调用')
      return {
        status: 'warning',
        reason: 'dry_run',
        strict,
        message: 'DX_TELEGRAM_WEBHOOK_DRY_RUN=1',
        webhookUrl,
      }
    }

    // 3. 调用 Telegram API 设置 Webhook
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`
    const payload = JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      drop_pending_updates: false,
    })

    const curlCmd = [
      'curl',
      '-X POST',
      `"${telegramApiUrl}"`,
      '-H "Content-Type: application/json"',
      `-d '${payload}'`,
      '--silent',
    ].join(' ')

    const response = execSync(curlCmd, { encoding: 'utf8' })
    const result = JSON.parse(response)

    if (result.ok) {
      logger.success('Telegram Webhook 设置成功')
      logger.info(`Webhook URL: ${webhookUrl}`)

      // 4. 验证 Webhook 状态
      const verifyResult = await verifyWebhook(botToken, webhookUrl, { strict })
      if (verifyResult.status === 'success') {
        return {
          status: 'success',
          reason: 'verified',
          strict,
          webhookUrl,
        }
      }

      return {
        status: strict ? 'failed' : 'warning',
        reason: 'verify_failed',
        strict,
        message: verifyResult.message,
        webhookUrl,
      }
    }
    else {
      const desc = result.description || '未知错误'
      const message = `Telegram Webhook 设置失败: ${desc}`
      if (strict) {
        return {
          status: 'failed',
          reason: 'set_webhook_failed',
          strict,
          message,
          webhookUrl,
        }
      }

      logger.error(message)
      logger.info('请手动执行以下命令（不要把明文 token/secret 写进日志）:')
      const manualPayload = JSON.stringify({
        url: webhookUrl,
        secret_token: '<YOUR_WEBHOOK_SECRET>',
        drop_pending_updates: false,
      })
      logger.info(
        `curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" -H "Content-Type: application/json" -d '${manualPayload}' --silent`,
      )
      return {
        status: 'warning',
        reason: 'set_webhook_failed',
        strict,
        message,
        webhookUrl,
      }
    }
  }
  catch (error) {
    const message = error?.message || String(error)
    logger.error(`Webhook 配置失败: ${message}`)

    if (!strict) {
      logger.warn('请手动设置 Webhook（参考 apps/telegram-bot/README.md）')
    }
    return {
      status: strict ? 'failed' : 'warning',
      reason: 'runtime_error',
      strict,
      message,
    }
  }
}

/**
 * 获取最新部署的 URL
 */
async function getLatestDeploymentUrl({
  projectId,
  orgId,
  token,
  environment,
  deployOutput,
  projectNameHint,
}) {
  const fromDeploy = parseDeployUrlFromDeployOutput(deployOutput)
  if (fromDeploy) return fromDeploy

  const fromApi = await getDeploymentUrlFromVercelApi({ projectId, orgId, token, environment })
  if (fromApi) return fromApi

  const fromList = await getDeploymentUrlFromVercelList({ orgId, token, projectNameHint })
  if (fromList) return fromList

  return null
}

export function pickDeploymentUrlFromVercelApiResponse(json) {
  const deployments = json?.deployments
  if (!Array.isArray(deployments)) return null

  for (const d of deployments) {
    const url = d?.url
    if (!url) continue
    const state = d?.state || d?.readyState
    if (state && String(state).toUpperCase() !== 'READY') continue
    const normalized = normalizeDeployUrl(url)
    if (normalized) return normalized
  }

  return null
}

async function getDeploymentUrlFromVercelApi({ projectId, orgId, token, environment }) {
  try {
    const qs = new URLSearchParams({
      projectId: String(projectId),
      state: 'READY',
      limit: '10',
    })

    // dx 的 deploy 实现里：staging/production 都会传 --prod，因此对应 Vercel 的 production target。
    // development 环境若需要兜底查询，则不强制 target（避免与 Vercel CLI/REST 字段差异耦合）。
    if (environment !== 'development') {
      qs.set('target', 'production')
    }

    if (orgId) {
      const scope = String(orgId)
      if (scope.startsWith('team_')) qs.set('teamId', scope)
      else qs.set('slug', scope)
    }

    const url = `https://api.vercel.com/v6/deployments?${qs.toString()}`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) {
      logger.warn(`Vercel API 获取部署列表失败: HTTP ${res.status}`)
      return null
    }

    const json = await res.json()
    return pickDeploymentUrlFromVercelApiResponse(json)
  } catch (error) {
    logger.warn(`Vercel API 获取部署列表失败: ${error?.message || String(error)}`)
    return null
  }
}

async function getDeploymentUrlFromVercelList({ orgId, token, projectNameHint }) {
  try {
    const cmd = ['vercel', 'list', orgId ? `--scope=${orgId}` : '']
      .filter(Boolean)
      .join(' ')

    const output = execSync(cmd, {
      encoding: 'utf8',
      env: {
        ...process.env,
        VERCEL_TOKEN: token,
      },
    })

    return parseDeployUrlFromVercelListOutput(output, projectNameHint)
  } catch (error) {
    logger.warn(`vercel list 获取部署 URL 失败: ${error?.message || String(error)}`)
    return null
  }
}

/**
 * 验证 Webhook 配置
 */
async function verifyWebhook(botToken, expectedWebhookUrl, options = {}) {
  const { strict = false } = options || {}
  try {
    const cmd = `curl -s "https://api.telegram.org/bot${botToken}/getWebhookInfo"`
    const response = execSync(cmd, { encoding: 'utf8' })
    const result = JSON.parse(response)

    if (result.ok && result.result) {
      const info = result.result
      logger.info('Webhook 状态:')
      logger.info(`  URL: ${info.url}`)
      logger.info(`  Pending Updates: ${info.pending_update_count}`)
      if (info.last_error_message) {
        logger.warn(`  最后错误: ${info.last_error_message}`)
      }

      if (expectedWebhookUrl && info.url !== expectedWebhookUrl) {
        const message = `Webhook 未生效：期望 ${expectedWebhookUrl}，实际 ${info.url || '(empty)'}`
        if (strict) {
          return { status: 'failed', message }
        }
        logger.warn(message)
        return { status: 'warning', message }
      }
      return { status: 'success' }
    }
    else {
      const desc = result?.description || '未知错误'
      const message = `getWebhookInfo 失败: ${desc}`
      if (strict) {
        return { status: 'failed', message }
      }
      logger.warn(message)
      return { status: 'warning', message }
    }
  }
  catch (error) {
    const message = error?.message || String(error)
    if (strict) return { status: 'failed', message }
    logger.warn('无法验证 Webhook 状态')
    return { status: 'warning', message: '无法验证 Webhook 状态' }
  }
}
