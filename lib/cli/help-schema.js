import { logger } from '../logger.js'
import { parseFlags } from './flags.js'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertOptionalString(value, path) {
  if (value === undefined) return
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string`)
  }
}

function assertArrayOfObjects(value, path) {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`)
  }

  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(`${path}[${index}] must be an object`)
    }
  })
}

function assertArray(value, path) {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`)
  }
}

function assertDescription(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must include a description`)
  }
}

function assertFlagsExist(flags, knownFlags, path) {
  if (!Array.isArray(flags) || flags.length === 0) {
    throw new Error(`${path} must include at least one flag`)
  }

  flags.forEach((flag, index) => {
    if (typeof flag !== 'string' || flag.trim() === '') {
      throw new Error(`${path}[${index}] must be a non-empty string`)
    }
    if (!knownFlags.has(flag)) {
      throw new Error(`${path}[${index}] references unknown flag: ${flag}`)
    }
  })
}

function extractCommandName(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return ''
  }

  const tokens = command.trim().split(/\s+/)

  if (tokens[0] === 'dx') {
    return tokens[1] ?? ''
  }

  return tokens[0] ?? ''
}

function assertRegisteredCommand(command, registeredCommands, path) {
  const commandName = extractCommandName(command)

  if (!commandName) {
    throw new Error(`${path} must include a command`)
  }

  if (!registeredCommands.has(commandName)) {
    throw new Error(`${path} references unknown command: ${commandName}`)
  }
}

function validateHelpExamples(examples, path, context) {
  const { registeredCommands, exampleValidator } = context

  assertArrayOfObjects(examples, path)

  examples?.forEach((example, index) => {
    const entryPath = `${path}[${index}]`
    assertOptionalString(example.command, `${entryPath}.command`)
    assertDescription(example.description, `${entryPath}.description`)
    assertRegisteredCommand(example.command, registeredCommands, `${entryPath}.command`)

    const result = exampleValidator(example.command)
    if (!result?.ok) {
      throw new Error(result?.reason || `${entryPath}.command failed validation`)
    }
  })
}

function validateHelpOptions(options, path, knownFlags) {
  assertArrayOfObjects(options, path)

  options?.forEach((option, index) => {
    const entryPath = `${path}[${index}]`
    assertFlagsExist(option.flags, knownFlags, `${entryPath}.flags`)
    assertDescription(option.description, `${entryPath}.description`)
  })
}

function validateCommandHelp(commandName, help, context) {
  const { registeredCommands, usageValidator } = context

  if (!isPlainObject(help)) {
    throw new Error(`help.commands.${commandName} must be an object`)
  }

  if (!registeredCommands.has(commandName)) {
    throw new Error(`help.commands.${commandName} references unknown command`)
  }

  assertOptionalString(help.summary, `help.commands.${commandName}.summary`)
  assertArray(help.notes, `help.commands.${commandName}.notes`)

  help.notes?.forEach((note, index) => {
    assertOptionalString(note, `help.commands.${commandName}.notes[${index}]`)
  })

  validateHelpOptions(
    help.options,
    `help.commands.${commandName}.options`,
    context.knownFlags,
  )
  validateHelpExamples(help.examples, `help.commands.${commandName}.examples`, context)

  if (help.usage !== undefined) {
    assertOptionalString(help.usage, `help.commands.${commandName}.usage`)
    const result = usageValidator(commandName, help.usage)

    if (!result?.ok) {
      throw new Error(result?.reason || `help.commands.${commandName}.usage failed validation`)
    }
  }
}

function validateTargetHelp(commandName, targetName, help, commands, context) {
  const entryPath = `help.targets.${commandName}.${targetName}`

  if (!isPlainObject(help)) {
    throw new Error(`${entryPath} must be an object`)
  }

  if (!context.registeredCommands.has(commandName) || !isPlainObject(commands?.[commandName])) {
    throw new Error(`help.targets.${commandName} references unknown command`)
  }

  if (!Object.prototype.hasOwnProperty.call(commands[commandName], targetName)) {
    throw new Error(`${entryPath} references unknown target`)
  }

  assertOptionalString(help.summary, `${entryPath}.summary`)
  assertArray(help.notes, `${entryPath}.notes`)

  help.notes?.forEach((note, index) => {
    assertOptionalString(note, `${entryPath}.notes[${index}]`)
  })

  validateHelpOptions(help.options, `${entryPath}.options`, context.knownFlags)
  validateHelpExamples(help.examples, `${entryPath}.examples`, context)
}

