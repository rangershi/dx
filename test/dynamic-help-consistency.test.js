import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const logger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  step: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
}

jest.unstable_mockModule('../lib/logger.js', () => ({
  logger,
}))

const { DxCli } = await import('../lib/cli/dx-cli.js')
const { parseFlags } = await import('../lib/cli/flags.js')
const { validateHelpConfig } = await import('../lib/cli/help-schema.js')

const CONFIG_FIXTURES = [
  {
    name: 'workspace config',
    configDir: resolve(process.cwd(), 'dx', 'config'),
    file: resolve(process.cwd(), 'dx', 'config', 'commands.json'),
  },
  {
    name: 'example config',
    configDir: resolve(process.cwd(), 'example', 'dx', 'config'),
    file: resolve(process.cwd(), 'example', 'dx', 'config', 'commands.json'),
  },
]

beforeEach(() => {
  jest.clearAllMocks()
})

function readCommands(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function createCli(configDir) {
  const argvBackup = process.argv

  try {
    process.argv = ['node', 'dx']
    return new DxCli({ configDir })
  } finally {
    process.argv = argvBackup
  }
}

function buildRuntimeHelpContext(configDir) {
  const cli = createCli(configDir)
  const knownFlags = new Map()

  for (const definitions of Object.values(cli.flagDefinitions)) {
    for (const definition of definitions) {
      knownFlags.set(definition.flag, definition)
    }
  }

  return {
    cli,
    knownFlags,
    registeredCommands: Object.keys(cli.commandHandlers),
    exampleValidator: commandText => validateExampleCommand(commandText, cli),
    usageValidator: (commandName, usageText) =>
      validateUsageAgainstRuntime(commandName, usageText, cli),
  }
}

function collectConfiguredExamples(commands) {
  const examples = []

  for (const [index, entry] of (commands.help?.examples || []).entries()) {
    examples.push({
      path: `help.examples[${index}]`,
      command: entry.command,
    })
  }

  for (const [commandName, commandHelp] of Object.entries(commands.help?.commands || {})) {
    for (const [index, entry] of (commandHelp.examples || []).entries()) {
      examples.push({
        path: `help.commands.${commandName}.examples[${index}]`,
        command: entry.command,
      })
    }
  }

  for (const [commandName, targets] of Object.entries(commands.help?.targets || {})) {
    for (const [targetName, targetHelp] of Object.entries(targets || {})) {
      for (const [index, entry] of (targetHelp.examples || []).entries()) {
        examples.push({
          path: `help.targets.${commandName}.${targetName}.examples[${index}]`,
          command: entry.command,
        })
      }
    }
  }

  return examples
}

function collectConfiguredOptions(commands) {
  const options = []

  for (const [index, entry] of (commands.help?.globalOptions || []).entries()) {
    options.push({
      path: `help.globalOptions[${index}]`,
      flags: entry.flags || [],
    })
  }

  for (const [commandName, commandHelp] of Object.entries(commands.help?.commands || {})) {
    for (const [index, entry] of (commandHelp.options || []).entries()) {
      options.push({
        path: `help.commands.${commandName}.options[${index}]`,
        flags: entry.flags || [],
      })
    }
  }

  for (const [commandName, targets] of Object.entries(commands.help?.targets || {})) {
    for (const [targetName, targetHelp] of Object.entries(targets || {})) {
      for (const [index, entry] of (targetHelp.options || []).entries()) {
        options.push({
          path: `help.targets.${commandName}.${targetName}.options[${index}]`,
          flags: entry.flags || [],
        })
      }
    }
  }

  return options
}

function collectConfiguredUsages(commands) {
  const usages = []

  for (const [commandName, commandHelp] of Object.entries(commands.help?.commands || {})) {
    if (commandHelp.usage) {
      usages.push({
        path: `help.commands.${commandName}.usage`,
        commandName,
        usage: commandHelp.usage,
      })
    }
  }

  return usages
}

function validateExampleCommand(commandText, cli) {
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

  if (!cli.commandHandlers[commandName]) {
    return { ok: false, reason: `unknown command: ${commandName}` }
  }

  return runCliInputValidation(cli, tokens.slice(1))
}

function validateUsageAgainstRuntime(commandName, usageText, cli) {
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
  const runtimeMaxPositionals = getRuntimeMaxPositionals(commandName, cli)

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

  if (commandName === 'start') {
    if (!tokens.includes('<service>')) {
      return { ok: false, reason: 'usage for start must include <service>' }
    }

    if (supportsStartSubcommand(cli) && !tokens.some(token => token.includes('subcommand'))) {
      return { ok: false, reason: 'usage for start omits supported stack subcommand' }
    }
  }

  return { ok: true }
}

function getRuntimeMaxPositionals(commandName, cli) {
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
      return supportsStartSubcommand(cli) ? 2 : 1
    case 'lint':
    case 'status':
      return 0
    default:
      return null
  }
}

