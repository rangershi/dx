import { spawn, exec as nodeExec } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from './logger.js'
import { envManager } from './env.js'
import { validateEnvironment } from './validate-env.js'
import {
  loadEnvPolicy,
  resolvePolicyTargetId,
  resolveTargetRequiredVars,
} from './env-policy.js'
import { confirmManager } from './confirm.js'

const execPromise = promisify(nodeExec)

export class ExecManager {
  constructor() {
    this.runningProcesses = new Map()
    this.processCounter = 0
    this.setupSignalHandlers()
  }

  // 设置信号处理
  setupSignalHandlers() {
    const safeCleanup = () => {
      try {
        this.cleanup()
      } catch {
        // 忽略清理中的错误，避免影响主进程退出
      }
    }
    process.on('SIGINT', safeCleanup)
    process.on('SIGTERM', safeCleanup)
    process.on('exit', safeCleanup)
  }

  // 执行单个命令
  async executeCommand(command, options = {}) {
    const {
      app,
      flags = {},
      cwd,
      stdio = 'inherit',
      env: extraEnv = {},
      timeout = 0,
      retries = 0,
      ports = [],
      skipEnvValidation = false,
      forcePortCleanup = false,
    } = options

    // 在执行前同步环境，确保 Nx/构建工具拿到规范的 NODE_ENV
    if (process.env.APP_ENV && !process.env.NODE_ENV) {
      envManager.syncEnvironments(process.env.APP_ENV)
    }

    const isVercelEnv = String(process.env.VERCEL || '').toLowerCase() === '1'
    const skipValidation =
      skipEnvValidation ||
      Boolean(flags?.noEnvCheck) ||
      String(process.env.AI_SKIP_ENV_CHECK || '').toLowerCase() === 'true' ||
      isVercelEnv

    // 检测环境（用于 dotenv 层选择）
    const environment = envManager.detectEnvironment(flags)
    logger.debug(`执行环境: ${environment}`)

    let layeredEnv = {}
    if (!skipValidation) {
      validateEnvironment()
      layeredEnv = envManager.collectEnvFromLayers(app, environment)
      if (envManager.latestEnvWarnings && envManager.latestEnvWarnings.length > 0) {
        envManager.latestEnvWarnings.forEach(message => {
          logger.warn(message)
        })
      }

       const effectiveEnv = { ...process.env, ...layeredEnv }
       const isCI = process.env.CI === '1'

       const policy = loadEnvPolicy(envManager.configDir)
       let requiredVars = []

       if (!isCI && app) {
         const targetId = resolvePolicyTargetId(policy, app)
         if (!targetId) {
           throw new Error(
             `未找到 app 对应的 target 配置: app=${app}\n请在 dx/config/env-policy.jsonc 中配置 appToTarget.${app}`,
           )
         }
         requiredVars = resolveTargetRequiredVars(policy, targetId, environment)
       }

       if (requiredVars.length > 0) {
         const { valid, missing, placeholders } = envManager.validateRequiredVars(
           requiredVars,
           effectiveEnv,
         )
        if (!valid) {
          const problems = ['环境变量校验未通过']
          if (missing.length > 0) {
            problems.push(`缺少必填环境变量: ${missing.join(', ')}`)
          }
          if (placeholders.length > 0) {
            problems.push(`以下环境变量仍为占位值或空串: ${placeholders.join(', ')}`)
          }
          if (missing.length > 0 || placeholders.length > 0) {
            problems.push(`请在 .env.${environment} / .env.${environment}.local 中补齐配置`)
          }
          throw new Error(problems.join('\n'))
        }
      }
    } else if (app) {
      // 即便跳过校验，对于需要应用层的命令仍保留层级加载能力
      layeredEnv = envManager.collectEnvFromLayers(app, environment)
    }

    // 处理端口冲突（开发服务自动清理，无需交互）
    const autoSkipPortCleanup = this.isDevServerCommandString(command)
    if (ports.length > 0) {
      await this.handlePortConflicts(ports, flags.Y || autoSkipPortCleanup || forcePortCleanup)
    }

    // 在构建完整命令前判断是否为构建命令
    // 构建类命令需要确保 NODE_ENV 为 production，且不允许 .env 覆盖该变量
    // 识别构建类命令（包括 Nx 构建）以便：
    // 1) 对 dotenv 传参时不使用 --override（避免覆盖我们显式传入的 NODE_ENV）
    // 2) 在 spawn 时将 NODE_ENV 强制为 production
    const isBuildCmdForWrapping =
      /(?:^|\s)(?:pnpm|npm|yarn)\b.+\brun\s+build\b/.test(command) ||
      /\bnext\s+build\b/.test(command) ||
      // Nx 常见构建形式：nx build <proj> / nx run <proj>:build / nx run-many -t build
      /\bnx\s+build\b/.test(command) ||
      /\bnx\s+run\s+[^\s:]+:build\b/.test(command) ||
      /\bnx\s+run-many\b[\s\S]*?(?:-t|--target)\s+build\b/.test(command)

    // 构建完整命令
    let fullCommand = command
    if (app) {
      const resolvedLayers = envManager.getResolvedEnvLayers(app, environment)
      if (resolvedLayers.length > 0) {
        const layerSummary = resolvedLayers.join(' -> ')
        const envLabel = `${app}@${environment}`
        logger.info(`dotenv层 ${envLabel}: ${layerSummary}`, '🌱')
      }

      const envFlags = envManager.buildEnvFlags(app, environment)
      if (envFlags) {
        // 对 build 命令禁用 dotenv 的 --override，避免覆盖我们显式传入的 NODE_ENV
        const overrideFlag = isBuildCmdForWrapping ? '' : '--override'
        const space = overrideFlag ? ' ' : ''
        fullCommand = `pnpm exec dotenv ${overrideFlag}${space}${envFlags} -- ${command}`
      }
    }

    logger.command(fullCommand)

    // 执行命令（可能重试）
    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info(`重试第 ${attempt} 次...`)
        }

