import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import readline from 'node:readline'
import { isAbsolute, join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { logger } from '../../logger.js'
import { execManager } from '../../exec.js'

const execPromise = promisify(exec)

const DEFAULT_SERVICES = ['backend', 'front', 'admin']
const DEFAULT_PRE_FLIGHT = {
  pm2Reset: true,
  killPorts: [3000, 3001, 3500],
  forcePortCleanup: true,
  cleanPaths: [
    'apps/front/.next',
    'dist/front',
    'apps/front/.eslintcache',
    'apps/admin-front/node_modules/.vite',
    'dist/admin-front',
    'apps/admin-front/.eslintcache',
  ],
  cleanTsBuildInfo: true,
  cleanTsBuildInfoDirs: ['apps/front', 'apps/admin-front'],
}

class PM2StackManager {
  constructor(options = {}) {
    this.projectRoot = process.cwd()
    this.pm2Bin = String(options.pm2Bin || 'pnpm pm2').trim()

    const ecosystemConfig = options.ecosystemConfig || 'ecosystem.config.cjs'
    this.configPath = this.resolvePath(ecosystemConfig)

    this.services = Array.isArray(options.services) && options.services.length > 0
      ? options.services.map(item => String(item).trim()).filter(Boolean)
      : [...DEFAULT_SERVICES]

    this.urls = options.urls && typeof options.urls === 'object' ? options.urls : {}

    const incomingPreflight = options.preflight && typeof options.preflight === 'object'
      ? options.preflight
      : {}

    this.preflight = {
      pm2Reset: incomingPreflight.pm2Reset ?? DEFAULT_PRE_FLIGHT.pm2Reset,
      killPorts: this.normalizePorts(incomingPreflight.killPorts, DEFAULT_PRE_FLIGHT.killPorts),
      forcePortCleanup:
        incomingPreflight.forcePortCleanup ?? DEFAULT_PRE_FLIGHT.forcePortCleanup,
      cleanPaths: this.normalizeStringArray(
        incomingPreflight.cleanPaths,
        DEFAULT_PRE_FLIGHT.cleanPaths,
      ),
      cleanTsBuildInfo:
        incomingPreflight.cleanTsBuildInfo ?? DEFAULT_PRE_FLIGHT.cleanTsBuildInfo,
      cleanTsBuildInfoDirs: this.normalizeStringArray(
        incomingPreflight.cleanTsBuildInfoDirs,
        DEFAULT_PRE_FLIGHT.cleanTsBuildInfoDirs,
      ),
    }

    this.isRunning = false
  }

  resolvePath(targetPath) {
    if (isAbsolute(targetPath)) return targetPath
    return join(this.projectRoot, targetPath)
  }

  normalizePorts(input, fallback) {
    const source = Array.isArray(input) ? input : fallback
    return source
      .map(port => Number(port))
      .filter(port => Number.isFinite(port) && port > 0)
  }

  normalizeStringArray(input, fallback) {
    const source = Array.isArray(input) ? input : fallback
    return source.map(item => String(item).trim()).filter(Boolean)
  }

  async start() {
    if (!existsSync(this.configPath)) {
      logger.error(`未找到 PM2 配置文件: ${this.configPath}`)
      logger.info('请在 commands.json 的 start.stack.stack.ecosystemConfig 中配置正确路径')
      throw new Error('PM2 配置文件不存在')
    }

    logger.step('启动 PM2 交互式服务栈')

    await this.prepareBeforeStart()
    await this.pm2Start()
    this.isRunning = true
    await this.showStatus()
    this.startInteractive()
  }

  async prepareBeforeStart() {
    logger.info('正在执行 stack 启动前检查...')

    if (this.preflight.pm2Reset) {
      await this.resetPm2State()
    }

    if (this.preflight.killPorts.length > 0) {
      logger.info(`正在清理端口占用: ${this.preflight.killPorts.join(', ')}`)
      await execManager.handlePortConflicts(
        this.preflight.killPorts,
        Boolean(this.preflight.forcePortCleanup),
      )
    }

    this.cleanConfiguredPaths()

    if (this.preflight.cleanTsBuildInfo) {
      this.cleanTsBuildInfoFiles()
    }
  }

  async resetPm2State() {
    logger.info('正在重置 PM2 状态...')

    try {
      try {
        await this.pm2Exec('delete all', { timeout: 5000 })
      } catch {
        // ignore
      }

      await this.pm2Exec('kill', { timeout: 5000 })
      logger.success('PM2 守护进程已停止')
    } catch {
      logger.info('PM2 守护进程可能已停止')
    }

    const pm2Home = join(homedir(), '.pm2')
    const stateFiles = ['dump.pm2', 'pm2.log', 'pm2.pid']

    for (const file of stateFiles) {
      const filePath = join(pm2Home, file)
      try {
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true })
          logger.success(`已清理 PM2 文件: ${file}`)
        }
      } catch (error) {
        logger.warn(`清理 PM2 文件失败 (${file}): ${error.message}`)
      }
    }

    const logDir = join(this.projectRoot, 'logs', 'pm2')
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
      logger.success('已创建 PM2 日志目录')
    }
  }

  cleanConfiguredPaths() {
    if (this.preflight.cleanPaths.length === 0) return

    logger.info('正在清理缓存路径...')

    for (const rawPath of this.preflight.cleanPaths) {
      const targetPath = this.resolvePath(rawPath)
      try {
        if (existsSync(targetPath)) {
          rmSync(targetPath, { recursive: true, force: true })
          logger.success(`已清理: ${rawPath}`)
        }
      } catch (error) {
        logger.warn(`清理失败 (${rawPath}): ${error.message}`)
      }
    }
  }

  cleanTsBuildInfoFiles() {
    if (this.preflight.cleanTsBuildInfoDirs.length === 0) return

    logger.info('正在清理 TypeScript 构建缓存...')

    for (const rawDirPath of this.preflight.cleanTsBuildInfoDirs) {
      const dirPath = this.resolvePath(rawDirPath)
      if (!existsSync(dirPath)) continue

      try {
        const files = readdirSync(dirPath)
        for (const file of files) {
          if (!file.endsWith('.tsbuildinfo')) continue
          const filePath = join(dirPath, file)
          try {
            unlinkSync(filePath)
            logger.success(`已清理: ${join(rawDirPath, file)}`)
          } catch (error) {
            logger.warn(`清理失败 (${join(rawDirPath, file)}): ${error.message}`)
          }
        }
      } catch (error) {
        logger.warn(`读取目录失败 (${rawDirPath}): ${error.message}`)
      }
    }
  }

  async pm2Exec(args, options = {}) {
    return execPromise(`${this.pm2Bin} ${args}`, options)
  }

  async pm2Start() {
    logger.info('正在启动 PM2 服务...')
    const { stderr } = await this.pm2Exec(`start "${this.configPath}"`, { timeout: 30000 })
    if (stderr && !stderr.includes('[PM2]')) {
      logger.warn(stderr)
    }
    logger.success('服务启动成功')
    this.printServiceUrls()
  }

  printServiceUrls() {
    const entries = Object.entries(this.urls)
    if (entries.length === 0) return

    console.log('')
    logger.info('服务访问链接:')
    for (const [service, url] of entries) {
      console.log(`  ${service.padEnd(12)} → ${url}`)
    }
    console.log('')
  }

  async showStatus() {
    try {
      const { stdout } = await this.pm2Exec('list', { timeout: 5000 })
      console.log(`\n${stdout}`)
    } catch (error) {
      logger.error(`获取状态失败: ${error.message}`)
    }
  }

  ensureKnownService(service) {
    if (this.services.includes(service)) return true
    logger.error(`未知服务: ${service}`)
    logger.info(`可用服务: ${this.services.join(', ')}`)
    return false
  }

  async restart(service) {
    if (!this.ensureKnownService(service)) return

    logger.info(`正在重启 ${service}...`)
    try {
      await this.pm2Exec(`restart ${service}`)
      logger.success(`${service} 重启成功`)
      await this.showStatus()
    } catch (error) {
      logger.error(`重启失败: ${error.message}`)
    }
  }

  async logs(service) {
    if (!this.ensureKnownService(service)) return

    logger.info(`查看 ${service} 日志（按 Ctrl+C 返回）...`)
    console.log('')

    const pm2Logs = spawn('bash', ['-lc', `${this.pm2Bin} logs ${service}`], {
      stdio: 'inherit',
    })

    await new Promise(resolve => {
      pm2Logs.on('exit', resolve)
    })

    console.log('')
    this.showPrompt()
  }

  async stop(service) {
    if (!this.ensureKnownService(service)) return

    logger.info(`正在停止 ${service}...`)
    try {
      await this.pm2Exec(`stop ${service}`)
      logger.success(`${service} 停止成功`)
      await this.showStatus()
    } catch (error) {
      logger.error(`停止失败: ${error.message}`)
    }
  }

  async monit() {
    logger.info('打开 PM2 实时监控（按 q 退出）...')
    console.log('')

    const pm2Monit = spawn('bash', ['-lc', `${this.pm2Bin} monit`], {
      stdio: 'inherit',
    })

    await new Promise(resolve => {
      pm2Monit.on('exit', resolve)
    })

    console.log('')
    this.showPrompt()
  }

  async stopAll() {
    if (!this.isRunning) return

    logger.step('正在停止所有服务...')
    try {
      await this.pm2Exec('stop all')
      await this.pm2Exec('delete all')
      logger.success('所有服务已停止')
      this.isRunning = false
    } catch (error) {
      logger.error(`停止服务失败: ${error.message}`)
    }
  }

  showHelp() {
    console.log('\n可用命令:')
    console.log('  r <service>   - 重启服务')
    console.log('  l <service>   - 查看日志')
    console.log('  s <service>   - 停止服务')
    console.log('  list          - 显示服务状态')
    console.log('  monit         - 打开实时监控')
    console.log('  q / quit      - 停止所有服务并退出')
    console.log('  help          - 显示此帮助信息')
    console.log(`\n可用服务: ${this.services.join(', ')}\n`)
  }

  showPrompt() {
    process.stdout.write('dx> ')
  }

  startInteractive() {
    this.showHelp()
    this.showPrompt()

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    })

    rl.on('line', async line => {
      const input = line.trim()
      if (!input) {
        this.showPrompt()
        return
      }

      const [cmd, ...args] = input.split(/\s+/)

      switch (cmd.toLowerCase()) {
        case 'r':
        case 'restart':
          if (args[0]) await this.restart(args[0])
          else logger.error('请指定服务名称，例如: r backend')
          break

        case 'l':
        case 'logs':
          if (args[0]) await this.logs(args[0])
          else logger.error('请指定服务名称，例如: l backend')
          return

        case 's':
        case 'stop':
          if (args[0]) await this.stop(args[0])
          else logger.error('请指定服务名称，例如: s backend')
          break

        case 'list':
        case 'ls':
          await this.showStatus()
          break

        case 'monit':
        case 'monitor':
          await this.monit()
          return

        case 'q':
        case 'quit':
        case 'exit':
          await this.stopAll()
          rl.close()
          process.exit(0)
          return

        case 'help':
        case 'h':
        case '?':
          this.showHelp()
          break

        default:
          logger.warn(`未知命令: ${cmd}`)
          logger.info('输入 help 查看可用命令')
          break
      }

      this.showPrompt()
    })

    rl.on('close', async () => {
      if (this.isRunning) {
        console.log('\n')
        await this.stopAll()
      }
      process.exit(0)
    })

    process.on('SIGINT', async () => {
      console.log('\n')
      await this.stopAll()
      process.exit(0)
    })
  }
}

export async function runPm2Stack(options = {}) {
  const manager = new PM2StackManager(options)
  await manager.start()
}