export function validateHelpConfig(commands, context = {}) {
  const {
    registeredCommands = [],
    knownFlags = new Map(),
    usageValidator = () => ({ ok: true }),
    exampleValidator = () => ({ ok: true }),
  } = context

  if (!isPlainObject(commands)) {
    throw new Error('commands must be an object')
  }

  const normalizedContext = {
    registeredCommands: new Set(registeredCommands),
    knownFlags,
    usageValidator,
    exampleValidator,
  }

  const help = commands.help
  if (help === undefined) {
    return commands
  }

  if (!isPlainObject(help)) {
    throw new Error('help must be an object')
  }

  assertOptionalString(help.summary, 'help.summary')
  validateHelpOptions(help.globalOptions, 'help.globalOptions', normalizedContext.knownFlags)
  validateHelpExamples(help.examples, 'help.examples', normalizedContext)

  if (help.commands !== undefined) {
    if (!isPlainObject(help.commands)) {
      throw new Error('help.commands must be an object')
    }

    Object.entries(help.commands).forEach(([commandName, commandHelp]) => {
      validateCommandHelp(commandName, commandHelp, normalizedContext)
    })
  }

  if (help.targets !== undefined) {
    if (!isPlainObject(help.targets)) {
      throw new Error('help.targets must be an object')
    }

    Object.entries(help.targets).forEach(([commandName, targetHelp]) => {
      if (!isPlainObject(targetHelp)) {
        throw new Error(`help.targets.${commandName} must be an object`)
      }

      Object.entries(targetHelp).forEach(([targetName, targetEntryHelp]) => {
        validateTargetHelp(commandName, targetName, targetEntryHelp, commands, normalizedContext)
      })
    })
  }

  return commands
}

export function buildStrictHelpValidationContext(cli) {
  const knownFlags = new Map()
  for (const definitions of Object.values(cli?.flagDefinitions || {})) {
    if (!Array.isArray(definitions)) continue
    for (const definition of definitions) {
      if (!definition?.flag) continue
      knownFlags.set(definition.flag, definition)
    }
  }

  return {
    registeredCommands: Object.keys(cli?.commandHandlers || {}),
    knownFlags,
    usageValidator: (commandName, usageText) =>
      validateUsageAgainstRuntime(commandName, usageText, cli),
    exampleValidator: commandText => validateExampleCommandAgainstCli(commandText, cli),
  }
}

export function validateExampleCommandAgainstCli(commandText, cli) {
  let tokens

  try {
    tokens = shellLikeSplit(commandText)
  } catch (error) {
    return { ok: false, reason: error.message }
  }

  if (tokens[0] !== cli.invocation) {
    return { ok: false, reason: `example must start with ${cli.invocation}` }
  }

  const commandName = tokens[1]
  if (!commandName) {
    return { ok: false, reason: 'example must include a top-level command' }
  }

  if (!cli.commandHandlers?.[commandName]) {
    return { ok: false, reason: `unknown command: ${commandName}` }
  }

  return runCliInputValidation(cli, tokens.slice(1))
}

export function validateUsageAgainstRuntime(commandName, usageText, cli) {
  let tokens

  try {
    tokens = shellLikeSplit(usageText)
  } catch (error) {
    return { ok: false, reason: error.message }
  }

  if (tokens[0] !== cli.invocation) {
    return { ok: false, reason: `usage must start with ${cli.invocation}` }
  }

  if (tokens[1] !== commandName) {
    return {
      ok: false,
      reason: `usage for ${commandName} must start with "${cli.invocation} ${commandName}"`,
    }
  }

  const placeholderTokens = tokens
    .slice(2)
    .filter(token => isPlaceholderToken(token) && !isEnvironmentPlaceholder(token))
  const runtimeMaxPositionals = getRuntimeMaxPositionals(commandName)

  if (
    Number.isInteger(runtimeMaxPositionals) &&
    placeholderTokens.length > runtimeMaxPositionals
  ) {
    return {
      ok: false,
      reason: `usage for ${commandName} advertises ${placeholderTokens.length} positionals but runtime allows ${runtimeMaxPositionals}`,
    }
  }

  if (mentionsPositionalEnvironmentPlaceholder(tokens)) {
    return {
      ok: false,
      reason: `usage for ${commandName} must use environment flags instead of positional env placeholders`,
    }
  }

  if (commandName === 'start' && !tokens.includes('<service>')) {
    return { ok: false, reason: 'usage for start must include <service>' }
  }

  return { ok: true }
}

