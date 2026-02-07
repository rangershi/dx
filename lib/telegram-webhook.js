import { execSync } from 'node:child_process'
import { logger } from './logger.js'
import { envManager } from './env.js'

/**
 * 处理 Telegram Bot 部署后的 Webhook 配置
 */
export async function handleTelegramBotDeploy(environment, projectId, orgId, token) {
  logger.step('配置 Telegram Webhook...')

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
    logger.warn('跳过 Webhook 配置，请手动设置')
    return
  }

  try {
    // 2. 获取 Vercel 部署 URL
    const deploymentUrl = await getLatestDeploymentUrl(projectId, orgId, token, environment)
    if (!deploymentUrl) {
      logger.error('无法获取 Vercel 部署 URL，跳过 Webhook 配置')
      return
    }

    const webhookUrl = `${deploymentUrl}/api/webhook`
    logger.info(`Webhook URL: ${webhookUrl}`)

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
      await verifyWebhook(botToken)
    }
    else {
      logger.error(`Telegram Webhook 设置失败: ${result.description}`)
      logger.info('请手动执行以下命令（不要把明文 token/secret 写进日志）:')
      const manualPayload = JSON.stringify({
        url: webhookUrl,
        secret_token: '<YOUR_WEBHOOK_SECRET>',
        drop_pending_updates: false,
      })
      logger.info(
        `curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" -H "Content-Type: application/json" -d '${manualPayload}' --silent`,
      )
    }
  }
  catch (error) {
    logger.error(`Webhook 配置失败: ${error.message}`)
    logger.warn('请手动设置 Webhook（参考 apps/telegram-bot/README.md）')
  }
}

/**
 * 获取最新部署的 URL
 */
async function getLatestDeploymentUrl(projectId, orgId, token, environment) {
  try {
    const cmd = ['vercel', 'ls', orgId ? `--scope=${orgId}` : '', '--json']
      .filter(Boolean)
      .join(' ')

    const output = execSync(cmd, {
      encoding: 'utf8',
      env: {
        ...process.env,
        // 不通过 CLI args 传递 token，避免出现在错误信息/日志中
        VERCEL_TOKEN: token,
      },
    })
    const deployments = JSON.parse(output)

    // 根据环境筛选部署
    const targetEnv = environment === 'production' ? 'production' : 'preview'
    const latest = deployments.find(d =>
      d.projectId === projectId
      && d.target === targetEnv
      && d.state === 'READY',
    )

    return latest ? `https://${latest.url}` : null
  }
  catch (error) {
    logger.warn(`获取部署 URL 失败: ${error.message}`)
    return null
  }
}

/**
 * 验证 Webhook 配置
 */
async function verifyWebhook(botToken) {
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
    }
  }
  catch (error) {
    logger.warn('无法验证 Webhook 状态')
  }
}