function supportsStartSubcommand(cli) {
  return runCliPositionalValidation(cli, 'start', ['stack', 'front'], { dev: true }).ok
}

function runCliInputValidation(cli, args) {
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit:${code}`)
  })
  const originalState = {
    args: cli.args,
    command: cli.command,
    flags: cli.flags,
    subcommand: cli.subcommand,
  }

  try {
    return withStableEnvironment(() => {
      clearLoggerCalls()
      cli.args = [...args]
      cli.flags = parseFlags(cli.args)
      cli.command = cli.args[0]
      cli.subcommand = cli.args[1]
      cli.validateInputs()
      return { ok: true }
    })
  } catch (error) {
    if (String(error?.message || '').startsWith('process.exit:')) {
      return { ok: false, reason: formatLoggerReason(error.message) }
    }
    throw error
  } finally {
    cli.args = originalState.args
    cli.command = originalState.command
    cli.flags = originalState.flags
    cli.subcommand = originalState.subcommand
    exitSpy.mockRestore()
  }
}

function runCliPositionalValidation(cli, commandName, positionalArgs, flags = {}) {
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit:${code}`)
  })
  const originalFlags = cli.flags

  try {
    return withStableEnvironment(() => {
      clearLoggerCalls()
      cli.flags = { ...flags }
      cli.validatePositionalArgs(commandName, positionalArgs)
      return { ok: true }
    })
  } catch (error) {
    if (String(error?.message || '').startsWith('process.exit:')) {
      return { ok: false, reason: formatLoggerReason(error.message) }
    }
    throw error
  } finally {
    cli.flags = originalFlags
    exitSpy.mockRestore()
  }
}

function clearLoggerCalls() {
  Object.values(logger).forEach(mockFn => {
    if (typeof mockFn.mockClear === 'function') {
      mockFn.mockClear()
    }
  })
}

function formatLoggerReason(fallback) {
  const messages = [...logger.error.mock.calls, ...logger.info.mock.calls]
    .flat()
    .filter(Boolean)
    .map(message => String(message))

  return messages.join(' | ') || fallback
}

function withStableEnvironment(callback) {
  const previousAppEnv = process.env.APP_ENV
  const previousNodeEnv = process.env.NODE_ENV

  delete process.env.APP_ENV
  process.env.NODE_ENV = 'development'

  try {
    return callback()
  } finally {
    if (previousAppEnv === undefined) {
      delete process.env.APP_ENV
    } else {
      process.env.APP_ENV = previousAppEnv
    }

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }
  }
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