function getRuntimeMaxPositionals(commandName) {
  switch (commandName) {
    case 'help':
      return 1
    case 'build':
    case 'package':
    case 'clean':
    case 'cache':
      return 1
    case 'db':
      return 2
    case 'test':
      return 3
    case 'worktree':
      return 3
    case 'start':
      return 1
    case 'lint':
    case 'status':
      return 0
    default:
      return null
  }
}

function runCliInputValidation(cli, args) {
  if (typeof cli?.validateInputs !== 'function') {
    return validateArgumentTokens(args, cli)
  }

  const exitSpy = process.exit
  const originalLogger = {
    error: logger.error,
    info: logger.info,
  }
  const messages = []
  const originalState = {
    args: cli.args,
    command: cli.command,
    flags: cli.flags,
    subcommand: cli.subcommand,
  }

  try {
    process.exit = code => {
      throw new Error(`process.exit:${code}`)
    }
    logger.error = message => {
      messages.push(String(message))
    }
    logger.info = message => {
      messages.push(String(message))
    }

    cli.args = [...args]
    cli.flags = parseFlags(cli.args)
    cli.command = cli.args[0]
    cli.subcommand = cli.args[1]
    cli.validateInputs()
    return { ok: true }
  } catch (error) {
    if (String(error?.message || '').startsWith('process.exit:')) {
      return { ok: false, reason: messages.join(' | ') || error.message }
    }
    throw error
  } finally {
    process.exit = exitSpy
    logger.error = originalLogger.error
    logger.info = originalLogger.info
    cli.args = originalState.args
    cli.command = originalState.command
    cli.flags = originalState.flags
    cli.subcommand = originalState.subcommand
  }
}

function validateArgumentTokens(args, cli) {
  const tokens = Array.isArray(args) ? [...args] : []
  const commandName = tokens[0]
  if (!commandName) {
    return { ok: false, reason: 'example must include a top-level command' }
  }

  const definitions = cli?.flagDefinitions || {}
  const knownFlags = new Map()
  for (const entries of Object.values(definitions)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry?.flag) continue
      knownFlags.set(entry.flag, Boolean(entry.expectsValue))
    }
  }

  const positionalArgs = []
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--') break
    if (!token.startsWith('-')) {
      positionalArgs.push(token)
      continue
    }

    if (!knownFlags.has(token)) {
      return { ok: false, reason: `检测到未识别的选项: ${token}` }
    }

    if (knownFlags.get(token)) {
      const next = tokens[index + 1]
      if (next === undefined || next.startsWith('-')) {
        return { ok: false, reason: `选项 ${token} 需要提供参数值` }
      }
      index += 1
    }
  }

  const maxByCommand = {
    help: 1,
    build: 1,
    package: 1,
    db: 2,
    test: 3,
    worktree: 3,
    start: 1,
    lint: 0,
    clean: 1,
    cache: 1,
    status: 0,
  }

  const max = maxByCommand[commandName]
  if (Number.isInteger(max) && positionalArgs.length > max) {
    return { ok: false, reason: `命令 ${commandName} 存在未识别的额外参数: ${positionalArgs.slice(max).join(', ')}` }
  }

  return { ok: true }
}

function isPlaceholderToken(token) {
  return (
    (token.startsWith('<') && token.endsWith('>')) ||
    (token.startsWith('[') && token.endsWith(']'))
  )
}

function isEnvironmentPlaceholder(token) {
  return token === '[环境标志]'
}

function mentionsPositionalEnvironmentPlaceholder(tokens) {
  return tokens.some(token => {
    const normalized = token.replace(/^[<[|]+|[\]>|]+$/g, '').toLowerCase()
    return normalized === 'env' || normalized === 'environment'
  })
}

export function shellLikeSplit(text) {
  const tokens = []
  let current = ''
  let quote = null
  let tokenStarted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quote) {
      if (character === '\\') {
        const next = text[index + 1]
        if (next === quote || next === '\\') {
          current += next
          tokenStarted = true
          index += 1
          continue
        }
      }

      if (character === quote) {
        quote = null
        continue
      }

      current += character
      tokenStarted = true
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      tokenStarted = true
      continue
    }

    if (character === '\\') {
      const next = text[index + 1]
      if (next !== undefined) {
        current += next
        tokenStarted = true
        index += 1
        continue
      }
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }

    current += character
    tokenStarted = true
  }

  if (quote) {
    const quoteName = quote === '"' ? 'double' : 'single'
    throw new Error(`Unclosed ${quoteName} quote in "${text}"`)
  }

  if (tokenStarted) {
    tokens.push(current)
  }

  return tokens
}
