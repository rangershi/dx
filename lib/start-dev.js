#!/usr/bin/env node

/**
 * 开发环境启动模块
 * 集成原 start-dev.sh 的功能到 Node.js
 * 支持智能端口检测、进程管理和服务启动
 */

import { spawn, exec as nodeExec } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from './logger.js'
import { execManager } from './exec.js'
// removed unused imports: confirmManager, envManager

const execPromise = promisify(nodeExec)

class DevStarter {
  constructor() {
    this.services = [
      {
        name: 'backend',
        command: 'pnpm exec nx dev backend',
        port: 3000,
        healthCheck: 'http://localhost:3000/health',
        description: '后端服务',
      },
      {
        name: 'admin-front',
        command: 'pnpm exec nx dev admin-front',
        port: 3500,
        description: '管理后台前端',
      },
      {
        name: 'front',
        command: 'pnpm exec nx dev front',
        port: 3001,
        description: '用户前端',
        dependsOn: ['backend'],
      },
    ]

    this.runningProcesses = new Map()
    this.setupSignalHandlers()
  }

  // 设置信号处理
  setupSignalHandlers() {
    process.on('SIGINT', () => this.cleanup())
    process.on('SIGTERM', () => this.cleanup())
    process.on('exit', () => this.cleanup())
  }

  // 启动开发环境
  async start(options = {}) {
    try {
      logger.step('开发环境启动脚本')

      // 检查必要命令
      await this.checkCommands()

      // 检查项目根目录
      await this.checkProjectRoot()

      // 步骤 1: 检测并清理端口占用
      await this.cleanupPorts()

      // 步骤 2: 启动后端服务
      await this.startService('backend')

      // 步骤 3: 启动管理后台前端
      await this.startService('admin-front')

      // 步骤 4: 等待后端服务启动完成
      await this.waitForBackend()

      // 步骤 5: 启动用户前端
      await this.startService('front')

      // 显示服务信息
      await this.showServiceInfo()

      // 保持进程运行
      await this.keepAlive()
    } catch (error) {
      logger.error('开发环境启动失败')
      logger.error(error.message)
      await this.cleanup()
      throw error
    }
  }

  // 检查必要命令
  async checkCommands() {
    const commands = ['pnpm', 'lsof', 'curl']

    for (const cmd of commands) {
      try {
        await execPromise(`command -v ${cmd}`)
      } catch (error) {
        throw new Error(`错误: ${cmd} 命令未找到，请确保已安装`)
      }
    }

    logger.success('必要命令检查通过')
  }

  // 检查项目根目录
  async checkProjectRoot() {
    try {
      await execPromise('test -f package.json')
      logger.success('项目根目录检查通过')
    } catch (error) {
      throw new Error('错误: 请在项目根目录运行此脚本')
    }
  }

  // 清理端口占用
  async cleanupPorts() {
    logger.step('检测并清理端口占用')

    const ports = this.services.map(s => s.port)
    await execManager.handlePortConflicts(ports, true)

    logger.success('端口清理完成')
  }

  // 启动单个服务
  async startService(serviceName) {
    const service = this.services.find(s => s.name === serviceName)
    if (!service) {
      throw new Error(`未找到服务配置: ${serviceName}`)
    }

    logger.step(`启动${service.description}`)

    // 检查依赖服务
    if (service.dependsOn) {
      for (const dep of service.dependsOn) {
        if (!this.runningProcesses.has(dep)) {
          throw new Error(`服务 ${serviceName} 依赖的服务 ${dep} 未启动`)
        }
      }
    }

    // 在新终端窗口启动服务
    if (this.shouldUseNewTerminal()) {
      await this.startInNewTerminal(service)
    } else {
      // 后台启动
      await this.startInBackground(service)
    }

    logger.success(`${service.description}启动命令已发送`)
  }

  // 判断是否应该使用新终端
  shouldUseNewTerminal() {
    // 如果是 CI 环境或者没有图形界面，使用后台模式
    return !process.env.CI && !process.env.GITHUB_ACTIONS && process.env.DISPLAY !== undefined
  }

  // 在新终端窗口启动
  async startInNewTerminal(service) {
    const title = service.description
    const command = service.command
    const currentDir = process.cwd()

    if (process.platform === 'darwin') {
      // macOS
      const script = `cd "${currentDir}" && echo "${title}" && ${command}`
      spawn('osascript', ['-e', `tell app "Terminal" to do script "${script}"`], { detached: true })
    } else if (process.platform === 'linux') {
      // Linux
      try {
        // 尝试使用 gnome-terminal
        spawn(
          'gnome-terminal',
          [
            '--title',
            title,
            '--',
            'bash',
            '-c',
            `cd "${currentDir}" && echo "${title}" && ${command}; exec bash`,
          ],
          { detached: true },
        )
      } catch (error) {
        try {
          // 尝试使用 xterm
          spawn(
            'xterm',
            [
              '-title',
              title,
              '-e',
              `bash -c "cd '${currentDir}' && echo '${title}' && ${command}; exec bash"`,
            ],
            { detached: true },
          )
        } catch (error2) {
          logger.warn(`未找到合适的终端，使用后台运行: ${command}`)
          await this.startInBackground(service)
        }
      }
    } else {
      logger.warn(`不支持的操作系统，使用后台运行: ${command}`)
      await this.startInBackground(service)
    }

    // 记录服务为已启动
    this.runningProcesses.set(service.name, {
      service,
      startTime: Date.now(),
      method: 'terminal',
    })
  }

