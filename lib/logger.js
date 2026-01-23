import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function resolveProjectRoot() {
  return process.env.DX_PROJECT_ROOT || process.cwd()
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
    const output = `${prefix} ${message}`
    console.log(output)
    this.writeLog('info', message)
  }

  success(message) {
    const output = `✅ ${message}`
    console.log(output)
    this.writeLog('success', message)
  }

  warn(message) {
    const output = `⚠️  ${message}`
    console.log(output)
    this.writeLog('warn', message)
  }

  error(message) {
    const output = `❌ ${message}`
    console.log(output)
    this.writeLog('error', message)
  }

  debug(message) {
    if (this.logLevel === 'debug') {
      const output = `🐛 ${message}`
      console.log(output)
      this.writeLog('debug', message)
    }
  }

  // 步骤显示
  step(message, stepNumber = null) {
    const prefix = stepNumber ? `步骤 ${stepNumber}:` : '执行:'
    const separator = '=================================='

    console.log(`\n${separator}`)
    console.log(`🚀 ${prefix} ${message}`)
    console.log(separator)

    this.writeLog('step', `${prefix} ${message}`)
  }

  // 进度显示
  progress(message) {
    process.stdout.write(`⌛ ${message}...`)
    this.writeLog('progress', `开始: ${message}`)
  }

  progressDone() {
    console.log(' 完成')
    this.writeLog('progress', '完成')
  }

  // 命令执行日志
  command(command) {
    console.log(`💻 执行: ${command}`)
    this.writeLog('command', command)
  }

  // 分隔符
  separator() {
    console.log(`\n${'='.repeat(50)}`)
  }

  // 表格显示
  table(data, headers = []) {
    if (data.length === 0) return

    if (headers.length > 0) {
      console.log(`\n${headers.join('\t')}`)
      console.log('-'.repeat(headers.join('\t').length))
    }

    data.forEach(row => {
      if (Array.isArray(row)) {
        console.log(row.join('\t'))
      } else {
        console.log(row)
      }
    })
    console.log()
  }

  // 端口信息显示
  ports(portInfo) {
    console.log('\n📡 服务端口信息:')
    portInfo.forEach(({ service, port, url }) => {
      console.log(`  ${service}: http://localhost:${port} ${url ? `(${url})` : ''}`)
    })
    console.log()
  }

  // 写入日志文件
  writeLog(level, message) {
    if (!this.enableFile) return

    try {
      const timestamp = this.formatTimestamp()
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`

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
