import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadEnvPolicy,
  validateEnvPolicy,
  resolvePolicyTargetId,
  resolveTargetRequiredVars,
} from '../lib/env-policy.js'

// Valid base policy fixture
const validPolicy = {
  version: 1,
  environments: ['development', 'production'],
  secretPlaceholder: '__SET_IN_env.local__',
  layout: {
    forbidExact: ['.env', '.env.local'],
    allowRoot: ['.env.{env}', '.env.{env}.local'],
    allowSubdirGlobs: ['docker/.env*'],
  },
  keys: {
    secret: ['APP_SECRET', 'DATABASE_URL'],
    localOnly: [],
    localOverride: [],
  },
  appToTarget: {
    backend: 'backend',
    front: 'frontend',
    'admin-front': 'frontend',
  },
  targets: {
    backend: {
      files: {
        committed: '.env.{env}',
        local: '.env.{env}.local',
      },
      required: {
        _common: ['APP_ENV'],
        development: ['DATABASE_URL', 'APP_SECRET'],
        production: ['DATABASE_URL', 'APP_SECRET'],
      },
    },
    frontend: {
      files: {
        committed: '.env.{env}',
        local: '.env.{env}.local',
      },
      required: {
        _common: ['NEXT_PUBLIC_APP_ENV', 'VITE_APP_ENV'],
        development: [],
        production: [],
      },
    },
  },
}

