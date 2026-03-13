import { describe, expect, jest, test } from '@jest/globals'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildBackendArtifact,
  buildFlagsForEnvironment,
  createArtifactNames,
  createStagePlan,
} from '../lib/backend-artifact-deploy/artifact-builder.js'

describe('backend artifact builder', () => {
  test('builds inner archive, checksum, and outer bundle metadata', async () => {
    const deps = {
      nowTag: jest.fn(() => '20260312-010203'),
      readVersion: jest.fn(async () => '1.2.3'),
      runBuild: jest.fn(async () => {}),
      prepareOutputDir: jest.fn(async () => {}),
      stageFiles: jest.fn(async () => {}),
      assertNoEnvFiles: jest.fn(async () => {}),
      createInnerArchive: jest.fn(async () => {}),
      writeChecksum: jest.fn(async () => {}),
      createBundle: jest.fn(async () => {}),
    }

    const result = await buildBackendArtifact(
      {
        environment: 'production',
        build: {
          command: 'npx nx build backend --configuration=production',
          distDir: '/repo/dist/backend',
          versionFile: '/repo/apps/backend/package.json',
        },
        runtime: {
          appPackage: '/repo/apps/backend/package.json',
          rootPackage: '/repo/package.json',
          lockfile: '/repo/pnpm-lock.yaml',
          prismaSchemaDir: '/repo/apps/backend/prisma/schema',
          prismaConfig: '/repo/apps/backend/prisma.config.ts',
          ecosystemConfig: '/repo/ecosystem.config.cjs',
        },
        artifact: {
          outputDir: '/repo/release/backend',
          bundleName: 'backend-bundle',
        },
      },
      deps,
    )

    expect(result).toEqual({
      version: '1.2.3',
      timeTag: '20260312-010203',
      versionName: 'backend-v1.2.3-20260312-010203',
      bundlePath: '/repo/release/backend/backend-bundle-v1.2.3-20260312-010203.tgz',
      innerArchivePath: '/repo/release/backend/backend-v1.2.3-20260312-010203.tgz',
      checksumPath: '/repo/release/backend/backend-v1.2.3-20260312-010203.tgz.sha256',
    })
    expect(deps.runBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npx nx build backend --configuration=production',
      }),
      'production',
    )
    expect(deps.createBundle).toHaveBeenCalled()
  })

  test('fails when staged payload contains env files', async () => {
    const deps = {
      nowTag: jest.fn(() => '20260312-010203'),
      readVersion: jest.fn(async () => '1.2.3'),
      runBuild: jest.fn(async () => {}),
      prepareOutputDir: jest.fn(async () => {}),
      stageFiles: jest.fn(async () => {}),
      assertNoEnvFiles: jest.fn(async () => {
        throw new Error('制品目录包含 .env* 文件')
      }),
      createInnerArchive: jest.fn(async () => {}),
      writeChecksum: jest.fn(async () => {}),
      createBundle: jest.fn(async () => {}),
    }

    await expect(
      buildBackendArtifact(
        {
          build: { command: 'build', versionFile: '/repo/apps/backend/package.json' },
          runtime: { appPackage: '/repo/apps/backend/package.json', rootPackage: '/repo/package.json', lockfile: '/repo/pnpm-lock.yaml' },
          artifact: { outputDir: '/repo/release/backend', bundleName: 'backend-bundle' },
        },
        deps,
      ),
    ).rejects.toThrow('.env')
  })

  test('preserves paths relative to distDir and writes runtime files at release root', () => {
    const plan = createStagePlan({
      build: {
        distDir: '/repo/dist/backend',
      },
      runtime: {
        appPackage: '/repo/apps/backend/package.json',
        rootPackage: '/repo/package.json',
        lockfile: '/repo/pnpm-lock.yaml',
      },
    })

    expect(plan.dist.source).toBe('/repo/dist/backend')
    expect(plan.dist.destination).toBe('.')
    expect(plan.runtimePackage.destination).toBe('package.json')
    expect(plan.lockfile.destination).toBe('pnpm-lock.yaml')
  })

  test('stages prisma and ecosystem files at configured relative paths', () => {
    const plan = createStagePlan({
      build: {
        distDir: '/repo/dist/backend',
      },
      runtime: {
        appPackage: '/repo/apps/backend/package.json',
        rootPackage: '/repo/package.json',
        lockfile: '/repo/pnpm-lock.yaml',
        prismaSchemaDir: '/repo/apps/backend/prisma/schema',
        prismaConfig: '/repo/apps/backend/prisma.config.ts',
        ecosystemConfig: '/repo/ecosystem.config.cjs',
      },
    })

    expect(plan.prismaSchema.destination).toBe('apps/backend/prisma/schema')
    expect(plan.prismaConfig.destination).toBe('apps/backend/prisma.config.ts')
    expect(plan.ecosystemConfig.destination).toBe('ecosystem.config.cjs')
  })

  test('uses exact release naming and checksum contract', () => {
    expect(createArtifactNames({ version: '1.2.3', timeTag: '20260312-010203', bundleName: 'backend-bundle' })).toEqual({
      versionName: 'backend-v1.2.3-20260312-010203',
      innerArchiveName: 'backend-v1.2.3-20260312-010203.tgz',
      checksumName: 'backend-v1.2.3-20260312-010203.tgz.sha256',
      bundleName: 'backend-bundle-v1.2.3-20260312-010203.tgz',
    })
  })

  test('maps deploy environment to exec flags used by env layer detection', () => {
    expect(buildFlagsForEnvironment('production')).toEqual({ prod: true })
    expect(buildFlagsForEnvironment('staging')).toEqual({ staging: true })
    expect(buildFlagsForEnvironment('development')).toEqual({ dev: true })
    expect(buildFlagsForEnvironment(undefined)).toEqual({ dev: true })
    expect(buildFlagsForEnvironment('unknown')).toEqual({ dev: true })
  })

  test('rejects local output paths that escape the configured artifact directory', async () => {
    const deps = {
      nowTag: jest.fn(() => '../escape'),
      readVersion: jest.fn(async () => '1.2.3'),
      runBuild: jest.fn(async () => {}),
      prepareOutputDir: jest.fn(async () => {}),
      stageFiles: jest.fn(async () => {}),
      assertNoEnvFiles: jest.fn(async () => {}),
      createInnerArchive: jest.fn(async () => {}),
      writeChecksum: jest.fn(async () => {}),
      createBundle: jest.fn(async () => {}),
    }

    await expect(
      buildBackendArtifact(
        {
          build: { command: 'build', versionFile: '/repo/apps/backend/package.json' },
          runtime: { appPackage: '/repo/apps/backend/package.json', rootPackage: '/repo/package.json', lockfile: '/repo/pnpm-lock.yaml' },
          artifact: { outputDir: '/repo/release/backend', bundleName: 'backend-bundle' },
        },
        deps,
      ),
    ).rejects.toThrow('越界')
  })

  test('rejects nested .env files anywhere in the staged payload', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'dx-artifact-stage-'))

    try {
      await expect(
        buildBackendArtifact(
          {
            build: { command: 'build', versionFile: join(tempDir, 'package.json') },
            runtime: {
              appPackage: join(tempDir, 'app-package.json'),
              rootPackage: join(tempDir, 'root-package.json'),
              lockfile: join(tempDir, 'pnpm-lock.yaml'),
            },
            artifact: { outputDir: tempDir, bundleName: 'backend-bundle' },
          },
          {
            nowTag: jest.fn(() => '20260312-010203'),
            readVersion: jest.fn(async () => '1.2.3'),
            runBuild: jest.fn(async () => {}),
            prepareOutputDir: jest.fn(async () => {}),
            stageFiles: jest.fn(async ({ stageDir }) => {
              const nestedDir = join(stageDir, 'apps/backend')
              mkdirSync(nestedDir, { recursive: true })
              writeFileSync(join(nestedDir, '.env.production'), 'SECRET=1\n')
            }),
            createInnerArchive: jest.fn(async () => {
              throw new Error('archive step should not run')
            }),
            writeChecksum: jest.fn(async () => {}),
            createBundle: jest.fn(async () => {}),
          },
        ),
      ).rejects.toThrow('.env.production')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('writes checksum using the archive basename instead of an absolute path', async () => {
    const deps = {
      nowTag: jest.fn(() => '20260312-010203'),
      readVersion: jest.fn(async () => '1.2.3'),
      runBuild: jest.fn(async () => {}),
      prepareOutputDir: jest.fn(async () => {}),
      stageFiles: jest.fn(async () => {}),
      assertNoEnvFiles: jest.fn(async () => {}),
      createInnerArchive: jest.fn(async () => {}),
      writeChecksum: jest.fn(async () => {}),
      createBundle: jest.fn(async () => {}),
    }

    await buildBackendArtifact(
      {
        build: { command: 'build', versionFile: '/repo/apps/backend/package.json' },
        runtime: { appPackage: '/repo/apps/backend/package.json', rootPackage: '/repo/package.json', lockfile: '/repo/pnpm-lock.yaml' },
        artifact: { outputDir: '/repo/release/backend', bundleName: 'backend-bundle' },
      },
      deps,
    )

    expect(deps.writeChecksum).toHaveBeenCalledWith({
      archivePath: '/repo/release/backend/backend-v1.2.3-20260312-010203.tgz',
      checksumPath: '/repo/release/backend/backend-v1.2.3-20260312-010203.tgz.sha256',
    })
  })
})
