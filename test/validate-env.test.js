import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Comprehensive filesystem-based tests for validateEnvironment()
 * 
 * CRITICAL: Must use jest.resetModules() + dynamic import() per test
 * because lib/validate-env.js reads ROOT_DIR/CONFIG_DIR at import time.
 */

let tempDir

beforeEach(() => {
  // Create isolated temp directory for each test
  tempDir = mkdtempSync(join(tmpdir(), 'dx-validate-env-test-'))
  
  // Clear module cache to allow fresh imports with new env vars
  jest.resetModules()
})

afterEach(() => {
  // Clean up temp directory
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
  
  // Clean up env vars
  delete process.env.DX_PROJECT_ROOT
  delete process.env.DX_CONFIG_DIR
})

/**
 * Helper: Create minimal env-policy.jsonc with overrides
 */
function createMinimalPolicy(root, overrides = {}) {
  const policy = {
    version: 1,
    environments: overrides.environments || ['development', 'production'],
    layout: {
      forbidExact: overrides.forbidExact || ['.env', '.env.local'],
      allowRoot: overrides.allowRoot || ['.env.{env}', '.env.{env}.local'],
      allowSubdirGlobs: overrides.allowSubdirGlobs || ['docker/.env*']
    },
    secretPlaceholder: overrides.secretPlaceholder || '__SET_IN_env.local__',
    keys: {
      secret: overrides.secretKeys || ['APP_SECRET', 'DATABASE_URL'],
      localOnly: overrides.localOnlyKeys || [],
      localOverride: overrides.localOverrideKeys || []
    },
    appToTarget: overrides.appToTarget || { backend: 'backend' },
    targets: overrides.targets || {
      backend: {
        files: { committed: '.env.{env}', local: '.env.{env}.local' },
        required: { _common: ['APP_ENV'], development: [], production: [] }
      }
    },
    ...overrides.extra
  }
  
  const configDir = join(root, 'dx/config')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'env-policy.jsonc'),
    JSON.stringify(policy, null, 2)
  )
}

/**
 * Helper: Write env file with key-value pairs
 */
function writeEnvFile(root, fileName, entries) {
  const lines = Object.entries(entries).map(([key, value]) => `${key}=${value}`)
  writeFileSync(join(root, fileName), lines.join('\n'))
}

// ============================================================================
// ROOT LAYOUT RULES
// ============================================================================

describe('validateEnvironment() - Root Layout Rules', () => {
  it('should throw when root .env exists', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env', { FOO: 'bar' })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('.env')
      expect(err.message).toContain('根目录')
    }
  })

  it('should throw when root .env.local exists', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.local', { SECRET: 'value' })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('.env.local')
    }
  })

  it('should pass when forbidden root files are missing (minimal policy)', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })
})

// ============================================================================
// SUBDIR LAYOUT SCANNING
// ============================================================================

describe('validateEnvironment() - Subdir Layout Scanning', () => {
  it('should throw when apps/backend/.env.development exists (not in allowlist)', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    
    const appsDir = join(tempDir, 'apps/backend')
    mkdirSync(appsDir, { recursive: true })
    writeEnvFile(appsDir, '.env.development', { FOO: 'bar' })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('apps/backend/.env.development')
      expect(err.message).toContain('非根目录')
    }
  })

  it('should allow docker/.env.example (built-in EXTRA_ENV_ALLOWED_PATHS)', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    
    const dockerDir = join(tempDir, 'docker')
    mkdirSync(dockerDir, { recursive: true })
    writeEnvFile(dockerDir, '.env.example', { FOO: 'bar' })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })

  it('should allow docker/.env (built-in EXTRA_ENV_ALLOWED_PATHS)', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    
    const dockerDir = join(tempDir, 'docker')
    mkdirSync(dockerDir, { recursive: true })
    writeEnvFile(dockerDir, '.env', { FOO: 'bar' })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })

  it('should allow docker/.env.foo via policy glob docker/.env*', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir, { allowSubdirGlobs: ['docker/.env*'] })
    
    const dockerDir = join(tempDir, 'docker')
    mkdirSync(dockerDir, { recursive: true })
    writeEnvFile(dockerDir, '.env.foo', { FOO: 'bar' })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })
})

// ============================================================================
// SECRET POLICY - COMMITTED/LOCAL PAIRING
// ============================================================================