describe('loadEnvPolicy (JSONC comment support)', () => {
  it('should parse env-policy.jsonc that contains // and /* */ comments', () => {
    // env-policy.jsonc is JSONC in practice; dx strips comments before JSON.parse.
    // This test ensures comment support does not regress.
    const root = mkdtempSync(join(tmpdir(), 'dx-env-policy-jsonc-'))
    try {
      const configDir = join(root, 'dx', 'config')
      mkdirSync(configDir, { recursive: true })

      const policyJsonc = `// top comment\n{
  /* block comment */
  "version": 1,
  "environments": ["development"],
  "layout": {
    "forbidExact": [".env"],
    "allowRoot": [".env.{env}", ".env.{env}.local"],
    "allowSubdirGlobs": []
  },
  "secretPlaceholder": "__SET_IN_env.local__",
  "keys": { "secret": [], "localOnly": [], "localOverride": [] },
  "appToTarget": { "backend": "backend" },
  "targets": {
    "backend": {
      "files": { "committed": ".env.{env}", "local": ".env.{env}.local" },
      "required": { "_common": [], "development": [] }
    }
  }
}\n`

      writeFileSync(join(configDir, 'env-policy.jsonc'), policyJsonc)

      // Ensure no cross-test configDir caching confusion.
      jest.resetModules()

      const loaded = loadEnvPolicy(configDir)
      expect(loaded).toBeTruthy()
      expect(loaded.version).toBe(1)
      expect(Array.isArray(loaded.environments)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('validateEnvPolicy', () => {
  describe('version validation', () => {
    it('should reject policy with version !== 1', () => {
      const policy = { ...validPolicy, version: 2 }
      expect(() => validateEnvPolicy(policy)).toThrow(/version.*1/)
    })

    it('should reject policy with missing version', () => {
      const policy = { ...validPolicy }
      delete policy.version
      expect(() => validateEnvPolicy(policy)).toThrow(/version.*1/)
    })

    it('should accept policy with version 1', () => {
      expect(() => validateEnvPolicy(validPolicy)).not.toThrow()
    })
  })

  describe('environments validation', () => {
    it('should reject policy with missing environments', () => {
      const policy = { ...validPolicy }
      delete policy.environments
      expect(() => validateEnvPolicy(policy)).toThrow(/environments/)
    })

    it('should accept policy with empty environments array', () => {
      const policy = { ...validPolicy, environments: [] }
      expect(() => validateEnvPolicy(policy)).not.toThrow()
    })

    it('should reject environments with non-string values', () => {
      const policy = { ...validPolicy, environments: ['development', 123] }
      expect(() => validateEnvPolicy(policy)).toThrow(/environments/)
    })

    it('should reject environments with empty string', () => {
      const policy = { ...validPolicy, environments: ['development', ''] }
      expect(() => validateEnvPolicy(policy)).toThrow(/environments/)
    })
  })

  describe('secretPlaceholder validation', () => {
    it('should reject missing secretPlaceholder', () => {
      const policy = { ...validPolicy }
      delete policy.secretPlaceholder
      expect(() => validateEnvPolicy(policy)).toThrow(/secretPlaceholder/)
    })

    it('should reject empty secretPlaceholder', () => {
      const policy = { ...validPolicy, secretPlaceholder: '' }
      expect(() => validateEnvPolicy(policy)).toThrow(/secretPlaceholder/)
    })

    it('should reject non-string secretPlaceholder', () => {
      const policy = { ...validPolicy, secretPlaceholder: 123 }
      expect(() => validateEnvPolicy(policy)).toThrow(/secretPlaceholder/)
    })
  })

  describe('keys validation', () => {
    it('should reject missing keys', () => {
      const policy = { ...validPolicy }
      delete policy.keys
      expect(() => validateEnvPolicy(policy)).toThrow(/keys/)
    })

    it('should reject keys.secret with non-string values', () => {
      const policy = {
        ...validPolicy,
        keys: { ...validPolicy.keys, secret: ['KEY1', 123] },
      }
      expect(() => validateEnvPolicy(policy)).toThrow(/secret/)
    })

    it('should accept optional localOnly and localOverride', () => {
      const policy = {
        ...validPolicy,
        keys: {
          secret: ['APP_SECRET'],
          localOnly: ['LOCAL_KEY'],
          localOverride: ['OVERRIDE_KEY'],
        },
      }
      expect(() => validateEnvPolicy(policy)).not.toThrow()
    })
  })

  describe('layout validation', () => {
    it('should reject missing layout', () => {
      const policy = { ...validPolicy }
      delete policy.layout
      expect(() => validateEnvPolicy(policy)).toThrow(/layout/)
    })

    it('should accept layout with all fields present', () => {
      expect(() => validateEnvPolicy(validPolicy)).not.toThrow()
    })
  })

  describe('appToTarget validation', () => {
    it('should reject appToTarget pointing to non-existent target', () => {
      const policy = {
        ...validPolicy,
        appToTarget: {
          backend: 'backend',
          front: 'non_existent_target',
        },
      }
      expect(() => validateEnvPolicy(policy)).toThrow(/appToTarget.*non_existent_target/)
    })

    it('should accept appToTarget mapping all apps to existing targets', () => {
      expect(() => validateEnvPolicy(validPolicy)).not.toThrow()
    })

    it('should accept empty appToTarget', () => {
      const policy = { ...validPolicy, appToTarget: {} }
      expect(() => validateEnvPolicy(policy)).not.toThrow()
    })
  })

  describe('targets validation', () => {
    it('should reject empty targets', () => {
      const policy = { ...validPolicy, targets: {} }
      expect(() => validateEnvPolicy(policy)).toThrow(/targets.*不能为空/)
    })

    it('should reject missing targets', () => {
      const policy = { ...validPolicy }
      delete policy.targets
      expect(() => validateEnvPolicy(policy)).toThrow(/targets/)
    })

    it('should reject target with missing files', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            required: {},
          },
        },
      }
      expect(() => validateEnvPolicy(policy)).toThrow(/files/)
    })

    it('should reject target files.committed as empty string', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            files: {
              committed: '',
              local: '.env.{env}.local',
            },
            required: {},
          },
        },
      }
      expect(() => validateEnvPolicy(policy)).toThrow(/committed/)
    })

    it('should reject target files.local as empty string', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            files: {
              committed: '.env.{env}',
              local: '',
            },
            required: {},
          },
        },
      }
      expect(() => validateEnvPolicy(policy)).toThrow(/local/)
    })

    it('should reject target required with non-string array', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            files: {
              committed: '.env.{env}',
              local: '.env.{env}.local',
            },
            required: {
              development: ['KEY1', 123],
            },
          },
        },
      }
      expect(() => validateEnvPolicy(policy)).toThrow(/required/)
    })
  })

  describe('full policy validation', () => {
    it('should accept valid policy from example', () => {
      expect(() => validateEnvPolicy(validPolicy)).not.toThrow()
    })

    it('should reject non-object policy', () => {
      expect(() => validateEnvPolicy(null)).toThrow()
      expect(() => validateEnvPolicy('string')).toThrow()
      expect(() => validateEnvPolicy([])).toThrow()
    })
  })
})

describe('resolvePolicyTargetId', () => {
  describe('app mapping', () => {
    it('should map front to frontend', () => {
      const targetId = resolvePolicyTargetId(validPolicy, 'front')
      expect(targetId).toBe('frontend')
    })

    it('should map admin-front to frontend', () => {
      const targetId = resolvePolicyTargetId(validPolicy, 'admin-front')
      expect(targetId).toBe('frontend')
    })

    it('should map backend to backend', () => {
      const targetId = resolvePolicyTargetId(validPolicy, 'backend')
      expect(targetId).toBe('backend')
    })

    it('should return null for unknown app', () => {
      const targetId = resolvePolicyTargetId(validPolicy, 'unknown-app')
      expect(targetId).toBeNull()
    })

    it('should return null when policy is null', () => {
      const targetId = resolvePolicyTargetId(null, 'backend')
      expect(targetId).toBeNull()
    })

    it('should return null when app is null', () => {
      const targetId = resolvePolicyTargetId(validPolicy, null)
      expect(targetId).toBeNull()
    })

    it('should return null when policy is undefined', () => {
      const targetId = resolvePolicyTargetId(undefined, 'backend')
      expect(targetId).toBeNull()
    })

    it('should return null when app is undefined', () => {
      const targetId = resolvePolicyTargetId(validPolicy, undefined)
      expect(targetId).toBeNull()
    })

    it('should return null when appToTarget is missing', () => {
      const policy = { ...validPolicy }
      delete policy.appToTarget
      const targetId = resolvePolicyTargetId(policy, 'backend')
      expect(targetId).toBeNull()
    })
  })
})

