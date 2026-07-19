import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { loadEnvPolicy, resolveTargetRequiredVars } from './env-policy.js'

const PROFILE_CONFIG_FILE = 'env-profiles.json'
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`无法解析 ${filePath}: ${error.message}`)
  }
}

export function loadEnvProfileConfig(configDir) {
  const filePath = join(configDir, PROFILE_CONFIG_FILE)
  assert(existsSync(filePath), `缺少配置文件 ${filePath}`)
  const config = parseJsonFile(filePath)

  assert(config.version === 1, `${PROFILE_CONFIG_FILE}.version 必须为 1`)
  assert(
    config.profiles && typeof config.profiles === 'object' && !Array.isArray(config.profiles),
    `${PROFILE_CONFIG_FILE}.profiles 必须为对象`,
  )
  const profileNames = Object.keys(config.profiles)
  assert(profileNames.length > 0, `${PROFILE_CONFIG_FILE}.profiles 不能为空`)
  for (const name of profileNames) {
    assert(PROFILE_NAME_PATTERN.test(name), `非法 profile 名称: ${name}`)
    const profile = config.profiles[name]
    assert(profile && typeof profile === 'object' && !Array.isArray(profile), `profile ${name} 必须为对象`)
    if (profile.label !== undefined) {
      assert(typeof profile.label === 'string' && profile.label.trim(), `profile ${name}.label 必须为非空字符串`)
    }
  }

  assert(Array.isArray(config.environments), `${PROFILE_CONFIG_FILE}.environments 必须为数组`)
  assert(config.environments.length > 0, `${PROFILE_CONFIG_FILE}.environments 不能为空`)
  for (const environment of config.environments) {
    assert(typeof environment === 'string' && environment.trim(), 'environment 必须为非空字符串')
  }

  const requiredLocalKeys = config.requiredLocalKeys || {}
  assert(
    requiredLocalKeys && typeof requiredLocalKeys === 'object' && !Array.isArray(requiredLocalKeys),
    `${PROFILE_CONFIG_FILE}.requiredLocalKeys 必须为对象`,
  )
  for (const [environment, keys] of Object.entries(requiredLocalKeys)) {
    assert(config.environments.includes(environment), `requiredLocalKeys 包含未声明环境: ${environment}`)
    assert(Array.isArray(keys), `requiredLocalKeys.${environment} 必须为数组`)
    for (const key of keys) {
      assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key), `requiredLocalKeys.${environment} 包含非法键: ${key}`)
    }
  }

  return config
}

export function resolveEnvProfilePaths({ projectRoot, profile, environment }) {
  assert(PROFILE_NAME_PATTERN.test(profile || ''), `非法 profile 名称: ${profile || '<empty>'}`)
  assert(typeof environment === 'string' && environment.trim(), 'environment 不能为空')
  const profileDirectory = join(projectRoot, 'dx', 'env', 'templates', profile)
  return {
    source: join(profileDirectory, `${environment}.local`),
    target: join(projectRoot, `.env.${environment}.local`),
    template: join(profileDirectory, `${environment}.local.example`),
  }
}

function parseEnvContent(content, filePath) {
  const entries = new Map()
  const errors = []
  const lines = String(content).split(/\r?\n/)

  lines.forEach((rawLine, index) => {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) return
    if (line.startsWith('export ')) line = line.slice('export '.length).trim()
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) {
      errors.push(`${filePath}:${index + 1}: 不是合法的 KEY=VALUE`)
      return
    }
    if (entries.has(match[1])) {
      errors.push(`${filePath}:${index + 1}: 重复键 ${match[1]}`)
      return
    }
    entries.set(match[1], match[2])
  })

  if (errors.length > 0) throw new Error(errors.join('\n'))
  return entries
}

function normalizedValue(value) {
  const text = String(value ?? '').trim()
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1).trim()
  }
  return text
}

function assertPrivatePermissions(filePath) {
  const linkStat = lstatSync(filePath)
  assert(!linkStat.isSymbolicLink(), `profile 不允许使用符号链接: ${filePath}`)
  const stat = statSync(filePath)
  assert(stat.isFile(), `profile 必须是普通文件: ${filePath}`)
  if (process.platform === 'win32') return
  const publicBits = stat.mode & 0o077
  assert(
    publicBits === 0,
    `${filePath} 权限过宽（当前 ${(stat.mode & 0o777).toString(8).padStart(3, '0')}），请执行 chmod 600 ${basename(filePath)}`,
  )
}

