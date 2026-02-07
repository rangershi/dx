import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function resolveProjectRoot() {
  return process.env.DX_PROJECT_ROOT || process.cwd()
}

export function sanitizeForLog(input) {
  let text = input == null ? '' : String(input)

  // CLI token args (vercel)
  text = text.replace(/--token=("[^"]*"|'[^']*'|[^\s]+)/gi, '--token=***')
  text = text.replace(/--token\s+("[^"]*"|'[^']*'|[^\s]+)/gi, '--token ***')

  // Env style secrets
  text = text.replace(/\bVERCEL_TOKEN=([^\s]+)/g, 'VERCEL_TOKEN=***')
  text = text.replace(/\bTELEGRAM_BOT_TOKEN=([^\s]+)/g, 'TELEGRAM_BOT_TOKEN=***')
  text = text.replace(
    /\bTELEGRAM_BOT_WEBHOOK_SECRET=([^\s]+)/g,
    'TELEGRAM_BOT_WEBHOOK_SECRET=***',
  )

  // Authorization bearer
  text = text.replace(
    /Authorization:\s*Bearer\s+([^\s]+)/gi,
    'Authorization: Bearer ***',
  )

  // JSON-ish token fields
  text = text.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"***"')
  text = text.replace(
    /("secret_token"\s*:\s*")([^"]*)(")/gi,
    '$1***$3',
  )
  text = text.replace(/\bsecret_token=([^\s&]+)/gi, 'secret_token=***')

  // Telegram bot token in URLs
  text = text.replace(
    /api\.telegram\.org\/bot([^/\s]+)(\/|$)/gi,
    'api.telegram.org/bot***$2',
  )

  return text
}

// 处理输出管道被关闭导致的 EPIPE 错误，避免进程在清理阶段崩溃
try {
  const handleBrokenPipe = err => {
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_WRITE_AFTER_END')) {
      // 静默忽略，允许进程优雅退出
      try {
        /* noop */
      } catch {}
    }
  }
  if (process?.stdout?.on) process.stdout.on('error', handleBrokenPipe)
  if (process?.stderr?.on) process.stderr.on('error', handleBrokenPipe)
} catch {
  /* 安全保护，忽略环境不支持的情况 */
}

export class Logger {
  constructor(options = {}) {
    this.logLevel = options.level || 'info'
    this.enableFile = options.enableFile || false
    this.logDir = options.logDir || join(resolveProjectRoot(), 'dx', 'logs')

    if (this.enableFile) {
      this.ensureLogDir()
    }
  }

  // 确保日志目录存在
  ensureLogDir() {
    try {
      mkdirSync(this.logDir, { recursive: true })
    } catch (error) {
      // 目录可能已存在，忽略错误
    }
  }

  // 格式化时间戳
  formatTimestamp() {
    return new Date().toLocaleString('zh-CN')
  }

  // 基础日志方法
  info(message, prefix = '🚀') {
    const safeMessage = sanitizeForLog(message)
    const output = `${prefix} ${safeMessage}`
    console.log(output)
    this.writeLog('info', safeMessage)
  }

  success(message) {
    const safeMessage = sanitizeForLog(message)
    const output = `✅ ${safeMessage}`
    console.log(output)
    this.writeLog('success', safeMessage)
  }

  warn(message) {
    const safeMessage = sanitizeForLog(message)
    const output = `⚠️  ${safeMessage}`
    console.log(output)
    this.writeLog('warn', safeMessage)
  }

  error(message) {
    const safeMessage = sanitizeForLog(message)
    const output = `❌ ${safeMessage}`
    console.log(output)
    this.writeLog('error', safeMessage)
  }

  debug(message) {
    if (this.logLevel === 'debug') {
      const safeMessage = sanitizeForLog(message)
      const output = `🐛 ${safeMessage}`
      console.log(output)
      this.writeLog('debug', safeMessage)
    }
  }

  // 步骤显示
  step(message, stepNumber = null) {
    const prefix = stepNumber ? `步骤 ${stepNumber}:` : '执行:'
    const separator = '=================================='

    const safeMessage = sanitizeForLog(message)

    console.log(`\n${separator}`)
    console.log(`🚀 ${prefix} ${safeMessage}`)
    console.log(separator)

    this.writeLog('step', `${prefix} ${safeMessage}`)
  }

  // 进度显示
  progress(message) {
    const safeMessage = sanitizeForLog(message)
    process.stdout.write(`⌛ ${safeMessage}...`)
    this.writeLog('progress', `开始: ${safeMessage}`)
  }

  progressDone() {
    console.log(' 完成')
    this.writeLog('progress', '完成')
  }

  // 命令执行日志
  command(command) {
    const safeCommand = sanitizeForLog(command)
    console.log(`💻 执行: ${safeCommand}`)
    this.writeLog('command', safeCommand)
  }

  // 分隔符
  separator() {
    console.log(`\n${'='.repeat(50)}`)
  }

  // 表格显示
  table(data, headers = []) {
    if (data.length === 0) return

    if (headers.length > 0) {
      const safeHeaders = headers.map(h => sanitizeForLog(h))
      console.log(`\n${safeHeaders.join('\t')}`)
      console.log('-'.repeat(safeHeaders.join('\t').length))
    }

    data.forEach(row => {
      if (Array.isArray(row)) {
        console.log(row.map(cell => sanitizeForLog(cell)).join('\t'))
      } else {
        console.log(sanitizeForLog(row))
      }
    })
    console.log()
  }

  // 端口信息显示
  ports(portInfo) {
    console.log('\n📡 服务端口信息:')
    portInfo.forEach(({ service, port, url }) => {
      const safeService = sanitizeForLog(service)
      const safeUrl = url ? sanitizeForLog(url) : ''
      console.log(`  ${safeService}: http://localhost:${port} ${safeUrl ? `(${safeUrl})` : ''}`)
    })
    console.log()
  }

  // 写入日志文件
  writeLog(level, message) {
    if (!this.enableFile) return

    try {
      const safeMessage = sanitizeForLog(message)
      const timestamp = this.formatTimestamp()
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${safeMessage}\n`

      const logFile = join(this.logDir, `ai-cli-${new Date().toISOString().split('T')[0]}.log`)
      writeFileSync(logFile, logLine, { flag: 'a', encoding: 'utf8' })
    } catch (error) {
      // 写入日志失败时静默处理，避免影响主流程
    }
  }

  // 创建子日志器
  createChild(prefix) {
    const childLogger = new Logger({
      level: this.logLevel,
      enableFile: this.enableFile,
      logDir: this.logDir,
    })

    // 重写方法以添加前缀
    const originalMethods = ['info', 'success', 'warn', 'error', 'debug']
    originalMethods.forEach(method => {
      const originalMethod = childLogger[method].bind(childLogger)
      childLogger[method] = (message, customPrefix) => {
        const finalPrefix = customPrefix || prefix
        originalMethod(message, finalPrefix)
      }
    })

    return childLogger
  }
}

// 导出默认实例
export const logger = new Logger()

// 导出带文件日志的实例
export const fileLogger = new Logger({ enableFile: true })

// 导出调试日志实例
export const debugLogger = new Logger({ level: 'debug', enableFile: true })
