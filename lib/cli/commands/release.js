import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../logger.js'

export async function handleRelease(cli, args = []) {
  const action = args[0]
  const version = args[1]

  if (action !== 'version') {
    logger.error(`用法: ${cli.invocation} release version <版本号>`)
    process.exitCode = 1
    return
  }

  if (!version) {
    logger.error(`请提供要发布的版本号，例如: ${cli.invocation} release version 1.2.3`)
    process.exitCode = 1
    return
  }

  cli.ensureRepoRoot()

  const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/
  if (!semverPattern.test(version)) {
    logger.warn(`版本号 ${version} 不符合常见语义化版本格式，仍将继续更新`)
  }

  const packageFiles = [
    'apps/backend/package.json',
    'apps/front/package.json',
    'apps/admin-front/package.json',
  ]

  logger.step(`统一更新版本号 -> ${version}`)

  for (const relativePath of packageFiles) {
    const fullPath = join(process.cwd(), relativePath)
    if (!existsSync(fullPath)) {
      logger.warn(`跳过，未找到文件: ${relativePath}`)
      continue
    }

    try {
      const raw = readFileSync(fullPath, 'utf8')
      const pkg = JSON.parse(raw)
      const previous = pkg.version || '0.0.0'
      pkg.version = version
      writeFileSync(fullPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
      logger.info(`更新 ${relativePath}: ${previous} -> ${version}`)
    } catch (error) {
      logger.error(`更新 ${relativePath} 失败: ${error?.message || String(error)}`)
    }
  }

  logger.success(`版本号已同步为 ${version}`)
}