function assertGitIgnored(projectRoot, filePath) {
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (inside.status !== 0) return

  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', relative(projectRoot, filePath)], {
    cwd: projectRoot,
    stdio: 'ignore',
  })
  assert(
    ignored.status === 0,
    `${basename(filePath)} 未被 Git 忽略；为防止泄密，拒绝读取该 profile`,
  )
}

function mergeEntries(...maps) {
  const merged = new Map()
  for (const map of maps) {
    for (const [key, value] of map) merged.set(key, value)
  }
  return merged
}

export function validateEnvProfile({ projectRoot, configDir, profile, environment }) {
  const config = loadEnvProfileConfig(configDir)
  assert(config.profiles[profile], `未声明 env profile: ${profile}`)
  assert(config.environments.includes(environment), `profile 不支持环境: ${environment}`)

  const paths = resolveEnvProfilePaths({ projectRoot, profile, environment })
  assert(
    existsSync(paths.source),
    `缺少私有配置 ${basename(paths.source)}；请从 ${relative(projectRoot, paths.template)} 复制并填写`,
  )
  assertPrivatePermissions(paths.source)
  assertGitIgnored(projectRoot, paths.source)

  const policy = loadEnvPolicy(configDir)
  const placeholder = normalizedValue(policy.secretPlaceholder)
  const secretKeys = new Set(policy.keys?.secret || [])
  const allowedLocalKeys = new Set([
    ...(policy.keys?.secret || []),
    ...(policy.keys?.localOnly || []),
    ...(policy.keys?.localOverride || []),
  ])
  const profileEntries = parseEnvContent(readFileSync(paths.source, 'utf8'), paths.source)
  const errors = []
  const invalidKeys = new Set()

  for (const [key, value] of profileEntries) {
    if (!allowedLocalKeys.has(key)) {
      errors.push(`${basename(paths.source)}: 未在 env-policy keys.* 声明的键 ${key}`)
      invalidKeys.add(key)
    }
    const normalized = normalizedValue(value)
    if (secretKeys.has(key) && (!normalized || normalized === placeholder)) {
      errors.push(`${basename(paths.source)}: 机密键 ${key} 必须设置真实值`)
      invalidKeys.add(key)
    }
  }

  for (const key of config.requiredLocalKeys?.[environment] || []) {
    if (!profileEntries.has(key) || !normalizedValue(profileEntries.get(key))) {
      if (invalidKeys.has(key)) continue
      errors.push(`${basename(paths.source)}: 缺少 profile 必填键 ${key}`)
      invalidKeys.add(key)
    }
  }

  const checkedRequired = new Set()
  for (const [targetId, target] of Object.entries(policy.targets || {})) {
    const committedTemplate = target?.files?.committed
    if (typeof committedTemplate !== 'string') continue
    const committedFile = committedTemplate.replace(/\{env\}/g, environment)
    const committedPath = join(projectRoot, committedFile)
    const committedEntries = existsSync(committedPath)
      ? parseEnvContent(readFileSync(committedPath, 'utf8'), committedPath)
      : new Map()
    const effective = mergeEntries(committedEntries, profileEntries)
    for (const key of resolveTargetRequiredVars(policy, targetId, environment)) {
      const identity = `${targetId}:${key}`
      if (checkedRequired.has(identity)) continue
      checkedRequired.add(identity)
      const value = normalizedValue(effective.get(key))
      if (!value || value === placeholder) {
        if (invalidKeys.has(key)) continue
        errors.push(`${targetId}@${environment}: 必填键 ${key} 未由 committed env 或 profile 提供`)
        invalidKeys.add(key)
      }
    }
  }

  if (errors.length > 0) throw new Error(`env profile 校验未通过:\n${errors.join('\n')}`)

  return {
    profile,
    label: config.profiles[profile].label || profile,
    environment,
    source: paths.source,
    target: paths.target,
    keyCount: profileEntries.size,
  }
}

function sameFileContent(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false
  const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')
  return digest(left) === digest(right)
}

