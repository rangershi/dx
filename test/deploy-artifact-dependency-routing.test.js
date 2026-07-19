import { describe, expect, test } from '@jest/globals'
import { DxCli } from '../lib/cli/dx-cli.js'

function createCli({ command = 'deploy', target = 'backend', artifact } = {}) {
  return Object.assign(Object.create(DxCli.prototype), {
    command,
    subcommand: target,
    flags: artifact ? { artifact } : {},
    commands: {
      deploy: {
        backend: { internal: 'backend-artifact-deploy' },
        front: { description: 'Vercel target' },
      },
    },
  })
}

describe('artifact deploy dependency routing', () => {
  test('existing backend artifact does not require target project dependencies', () => {
    expect(createCli({ artifact: 'release/backend/backend-bundle-v1.tgz' }).requiresProjectDependencies()).toBe(false)
  })

  test.each([
    ['regular backend deploy', createCli()],
    ['Vercel deploy', createCli({ target: 'front', artifact: 'dist/front.tgz' })],
    ['non-deploy command', createCli({ command: 'build', artifact: 'dist/backend.tgz' })],
  ])('%s keeps the dependency check', (_label, cli) => {
    expect(cli.requiresProjectDependencies()).toBe(true)
  })
})
