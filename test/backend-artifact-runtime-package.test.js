import { describe, expect, test } from '@jest/globals'
import { createRuntimePackage } from '../lib/backend-artifact-deploy/runtime-package.js'

describe('createRuntimePackage', () => {
  test('generates runtime package.json with required fields only', () => {
    const runtimePackage = createRuntimePackage({
      appPackage: {
        name: '@repo/backend',
        version: '1.2.3',
        private: true,
        type: 'module',
        dependencies: {
          express: '^4.0.0',
        },
        devDependencies: {
          prisma: '^6.0.0',
        },
      },
      rootPackage: {
        packageManager: 'pnpm@10.0.0',
        engines: {
          node: '>=20.11.0',
        },
      },
    })

    expect(runtimePackage).toEqual({
      name: '@repo/backend',
      version: '1.2.3',
      private: true,
      type: 'module',
      dependencies: {
        express: '^4.0.0',
        prisma: '^6.0.0',
      },
      packageManager: 'pnpm@10.0.0',
      engines: {
        node: '>=20.11.0',
      },
    })
  })

  test('preserves prisma cli from devDependencies for remote deploy flows', () => {
    const runtimePackage = createRuntimePackage({
      appPackage: {
        name: '@repo/backend',
        version: '1.2.3',
        dependencies: {
          express: '^4.0.0',
        },
        devDependencies: {
          prisma: '^6.0.0',
        },
      },
      rootPackage: {},
    })

    expect(runtimePackage.dependencies).toEqual({
      express: '^4.0.0',
      prisma: '^6.0.0',
    })
  })

  test('fails on workspace dependencies that cannot be installed remotely', () => {
    expect(() =>
      createRuntimePackage({
        appPackage: {
          name: '@repo/backend',
          version: '1.2.3',
          dependencies: {
            '@repo/shared': 'workspace:*',
          },
        },
        rootPackage: {},
      }),
    ).toThrow('@repo/shared')
  })

  test('fails on other non-installable local dependency references', () => {
    expect(() =>
      createRuntimePackage({
        appPackage: {
          name: '@repo/backend',
          version: '1.2.3',
          dependencies: {
            '@repo/shared': 'file:../shared',
            '@repo/core': 'link:../core',
          },
        },
        rootPackage: {},
      }),
    ).toThrow('@repo/shared')
  })
})