export function describeEnvProfiles({ projectRoot, configDir }) {
  const config = loadEnvProfileConfig(configDir)
  const rows = []
  for (const [profile, metadata] of Object.entries(config.profiles)) {
    for (const environment of config.environments) {
      const paths = resolveEnvProfilePaths({ projectRoot, profile, environment })
      let mode = '-'
      if (existsSync(paths.source) && process.platform !== 'win32') {
        mode = (statSync(paths.source).mode & 0o777).toString(8).padStart(3, '0')
      }
      rows.push({
        profile,
        label: metadata.label || profile,
        environment,
        exists: existsSync(paths.source),
        mode,
        active: sameFileContent(paths.source, paths.target),
        source: paths.source,
      })
    }
  }
  return rows
}

function lockPathFor(projectRoot, environment) {
  const key = createHash('sha256').update(`${projectRoot}\0${environment}`).digest('hex').slice(0, 20)
  return join(tmpdir(), `dx-env-profile-${key}.lock`)
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function acquireLock(projectRoot, environment, profile) {
  const lockPath = lockPathFor(projectRoot, environment)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify({ pid: process.pid, profile, environment }))
      closeSync(fd)
      return lockPath
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let owner = null
      try {
        owner = JSON.parse(readFileSync(lockPath, 'utf8'))
      } catch {}
      if (owner && isProcessAlive(owner.pid)) {
        throw new Error(
          `已有 env profile 操作运行中: pid=${owner.pid}, profile=${owner.profile}, environment=${owner.environment}`,
        )
      }
      recoverStaleTransaction(projectRoot, environment, owner?.transaction)
      rmSync(lockPath, { force: true })
    }
  }
  throw new Error(`无法取得 env profile 锁: ${lockPath}`)
}

function writeLockState(lockPath, state) {
  const temporary = `${lockPath}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
  renameSync(temporary, lockPath)
}

function recoverStaleTransaction(projectRoot, environment, transaction) {
  if (!transaction || typeof transaction !== 'object') return
  const expectedTarget = join(projectRoot, `.env.${environment}.local`)
  if (transaction.target !== expectedTarget) return
  if (
    typeof transaction.temporary !== 'string' ||
    !transaction.temporary.startsWith(`${expectedTarget}.dx-profile-`)
  ) {
    return
  }

  rmSync(expectedTarget, { force: true })
  rmSync(transaction.temporary, { force: true })
}

function materializeProfile(source, target, onPrepared) {
  const suffix = randomUUID()
  const temporary = `${target}.dx-profile-${suffix}`
  assert(
    !existsSync(target),
    `不允许存在持久根配置 ${basename(target)}；请迁移到品牌 profile 后删除该文件`,
  )
  const transaction = { target, temporary }
  onPrepared?.(transaction)

  writeFileSync(temporary, readFileSync(source), { flag: 'wx', mode: 0o600 })
  chmodSync(temporary, 0o600)

  try {
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }

  return {
    transaction,
    restore() {
      rmSync(target, { force: true })
      rmSync(temporary, { force: true })
    },
  }
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      shell: false,
    })
    const handlers = new Map()
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal)
      }
      handlers.set(signal, handler)
      process.on(signal, handler)
    }
    const removeHandlers = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
    }

    child.once('error', error => {
      removeHandlers()
      reject(error)
    })
    child.once('close', (code, signal) => {
      removeHandlers()
      resolve(code ?? SIGNAL_EXIT_CODES[signal] ?? 1)
    })
  })
}

export async function executeWithEnvProfile({
  projectRoot,
  configDir,
  profile,
  environment,
  command,
  args = [],
}) {
  assert(typeof command === 'string' && command.trim(), 'env exec 必须在 -- 后提供要执行的命令')
  const validated = validateEnvProfile({ projectRoot, configDir, profile, environment })
  const lockPath = acquireLock(projectRoot, environment, profile)
  let materialized = null

  try {
    materialized = materializeProfile(validated.source, validated.target, transaction => {
      writeLockState(lockPath, { pid: process.pid, profile, environment, transaction })
    })
    const profileEntries = parseEnvContent(readFileSync(validated.source, 'utf8'), validated.source)
    const profileEnv = Object.fromEntries(
      [...profileEntries].map(([key, value]) => [key, normalizedValue(value)]),
    )
    return await runChild(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...profileEnv,
        DX_ENV_PROFILE: profile,
        DX_ENV_PROFILE_ENVIRONMENT: environment,
      },
    })
  } finally {
    try {
      materialized?.restore()
    } finally {
      rmSync(lockPath, { force: true })
    }
  }
}