describe('resolveTargetRequiredVars', () => {
  describe('required vars resolution', () => {
    it('should return union of _common and development for backend+development', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'backend', 'development')
      expect(new Set(vars)).toEqual(
        new Set(['APP_ENV', 'DATABASE_URL', 'APP_SECRET']),
      )
    })

    it('should deduplicate when _common and environment have overlap', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            files: {
              committed: '.env.{env}',
              local: '.env.{env}.local',
            },
            required: {
              _common: ['APP_ENV', 'DATABASE_URL'],
              development: ['DATABASE_URL', 'APP_SECRET'],
            },
          },
        },
      }
      const vars = resolveTargetRequiredVars(policy, 'backend', 'development')
      // Should have 3 unique values, not 4
      expect(vars).toHaveLength(3)
      expect(new Set(vars)).toEqual(
        new Set(['APP_ENV', 'DATABASE_URL', 'APP_SECRET']),
      )
    })

    it('should return only _common for frontend+development (no dev-specific)', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'frontend', 'development')
      expect(new Set(vars)).toEqual(
        new Set(['NEXT_PUBLIC_APP_ENV', 'VITE_APP_ENV']),
      )
    })

    it('should return only _common for frontend+production (no prod-specific)', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'frontend', 'production')
      expect(new Set(vars)).toEqual(
        new Set(['NEXT_PUBLIC_APP_ENV', 'VITE_APP_ENV']),
      )
    })

    it('should return backend production vars (union of _common and production)', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'backend', 'production')
      expect(new Set(vars)).toEqual(
        new Set(['APP_ENV', 'DATABASE_URL', 'APP_SECRET']),
      )
    })
  })

  describe('edge cases', () => {
    it('should return empty array for non-existent targetId', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'non-existent', 'development')
      expect(vars).toEqual([])
    })

    it('should return empty array when policy is null', () => {
      const vars = resolveTargetRequiredVars(null, 'backend', 'development')
      expect(vars).toEqual([])
    })

    it('should return empty array when targetId is null', () => {
      const vars = resolveTargetRequiredVars(validPolicy, null, 'development')
      expect(vars).toEqual([])
    })

    it('should return empty array when policy is undefined', () => {
      const vars = resolveTargetRequiredVars(undefined, 'backend', 'development')
      expect(vars).toEqual([])
    })

    it('should return empty array when targetId is undefined', () => {
      const vars = resolveTargetRequiredVars(validPolicy, undefined, 'development')
      expect(vars).toEqual([])
    })

    it('should return _common when environment does not exist in required', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'backend', 'staging')
      expect(vars).toEqual(['APP_ENV'])
    })

    it('should return empty array when target has no required field', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            files: {
              committed: '.env.{env}',
              local: '.env.{env}.local',
            },
          },
        },
      }
      const vars = resolveTargetRequiredVars(policy, 'backend', 'development')
      expect(vars).toEqual([])
    })

    it('should return empty array when required field is empty object', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            files: {
              committed: '.env.{env}',
              local: '.env.{env}.local',
            },
            required: {},
          },
        },
      }
      const vars = resolveTargetRequiredVars(policy, 'backend', 'development')
      expect(vars).toEqual([])
    })

    it('should handle null environment parameter gracefully', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'backend', null)
      expect(vars).toEqual(['APP_ENV'])
    })
  })

  describe('set semantics', () => {
    it('should return result as array (not Set)', () => {
      const vars = resolveTargetRequiredVars(validPolicy, 'backend', 'development')
      expect(Array.isArray(vars)).toBe(true)
    })

    it('should not have duplicate values in result array', () => {
      const policy = {
        ...validPolicy,
        targets: {
          backend: {
            files: {
              committed: '.env.{env}',
              local: '.env.{env}.local',
            },
            required: {
              _common: ['KEY1', 'KEY2'],
              development: ['KEY2', 'KEY3', 'KEY1'],
            },
          },
        },
      }
      const vars = resolveTargetRequiredVars(policy, 'backend', 'development')
      expect(vars).toHaveLength(3)
      expect(new Set(vars)).toEqual(new Set(['KEY1', 'KEY2', 'KEY3']))
    })
  })
})
