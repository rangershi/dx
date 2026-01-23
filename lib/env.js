import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function resolveProjectRoot() {
  return process.env.DX_PROJECT_ROOT || process.cwd()
}

function resolveConfigDir() {
  const projectRoot = resolveProjectRoot()
  return process.env.DX_CONFIG_DIR || join(projectRoot, 'dx', 'config')
}

export class EnvManager {
  constructor() {
    this.projectRoot = resolveProjectRoot()
    this.configDir = resolveConfigDir()
    this.envLayers = this.loadEnvLayers()
    this.requiredEnvConfig = null
    this.latestEnvWarnings = []

    // APP_ENV → NODE_ENV 映射（用于运行时行为和工具链，如 Nx/Next）
    // 注意：'e2e' 在 dotenv 层使用独立层（.env.e2e），但在 NODE_ENV 上归并为 'test'
    this.APP_TO_NODE_ENV = {
      local: 'development',
      dev: 'development',
      development: 'development',
      staging: 'production',
      production: 'production',
      e2e: 'test',
      test: 'test',
    }
  }

  // 加载环境层级配置
  loadEnvLayers() {
    try {
      const configPath = join(this.configDir, 'env-layers.json')
      return JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (error) {
      // 使用默认配置（按环境 → 全局本地 → 环境本地 的优先级）
      return {
        development: ['.env.development', '.env.development.local'],
        staging: ['.env.staging', '.env.staging.local'],
        production: ['.env.production', '.env.production.local'],
        test: ['.env.test', '.env.test.local'],
        e2e: ['.env.e2e', '.env.e2e.local'],
      }
    }
  }

  // 将 APP_ENV 规范化为 dotenv 层（development/production/test/e2e）
  mapAppEnvToLayerEnv(appEnv) {
    const env = String(appEnv || '').toLowerCase()
    if (env === 'e2e') return 'e2e'
    if (env === 'staging' || env === 'stage') return 'staging'
    if (env === 'production' || env === 'prod') return 'production'
    if (env === 'test') return 'test'
    return 'development'
  }

  // 将 APP_ENV 规范化为 NODE_ENV（development/production/test）
  mapAppEnvToNodeEnv(appEnv) {
    const env = String(appEnv || '').toLowerCase()
    return this.APP_TO_NODE_ENV[env] || 'development'
  }

  // 同步 APP_ENV 与 NODE_ENV（不改变现有 APP_ENV；仅在缺失或需规范化时设置 NODE_ENV）
  syncEnvironments(appEnv) {
    const app = String(appEnv || process.env.APP_ENV || '').toLowerCase()
    if (app) {
      const node = this.mapAppEnvToNodeEnv(app)
      process.env.APP_ENV = app
      process.env.NODE_ENV = node
      return { appEnv: app, nodeEnv: node }
    }
    // 若没有 APP_ENV，仍保证 NODE_ENV 有合理默认值
    process.env.NODE_ENV = process.env.NODE_ENV || 'development'
    return { appEnv: process.env.APP_ENV, nodeEnv: process.env.NODE_ENV }
  }

  // 检测当前环境（用于选择 dotenv 层，如 .env.production/.env.e2e）
  detectEnvironment(flags = {}) {
    if (flags.prod || flags.production) return 'production'
    if (flags.staging) return 'staging'
    if (flags.dev || flags.development) return 'development'
    if (flags.test) return 'test'
    if (flags.e2e) return 'e2e'

    // 优先基于 APP_ENV 选择 dotenv 层
    if (process.env.APP_ENV) {
      return this.mapAppEnvToLayerEnv(process.env.APP_ENV)
    }

    // 回退到 NODE_ENV
    return process.env.NODE_ENV || 'development'
  }

  // 获取解析后的 dotenv 层级路径
  getResolvedEnvLayers(app, environment) {
    const layers = this.envLayers[environment] || []
    if (!app) return layers
    return layers.map(layer => layer.replace('{app}', app))
  }

  loadRequiredEnvConfig() {
    if (this.requiredEnvConfig) return this.requiredEnvConfig
    const configPath = join(this.configDir, 'required-env.jsonc')
    if (!existsSync(configPath)) {
      this.requiredEnvConfig = { _common: [] }
      return this.requiredEnvConfig
    }

    try {
      const raw = readFileSync(configPath, 'utf8')
      const sanitized = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      this.requiredEnvConfig = JSON.parse(sanitized || '{}') || { _common: [] }
    } catch (error) {
      throw new Error(`无法解析 required-env.jsonc: ${error.message}`)
    }
    return this.requiredEnvConfig
  }

  getRequiredEnvVars(environment, appType = null) {
    const config = this.loadRequiredEnvConfig()
    const base = Array.isArray(config._common) ? config._common : []
    const envSpecific = Array.isArray(config[environment]) ? config[environment] : []

    // 按应用类型添加对应的环境变量组
    let appSpecific = []
    if (appType) {
      const appTypes = Array.isArray(appType) ? appType : [appType]
      for (const type of appTypes) {
        if (Array.isArray(config[type])) {
          appSpecific = appSpecific.concat(config[type])
        }
      }
    }

    return Array.from(new Set([...base, ...envSpecific, ...appSpecific]))
  }

  // 构建dotenv命令参数
  buildEnvFlags(app, environment) {
    return this.getResolvedEnvLayers(app, environment)
      .map(layer => `-e ${layer}`)
      .join(' ')
  }

  // 检查必需环境变量
  validateRequiredVars(requiredVars = [], sourceEnv = process.env) {
    const missing = []
    const placeholders = []

    requiredVars.forEach(varName => {
      const value = sourceEnv[varName]
      if (value === undefined || value === null) {
        missing.push(varName)
        return
      }

      if (this.isPlaceholderEnvValue(value)) {
        placeholders.push(varName)
      }
    })

    if (missing.length > 0 || placeholders.length > 0) {
      return { valid: false, missing, placeholders }
    }
    return { valid: true, missing: [], placeholders: [] }
  }

  // 判断环境变量值是否缺失或仅为占位内容
  isMissingEnvValue(value) {
    if (value === undefined || value === null) return true
    return this.isPlaceholderEnvValue(value)
  }

  // 占位符判定：空串/空格/包裹引号但内容为空/null/undefined
  isPlaceholderEnvValue(value) {
    const stringValue = String(value)
    const trimmed = stringValue.trim()
    if (trimmed.length === 0) return true

    let unwrapped = trimmed
    const firstChar = trimmed[0]
    const lastChar = trimmed[trimmed.length - 1]
    const isQuotedPair =
      (firstChar === '"' || firstChar === "'" || firstChar === '`') && firstChar === lastChar
    if (trimmed.length >= 2 && isQuotedPair) {
      unwrapped = trimmed.slice(1, -1).trim()
      if (unwrapped.length === 0) return true
    }

    if (unwrapped.includes('__SET_IN_env.local__')) return true

    const normalized = unwrapped.toLowerCase()
    return normalized === 'null' || normalized === 'undefined'
  }

  collectEnvFromLayers(app, environment) {
    const layers = this.getResolvedEnvLayers(app, environment)
    const result = {}
    const warnings = []

    const interpolate = value =>
      value.replace(/\$\{([^}]+)\}/g, (_, name) => {
        const key = name.trim()
        if (Object.prototype.hasOwnProperty.call(result, key)) return result[key]
        if (process.env[key] !== undefined) return process.env[key]
        return ''
      })

    layers.forEach(layer => {
      const filePath = join(this.projectRoot, layer)
      if (!existsSync(filePath)) return

      try {
        const content = readFileSync(filePath, 'utf8')
        const lines = content.split(/\r?\n/)
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line || line.startsWith('#')) continue
          const eqIdx = line.indexOf('=')
          if (eqIdx <= 0) continue
          const key = line.slice(0, eqIdx).trim()
          if (!key) continue
          let value = line.slice(eqIdx + 1)

          // 移除行末注释（仅当值未被引号包裹时处理）
          let commentIndex = -1
          if (!/^\s*['"`]/.test(value)) {
            commentIndex = value.indexOf(' #')
            if (commentIndex !== -1) {
              value = value.slice(0, commentIndex)
            }
          }

          value = value.trim()
          const isSingleQuoted = value.startsWith("'") && value.endsWith("'")
          const isDoubleQuoted = value.startsWith('"') && value.endsWith('"')
          const isBacktickQuoted = value.startsWith('`') && value.endsWith('`')

          if (isSingleQuoted || isDoubleQuoted || isBacktickQuoted) {
            value = value.slice(1, -1)
          }

          if (!isSingleQuoted) {
            value = interpolate(value)
          }

          const previous = result[key]
          const previousIsNonEmpty = previous !== undefined && String(previous).trim().length > 0
          if (previousIsNonEmpty && value.trim().length === 0) {
            warnings.push(`环境文件 ${layer} 将 ${key} 覆盖为空值，请确认层级顺序是否正确`)
          }

          result[key] = value
        }
      } catch (error) {
        throw new Error(`读取环境文件失败 (${filePath}): ${error.message}`)
      }
    })

    this.latestEnvWarnings = warnings
    return result
  }

  // 智能错误修复建议
  suggestFixes(missing, environment) {
    const env = environment || this.detectEnvironment()
    return missing.map(varName => ({
      var: varName,
      suggestion: `请检查以下文件中的 ${varName} 配置:`,
      files: [`.env.${env}`, `.env.${env}.local`],
    }))
  }

  // 获取环境描述
  getEnvironmentDescription(environment) {
    const descriptions = {
      development: '开发环境',
      staging: '预发环境',
      production: '生产环境',
      test: '测试环境',
      e2e: 'E2E测试环境',
    }
    return descriptions[environment] || environment
  }

  // 检查危险操作环境
  isDangerousEnvironment(environment) {
    return environment === 'production'
  }
}

export const envManager = new EnvManager()
