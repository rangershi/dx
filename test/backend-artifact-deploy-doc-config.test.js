import { readFileSync } from 'node:fs'
import { describe, expect, test } from '@jest/globals'

describe('backend artifact deploy docs and example config', () => {
  test('example commands config documents backend artifact deploy shape', () => {
    const source = readFileSync(new URL('../example/dx/config/commands.json', import.meta.url), 'utf8')
    const config = JSON.parse(source)

    expect(config.deploy.backend.internal).toBe('backend-artifact-deploy')
    expect(config.deploy.backend.backendDeploy.build.commands.production).toContain('npx nx build backend')
    expect(config.deploy.backend.backendDeploy.remote.baseDir).toBe('/srv/example-app')
  })

  test('README documents backend artifact deploy command and fixed remote layout', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

    expect(readme).toContain('dx deploy backend --prod')
    expect(readme).toContain('--build-only')
    expect(readme).toContain('--skip-migration')
    expect(readme).toContain('<baseDir>/releases/<version-name>')
    expect(readme).toContain('<baseDir>/current')
    expect(readme).toContain('<baseDir>/shared/.env.<environment>')
  })
})
