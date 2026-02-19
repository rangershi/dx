import { describe, expect, test } from '@jest/globals'
import { mergeLayeredDeployEnv } from '../lib/cli/commands/deploy.js'

describe('mergeLayeredDeployEnv', () => {
  test('保留外部注入的真实 VERCEL_TOKEN，不被占位符覆盖', () => {
    const runtimeEnv = {
      VERCEL_TOKEN: 'from-github-secret',
    }
    const layeredEnv = {
      VERCEL_TOKEN: '__SET_IN_env.local__',
    }
    const envManager = {
      isPlaceholderEnvValue(value) {
        return String(value).includes('__SET_IN_env.local__')
      },
    }

    mergeLayeredDeployEnv(layeredEnv, envManager, runtimeEnv)

    expect(runtimeEnv.VERCEL_TOKEN).toBe('from-github-secret')
  })

  test('当现有值为占位符时，允许 layer 的真实值覆盖关键变量', () => {
    const runtimeEnv = {
      VERCEL_TOKEN: '__SET_IN_env.local__',
    }
    const layeredEnv = {
      VERCEL_TOKEN: 'real-token-in-local',
    }
    const envManager = {
      isPlaceholderEnvValue(value) {
        return String(value).includes('__SET_IN_env.local__')
      },
    }

    mergeLayeredDeployEnv(layeredEnv, envManager, runtimeEnv)

    expect(runtimeEnv.VERCEL_TOKEN).toBe('real-token-in-local')
  })

  test('非关键变量保持原有语义：仅在缺失或占位时覆盖', () => {
    const runtimeEnv = {
      SOME_KEY: 'keep-me',
      SOME_EMPTY_KEY: '__SET_IN_env.local__',
    }
    const layeredEnv = {
      SOME_KEY: 'layer-value',
      SOME_EMPTY_KEY: 'filled-by-layer',
    }
    const envManager = {
      isPlaceholderEnvValue(value) {
        return String(value).includes('__SET_IN_env.local__')
      },
    }

    mergeLayeredDeployEnv(layeredEnv, envManager, runtimeEnv)

    expect(runtimeEnv.SOME_KEY).toBe('keep-me')
    expect(runtimeEnv.SOME_EMPTY_KEY).toBe('filled-by-layer')
  })
})
