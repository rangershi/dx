import { envManager } from '../lib/env.js'

describe('Placeholder Detection Semantics', () => {
  describe('isPlaceholderEnvValue()', () => {
    describe('should return true (is placeholder)', () => {
      test('empty string', () => {
        expect(envManager.isPlaceholderEnvValue('')).toBe(true)
      })

      test('whitespace only', () => {
        expect(envManager.isPlaceholderEnvValue('   ')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('\t')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('\n')).toBe(true)
      })

      test('string "null"', () => {
        expect(envManager.isPlaceholderEnvValue('null')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('NULL')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('Null')).toBe(true)
      })

      test('string "undefined"', () => {
        expect(envManager.isPlaceholderEnvValue('undefined')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('UNDEFINED')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('Undefined')).toBe(true)
      })

      test('double quoted empty string', () => {
        expect(envManager.isPlaceholderEnvValue('""')).toBe(true)
      })

      test('single quoted empty string', () => {
        expect(envManager.isPlaceholderEnvValue("''")).toBe(true)
      })

      test('backtick quoted empty string', () => {
        expect(envManager.isPlaceholderEnvValue('``')).toBe(true)
      })

      test('quoted empty with internal whitespace', () => {
        expect(envManager.isPlaceholderEnvValue('" "')).toBe(true)
        expect(envManager.isPlaceholderEnvValue("' '")).toBe(true)
        expect(envManager.isPlaceholderEnvValue('`  `')).toBe(true)
      })

      test('contains __SET_IN_env.local__ token', () => {
        expect(envManager.isPlaceholderEnvValue('__SET_IN_env.local__')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('some_prefix__SET_IN_env.local__')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('__SET_IN_env.local__some_suffix')).toBe(true)
      })

      test('whitespace around placeholder token', () => {
        expect(envManager.isPlaceholderEnvValue('  __SET_IN_env.local__  ')).toBe(true)
      })
    })

    describe('should return false (not placeholder)', () => {
      test('normal string value', () => {
        expect(envManager.isPlaceholderEnvValue('postgres://localhost/db')).toBe(false)
      })

      test('environment name value', () => {
        expect(envManager.isPlaceholderEnvValue('production')).toBe(false)
      })

      test('quoted non-empty string', () => {
        expect(envManager.isPlaceholderEnvValue('"value"')).toBe(false)
        expect(envManager.isPlaceholderEnvValue("'value'")).toBe(false)
        expect(envManager.isPlaceholderEnvValue('`value`')).toBe(false)
      })

      test('zero value', () => {
        expect(envManager.isPlaceholderEnvValue('0')).toBe(false)
      })

      test('false value', () => {
        expect(envManager.isPlaceholderEnvValue('false')).toBe(false)
      })

      test('url with protocol', () => {
        expect(envManager.isPlaceholderEnvValue('http://localhost:3000')).toBe(false)
      })

      test('json-like value', () => {
        expect(envManager.isPlaceholderEnvValue('{"key":"value"}')).toBe(false)
      })

      test('apikey-like value', () => {
        expect(envManager.isPlaceholderEnvValue('sk_test_1234567890')).toBe(false)
      })

      test('semicolon path', () => {
        expect(envManager.isPlaceholderEnvValue('/usr/bin:/usr/local/bin')).toBe(false)
      })
    })

    describe('edge cases', () => {
      test('quoted null string is also a placeholder', () => {
        expect(envManager.isPlaceholderEnvValue('"null"')).toBe(true)
        expect(envManager.isPlaceholderEnvValue("'null'")).toBe(true)
      })

      test('quoted undefined string is also a placeholder', () => {
        expect(envManager.isPlaceholderEnvValue('"undefined"')).toBe(true)
        expect(envManager.isPlaceholderEnvValue("'undefined'")).toBe(true)
      })

      test('whitespace around quoted values', () => {
        expect(envManager.isPlaceholderEnvValue(' "value" ')).toBe(false)
        expect(envManager.isPlaceholderEnvValue("  'value'  ")).toBe(false)
      })

      test('mismatched quotes (not treated as quoted)', () => {
        expect(envManager.isPlaceholderEnvValue('"value\'')).toBe(false)
        expect(envManager.isPlaceholderEnvValue('\'value"')).toBe(false)
      })

      test('null and undefined with surrounding whitespace', () => {
        expect(envManager.isPlaceholderEnvValue('  null  ')).toBe(true)
        expect(envManager.isPlaceholderEnvValue('\tundefined\t')).toBe(true)
      })
    })
  })

  describe('validateRequiredVars()', () => {
    describe('valid cases', () => {
      test('all vars present with real values', () => {
        const env = {
          DATABASE_URL: 'postgres://localhost/db',
          API_KEY: 'sk_test_1234567890',
          NODE_ENV: 'production',
        }
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY', 'NODE_ENV'],
          env
        )
        expect(result).toEqual({
          valid: true,
          missing: [],
          placeholders: [],
        })
      })

      test('empty required vars list', () => {
        const result = envManager.validateRequiredVars([], {})
        expect(result).toEqual({
          valid: true,
          missing: [],
          placeholders: [],
        })
      })

      test('single required var with real value', () => {
        const result = envManager.validateRequiredVars(['API_KEY'], {
          API_KEY: 'sk_test_1234567890',
        })
        expect(result).toEqual({
          valid: true,
          missing: [],
          placeholders: [],
        })
      })
    })

    describe('missing vars cases', () => {
      test('single missing var', () => {
        const result = envManager.validateRequiredVars(['DATABASE_URL'], {})
        expect(result).toEqual({
          valid: false,
          missing: ['DATABASE_URL'],
          placeholders: [],
        })
      })

      test('multiple missing vars', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY', 'SECRET'],
          { DATABASE_URL: 'postgres://localhost/db' }
        )
        expect(result).toEqual({
          valid: false,
          missing: ['API_KEY', 'SECRET'],
          placeholders: [],
        })
      })

      test('all vars missing', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY'],
          {}
        )
        expect(result).toEqual({
          valid: false,
          missing: ['DATABASE_URL', 'API_KEY'],
          placeholders: [],
        })
      })

      test('undefined value is treated as missing', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: undefined }
        )
        expect(result).toEqual({
          valid: false,
          missing: ['DATABASE_URL'],
          placeholders: [],
        })
      })

      test('null value is treated as missing', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: null }
        )
        expect(result).toEqual({
          valid: false,
          missing: ['DATABASE_URL'],
          placeholders: [],
        })
      })
    })

    describe('placeholder vars cases', () => {
      test('single var with placeholder (empty string)', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: '' }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['DATABASE_URL'],
        })
      })

      test('single var with placeholder (whitespace)', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: '   ' }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['DATABASE_URL'],
        })
      })

      test('single var with placeholder ("null")', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: 'null' }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['DATABASE_URL'],
        })
      })

      test('single var with placeholder ("undefined")', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: 'undefined' }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['DATABASE_URL'],
        })
      })

      test('single var with placeholder (quoted empty)', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: '""' }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['DATABASE_URL'],
        })
      })

      test('single var with placeholder token', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          { DATABASE_URL: '__SET_IN_env.local__' }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['DATABASE_URL'],
        })
      })

      test('multiple vars with placeholder', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY', 'SECRET'],
          {
            DATABASE_URL: '',
            API_KEY: 'null',
            SECRET: 'real_secret_value',
          }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['DATABASE_URL', 'API_KEY'],
        })
      })
    })

    describe('mixed cases (both missing and placeholder)', () => {
      test('one missing, one placeholder', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY'],
          { DATABASE_URL: '' }
        )
        expect(result).toEqual({
          valid: false,
          missing: ['API_KEY'],
          placeholders: ['DATABASE_URL'],
        })
      })

      test('multiple missing and multiple placeholder', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY', 'SECRET', 'TOKEN'],
          {
            DATABASE_URL: '',
            API_KEY: 'null',
            SECRET: undefined,
          }
        )
        expect(result).toEqual({
          valid: false,
          missing: ['SECRET', 'TOKEN'],
          placeholders: ['DATABASE_URL', 'API_KEY'],
        })
      })

      test('three vars: one valid, one missing, one placeholder', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY', 'NODE_ENV'],
          {
            DATABASE_URL: 'postgres://localhost/db',
            API_KEY: '  ',
          }
        )
        expect(result).toEqual({
          valid: false,
          missing: ['NODE_ENV'],
          placeholders: ['API_KEY'],
        })
      })
    })

    describe('integration with isPlaceholderEnvValue()', () => {
      test('all documented placeholder patterns are detected', () => {
        const result = envManager.validateRequiredVars(
          ['VAR1', 'VAR2', 'VAR3', 'VAR4', 'VAR5'],
          {
            VAR1: '',
            VAR2: 'null',
            VAR3: '""',
            VAR4: '__SET_IN_env.local__',
            VAR5: 'valid_value',
          }
        )
        expect(result).toEqual({
          valid: false,
          missing: [],
          placeholders: ['VAR1', 'VAR2', 'VAR3', 'VAR4'],
        })
      })

      test('normal values are not classified as placeholders', () => {
        const result = envManager.validateRequiredVars(
          ['VAR1', 'VAR2', 'VAR3', 'VAR4'],
          {
            VAR1: 'production',
            VAR2: 'http://localhost:3000',
            VAR3: '0',
            VAR4: '"normal_value"',
          }
        )
        expect(result).toEqual({
          valid: true,
          missing: [],
          placeholders: [],
        })
      })
    })

    describe('explicit env object parameter', () => {
      test('uses provided env object instead of process.env', () => {
        const customEnv = {
          DATABASE_URL: 'postgres://localhost/db',
          API_KEY: 'sk_test_1234567890',
        }
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL', 'API_KEY'],
          customEnv
        )
        expect(result.valid).toBe(true)
      })

      test('empty object for custom env', () => {
        const result = envManager.validateRequiredVars(
          ['DATABASE_URL'],
          {}
        )
        expect(result).toEqual({
          valid: false,
          missing: ['DATABASE_URL'],
          placeholders: [],
        })
      })
    })
  })
})
