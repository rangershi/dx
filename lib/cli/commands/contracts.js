import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../logger.js'
import { execManager } from '../../exec.js'

export async function handleContracts(cli, args = []) {
  const action = args[0] || 'generate'
  if (!['generate', 'pull'].includes(action)) {
    logger.error(`不支持的 contracts 子命令: ${action}`)
    logger.info(`用法: ${cli.invocation} contracts [generate|pull]`)
    process.exitCode = 1
    return
  }

  cli.ensureRepoRoot()

  // starmomo/ai-monorepo compatibility: packages/api-contracts is expected
  const contractsRoot = join(process.cwd(), 'packages', 'api-contracts')
  if (!existsSync(contractsRoot)) {
    logger.error(`未找到 contracts 目录: ${contractsRoot}`)
    logger.info('期望存在 packages/api-contracts，用于输出生成的 Zod 合约。')
    process.exitCode = 1
    return
  }

  logger.step('导出 OpenAPI 并生成 Zod 合约')

  // 1) Export OpenAPI spec to dist/openapi/backend.json
  await execManager.executeCommand('npx nx run backend:swagger', {
    app: 'backend',
    flags: cli.flags,
    env: { NX_CACHE: 'false', SKIP_PRISMA_CONNECT: 'true' },
  })

  // 2) Generate zod client
  const outputDir = join(contractsRoot, 'src', 'generated')
  mkdirSync(outputDir, { recursive: true })

  const baseUrl = process.env.OPENAPI_BASE_URL || 'http://localhost:3000/api/v1'
  logger.info(`使用 API 基地址: ${baseUrl}`)

  const generatorCommand = [
    'pnpm exec openapi-zod-client',
    'dist/openapi/backend.json',
    '--output packages/api-contracts/src/generated/backend.ts',
    '--api-client-name aiBackendClient',
    `--base-url "${baseUrl}"`,
    '--with-alias',
    '--with-docs',
    '--with-deprecated',
    '--export-schemas',
    '--prettier prettier.config.js',
  ].join(' ')

  await execManager.executeCommand(generatorCommand, {
    flags: cli.flags,
  })

  logger.success('Zod 合约已更新（packages/api-contracts）')
}