function shellLikeSplit(text) {
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

describe('dynamic help example parser', () => {
  test('keeps quoted arguments intact and preserves escaped quotes', () => {
    expect(
      shellLikeSplit(
        'dx test e2e backend apps/backend/e2e/auth --test-name-pattern "auth \\"smoke\\" suite"',
      ),
    ).toEqual([
      'dx',
      'test',
      'e2e',
      'backend',
      'apps/backend/e2e/auth',
      '--test-name-pattern',
      'auth "smoke" suite',
    ])

    expect(
      shellLikeSplit(
        "dx test e2e backend apps/backend/e2e/auth --name 'backend smoke suite'",
      ),
    ).toEqual([
      'dx',
      'test',
      'e2e',
      'backend',
      'apps/backend/e2e/auth',
      '--name',
      'backend smoke suite',
    ])
  })

  test('rejects unclosed quotes with a descriptive error', () => {
    expect(() =>
      shellLikeSplit('dx test e2e backend --test-name-pattern "auth smoke'),
    ).toThrow('Unclosed double quote')
  })
})

describe.each(CONFIG_FIXTURES)('$name dynamic help consistency', fixture => {
  test('every configured example command stays valid against the live CLI parser', () => {
    const commands = readCommands(fixture.file)
    const { exampleValidator } = buildRuntimeHelpContext(fixture.configDir)
    const failures = collectConfiguredExamples(commands)
      .map(entry => {
        const result = exampleValidator(entry.command)
        return result.ok ? null : `${entry.path}: ${result.reason}`
      })
      .filter(Boolean)

    expect(failures).toEqual([])
  })

  test('every configured option flag exists in FLAG_DEFINITIONS', () => {
    const commands = readCommands(fixture.file)
    const { knownFlags } = buildRuntimeHelpContext(fixture.configDir)
    const failures = collectConfiguredOptions(commands)
      .flatMap(entry =>
        entry.flags.map(flag =>
          knownFlags.has(flag) ? null : `${entry.path} references unknown flag: ${flag}`,
        ),
      )
      .filter(Boolean)

    expect(failures).toEqual([])
  })

  test('configured usage strings do not contradict positional validation', () => {
    const commands = readCommands(fixture.file)
    const { usageValidator } = buildRuntimeHelpContext(fixture.configDir)
    const failures = collectConfiguredUsages(commands)
      .map(entry => {
        const result = usageValidator(entry.commandName, entry.usage)
        return result.ok ? null : `${entry.path}: ${result.reason}`
      })
      .filter(Boolean)

    expect(failures).toEqual([])
  })
})

describe('dynamic help consistency with runtime callbacks', () => {
  test('accepts quoted example arguments when validateHelpConfig uses the shell-like parser', () => {
    const context = buildRuntimeHelpContext(resolve(process.cwd(), 'dx', 'config'))

    expect(() =>
      validateHelpConfig(
        {
          test: readCommands(join(process.cwd(), 'dx', 'config', 'commands.json')).test,
          help: {
            commands: {
              test: {
                summary: 'Run tests',
                examples: [
                  {
                    command:
                      'dx test e2e backend apps/backend/e2e/auth --test-name-pattern "auth smoke"',
                    description: 'Run a quoted test pattern',
                  },
                ],
              },
            },
          },
        },
        context,
      ),
    ).not.toThrow()
  })

  test('rejects unclosed quoted examples before config drift reaches help output', () => {
    const context = buildRuntimeHelpContext(resolve(process.cwd(), 'dx', 'config'))

    expect(() =>
      validateHelpConfig(
        {
          test: readCommands(join(process.cwd(), 'dx', 'config', 'commands.json')).test,
          help: {
            commands: {
              test: {
                summary: 'Run tests',
                examples: [
                  {
                    command:
                      'dx test e2e backend apps/backend/e2e/auth --test-name-pattern "auth smoke',
                    description: 'Broken quoted test pattern',
                  },
                ],
              },
            },
          },
        },
        context,
      ),
    ).toThrow('Unclosed double quote')
  })

  test('rejects start usage that omits the supported stack subcommand', () => {
    const commands = readCommands(join(process.cwd(), 'dx', 'config', 'commands.json'))
    const context = buildRuntimeHelpContext(resolve(process.cwd(), 'dx', 'config'))

    expect(() =>
      validateHelpConfig(
        {
          start: commands.start,
          help: {
            commands: {
              start: {
                summary: '启动/桥接服务',
                usage: 'dx start <service> [环境标志]',
              },
            },
          },
        },
        context,
      ),
    ).not.toThrow()
  })
})
