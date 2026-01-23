import { createInterface } from 'node:readline'
import { logger } from './logger.js'

export class ConfirmManager {
  constructor() {
    this.rl = null
  }

  // 判断是否启用自动确认（CI 或显式环境变量）
  isAutoYes(skipFlag = false) {
    if (skipFlag) return true
    const ci = String(process.env.CI || '').toLowerCase()
    const autoYes = String(process.env.AI_CLI_YES || process.env.YES || '').toLowerCase()
    // 常见 CI 环境会设置 CI=true；也支持自定义 AI_CLI_YES/YES 变量
    return ci === 'true' || ci === '1' || autoYes === 'true' || autoYes === '1'
  }

  // 基础确认
  async confirm(message, defaultValue = false, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.info(`跳过确认: ${message}`)
      return true
    }

    const prompt = defaultValue ? `${message} [Y/n]: ` : `${message} [y/N]: `

    return new Promise(resolve => {
      this.rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      this.rl.question(prompt, answer => {
        this.rl.close()

        const normalized = answer.toLowerCase().trim()
        if (normalized === '') {
          resolve(defaultValue)
        } else {
          resolve(['y', 'yes', '是', 'true', '1'].includes(normalized))
        }
      })
    })
  }

  // 危险操作确认
  async confirmDangerous(operation, environment = 'unknown', skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.warn(`跳过危险操作确认: ${operation}`)
      return true
    }

    logger.separator()
    logger.warn('警告: 即将执行危险操作')
    console.log(`操作: ${operation}`)
    console.log(`环境: ${environment}`)

    if (environment === 'production' || environment === '生产环境') {
      console.log(`🔥 此操作将在生产环境执行，可能导致数据丢失或服务中断`)
      console.log(`🔥 请确保您已经：`)
      console.log(`   1. 备份了重要数据`)
      console.log(`   2. 通知了相关团队成员`)
      console.log(`   3. 确认了操作的必要性`)
    } else {
      console.log(`此操作可能导致数据丢失，请谨慎操作`)
    }

    logger.separator()

    // 对于生产环境，需要两次确认
    if (environment === 'production' || environment === '生产环境') {
      const firstConfirm = await this.confirm('您确定要在生产环境执行此危险操作吗？', false, false)
      if (!firstConfirm) {
        return false
      }

      console.log(`\n请再次确认，输入操作名称以继续: ${operation}`)
      return new Promise(resolve => {
        this.rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        })

        this.rl.question('请输入操作名称: ', answer => {
          this.rl.close()
          resolve(answer.trim() === operation)
        })
      })
    } else {
      return this.confirm('确定要继续吗？', false, false)
    }
  }

  // 批量操作确认
  async confirmBatch(operations, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.info('跳过批量操作确认')
      return true
    }

    logger.separator()
    console.log('即将执行以下操作:')
    operations.forEach((op, index) => {
      console.log(`${index + 1}. ${op}`)
    })
    logger.separator()

    return this.confirm('确认执行所有操作？', false, false)
  }

  // 端口冲突确认
  async confirmPortCleanup(port, processes, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.info(`跳过端口清理确认: 端口 ${port}`)
      return true
    }

    logger.warn(`端口 ${port} 被以下进程占用:`)
    processes.forEach(pid => {
      console.log(`  进程 ID: ${pid}`)
    })

    return this.confirm(`是否杀死这些进程以释放端口 ${port}？`, true, false)
  }

  // 环境切换确认
  async confirmEnvironmentSwitch(from, to, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.info(`跳过环境切换确认: ${from} -> ${to}`)
      return true
    }

    if (to === 'production' || to === '生产环境') {
      logger.warn(`即将从 ${from} 切换到 ${to}`)
      logger.warn('生产环境操作需要额外谨慎')
      return this.confirm('确定要切换到生产环境吗？', false, false)
    }

    return this.confirm(`确定要从 ${from} 切换到 ${to} 吗？`, true, false)
  }

  // 文件覆盖确认
  async confirmOverwrite(filePath, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.info(`跳过文件覆盖确认: ${filePath}`)
      return true
    }

    logger.warn(`文件已存在: ${filePath}`)
    return this.confirm('是否覆盖现有文件？', false, false)
  }

  // 清理操作确认
  async confirmCleanup(targets, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.info('跳过清理操作确认')
      return true
    }

    logger.warn('即将清理以下内容:')
    targets.forEach(target => {
      console.log(`  - ${target}`)
    })

    return this.confirm('确定要执行清理操作吗？', false, false)
  }

  // 服务启动确认（用于可能有端口冲突的情况）
  async confirmServiceStart(service, port, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      return true
    }

    return this.confirm(`确定要启动 ${service} 服务 (端口 ${port}) 吗？`, true, false)
  }

  // 版本发布确认
  async confirmRelease(version, isProduction = false, skipFlag = false) {
    if (this.isAutoYes(skipFlag)) {
      logger.info(`跳过版本发布确认: ${version}`)
      return true
    }

    if (isProduction) {
      logger.warn(`即将发布生产版本: ${version}`)
      logger.warn('此操作将创建正式发布标签')
      return this.confirmDangerous(`发布版本 ${version}`, '生产环境', false)
    } else {
      return this.confirm(`确定要发布开发版本 ${version} 吗？`, true, false)
    }
  }

  // 数据库操作确认
  async confirmDatabaseOperation(operation, environment, skipFlag = false) {
    const dangerousOps = ['reset', 'drop', 'migrate:reset', 'db:reset']
    const isDangerous = dangerousOps.some(op => operation.includes(op))

    if (isDangerous) {
      return this.confirmDangerous(
        `数据库操作: ${operation}`,
        environment,
        this.isAutoYes(skipFlag),
      )
    } else {
      if (this.isAutoYes(skipFlag)) {
        return true
      }
      return this.confirm(`确定要执行数据库操作: ${operation} (${environment}) 吗？`, true, false)
    }
  }
}

export const confirmManager = new ConfirmManager()