describe('validateEnvironment() - Secret Policy', () => {
  it('should pass when committed has placeholder and local is missing', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      DATABASE_URL: '__SET_IN_env.local__'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })

  it('should throw when local exists but committed is missing', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.development.local', {
      APP_SECRET: 'real-secret-value'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('缺失')
      expect(err.message).toContain('.env.development')
    }
  })

  it('should throw when committed secret key has real value (not placeholder)', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: 'real-secret-in-committed-file',
      DATABASE_URL: '__SET_IN_env.local__'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('必须使用占位符')
      expect(err.message).toContain('APP_SECRET')
    }
  })

  it('should throw when local secret key uses placeholder', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      DATABASE_URL: '__SET_IN_env.local__'
    })
    writeEnvFile(tempDir, '.env.development.local', {
      APP_SECRET: '__SET_IN_env.local__'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('不允许使用占位符')
      expect(err.message).toContain('APP_SECRET')
    }
  })

  it('should throw when local has undeclared key (not in secret/localOnly/localOverride)', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      DATABASE_URL: '__SET_IN_env.local__'
    })
    writeEnvFile(tempDir, '.env.development.local', {
      APP_SECRET: 'real-value',
      UNDECLARED_KEY: 'some-value'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('未声明的键')
      expect(err.message).toContain('UNDECLARED_KEY')
    }
  })

  it('should throw when key is duplicated across secret and localOnly categories', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir, {
      secretKeys: ['APP_SECRET'],
      localOnlyKeys: ['APP_SECRET'] // Duplicate!
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('keys 分类存在重复')
      expect(err.message).toContain('APP_SECRET')
    }
  })

  it('should throw when localOnly key appears in committed file', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir, {
      secretKeys: ['APP_SECRET'],
      localOnlyKeys: ['LOCAL_DEBUG_KEY']
    })
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      LOCAL_DEBUG_KEY: 'should-not-be-here'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('localOnly')
      expect(err.message).toContain('LOCAL_DEBUG_KEY')
      expect(err.message).toContain('不允许出现')
    }
  })

  it('should pass when secret key in committed (placeholder) and real value in local', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      DATABASE_URL: '__SET_IN_env.local__'
    })
    writeEnvFile(tempDir, '.env.development.local', {
      APP_SECRET: 'real-secret-value',
      DATABASE_URL: 'postgres://localhost/db'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })

  it('should pass when localOnly key only appears in local file', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir, {
      secretKeys: ['APP_SECRET'],
      localOnlyKeys: ['LOCAL_DEBUG_KEY']
    })
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__'
    })
    writeEnvFile(tempDir, '.env.development.local', {
      APP_SECRET: 'real-value',
      LOCAL_DEBUG_KEY: 'debug-value'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })

  it('should pass when localOverride key appears in both committed and local', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir, {
      secretKeys: ['APP_SECRET'],
      localOverrideKeys: ['LOG_LEVEL']
    })
    writeEnvFile(tempDir, '.env.development', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      LOG_LEVEL: 'info'
    })
    writeEnvFile(tempDir, '.env.development.local', {
      APP_SECRET: 'real-value',
      LOG_LEVEL: 'debug' // Override committed value
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })
})

// ============================================================================
// .env.example POLICY
// ============================================================================

describe('validateEnvironment() - .env.example Policy', () => {
  it('should throw when secret key in .env.example has non-placeholder value', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.example', {
      APP_ENV: 'development',
      APP_SECRET: 'real-secret-value', // Should be placeholder!
      DATABASE_URL: '__SET_IN_env.local__'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('.env.example')
      expect(err.message).toContain('必须使用占位符')
      expect(err.message).toContain('APP_SECRET')
    }
  })

  it('should throw when localOnly key appears in .env.example', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir, {
      secretKeys: ['APP_SECRET'],
      localOnlyKeys: ['LOCAL_DEBUG_KEY']
    })
    writeEnvFile(tempDir, '.env.example', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      LOCAL_DEBUG_KEY: 'should-not-be-here'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).toThrow()
    try {
      validateEnvironment()
    } catch (err) {
      expect(err.message).toContain('.env.example')
      expect(err.message).toContain('不允许包含 localOnly')
      expect(err.message).toContain('LOCAL_DEBUG_KEY')
    }
  })

  it('should pass when secret keys in .env.example use correct placeholder', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    writeEnvFile(tempDir, '.env.example', {
      APP_ENV: 'development',
      APP_SECRET: '__SET_IN_env.local__',
      DATABASE_URL: '__SET_IN_env.local__'
    })
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })

  it('should pass when .env.example does not exist', async () => {
    process.env.DX_PROJECT_ROOT = tempDir
    process.env.DX_CONFIG_DIR = join(tempDir, 'dx/config')
    
    createMinimalPolicy(tempDir)
    // No .env.example file created
    
    const { validateEnvironment } = await import('../lib/validate-env.js')
    
    expect(() => validateEnvironment()).not.toThrow()
  })
})
