import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnvPolicy } from './env-policy.js'

const ROOT_DIR = process.env.DX_PROJECT_ROOT || process.cwd()
const CONFIG_DIR = process.env.DX_CONFIG_DIR || join(ROOT_DIR, 'dx', 'config')
const ROOT_ENV_FILE = join(ROOT_DIR, '.env')
const EXTRA_ENV_IGNORED_DIRS = new Set([
  '.git',
  '.vercel',
  'node_modules',
  '.nx',
  'dist',
  'logs',
  'tmp',
  '.schaltwerk',
])
const EXTRA_ENV_ALLOWED_PATHS = new Set(['docker/.env', 'docker/.env.example'])
const LOCAL_ALLOWLIST_CONFIG = join(CONFIG_DIR, 'local-env-allowlist.jsonc')
const EXEMPTED_KEYS_CONFIG = join(CONFIG_DIR, 'exempted-keys.jsonc')
const ENV_EXAMPLE_FILE = join(ROOT_DIR, '.env.example')
const PLACEHOLDER_TOKEN = '__SET_IN_env.local__'

const LOCAL_ENV_FILES = [
  '.env.development.local',
  '.env.production.local',
  '.env.test.local',
  '.env.e2e.local',
  '.env.staging.local',
]

let cachedAllowlist = null
let cachedExemptedKeys = null

export function validateEnvironment() {
  if (!process.env.NODE_ENV) {
    console.warn('⚠️  NODE_ENV 未设置，默认使用 development')
    process.env.NODE_ENV = 'development'
  }

  if (typeof process.env.APP_ENV === 'string' && process.env.APP_ENV.trim() === '') {
    delete process.env.APP_ENV
  }

  const policy = loadEnvPolicy(CONFIG_DIR)

  enforceRootOnlyEnvFiles(policy)
  enforceGlobalLocalFileProhibited()

  if (policy) {
    enforceSecretPolicy(policy)
    enforceEnvExamplePolicy(policy)
  } else {
    // Backward-compatible behavior
    enforceLocalSecretWhitelist()
    enforceNonLocalSecretPlaceholders()
    enforceEnvExampleSecrets()
  }

  return { nodeEnv: process.env.NODE_ENV, appEnv: process.env.APP_ENV }
}

function enforceRootOnlyEnvFiles(policy) {
  if (existsSync(ROOT_ENV_FILE)) {
    throw new Error(
      '检测到根目录存在 .env 文件，请迁移到 .env.<env> / .env.<env>.local 并删除 .env',
    )
  }

  // 保留现有规则：禁止子目录出现任意 .env* 文件（除特例路径）
  // 注：该规则对是否启用 env-policy 都有效。

  const violations = []
  const queue = ['.']

  while (queue.length > 0) {
    const current = queue.pop()
    const dirPath = join(ROOT_DIR, current)
    const entries = readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXTRA_ENV_IGNORED_DIRS.has(entry.name)) continue
        const next = current === '.' ? entry.name : `${current}/${entry.name}`
        queue.push(next)
        continue
      }

      if (!entry.isFile()) continue
      if (!entry.name.startsWith('.env')) continue

      const relativePath = current === '.' ? entry.name : `${current}/${entry.name}`

      if (!relativePath.includes('/')) {
        continue
      }

      if (EXTRA_ENV_ALLOWED_PATHS.has(relativePath)) continue

      if (policy) {
        const globs = Array.isArray(policy.layout?.allowSubdirGlobs) ? policy.layout.allowSubdirGlobs : []
        if (isAllowedBySimpleGlob(relativePath, globs)) continue
      }

      violations.push(relativePath)
    }
  }

  if (violations.length > 0) {
    const list = violations.join(', ')
    throw new Error(
      `检测到非根目录下的 env 文件: ${list}\n请将这些文件迁移到根目录或删除，再重试命令。`,
    )
  }
}

function enforceLocalSecretWhitelist() {
  const allowlist = loadLocalAllowlist()
  const errors = []

  for (const file of LOCAL_ENV_FILES) {
    const fullPath = join(ROOT_DIR, file)
    if (!existsSync(fullPath)) continue

    const entries = parseEnvFile(fullPath)
    const invalidKeys = []

    for (const key of entries.keys()) {
      if (!allowlist.has(key)) {
        invalidKeys.push(key)
      }
    }

    if (invalidKeys.length > 0) {
      errors.push(`${file}: ${invalidKeys.join(', ')}`)
    }
  }

  if (errors.length > 0) {
    const message = errors.join('\n')
    throw new Error(
      `检测到 *.local 文件包含非白名单键:\n${message}\n请将这些键迁移到对应的 .env.<env> 文件，仅保留白名单内的机密信息在 *.local 中。`,
    )
  }
}

function enforceGlobalLocalFileProhibited() {
  const legacyLocal = join(ROOT_DIR, '.env.local')
  if (existsSync(legacyLocal)) {
    throw new Error('项目已弃用 .env.local，请改用 .env.<env>.local 存放机密信息并删除 .env.local')
  }
}

