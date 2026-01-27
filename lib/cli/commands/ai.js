import { existsSync, readFileSync } from 'node:fs'
import { resolve, join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { logger } from '../../logger.js'
import { confirmManager } from '../../confirm.js'
import { getPassthroughArgs } from '../args.js'

function ensureOpencodeAvailable() {
  const result = spawnSync('opencode', ['--version'], { stdio: 'ignore' })
  if (result?.error?.code === 'ENOENT') {
    return { ok: false, reason: 'missing' }
  }
  return { ok: true }
}

function resolveAiConfig(cli, name) {
  const raw = cli.commands?.ai?.[name]
  if (!raw) return null

  const environment = cli.determineEnvironment()
  const envKey = cli.normalizeEnvKey(environment)
  let config = raw

  // 允许按环境分支（保持与 build/start/export 一致）
  if (typeof config === 'object' && config && !config.promptFile && !config.command) {
    if (config[envKey]) config = config[envKey]
    else if (envKey === 'staging' && config.prod) config = config.prod
    else config = config.dev || config
  }

  return config
}

function expandHomePath(input) {
  const raw = String(input ?? '')
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return resolve(homedir(), raw.slice(2))
  }
  return raw
}

function isBareFilename(input) {
  const raw = String(input ?? '')
  if (!raw) return false
  if (raw.startsWith('.')) return false
  return !raw.includes('/') && !raw.includes('\\')
}

function resolvePromptPath(promptFile) {
  const projectRoot = process.env.DX_PROJECT_ROOT || process.cwd()
  const expanded = expandHomePath(promptFile)

  if (isAbsolute(expanded)) return [expanded]

  const dxDir = join(projectRoot, 'dx')
  const candidates = []

  // 仅文件名：优先在 dx/prompts 下找（不破坏历史：仍保留 project root fallback）
  if (isBareFilename(expanded)) {
    candidates.push(join(dxDir, 'prompts', expanded))
    candidates.push(resolve(projectRoot, expanded))
    candidates.push(resolve(dxDir, expanded))
    return candidates
  }

  // 相对路径：优先保持与历史一致（相对 project root），找不到再 fallback 到 dx/ 下
  candidates.push(resolve(projectRoot, expanded))
  candidates.push(resolve(dxDir, expanded))
  return candidates
}

export async function handleAi(cli, args = []) {
  const name = args[0]
  if (!name) {
    const names = Object.keys(cli.commands?.ai || {})
    logger.error('请指定 ai 任务名称')
    logger.info(`用法: ${cli.invocation} ai <name> [-- <opencode flags>...]`)
    if (names.length > 0) {
      logger.info(`可用任务: ${names.join(', ')}`)
    }
    process.exitCode = 1
    return
  }

  const config = resolveAiConfig(cli, name)
  if (!config) {
    const names = Object.keys(cli.commands?.ai || {})
    logger.error(`未找到 ai 任务配置: ${name}`)
    if (names.length > 0) {
      logger.info(`可用任务: ${names.join(', ')}`)
    }
    process.exitCode = 1
    return
  }

  const availability = ensureOpencodeAvailable()
  if (!availability.ok) {
    logger.error('未找到 opencode 可执行文件（PATH 中不存在 opencode）')
    logger.info('请先安装并确保 `opencode --version` 可用')
    process.exitCode = 1
    return
  }

  const promptFile = config?.promptFile
  if (!promptFile) {
    logger.error(`ai.${name} 缺少 promptFile 配置（指向一个 .md 文件）`)
    process.exitCode = 1
    return
  }

  const promptCandidates = resolvePromptPath(promptFile)
  const promptPath = promptCandidates.find(p => existsSync(p)) || promptCandidates[0]
  if (!promptPath || !existsSync(promptPath)) {
    logger.error(`未找到提示词文件: ${promptFile}`)
    if (promptCandidates.length <= 1) {
      logger.info(`解析后的路径: ${promptPath}`)
    } else {
      logger.info('解析后的候选路径:')
      for (const p of promptCandidates) logger.info(`- ${p}`)
    }
    process.exitCode = 1
    return
  }

  let promptText = ''
  try {
    promptText = readFileSync(promptPath, 'utf8')
  } catch (error) {
    logger.error(`读取提示词文件失败: ${promptFile}`)
    logger.error(error?.message || String(error))
    process.exitCode = 1
    return
  }

  // 固定全权限：这会让 opencode 在当前目录拥有 bash/edit 等工具的自动执行权
  if (!cli.flags.Y) {
    const confirmed = await confirmManager.confirmDangerous(
      `ai.${name}（将以 OPENCODE_PERMISSION="allow" 运行，全权限）`,
      '当前目录',
      false,
    )
    if (!confirmed) {
      logger.info('操作已取消')
      return
    }
  }

  const model = config?.model ? String(config.model) : null
  const agent = config?.agent ? String(config.agent) : null
  const format = config?.format ? String(config.format) : null
  const attach = config?.attach ? String(config.attach) : null

  const passthrough = getPassthroughArgs(cli.args)
  const configPassthrough = Array.isArray(config?.passthrough)
    ? config.passthrough.map(v => String(v))
    : []

  const opencodeArgs = ['run']
  if (model) opencodeArgs.push('--model', model)
  if (agent) opencodeArgs.push('--agent', agent)
  if (format) opencodeArgs.push('--format', format)
  if (attach) opencodeArgs.push('--attach', attach)
  if (configPassthrough.length > 0) opencodeArgs.push(...configPassthrough)
  if (Array.isArray(passthrough) && passthrough.length > 0) opencodeArgs.push(...passthrough)
  // Protect prompt content from being parsed as CLI flags (e.g. markdown frontmatter starts with '---').
  opencodeArgs.push('--', promptText)

  logger.step(`ai ${name}`)
  logger.command(`opencode ${opencodeArgs.filter(a => a !== promptText).join(' ')} <prompt-from-file>`)

  await new Promise(resolvePromise => {
    const child = spawn('opencode', opencodeArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        // OpenCode expects OPENCODE_PERMISSION to be JSON (it JSON.parse's the value).
        OPENCODE_PERMISSION: '"allow"',
      },
    })

    const forwardSignal = signal => {
      try {
        child.kill(signal)
      } catch {}
    }

    const onSigint = () => forwardSignal('SIGINT')
    const onSigterm = () => forwardSignal('SIGTERM')
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)

    const cleanup = () => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }

    child.on('error', error => {
      cleanup()
      logger.error(error?.message || String(error))
      process.exitCode = 1
      resolvePromise()
    })

    child.on('exit', code => {
      cleanup()
      if (typeof code === 'number' && code !== 0) {
        process.exitCode = code
      }
      resolvePromise()
    })
  })
}
