import { describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DxCli } from '../lib/cli/dx-cli.js'

function createMinimalProject({ commandsJson, packageJson } = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dx-ensure-prisma-'))
  const configDir = join(projectRoot, 'dx', 'config')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'commands.json'),
    JSON.stringify(
      commandsJson ?? {
        install: { command: 'pnpm install', skipEnvValidation: true },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(projectRoot, 'package.json'),
    JSON.stringify(
      packageJson ?? {
        name: 'docs-site',
        private: true,
        devDependencies: { honkit: '^6.0.0' },
      },
      null,
      2,
    ),
  )
  return { projectRoot, configDir }
}

describe('DxCli.ensurePrismaClient', () => {
  let originalCwd
  let projectRoot

  beforeEach(() => {
    originalCwd = process.cwd()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true })
      projectRoot = null
    }
  })

  test('skips silently when the project does not install @prisma/client', async () => {
    const project = createMinimalProject()
    projectRoot = project.projectRoot
    process.chdir(projectRoot)

    const cli = new DxCli({ projectRoot, configDir: project.configDir })

    // 非 Prisma 项目应当直接跳过，即便没有配置 db.generate 也不应报错。
    await expect(cli.ensurePrismaClient()).resolves.toBeUndefined()
  })

  test('still errors loudly when @prisma/client is installed but db.generate is missing', async () => {
    const project = createMinimalProject()
    projectRoot = project.projectRoot
    process.chdir(projectRoot)

    // 模拟「项目确实安装了 @prisma/client，但尚未执行 prisma generate」的状态
    const clientDir = join(projectRoot, 'node_modules', '@prisma', 'client')
    mkdirSync(clientDir, { recursive: true })
    writeFileSync(
      join(clientDir, 'package.json'),
      JSON.stringify({ name: '@prisma/client', version: '5.0.0' }),
    )
    // 注意：故意不创建 default.js

    const cli = new DxCli({ projectRoot, configDir: project.configDir })

    const originalExit = process.exit
    let exitCode = null
    process.exit = code => {
      exitCode = code
      throw new Error('__process_exit_intercepted__')
    }
    try {
      await expect(cli.ensurePrismaClient()).rejects.toThrow('__process_exit_intercepted__')
      expect(exitCode).toBe(1)
    } finally {
      process.exit = originalExit
    }
  })
})