function enforceSecretPolicy(policy) {
  const placeholder = String(policy.secretPlaceholder || '').trim()
  const secretKeys = new Set(policy.keys?.secret || [])
  const localOnlyKeys = new Set(policy.keys?.localOnly || [])
  const localOverrideKeys = new Set(policy.keys?.localOverride || [])

  const invalidOverlap = findOverlaps([
    { name: 'keys.secret', set: secretKeys },
    { name: 'keys.localOnly', set: localOnlyKeys },
    { name: 'keys.localOverride', set: localOverrideKeys },
  ])
  if (invalidOverlap.length > 0) {
    throw new Error(`env-policy.jsonc keys 分类存在重复: ${invalidOverlap.join(', ')}`)
  }

  const errors = []
  const filePairs = listTargetEnvFilePairs(policy)

  for (const envName of policy.environments || []) {
    for (const pair of filePairs) {
      const committed = replaceEnvToken(pair.committed, envName)
      const local = replaceEnvToken(pair.local, envName)

      const committedPath = join(ROOT_DIR, committed)
      const localPath = join(ROOT_DIR, local)

      const committedExists = existsSync(committedPath)
      const localExists = existsSync(localPath)

      if (!committedExists && !localExists) continue
      if (!committedExists && localExists) {
        errors.push(`${committed} 缺失（但存在 ${local}），请补充 committed 模板文件`) 
        continue
      }

      const committedEntries = committedExists ? parseEnvFile(committedPath) : new Map()
      const localEntries = localExists ? parseEnvFile(localPath) : new Map()

      // Committed: secret keys must exist and be placeholder.
      for (const key of secretKeys) {
        if (!committedEntries.has(key)) {
          errors.push(`${committed}: 缺少机密键模板 ${key}`)
          continue
        }
        const rawValue = String(committedEntries.get(key) ?? '')
        if (rawValue.trim() !== placeholder) {
          errors.push(`${committed}: 机密键 ${key} 必须使用占位符 ${placeholder}`)
        }
      }

      // Committed: localOnly must not appear.
      for (const key of localOnlyKeys) {
        if (committedEntries.has(key)) {
          errors.push(`${committed}: localOnly 键 ${key} 不允许出现在非 local 文件中`)
        }
      }

      if (localExists) {
        const allowedInLocal = new Set([...secretKeys, ...localOnlyKeys, ...localOverrideKeys])

        for (const [key, value] of localEntries.entries()) {
          if (!allowedInLocal.has(key)) {
            errors.push(`${local}: 包含未声明的键 ${key}（请加入 env-policy.jsonc.keys.* 或迁移到 committed 文件）`)
            continue
          }

          if (secretKeys.has(key)) {
            if (String(value ?? '').trim() === placeholder) {
              errors.push(`${local}: 机密键 ${key} 不允许使用占位符，请设置真实值`)
            }
            if (!committedEntries.has(key)) {
              errors.push(`${committed}: 缺少机密键模板 ${key}（因为 ${local} 中存在该键）`)
            }
          }

          if (localOnlyKeys.has(key) && committedEntries.has(key)) {
            errors.push(`${committed}: localOnly 键 ${key} 不允许出现在 committed 文件中（已在 ${local} 中存在）`)
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`环境变量机密策略校验未通过:\n${errors.join('\n')}`)
  }
}

function enforceEnvExamplePolicy(policy) {
  if (!existsSync(ENV_EXAMPLE_FILE)) return

  const placeholder = String(policy.secretPlaceholder || '').trim()
  const secretKeys = new Set(policy.keys?.secret || [])
  const localOnlyKeys = new Set(policy.keys?.localOnly || [])
  const entries = parseEnvFile(ENV_EXAMPLE_FILE)
  const errors = []

  for (const [key, value] of entries.entries()) {
    if (localOnlyKeys.has(key)) {
      errors.push(`.env.example 不允许包含 localOnly 键: ${key}`)
      continue
    }
    if (secretKeys.has(key)) {
      if (String(value ?? '').trim() !== placeholder) {
        errors.push(`.env.example 中机密键 ${key} 必须使用占位符 ${placeholder}`)
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

function listTargetEnvFilePairs(policy) {
  const pairs = []
  const targets = policy.targets || {}
  for (const target of Object.values(targets)) {
    const committed = target?.files?.committed
    const local = target?.files?.local
    if (typeof committed !== 'string' || typeof local !== 'string') continue
    pairs.push({ committed, local })
  }

  // De-dup
  const seen = new Set()
  return pairs.filter(p => {
    const key = `${p.committed}@@${p.local}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function replaceEnvToken(template, envName) {
  return String(template).replace(/\{env\}/g, envName)
}

function isAllowedBySimpleGlob(path, globs) {
  for (const raw of globs) {
    const glob = String(raw)
    if (!glob.includes('*')) {
      if (glob === path) return true
      continue
    }
    // Only support a single trailing '*' for now.
    if (glob.endsWith('*')) {
      const prefix = glob.slice(0, -1)
      if (path.startsWith(prefix)) return true
    }
  }
  return false
}

function findOverlaps(namedSets) {
  const seen = new Map()
  const overlaps = []
  for (const { name, set } of namedSets) {
    for (const key of set) {
      if (seen.has(key)) {
        overlaps.push(`${key} (${seen.get(key)} & ${name})`)
      } else {
        seen.set(key, name)
      }
    }
  }
  return overlaps
}

function enforceNonLocalSecretPlaceholders() {
  const allowlist = loadLocalAllowlist()
  const exemptedKeys = loadExemptedKeys()
  const violations = []

  for (const file of listRootEnvFiles()) {
    if (file === '.env.example') continue
    if (file.includes('.local')) continue

    const fullPath = join(ROOT_DIR, file)
    if (!existsSync(fullPath)) continue

    const entries = parseEnvFile(fullPath)

    for (const [key, value] of entries.entries()) {
      if (!allowlist.has(key)) continue
      if (exemptedKeys.has(key)) continue // 豁免的键允许使用非占位符值

      const normalized = value.trim()
      if (normalized !== PLACEHOLDER_TOKEN) {
        violations.push(`${file}: ${key}`)
      }
    }
  }

  if (violations.length > 0) {
    const message = violations.join('\n')
    throw new Error(
      `检测到非 *.local 文件包含敏感键但未使用占位符 ${PLACEHOLDER_TOKEN}:\n${message}\n` +
        `请仅在 .env.<env>.local 系列中设置真实值，并在其他文件中使用占位符。`,
    )
  }
}

function enforceEnvExampleSecrets() {
  if (!existsSync(ENV_EXAMPLE_FILE)) return

  const allowlist = loadLocalAllowlist()
  const entries = parseEnvFile(ENV_EXAMPLE_FILE)
  const disallowedKeys = []
  const invalidPlaceholders = []

  for (const [key, value] of entries.entries()) {
    const normalized = value.trim()

    if (!allowlist.has(key)) {
      disallowedKeys.push(key)
      continue
    }

    if (normalized !== PLACEHOLDER_TOKEN) {
      invalidPlaceholders.push(key)
    }
  }

  if (disallowedKeys.length > 0) {
    throw new Error(
      `.env.example 仅允许包含 scripts/config/local-env-allowlist.jsonc 中的键，检测到非法键: ${disallowedKeys.join(', ')}`,
    )
  }

  if (invalidPlaceholders.length > 0) {
    throw new Error(
      `.env.example 中以下键未使用占位符 ${PLACEHOLDER_TOKEN}: ${invalidPlaceholders.join(', ')}`,
    )
  }
}

function listRootEnvFiles() {
  return readdirSync(ROOT_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith('.env'))
    .map(entry => entry.name)
}

function parseEnvFile(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const map = new Map()
  const lines = content.split(/\r?\n/)

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0) continue

    const key = trimmed.slice(0, eqIdx).trim()
    if (!key) continue

    map.set(key, trimmed.slice(eqIdx + 1))
  }

  return map
}

function loadLocalAllowlist() {
  if (cachedAllowlist) return cachedAllowlist

  if (!existsSync(LOCAL_ALLOWLIST_CONFIG)) {
    throw new Error('缺少配置文件 scripts/config/local-env-allowlist.jsonc，请补充后重试')
  }

  const raw = readFileSync(LOCAL_ALLOWLIST_CONFIG, 'utf8')
  const sanitized = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const parsed = JSON.parse(sanitized || '{}') || {}

  const allowedValues = Array.isArray(parsed.allowed) ? parsed.allowed : []
  if (allowedValues.length === 0) {
    throw new Error('local-env-allowlist.jsonc 中的 allowed 不能为空，请至少保留一个键')
  }

  const invalid = allowedValues.filter(
    value => typeof value !== 'string' || value.trim().length === 0,
  )
  if (invalid.length > 0) {
    throw new Error('local-env-allowlist.jsonc.allowed 中存在非法键，请使用非空字符串')
  }

  cachedAllowlist = new Set(allowedValues)
  return cachedAllowlist
}

function loadExemptedKeys() {
  if (cachedExemptedKeys) return cachedExemptedKeys

  // 如果豁免配置文件不存在，返回空集合（可选配置）
  if (!existsSync(EXEMPTED_KEYS_CONFIG)) {
    cachedExemptedKeys = new Set()
    return cachedExemptedKeys
  }

  const raw = readFileSync(EXEMPTED_KEYS_CONFIG, 'utf8')
  const sanitized = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const parsed = JSON.parse(sanitized || '{}') || {}

  const exemptedValues = Array.isArray(parsed.exempted) ? parsed.exempted : []
  
  const invalid = exemptedValues.filter(
    value => typeof value !== 'string' || value.trim().length === 0,
  )
  if (invalid.length > 0) {
    throw new Error('exempted-keys.jsonc.exempted 中存在非法键，请使用非空字符串')
  }

  cachedExemptedKeys = new Set(exemptedValues)
  return cachedExemptedKeys
}

export default { validateEnvironment }
