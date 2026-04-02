const ENVIRONMENT_KEYS = new Set(['development', 'production', 'staging', 'test', 'e2e'])
const COMMAND_LIST_HIDDEN = new Set(['help'])
const META_KEYS = new Set(['help', 'description', 'args', 'interactive', 'dangerous'])
const INTERNAL_CONFIG_KEYS = new Set([
  'services',
  'urls',
  'preflight',
  'ecosystemConfig',
  'pm2Bin',
  'backendDeploy',
  'artifactDeploy',
  'telegramWebhook',
])

export function buildHelpRuntimeContext(cli = {}) {
  return {
    registeredCommands: getRegisteredCommands(cli),
    knownFlags: getKnownFlags(cli),
  }
}

export function getRegisteredCommands(cli = {}) {
  const handlers = cli?.commandHandlers
  if (!handlers || typeof handlers !== 'object') return []

  return Object.keys(handlers).filter(name => !COMMAND_LIST_HIDDEN.has(name))
}

export function getKnownFlags(cli = {}) {
  const definitions = cli?.flagDefinitions
  const knownFlags = new Map()

  if (!definitions || typeof definitions !== 'object') return knownFlags

  for (const entries of Object.values(definitions)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry?.flag) continue
      knownFlags.set(entry.flag, {
        expectsValue: Boolean(entry.expectsValue),
      })
    }
  }

  return knownFlags
}

export function classifyCommandNode(node = {}) {
  if (node?.help?.nodeType) return node.help.nodeType
  if (looksLikeInternalConfigBag(node)) return 'internal-config-bag'
  if (node?.command || node?.internal) return 'target-leaf'
  if (node?.concurrent || node?.sequential) return 'orchestration-node'
  if (looksLikeEnvContainer(node)) return 'env-container'
  if (looksLikeCategoryNode(node)) return 'category-node'
  return 'unknown-node'
}

export function isVisibleHelpNode(name, node, nodeType = classifyCommandNode(node)) {
  void name

  if (node?.help?.expose === false) return false
  if (nodeType === 'internal-config-bag') return false
  if (nodeType === 'category-node') return false
  if (nodeType === 'orchestration-node') return node?.help?.expose === true
  return true
}

export function getGlobalHelpModel(commands = {}, context = {}) {
  const registeredCommands = Array.isArray(context?.registeredCommands)
    ? context.registeredCommands
    : []

  return {
    summary: commands?.help?.summary ?? '',
    commands: registeredCommands.map(name => getCommandHelpModel(commands, name, context)),
    globalOptions: normalizeArray(commands?.help?.globalOptions),
    examples: normalizeArray(commands?.help?.examples),
  }
}

export function getCommandHelpModel(commands = {}, commandName, context = {}) {
  const commandConfig = commands?.[commandName] ?? {}
  const commandHelp = getCommandHelpConfig(commands, commandName)

  return {
    name: commandName,
    summary: resolveSummary(commandConfig, commandHelp),
    usage: resolveUsage(commandName, commandHelp, commandConfig),
    args: normalizeArray(commandHelp?.args),
    notes: normalizeArray(commandHelp?.notes),
    examples: normalizeArray(commandHelp?.examples),
    options: normalizeArray(commandHelp?.options),
    targets: resolveVisibleTargets(commands, commandName, commandConfig, context),
  }
}

export function resolveSummary(node = {}, help = null) {
  return help?.summary || node?.help?.summary || node?.description || ''
}

function resolveUsage(commandName, commandHelp = {}, commandConfig = {}) {
  return commandHelp?.usage || generateUsage(commandName, commandConfig)
}

function generateUsage(commandName, commandConfig = {}) {
  switch (commandName) {
    case 'start':
      return 'dx start <service> [环境标志]'
    case 'build':
    case 'package':
      return `dx ${commandName} <target> [环境标志]`
    case 'db':
      return 'dx db <action> [name] [环境标志]'
    case 'test':
      return 'dx test [type] <target> [path]'
    case 'deploy':
    case 'clean':
    case 'cache':
      return `dx ${commandName} <target>`
    case 'help':
      return 'dx help [command]'
    case 'worktree':
      return 'dx worktree [action] [args...]'
    case 'lint':
    case 'status':
      return `dx ${commandName}`
    default:
      return hasVisibleTargets(commandConfig) ? `dx ${commandName} <target>` : `dx ${commandName}`
  }
}

function hasVisibleTargets(commandConfig) {
  if (!isPlainObject(commandConfig)) return false

  return Object.entries(commandConfig).some(([name, node]) => {
    if (name === 'help') return false
    return isVisibleHelpNode(name, node)
  })
}

function resolveVisibleTargets(commands, commandName, commandConfig, context) {
  void context

  if (!isPlainObject(commandConfig)) return []

  return Object.entries(commandConfig)
    .filter(([name]) => name !== 'help')
    .map(([name, node]) => {
      const nodeType = classifyCommandNode(node)
      if (!isVisibleHelpNode(name, node, nodeType)) return null

      const targetHelp = getTargetHelpConfig(commands, commandName, name)

      return {
        name,
        nodeType,
        summary: resolveSummary(node, targetHelp),
        notes: normalizeArray(targetHelp?.notes),
        options: normalizeArray(targetHelp?.options),
        examples: normalizeArray(targetHelp?.examples),
      }
    })
    .filter(Boolean)
}

function getCommandHelpConfig(commands, commandName) {
  const config = commands?.help?.commands?.[commandName]
  return isPlainObject(config) ? config : {}
}

function getTargetHelpConfig(commands, commandName, targetName) {
  const config = commands?.help?.targets?.[commandName]?.[targetName]
  return isPlainObject(config) ? config : {}
}

function looksLikeInternalConfigBag(node) {
  if (!isPlainObject(node)) return false
  if (node.command || node.internal || node.concurrent || node.sequential) return false
  if (looksLikeEnvContainer(node)) return false

  const visibleKeys = getVisibleKeys(node)
  if (visibleKeys.length === 0) return false

  return visibleKeys.some(key => INTERNAL_CONFIG_KEYS.has(key))
}

function looksLikeEnvContainer(node) {
  if (!isPlainObject(node)) return false
  const visibleKeys = getVisibleKeys(node)
  if (visibleKeys.length === 0) return false

  const envKeys = visibleKeys.filter(key => ENVIRONMENT_KEYS.has(key))
  return envKeys.length > 0 && envKeys.length === visibleKeys.length
}

function looksLikeCategoryNode(node) {
  if (!isPlainObject(node)) return false
  if (node.command || node.internal || node.concurrent || node.sequential) return false
  if (looksLikeEnvContainer(node) || looksLikeInternalConfigBag(node)) return false

  const visibleKeys = getVisibleKeys(node)
  if (visibleKeys.length === 0) return false

  return visibleKeys.every(key => isPlainObject(node[key]))
}

function getVisibleKeys(node) {
  return Object.keys(node).filter(key => !META_KEYS.has(key))
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
