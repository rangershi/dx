#!/usr/bin/env node

/**
 * PM2 开发服务栈交互式管理器
 * 启动 backend、front、admin 三个服务，并提供交互式命令界面
 *
 * 使用方法：
 *   dx dev stack
 *
 * 可用命令：
 *   r <service>   - 重启服务 (r backend / r front / r admin)
 *   l <service>   - 查看日志 (l backend / l front / l admin)
 *   s <service>   - 停止服务 (s backend / s front / s admin)
 *   list          - 显示服务状态
 *   monit         - 打开实时监控
 *   q / quit      - 停止所有服务并退出
 *   help          - 显示帮助信息
 */

import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import readline from 'node:readline'
import { join } from 'node:path'
import { existsSync, rmSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { logger } from '../../logger.js'

const execPromise = promisify(exec)

class PM2StackManager {
  constructor() {
    this.configPath = join(process.cwd(), 'ecosystem.config.cjs')
    this.services = ['backend', 'front', 'admin']
    this.isRunning = false
  }

  async start() {
    // 检查配置文件
    if (!existsSync(this.configPath)) {
      logger.error('未找到 ecosystem.config.cjs 配置文件')
      logger.info('请确保配置文件存在于项目根目录')
      process.exit(1)
    }

    logger.step('启动 PM2 开发服务栈')

    try {
      // 启动前清理 PM2 状态（确保干净启动）
      await this.preparePM2State()

      // 清理前端缓存
      this.cleanFrontendCache()

      // 启动 PM2 服务
      await this.pm2Start()
      this.isRunning = true

      // 显示初始状态
      await this.showStatus()

      // 启动交互式命令行
      this.startInteractive()
    } catch (error) {
      logger.error('启动失败')
      logger.error(error.message)
      process.exit(1)
    }
  }

  /**
   * 准备 PM2 状态
   * 启动前清理 PM2 状态，确保干净启动
   */
  async preparePM2State() {
    logger.info('正在准备 PM2 环境...')
    await this.fixPM2State()
  }

  /**
   * 清理 PM2 状态
   * 停止守护进程并清理状态文件，确保干净启动
   */
  async fixPM2State() {
    try {
      // 1. 停止 PM2 守护进程
      logger.info('正在停止 PM2 守护进程...')
      try {
        // 先尝试删除所有进程
        try {
          await execPromise('pnpm pm2 delete all', { timeout: 5000 })
        } catch {
          // 忽略删除失败
        }

        // 然后停止守护进程
        await execPromise('pnpm pm2 kill', { timeout: 5000 })
        logger.success('PM2 守护进程已停止')
      } catch (killError) {
        // 如果 kill 失败（可能已经停止），继续执行清理
        logger.info('PM2 守护进程可能已停止')
      }

      // 2. 清理 PM2 状态文件
      logger.info('正在清理 PM2 状态文件...')
      const pm2Home = join(homedir(), '.pm2')
      const stateFiles = ['dump.pm2', 'pm2.log', 'pm2.pid']

      for (const file of stateFiles) {
        const filePath = join(pm2Home, file)
        try {
          if (existsSync(filePath)) {
            rmSync(filePath, { force: true })
            logger.success(`已清理: ${file}`)
          }
        } catch (error) {
          // 忽略清理失败，继续执行
          logger.warn(`清理 ${file} 失败: ${error.message}`)
        }
      }

      // 3. 确保日志目录存在
      const projectRoot = process.cwd()
      const logDir = join(projectRoot, 'logs', 'pm2')
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true })
        logger.success('已创建日志目录')
      }

      logger.success('PM2 环境准备完成')
    } catch (error) {
      logger.warn(`准备 PM2 环境时出现警告: ${error.message}`)
      // 不抛出错误，继续尝试启动
    }
  }

  /**
   * 清理前端缓存
   * 清理 Next.js 用户端和 Vite 管理后台的构建缓存
   * 注意：此方法使用同步文件系统 API，无需 async/await
   */
  cleanFrontendCache() {
    logger.info('正在清理前端缓存...')

    const projectRoot = process.cwd()
    const cachePaths = [
      // Next.js 用户端 (apps/front)
      { path: join(projectRoot, 'apps/front/.next'), type: 'dir', name: 'Next.js 构建缓存' },
      { path: join(projectRoot, 'dist/front'), type: 'dir', name: 'Next.js 构建输出' },
      { path: join(projectRoot, 'apps/front/.eslintcache'), type: 'file', name: 'ESLint 缓存' },
      // Vite 管理后台 (apps/admin-front)
      {
        path: join(projectRoot, 'apps/admin-front/node_modules/.vite'),
        type: 'dir',
        name: 'Vite 开发服务器缓存',
      },
      { path: join(projectRoot, 'dist/admin-front'), type: 'dir', name: '管理后台构建输出' },
      {
        path: join(projectRoot, 'apps/admin-front/.eslintcache'),
        type: 'file',
        name: 'ESLint 缓存',
      },
    ]

    // 清理目录和文件
    for (const { path: cachePath, type, name } of cachePaths) {
      try {
        if (existsSync(cachePath)) {
          if (type === 'dir') {
            rmSync(cachePath, { recursive: true, force: true })
            logger.success(`已清理: ${name}`)
          } else {
            unlinkSync(cachePath)
            logger.success(`已清理: ${name}`)
          }
        }
      } catch (error) {
        logger.warn(`清理 ${name} 失败: ${error.message}`)
      }
    }

    // 清理 TypeScript 构建信息文件 (*.tsbuildinfo)
    const tsBuildInfoPaths = [
      join(projectRoot, 'apps/front'),
      join(projectRoot, 'apps/admin-front'),
    ]

    for (const dirPath of tsBuildInfoPaths) {
      try {
        if (existsSync(dirPath)) {
          const files = readdirSync(dirPath)
          for (const file of files) {
            if (file.endsWith('.tsbuildinfo')) {
              const filePath = join(dirPath, file)
              try {
                unlinkSync(filePath)
                logger.success(`已清理: TypeScript 构建信息 (${file})`)
              } catch (error) {
                logger.warn(`清理 ${file} 失败: ${error.message}`)
              }
            }
          }
        }
      } catch (error) {
        // 忽略目录不存在的错误
      }
    }

    logger.success('前端缓存清理完成')
  }

  async pm2Start() {
    logger.info('正在启动服务...')
    try {
      const { stderr } = await execPromise(`pnpm pm2 start ${this.configPath}`, { timeout: 30000 })
      if (stderr && !stderr.includes('[PM2]')) {
        logger.warn(stderr)
      }
      logger.success('服务启动成功')
    } catch (error) {
      throw new Error(`启动失败: ${error.message || error.stderr || error.stdout || '未知错误'}`)
    }
  }

  async showStatus() {
    try {
      const { stdout } = await execPromise('pnpm pm2 list', { timeout: 5000 })
      console.log(`\n${stdout}`)
    } catch (error) {
      logger.error(`获取状态失败: ${error.message}`)
    }
  }

  async restart(service) {
    if (!this.services.includes(service)) {
      logger.error(`未知服务: ${service}`)
      logger.info(`可用服务: ${this.services.join(', ')}`)
      return
    }

    logger.info(`正在重启 ${service}...`)
    try {
      await execPromise(`pnpm pm2 restart ${service}`)
      logger.success(`${service} 重启成功`)
      await this.showStatus()
    } catch (error) {
      logger.error(`重启失败: ${error.message}`)
    }
  }

  async logs(service) {
    if (!this.services.includes(service)) {
      logger.error(`未知服务: ${service}`)
      logger.info(`可用服务: ${this.services.join(', ')}`)
      return
    }

    logger.info(`查看 ${service} 日志（按 Ctrl+C 返回）...`)
    console.log('')

    // 使用 spawn 以便实时显示日志
    const pm2Logs = spawn('pnpm', ['pm2', 'logs', service], {
      stdio: 'inherit',
    })

    // 等待用户按 Ctrl+C
    await new Promise(resolve => {
      pm2Logs.on('exit', resolve)
    })

    console.log('')
    this.showPrompt()
  }

  async stop(service) {
    if (!this.services.includes(service)) {
      logger.error(`未知服务: ${service}`)
      logger.info(`可用服务: ${this.services.join(', ')}`)
      return
    }

    logger.info(`正在停止 ${service}...`)
    try {
      await execPromise(`pnpm pm2 stop ${service}`)
      logger.success(`${service} 已停止`)
      await this.showStatus()
    } catch (error) {
      logger.error(`停止失败: ${error.message}`)
    }
  }

  async monit() {
    logger.info('启动实时监控（按 Ctrl+C 返回）...')
    console.log('')

    const pm2Monit = spawn('pnpm', ['pm2', 'monit'], {
      stdio: 'inherit',
    })

    await new Promise(resolve => {
      pm2Monit.on('exit', resolve)
    })

    console.log('')
    this.showPrompt()
  }

  async stopAll() {
    logger.info('正在停止所有服务...')
    try {
      await execPromise('pnpm pm2 stop all')
      await execPromise('pnpm pm2 delete all')
      logger.success('所有服务已停止')
      this.isRunning = false
    } catch (error) {
      logger.error(`停止失败: ${error.message}`)
    }
  }

  showHelp() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🚀 服务访问链接：')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('  📦 Backend (后端 API)    → http://localhost:3000')
    console.log('  📦 API 文档 (Swagger)    → http://localhost:3000/doc')
    console.log('  🌐 Front (用户端)        → http://localhost:3001')
    console.log('  ⚙️  Admin (管理后台)     → http://localhost:3500')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('\n📋 可用命令：')
    console.log('  r <service>   - 重启服务 (例: r backend)')
    console.log('  l <service>   - 查看日志 (例: l backend)')
    console.log('  s <service>   - 停止服务 (例: s backend)')
    console.log('  list          - 显示服务状态')
    console.log('  monit         - 打开实时监控')
    console.log('  q / quit      - 停止所有服务并退出')
    console.log('  help          - 显示此帮助信息')
    console.log('\n📦 可用服务: backend, front, admin\n')
  }

  showPrompt() {
    process.stdout.write('dx> ')
  }

  startInteractive() {
    // 自动显示帮助信息和访问链接
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
          if (args[0]) {
            await this.restart(args[0])
          } else {
            logger.error('请指定服务名称，例如: r backend')
          }
          break

        case 'l':
        case 'logs':
          if (args[0]) {
            await this.logs(args[0])
          } else {
            logger.error('请指定服务名称，例如: l backend')
          }
          return // logs 命令会自己处理 prompt

        case 's':
        case 'stop':
          if (args[0]) {
            await this.stop(args[0])
          } else {
            logger.error('请指定服务名称，例如: s backend')
          }
          break

        case 'list':
        case 'ls':
          await this.showStatus()
          break

        case 'monit':
        case 'monitor':
          await this.monit()
          return // monit 命令会自己处理 prompt

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

    // 处理 Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\n')
      await this.stopAll()
      process.exit(0)
    })
  }
}

// 主函数
async function main() {
  const manager = new PM2StackManager()
  await manager.start()
}

main().catch(error => {
  logger.error('启动失败')
  logger.error(error.message)
  process.exit(1)
})
