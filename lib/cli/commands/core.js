import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { logger } from '../../logger.js'
import { confirmManager } from '../../confirm.js'
import { execManager } from '../../exec.js'
import { showHelp, showCommandHelp } from '../help.js'

export function handleHelp(cli, args = []) {
  void cli
  if (args[0]) showCommandHelp(args[0])
  else showHelp()
}

export function handleDev(cli, args = []) {
  return cli.reportDevCommandRemoved(args)
}

export async function handleBuild(cli, args) {
  const target = args[0] || 'all'
  const environment = cli.determineEnvironment()
  const envKey = cli.normalizeEnvKey(environment)
  const explicitEnv =
    Boolean(cli.flags.dev || cli.flags.prod || cli.flags.staging || cli.flags.test || cli.flags.e2e)

  const buildConfig = cli.commands.build[target]
  if (!buildConfig) {
    // 兼容用户误输入或快捷命令，把 "all./scripts/dx" 这类粘连错误拆分
    const fixed = String(target).split(/\s|\t|\r|\n|\u00A0|\.|\//)[0]
    if (fixed && cli.commands.build[fixed]) {
      logger.warn(`自动修正构建目标: ${target} -> ${fixed}`)
      return await handleBuild(cli, [fixed])
    }
    logger.error(`未找到构建目标: ${target}`)
    process.exitCode = 1
    return
  }

  logger.step(`构建 ${target} (${environment})`)

  // 处理嵌套配置
  let config = buildConfig
  if (typeof config === 'object' && !config.command) {
    const supportsCurrentEnv = Boolean(
      config[envKey] || (envKey === 'staging' && config.prod),
    )
    if (explicitEnv && !supportsCurrentEnv) {
      const envFlag = cli.getEnvironmentFlagExample(envKey) || `--${envKey}`
      logger.error(`构建目标 ${target} 不支持 ${envFlag} 环境`)
      logger.info('显式传入环境标志时，必须是该 target 实际支持的环境。')
      const available = ['dev', 'staging', 'prod', 'test', 'e2e']
        .filter(key => key in config)
        .map(key => cli.getEnvironmentFlagExample(key) || `--${key}`)
      if (available.length > 0) {
        logger.info(`支持的环境: ${available.join(', ')}`)
        logger.info(`示例: ${cli.invocation} build ${target} ${available[0]}`)
        if (available.length > 1) {
          logger.info(`示例: ${cli.invocation} build ${target} ${available[1]}`)
        }
      }
      process.exitCode = 1
      return
    }

    // 如果是嵌套配置，尝试获取环境特定的配置（兼容 dev/prod 与 development/production 命名）
    if (config[envKey]) config = config[envKey]
    else if (envKey === 'staging' && config.prod) config = config.prod
    else config = config.dev || config
  }

  if (config.concurrent) {
    await cli.handleConcurrentCommands(config.commands, 'build', envKey)
  } else if (config.sequential) {
    await cli.handleSequentialCommands(config.commands, envKey)
  } else {
    await cli.executeCommand(config)
  }
}

export async function handleTest(cli, args) {
  const type = args[0] || 'e2e'
  const target = args[1] || 'all'
  const testPath = args[2] // 可选的测试文件路径

  // 解析 -t 参数用于指定特定测试用例（使用原始参数列表）
  const allArgs = cli.args  // 使用原始参数列表包含所有标志
  const testNamePattern = resolveTestNamePattern(allArgs)

  // 根据测试类型自动设置环境标志
  if (type === 'e2e' && !cli.flags.e2e) {
    cli.flags.e2e = true
  } else if (type === 'unit' && !cli.flags.test) {
    cli.flags.test = true
  }

  const typeConfig = cli.commands.test[type]
  let testConfig = typeConfig?.[target]
  if (!testConfig && typeConfig?.command) {
    testConfig = typeConfig
  }

  if (!testConfig) {
    logger.error(`未找到测试配置: ${type}.${target}`)
    process.exit(1)
    return
  }

  if (type === 'e2e' && testConfig.requiresPath && testPath) {
    if (!testConfig.fileCommand) {
      logger.error(`测试配置错误: test.${type}.${target} 已启用 requiresPath，必须配置 fileCommand`)
      process.exit(1)
    }

    const fileCommand = String(testConfig.fileCommand)
    if (!fileCommand.includes('{TEST_PATH}')) {
      logger.error(`测试配置错误: test.${type}.${target} 的 fileCommand 必须包含 {TEST_PATH}`)
      process.exit(1)
    }

    let command = fileCommand.replace('{TEST_PATH}', shellEscape(testPath))

    if (testNamePattern) {
      command += ` -t ${shellEscape(testNamePattern)}`
    }

    testConfig = {
      ...testConfig,
      command: command,
      description: testNamePattern
        ? `运行单个E2E测试文件的特定用例: ${testPath} -> ${testNamePattern}`
        : `运行单个E2E测试文件: ${testPath}`
    }

    if (testNamePattern) {
      logger.step(`运行 ${type} 测试用例: ${testNamePattern} (文件: ${testPath})`)
    } else {
      logger.step(`运行单个 ${type} 测试: ${testPath}`)
    }
  } else if (type === 'unit' && testPath) {
    let command = String(testConfig.command).trim()
    const useDirectPathArg = shouldUseDirectPathArg(command)
    const normalizedTestPath = useDirectPathArg
      ? normalizeUnitTestPathForCommand(cli, command, testPath)
      : testPath
    const forwardedArgs = useDirectPathArg
      ? [shellEscape(normalizedTestPath)]
      : [`--runTestsByPath ${shellEscape(normalizedTestPath)}`]

    if (testNamePattern) {
      forwardedArgs.push(`-t ${shellEscape(testNamePattern)}`)
    }

    command += ` ${forwardedArgs.join(' ')}`

    testConfig = {
      ...testConfig,
      command,
      description: testNamePattern
        ? `运行单个单元测试文件的特定用例: ${testPath} -> ${testNamePattern}`
        : `运行单个单元测试文件: ${testPath}`,
    }

    if (testNamePattern) {
      logger.step(`运行 ${type} 测试用例: ${testNamePattern} (文件: ${testPath})`)
    } else {
      logger.step(`运行单个 ${type} 测试: ${testPath}`)
    }
  } else {
    logger.step(`运行 ${type} 测试`)
  }

  await cli.executeCommand(testConfig)
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function resolveTestNamePattern(args = []) {
  const aliases = ['-t', '--name', '--test-name-pattern']
  for (let i = 0; i < args.length; i++) {
    if (!aliases.includes(args[i])) continue
    if (i + 1 < args.length) return args[i + 1]
  }
  return null
}

function shouldUseDirectPathArg(command) {
  const text = String(command || '')
  return (
    /\bnx\s+test\b/.test(text) ||
    /\bnx\.js\s+test\b/.test(text) ||
    /\bvitest\s+run\b/.test(text)
  )
}

function normalizeUnitTestPathForCommand(cli, command, testPath) {
  const rawPath = String(testPath || '')
  if (!rawPath) return rawPath

  if (/\bvitest\s+run\b/.test(String(command || ''))) {
    return rawPath
  }

  const projectCwd = resolveNxTestProjectCwd(cli, command)
  if (!projectCwd) return rawPath

  const projectRoot = cli?.projectRoot || process.cwd()
  const absoluteProjectCwd = join(projectRoot, projectCwd)
  const absoluteTestPath = join(projectRoot, rawPath)
  const relativePath = relative(absoluteProjectCwd, absoluteTestPath)

  if (!relativePath || relativePath.startsWith('..')) {
    return rawPath
  }

  return relativePath
}

function resolveNxTestProjectCwd(cli, command) {
  const projectRoot = cli?.projectRoot || process.cwd()
  const nxTarget = extractNxTestTarget(command)
  if (!nxTarget) return null

  const projectConfigPath = join(projectRoot, 'apps', nxTarget, 'project.json')
  if (!existsSync(projectConfigPath)) return null

  try {
    const projectConfig = JSON.parse(readFileSync(projectConfigPath, 'utf8'))
    const testTarget = projectConfig?.targets?.test
    const cwd = testTarget?.options?.cwd
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      return cwd
    }
    return relative(projectRoot, dirname(projectConfigPath))
  } catch {
    return null
  }
}

function extractNxTestTarget(command) {
  const text = String(command || '').trim()
  const match =
    text.match(/\bnx(?:\.js)?\s+test\s+([^\s]+)/) ||
    text.match(/\bnx(?:\.js)?\s+run\s+([^:\s]+):test\b/)
  return match?.[1] || null
}

export async function handleLint(cli, args) {
  void args
  const baseConfig = cli.commands.lint
  if (!baseConfig || !baseConfig.command) {
    logger.error('未找到 lint 命令配置')
    process.exitCode = 1
    return
  }

  const config = { ...baseConfig }

  if (cli.flags.fix) {
    logger.step('运行代码检查（自动修复模式: --fix）')
    const cmd = String(config.command)
    // 若已包含 ` -- ` 分隔符，直接在末尾追加 --fix；否则通过 `--` 传递给 Nx 下游
    config.command = cmd.includes(' -- ')
      ? `${cmd} --fix`
      : `${cmd} -- --fix`
  } else {
    logger.step('运行代码检查')
  }

  await cli.executeCommand(config)
}

export async function handleClean(cli, args) {
  const target = args[0] || 'all'
  const cleanConfig = cli.commands.clean[target]

  if (!cleanConfig) {
    logger.error(`未找到清理目标: ${target}`)
    process.exitCode = 1
    return
  }

  // 危险操作确认
  if (cleanConfig.dangerous) {
    const confirmed = await confirmManager.confirmDangerous(
      `清理操作: ${target}`,
      '当前环境',
      cli.flags.Y
    )

    if (!confirmed) {
      logger.info('操作已取消')
      return
    }
  }

  logger.step(`清理 ${target}`)
  await cli.executeCommand(cleanConfig)
}

export async function handleCache(cli, args) {
  const action = args[0] || 'clear'
  const cacheConfig = cli.commands.cache?.[action]

  if (!cacheConfig) {
    logger.error(`未找到缓存操作: ${action}`)
    logger.info('用法: dx cache clear')
    process.exitCode = 1
    return
  }

  // 危险操作确认
  if (cacheConfig.dangerous) {
    const confirmed = await confirmManager.confirmDangerous(
      `缓存清理: ${action}`,
      '当前环境',
      cli.flags.Y
    )

    if (!confirmed) {
      logger.info('操作已取消')
      return
    }

    // 二次确认（更醒目）：强调将清理全局 pnpm store 与 ~/.pnpm-store
    if (!cli.flags.Y && action === 'clear') {
      const second = await confirmManager.confirm(
        '二次确认：将清理全局 pnpm store 与 ~/.pnpm-store，可能影响其他项目，是否继续？',
        false,
        false
      )
      if (!second) {
        logger.info('操作已取消')
        return
      }
    }
  }

  logger.step(`执行缓存操作: ${action}`)
  await cli.executeCommand(cacheConfig)
}

export async function handleInstall(cli, args) {
  void args
  const installConfig = cli.commands.install
  if (!installConfig) {
    logger.error('未找到 install 命令配置')
    process.exitCode = 1
    return
  }

  logger.step('安装依赖')
  await cli.executeCommand(installConfig)
}

export async function handleStatus(cli, args) {
  void args
  logger.step('系统状态')

  const status = execManager.getStatus()
  console.log(`运行中的进程: ${status.runningProcesses}`)

  if (status.processes.length > 0) {
    logger.table(
      status.processes.map(p => [p.id, p.command, `${Math.round(p.duration/1000)}s`]),
      ['进程ID', '命令', '运行时长']
    )
  }
}