        // next build 必须在 NODE_ENV=production 下运行；
        // 但我们仍然按 environment 加载 .env.* 层（通过 dotenv flags 已处理）
        const isBuildCommand =
          /(?:^|\s)(?:pnpm|npm|yarn)\b.+\brun\s+build\b/.test(fullCommand) ||
          /\bnext\s+build\b/.test(fullCommand) ||
          /\bnx\s+build\b/.test(fullCommand) ||
          /\bnx\s+run\s+[^\s:]+:build\b/.test(fullCommand) ||
          /\bnx\s+run-many\b[\s\S]*?(?:-t|--target)\s+build\b/.test(fullCommand)
        const isDevServerCommand = /\b(?:next\s+dev|run\s+start:dev|start:dev)\b/.test(fullCommand)
        const baseNodeEnv = envManager.mapAppEnvToNodeEnv(process.env.APP_ENV || environment)
        const nodeEnvForProcess = isBuildCommand
          ? 'production'
          : isDevServerCommand
            ? 'development'
            : baseNodeEnv

        // 在 CI/非交互/生产层或构建命令下，强制使用轮询以避免 inotify 限制（无需 root）
        const nonInteractive =
          !(process.stdout && process.stdout.isTTY) || !(process.stdin && process.stdin.isTTY)
        const inCI =
          String(process.env.CI || '').toLowerCase() === 'true' ||
          String(process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true'
        const isProdLayer =
          ['production', 'staging'].includes(String(environment).toLowerCase()) ||
          !!flags.prod ||
          !!flags.production ||
          !!flags.staging
        const shouldForcePolling = isBuildCommand || inCI || nonInteractive || isProdLayer

        const forcedEnv = {}
        if (shouldForcePolling) {
          if (process.env.NX_DAEMON === undefined && extraEnv.NX_DAEMON === undefined)
            forcedEnv.NX_DAEMON = 'false'
          if (
            process.env.CHOKIDAR_USEPOLLING === undefined &&
            extraEnv.CHOKIDAR_USEPOLLING === undefined
          )
            forcedEnv.CHOKIDAR_USEPOLLING = '1'
          if (
            process.env.WATCHPACK_POLLING === undefined &&
            extraEnv.WATCHPACK_POLLING === undefined
          )
            forcedEnv.WATCHPACK_POLLING = 'true'
          if (
            process.env.CHOKIDAR_INTERVAL === undefined &&
            extraEnv.CHOKIDAR_INTERVAL === undefined
          )
            forcedEnv.CHOKIDAR_INTERVAL = '1000'

          const forcedPairs = Object.entries(forcedEnv)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')
          if (forcedPairs) {
            logger.info(`已启用轮询模式: ${forcedPairs}`)
          }
        }

        const result = await this.spawnCommand(fullCommand, {
          cwd: cwd || process.cwd(),
          stdio,
          env: {
            ...process.env,
            NODE_ENV: nodeEnvForProcess,
            ...forcedEnv,
            ...extraEnv,
          },
          timeout,
        })

        logger.success(`命令执行成功: ${command}`)
        return result
      } catch (error) {
        lastError = error

        // 尝试智能错误修复
        const fixApplied = await this.tryAutoFix(error, {
          command,
          app,
          environment,
          ports,
          skipConfirm: flags.Y || autoSkipPortCleanup || forcePortCleanup,
        })

        if (fixApplied && attempt < retries) {
          continue // 重试
        }

        if (attempt === retries) {
          logger.error(`命令执行失败 (${attempt + 1}/${retries + 1} 次尝试): ${command}`)
          throw error
        }
      }
    }

    throw lastError
  }

  // Spawn 命令
  async spawnCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      const processId = ++this.processCounter

      // 强制默认使用独立的 stdio 配置，防止在父进程管道关闭时向已关闭的管道写入
      const spawnOptions = {
        stdio: options.stdio ?? 'inherit',
        cwd: options.cwd,
        env: options.env,
        detached: options.detached ?? false,
        timeout: options.timeout,
      }
      const childProcess = spawn('bash', ['-c', command], spawnOptions)
      this.runningProcesses.set(processId, {
        process: childProcess,
        command,
        startTime: Date.now(),
      })

      // 超时处理
      let timeoutId = null
      let isKilled = false
      if (options.timeout > 0) {
        timeoutId = setTimeout(() => {
          isKilled = true
          childProcess.kill('SIGTERM')
          // 给进程一些时间优雅退出
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL')
            }
          }, 2000)
          reject(new Error(`命令执行超时 (${options.timeout}ms): ${command}`))
        }, options.timeout)
      }

      childProcess.on('exit', code => {
        if (timeoutId) clearTimeout(timeoutId)
        this.runningProcesses.delete(processId)

        if (isKilled) return // 已经被超时处理了

        if (code === 0) {
          resolve({ success: true, code, processId })
        } else {
          reject(new Error(`进程退出码: ${code}`))
        }
      })

      childProcess.on('error', error => {
        if (timeoutId) clearTimeout(timeoutId)
        this.runningProcesses.delete(processId)
        // 忽略 EPIPE/ERR_STREAM_WRITE_AFTER_END 错误，避免清理阶段卡住
        const code = error?.code
        if (code === 'EPIPE' || code === 'ERR_STREAM_WRITE_AFTER_END') {
          return resolve({ success: true, code: 0, processId })
        }
        reject(error)
      })
    })
  }

  // 并发执行命令
  async executeConcurrent(commands, options = {}) {
    logger.step('并发执行多个命令')

    const processes = commands.map((cmd, index) => {
      const cmdOptions = typeof cmd === 'string' ? { ...options } : { ...options, ...cmd.options }

      const command = typeof cmd === 'string' ? cmd : cmd.command

      logger.info(`启动进程 ${index + 1}: ${command}`)

      return this.executeCommand(command, cmdOptions).catch(error => ({
        error,
        command,
        index,
      }))
    })

    const results = await Promise.allSettled(processes)

    // 分析结果
    const successful = results.filter(r => r.status === 'fulfilled' && !r.value.error)
    const failed = results.filter(r => r.status === 'rejected' || r.value?.error)

    logger.info(`并发执行完成: ${successful.length} 成功, ${failed.length} 失败`)

    if (failed.length > 0) {
      logger.error('失败的命令:')
      failed.forEach((failure, index) => {
        const cmd = commands[failure.value?.index || index]
        const command = typeof cmd === 'string' ? cmd : cmd.command
        logger.error(`  - ${command}`)
      })
    }

    return { results, successful: successful.length, failed: failed.length }
  }

  // 顺序执行命令
  async executeSequential(commands, options = {}) {
    logger.step('顺序执行多个命令')

    const results = []

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]
      const cmdOptions = typeof cmd === 'string' ? { ...options } : { ...options, ...cmd.options }

      const command = typeof cmd === 'string' ? cmd : cmd.command

      logger.info(`执行命令 ${i + 1}/${commands.length}: ${command}`)

      try {
        const result = await this.executeCommand(command, cmdOptions)
        results.push({ success: true, result, command, index: i })
      } catch (error) {
        logger.error(`命令 ${i + 1} 执行失败，停止后续执行`)
        results.push({ success: false, error, command, index: i })

        // 顺序执行遇到错误时停止
        if (!options.continueOnError) {
          throw error
        }
      }
    }

    const successful = results.filter(r => r.success).length
    const failed = results.length - successful

    logger.info(`顺序执行完成: ${successful} 成功, ${failed} 失败`)
    return { results, successful, failed }
  }

  // 端口冲突处理
  async handlePortConflicts(ports, skipConfirm = false) {
    for (const port of ports) {
      try {
        const processes = await this.getPortProcesses(port)
        if (processes.length > 0) {
          const shouldKill = await confirmManager.confirmPortCleanup(port, processes, skipConfirm)

          if (shouldKill) {
            await this.killPortProcesses(port)
            logger.success(`端口 ${port} 已清理`)

            // 等待端口释放
            await this.waitForPortFree(port)
          } else {
            logger.warn(`跳过端口 ${port} 清理，可能会导致启动失败`)
          }
        }
      } catch (error) {
        logger.warn(`检查端口 ${port} 时出错: ${error.message}`)
      }
    }
  }

  // 获取占用端口的进程
  async getPortProcesses(port) {
    try {
      const { stdout } = await execPromise(`lsof -t -i:${port}`)
      return stdout.trim() ? stdout.trim().split('\n') : []
    } catch (error) {
      return []
    }
  }

  // 杀死端口进程
  async killPortProcesses(port) {
    try {
      const { stdout } = await execPromise(`lsof -t -i:${port}`)
      const pids = stdout
        .trim()
        .split('\n')
        .filter(pid => pid)

      if (pids.length > 0) {
        logger.info(`开发环境清理（不会在 CI/生产执行）: kill -9 ${pids.join(', ')}`)
        await execPromise(`kill -9 ${pids.join(' ')}`)
      }

      // 额外清理：若为后端端口 3000，同时尝试终止可能存活的 nodemon 后台进程
      if (Number(port) === 3000) {
        try {
          logger.info('开发环境扩展清理: pkill -f "nodemon.*backend"')
          await execPromise('pkill -f "nodemon.*backend" || true')
        } catch (extraError) {
          // 忽略该步骤失败，以免影响主流程
          logger.debug(`扩展清理（pkill nodemon backend）时出错: ${extraError.message}`)
        }
      }

      if (pids.length > 0) {
        return { killed: true, pids }
      }
    } catch (error) {
      logger.debug(`杀死端口 ${port} 进程时出错: ${error.message}`)
    }
    return { killed: false, pids: [] }
  }

  // 等待端口释放
  async waitForPortFree(port, maxWait = 10000) {
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
      const processes = await this.getPortProcesses(port)
      if (processes.length === 0) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    throw new Error(`端口 ${port} 未能在 ${maxWait}ms 内释放`)
  }

  // 等待端口就绪
  async waitForPort(port, maxWait = 60000) {
    logger.progress(`等待端口 ${port} 就绪`)

    const startTime = Date.now()
    while (Date.now() - startTime < maxWait) {
      try {
        await execPromise(`nc -z localhost ${port}`)
        logger.progressDone()
        return true
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        process.stdout.write('.')
      }
    }

    logger.progressDone()
    throw new Error(`端口 ${port} 在 ${maxWait}ms 内未就绪`)
  }

  // 智能错误修复
  async tryAutoFix(error, context) {
    const { app, environment, ports, skipConfirm } = context

    // 端口占用错误
    if (this.isPortInUseError(error)) {
      logger.warn('检测到端口占用错误，尝试自动修复...')
      if (ports && ports.length > 0) {
        await this.handlePortConflicts(ports, skipConfirm)
        return true
      }
    }

    // 缺少环境变量错误
    if (this.isMissingEnvError(error)) {
      logger.warn('检测到环境变量缺失错误')
      return await this.fixMissingEnv(environment)
    }

    // Prisma 客户端未生成错误
    if (this.isPrismaNotGeneratedError(error)) {
      logger.warn('检测到 Prisma 客户端未生成，尝试自动修复...')
      return await this.fixPrismaGenerate(app, environment, skipConfirm)
    }

    // 依赖缺失错误
    if (this.isMissingDependencyError(error)) {
      logger.warn('检测到依赖缺失，尝试自动修复...')
      return await this.fixMissingDependency(skipConfirm)
    }

    return false
  }

  // 判断是否为开发服务器命令（Next/Vite/Nest 开发模式）
  isDevServerCommandString(cmd) {
    // 采用多条简单规则组合，避免复杂正则导致误判
    const rules = [
      /\bnext\s+dev\b/,
      /\bvite(?:\s|$)/,
      /\b(?:pnpm|npm|yarn)\s+(?:--filter\s+\S+\s+)?(?:run\s+)?start:dev\b/,
      /\bstart:dev\b/,
    ]
    return rules.some(r => r.test(cmd))
  }

  // 错误类型检测方法
  isPortInUseError(error) {
    const message = error.message || ''
    return (
      message.includes('EADDRINUSE') ||
      message.includes('address already in use') ||
      (message.includes('端口') && message.includes('占用'))
    )
  }

  isMissingEnvError(error) {
    const message = error.message || ''
    return (
      message.includes('environment variable') ||
      (message.includes('env') && message.includes('undefined'))
    )
  }

  isPrismaNotGeneratedError(error) {
    const message = error.message || ''
    return (
      message.includes('Prisma') && (message.includes('generate') || message.includes('client'))
    )
  }

  isMissingDependencyError(error) {
    const message = error.message || ''
    return message.includes('Cannot find module') || message.includes('command not found')
  }

  // 错误修复方法
  async fixMissingEnv(environment) {
    logger.info('环境变量修复建议:')
    logger.info(`1. 检查 .env.${environment} 文件`)
    logger.info('2. 检查对应环境的 .env.<env>.local（例如 .env.development.local）')
    logger.info('3. 参考 .env.example（模板示例，不参与运行时加载）')
    return false // 需要用户手动修复
  }

  async fixPrismaGenerate(app, environment, skipConfirm = false) {
    if (!skipConfirm) {
      const shouldFix = await confirmManager.confirm('是否自动生成 Prisma 客户端？', true)
      if (!shouldFix) return false
    }

    try {
      // 直接使用 Nx 执行 prisma:generate，避免依赖根 package.json scripts
      await this.executeCommand('npx nx prisma:generate backend', {
        app: 'backend',
        flags: { [environment]: true },
        // 禁用 Nx 缓存，确保实际执行生成步骤
        env: { NX_CACHE: 'false' },
      })
      logger.success('Prisma 客户端生成成功')
      return true
    } catch (error) {
      logger.error('Prisma 客户端生成失败')
      return false
    }
  }

  async fixMissingDependency(skipConfirm = false) {
    if (!skipConfirm) {
      const shouldInstall = await confirmManager.confirm('是否自动安装缺失的依赖？', true)
      if (!shouldInstall) return false
    }

    try {
      await this.executeCommand('pnpm install')
      logger.success('依赖安装成功')
      return true
    } catch (error) {
      logger.error('依赖安装失败')
      return false
    }
  }

  // 清理所有进程
  cleanup() {
    if (this.runningProcesses.size === 0) return

    logger.info(`清理 ${this.runningProcesses.size} 个运行中的进程...`)

    for (const [id, { process, command }] of this.runningProcesses) {
      try {
        logger.debug(`终止进程 ${id}: ${command}`)
        // 直接使用 SIGKILL，不等待优雅退出
        try {
          process.kill('SIGKILL')
        } catch {}
      } catch (error) {
        logger.debug(`清理进程 ${id} 时出错: ${error.message}`)
      }
    }

    this.runningProcesses.clear()
  }

  // 获取运行状态
  getStatus() {
    return {
      runningProcesses: this.runningProcesses.size,
      processes: Array.from(this.runningProcesses.entries()).map(([id, info]) => ({
        id,
        command: info.command,
        duration: Date.now() - info.startTime,
      })),
    }
  }
}

export const execManager = new ExecManager()
