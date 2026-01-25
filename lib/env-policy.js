import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import stripJsonComments from 'strip-json-comments'

const DEFAULT_POLICY_PATH = 'env-policy.jsonc'

let cachedPolicy = null
let cachedPolicyDir = null

function assertStringArray(value, fieldPath) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} 必须是数组`)
  }
  const invalid = value.filter(v => typeof v !== 'string' || v.trim().length === 0)
  if (invalid.length > 0) {
    throw new Error(`${fieldPath} 中存在非法值，请使用非空字符串`)
  }
}

function assertRecord(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldPath} 必须是对象`)
  }
}

export function loadEnvPolicy(configDir) {
  if (cachedPolicy && cachedPolicyDir === configDir) return cachedPolicy

  const policyPath = join(configDir, DEFAULT_POLICY_PATH)
  if (!existsSync(policyPath)) {
    cachedPolicy = null
    cachedPolicyDir = configDir
    return null
  }

  let parsed
  try {
    const raw = readFileSync(policyPath, 'utf8')
    parsed = JSON.parse(stripJsonComments(raw) || '{}')
  } catch (error) {
    throw new Error(`无法解析 ${DEFAULT_POLICY_PATH}: ${error.message}`)
  }

  validateEnvPolicy(parsed)
  cachedPolicy = parsed
  cachedPolicyDir = configDir
  return cachedPolicy
}

export function validateEnvPolicy(policy) {
  assertRecord(policy, 'env-policy')

  if (policy.version !== 1) {
    throw new Error('env-policy.jsonc.version 必须为 1')
  }

  assertStringArray(policy.environments, 'env-policy.jsonc.environments')

  if (typeof policy.secretPlaceholder !== 'string' || policy.secretPlaceholder.trim().length === 0) {
    throw new Error('env-policy.jsonc.secretPlaceholder 必须为非空字符串')
  }

  assertRecord(policy.keys, 'env-policy.jsonc.keys')
  assertStringArray(policy.keys.secret || [], 'env-policy.jsonc.keys.secret')
  assertStringArray(policy.keys.localOnly || [], 'env-policy.jsonc.keys.localOnly')
  assertStringArray(policy.keys.localOverride || [], 'env-policy.jsonc.keys.localOverride')

  assertRecord(policy.layout, 'env-policy.jsonc.layout')
  assertStringArray(policy.layout.forbidExact || [], 'env-policy.jsonc.layout.forbidExact')
  assertStringArray(policy.layout.allowRoot || [], 'env-policy.jsonc.layout.allowRoot')
  assertStringArray(policy.layout.allowSubdirGlobs || [], 'env-policy.jsonc.layout.allowSubdirGlobs')

  assertRecord(policy.appToTarget || {}, 'env-policy.jsonc.appToTarget')
  for (const [app, target] of Object.entries(policy.appToTarget || {})) {
    if (typeof app !== 'string' || app.trim().length === 0) {
      throw new Error('env-policy.jsonc.appToTarget 中存在非法 app key')
    }
    if (typeof target !== 'string' || target.trim().length === 0) {
      throw new Error('env-policy.jsonc.appToTarget 中存在非法 target value')
    }
  }

  assertRecord(policy.targets, 'env-policy.jsonc.targets')
  const targetIds = Object.keys(policy.targets)
  if (targetIds.length === 0) {
    throw new Error('env-policy.jsonc.targets 不能为空')
  }

  for (const [targetId, target] of Object.entries(policy.targets)) {
    if (typeof targetId !== 'string' || targetId.trim().length === 0) {
      throw new Error('env-policy.jsonc.targets 中存在非法 targetId')
    }
    assertRecord(target, `env-policy.jsonc.targets.${targetId}`)
    assertRecord(target.files, `env-policy.jsonc.targets.${targetId}.files`)
    if (typeof target.files.committed !== 'string' || target.files.committed.trim().length === 0) {
      throw new Error(`env-policy.jsonc.targets.${targetId}.files.committed 必须为非空字符串`)
    }
    if (typeof target.files.local !== 'string' || target.files.local.trim().length === 0) {
      throw new Error(`env-policy.jsonc.targets.${targetId}.files.local 必须为非空字符串`)
    }
    assertRecord(target.required || {}, `env-policy.jsonc.targets.${targetId}.required`)

    for (const [group, keys] of Object.entries(target.required || {})) {
      assertStringArray(keys, `env-policy.jsonc.targets.${targetId}.required.${group}`)
    }
  }

  // Ensure appToTarget does not point to missing targets.
  for (const [app, target] of Object.entries(policy.appToTarget || {})) {
    if (!policy.targets[target]) {
      throw new Error(
        `env-policy.jsonc.appToTarget.${app} 指向不存在的 target: ${target}（请在 env-policy.jsonc.targets 中定义）`,
      )
    }
  }
}

export function resolvePolicyTargetId(policy, app) {
  if (!policy || !app) return null
  const mapped = policy.appToTarget?.[app]
  return mapped || null
}

export function resolveTargetRequiredVars(policy, targetId, environment) {
  if (!policy || !targetId) return []
  const target = policy.targets?.[targetId]
  if (!target) return []
  const required = target.required || {}
  const common = Array.isArray(required._common) ? required._common : []
  const envSpecific = Array.isArray(required[environment]) ? required[environment] : []
  return Array.from(new Set([...common, ...envSpecific]))
}
