import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildHelpRuntimeContext, getCommandHelpModel, getGlobalHelpModel } from './help-model.js'
import { FLAG_DEFINITIONS } from './flags.js'
import { renderCommandHelp, renderGlobalHelp } from './help-renderer.js'
import { buildStrictHelpValidationContext, validateHelpConfig } from './help-schema.js'
import { getPackageVersion } from '../version.js'

const HIDDEN_COMMANDS = new Set(['help'])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function loadDefaultCommands() {
  const configDir = process.env.DX_CONFIG_DIR || join(process.cwd(), 'dx', 'config')
  const commandsPath = join(configDir, 'commands.json')

  try {
    return JSON.parse(readFileSync(commandsPath, 'utf8'))
  } catch {
    return null
  }
}

function deriveRegisteredCommands(commands = {}) {
  const ordered = []
  const seen = new Set()
  const sources = [
    Array.isArray(commands?.help?.commandOrder) ? commands.help.commandOrder : [],
    Object.keys(commands?.help?.commands || {}),
    Object.keys(commands).filter(name => !HIDDEN_COMMANDS.has(name) && name !== 'help'),
  ]

  for (const entries of sources) {
    for (const name of entries) {
      if (typeof name !== 'string' || !name || seen.has(name)) continue
      seen.add(name)
      ordered.push(name)
    }
  }

  return ordered
}

function buildSyntheticCliContext(commands) {
  const commandHandlers = Object.fromEntries(
    deriveRegisteredCommands(commands).map(name => [name, () => {}]),
  )

  return {
    invocation: 'dx',
    commands,
    commandHandlers,
    flagDefinitions: FLAG_DEFINITIONS,
  }
}

function resolveCliContext(cliContext = null) {
  if (isPlainObject(cliContext?.commands)) {
    const runtimeContext = buildHelpRuntimeContext(cliContext)
    validateHelpConfig(cliContext.commands, buildStrictHelpValidationContext(cliContext))
    return {
      invocation: cliContext.invocation || 'dx',
      commands: cliContext.commands,
      runtimeContext,
    }
  }

  const commands = loadDefaultCommands()
  if (!commands) return null

  const syntheticCli = buildSyntheticCliContext(commands)
  const runtimeContext = buildHelpRuntimeContext(syntheticCli)
  validateHelpConfig(commands, buildStrictHelpValidationContext(syntheticCli))

  return {
    invocation: syntheticCli.invocation,
    commands,
    runtimeContext,
  }
}

function hasRenderableCommandModel(model = {}) {
  return Boolean(
    model?.usage ||
      model?.summary ||
      model?.targets?.length ||
      model?.notes?.length ||
      model?.examples?.length ||
      model?.options?.length,
  )
}

function renderDynamicGlobalHelp(cliContext = null) {
  const resolved = resolveCliContext(cliContext)
  const version = getPackageVersion()
  if (!resolved) {
    return renderGlobalHelp({
      title: `DX CLI v${version}`,
      invocation: 'dx',
    })
  }

  const model = getGlobalHelpModel(resolved.commands, resolved.runtimeContext)

  return renderGlobalHelp({
    title: `DX CLI v${version}`,
    invocation: resolved.invocation,
    ...model,
  })
}

function renderDynamicCommandHelp(commandName, cliContext = null) {
  const resolved = resolveCliContext(cliContext)
  if (!resolved) return ''

  const model = getCommandHelpModel(resolved.commands, commandName, resolved.runtimeContext)
  if (!hasRenderableCommandModel(model)) return ''

  return renderCommandHelp({
    invocation: resolved.invocation,
    ...model,
  })
}

export function showHelp(cliContext = null) {
  console.log(renderDynamicGlobalHelp(cliContext))
}

export function showCommandHelp(command, cliContext = null) {
  const commandName = String(command || '').toLowerCase()
  const dynamicOutput = renderDynamicCommandHelp(commandName, cliContext)

  if (dynamicOutput) {
    console.log(dynamicOutput)
    return
  }

  showHelp(cliContext)
}