  // 在后台启动
  async startInBackground(service) {
    const childProcess = spawn('bash', ['-c', service.command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    // 记录进程
    this.runningProcesses.set(service.name, {
      service,
      process: childProcess,
      startTime: Date.now(),
      method: 'background',
    })

    // 处理进程输出
    if (childProcess.stdout) {
      childProcess.stdout.on('data', data => {
        console.log(`[${service.name}] ${data.toString()}`)
      })
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', data => {
        console.error(`[${service.name}] ${data.toString()}`)
      })
    }

    childProcess.on('exit', code => {
      if (code !== 0) {
        logger.error(`${service.description} 异常退出，退出码: ${code}`)
      }
      this.runningProcesses.delete(service.name)
    })

    logger.info(`${service.description} 在后台启动，PID: ${childProcess.pid}`)
  }

  // 等待后端服务启动
  async waitForBackend() {
    logger.step('等待后端服务启动完成')

    const backend = this.services.find(s => s.name === 'backend')
    if (!backend || !backend.healthCheck) {
      logger.warn('后端服务未配置健康检查，跳过等待')
      return
    }

    const maxAttempts = 60 // 60次尝试，每次2秒 = 120秒
    let attempt = 0

    logger.progress('检查后端服务')

    while (attempt < maxAttempts) {
      try {
        await execPromise(`curl -s ${backend.healthCheck}`)
        logger.progressDone()
        logger.success('后端服务已启动成功!')
        return true
      } catch (error) {
        attempt++
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          process.stdout.write('.')
        }
      }
    }

    logger.progressDone()
    throw new Error('后端服务启动超时，请检查日志')
  }

  // 显示服务信息
  async showServiceInfo() {
    logger.step('所有服务启动完成')

    const serviceInfo = [
      { service: '后端服务', port: 3000, url: 'http://localhost:3000' },
      { service: '管理后台', port: 3500, url: 'http://localhost:3500' },
      { service: '用户前端', port: 3001, url: 'http://localhost:3001' },
    ]

    logger.ports(serviceInfo)

    logger.info('注意事项:')
    logger.info('- front 固定 3001，admin-front 固定 3500')
    logger.info('- 若端口被占用，脚本会自动清理后再启动')
    logger.info('- 按 Ctrl+C 可以停止所有服务')
  }

  // 保持进程运行
  async keepAlive() {
    logger.info('\n开发环境已启动，按 Ctrl+C 停止所有服务...\n')

    // 监控后台进程
    setInterval(() => {
      this.checkBackgroundProcesses()
    }, 10000) // 每10秒检查一次

    // 保持主进程运行
    return new Promise(() => {
      // 这个 Promise 永不 resolve，保持进程运行
    })
  }

  // 检查后台进程状态
  checkBackgroundProcesses() {
    for (const [name, info] of this.runningProcesses) {
      if (info.method === 'background' && info.process) {
        if (info.process.killed) {
          logger.warn(`检测到 ${name} 服务进程已停止`)
          this.runningProcesses.delete(name)
        }
      }
    }
  }

  // 获取运行状态
  getStatus() {
    const status = {
      running: this.runningProcesses.size,
      services: [],
    }

    for (const [name, info] of this.runningProcesses) {
      status.services.push({
        name,
        description: info.service.description,
        port: info.service.port,
        method: info.method,
        uptime: Math.round((Date.now() - info.startTime) / 1000),
        pid: info.process ? info.process.pid : 'N/A',
      })
    }

    return status
  }

  // 清理资源
  async cleanup() {
    if (this.runningProcesses.size === 0) return

    logger.info('正在清理开发服务...')

    for (const [name, info] of this.runningProcesses) {
      if (info.method === 'background' && info.process) {
        try {
          logger.info(`停止 ${name} 服务 (PID: ${info.process.pid})`)
          info.process.kill('SIGTERM')

          // 如果 5 秒后还没停止，强制杀死
          setTimeout(() => {
            if (!info.process.killed) {
              info.process.kill('SIGKILL')
            }
          }, 5000)
        } catch (error) {
          logger.debug(`清理 ${name} 时出错: ${error.message}`)
        }
      }
    }

    this.runningProcesses.clear()
    logger.info('清理完成')
  }
}

export async function runStartDev(argv = []) {
  void argv
  const starter = new DevStarter()
  await starter.start()
}

// 如果直接执行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  runStartDev(process.argv.slice(2)).catch(error => {
    logger.error('开发环境启动失败')
    console.error(error)
    process.exit(1)
  })
}

export { DevStarter }
