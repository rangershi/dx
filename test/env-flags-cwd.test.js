import { describe, expect, test } from '@jest/globals'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvManager } from '../lib/env.js'

describe('EnvManager buildEnvFlags', () => {
  test('can emit absolute env file paths for commands that run with a nested cwd', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'dx-env-flags-test-'))
    const configDir = join(projectRoot, 'dx', 'config')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'env-layers.json'),
      JSON.stringify({ e2e: ['.env.e2e', '.env.e2e.local'] }),
    )

    const previousProjectRoot = process.env.DX_PROJECT_ROOT
    const previousConfigDir = process.env.DX_CONFIG_DIR
    process.env.DX_PROJECT_ROOT = projectRoot
    process.env.DX_CONFIG_DIR = configDir

    try {
      const manager = new EnvManager()
      expect(manager.buildEnvFlags('backend', 'e2e', { absolute: true })).toBe(
        `-e ${join(projectRoot, '.env.e2e')} -e ${join(projectRoot, '.env.e2e.local')}`,
      )
    } finally {
      if (previousProjectRoot === undefined) delete process.env.DX_PROJECT_ROOT
      else process.env.DX_PROJECT_ROOT = previousProjectRoot
      if (previousConfigDir === undefined) delete process.env.DX_CONFIG_DIR
      else process.env.DX_CONFIG_DIR = previousConfigDir
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})
