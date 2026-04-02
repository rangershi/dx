import { describe, expect, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DxCli } from '../lib/cli/dx-cli.js'

async function loadValidateHelpConfig() {
  const module = await import('../lib/cli/help-schema.js')
  return module.validateHelpConfig
}

function getRuntimeHelpContext() {
  const argvBackup = process.argv

  try {
    process.argv = ['node', 'dx']

    const cli = new DxCli({
      configDir: join(process.cwd(), 'example', 'dx', 'config'),
    })

    const knownFlags = new Map()

    for (const definitions of Object.values(cli.flagDefinitions)) {
      for (const definition of definitions) {
        knownFlags.set(definition.flag, definition)
      }
    }

    return {
      knownFlags,
      registeredCommands: Object.keys(cli.commandHandlers),
    }
  } finally {
    process.argv = argvBackup
  }
}

describe('dynamic help schema', () => {
  test('rejects unknown help option flags', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()

    expect(() =>
      validateHelpConfig(
        {
          help: {
            globalOptions: [{ flags: ['--unknown'], description: 'bad' }],
          },
        },
        getRuntimeHelpContext(),
      ),
    ).toThrow('--unknown')
  })

  test('rejects help examples that reference unknown commands', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()

    expect(() =>
      validateHelpConfig(
        {
          help: {
            commands: {
              start: {
                summary: 'Start services',
                examples: [{ command: 'dx nope x', description: 'bad' }],
              },
            },
          },
        },
        getRuntimeHelpContext(),
      ),
    ).toThrow('nope')
  })

  test('passes current config with runtime-derived registries', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()
    const file = join(process.cwd(), 'dx', 'config', 'commands.json')
    const commands = JSON.parse(readFileSync(file, 'utf8'))

    expect(() => validateHelpConfig(commands, getRuntimeHelpContext())).not.toThrow()
  })

  test('rejects invalid command usage through usage validator callback', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()

    expect(() =>
      validateHelpConfig(
        {
          help: {
            commands: {
              start: {
                summary: 'Start services',
                usage: 'dx start <bad>',
              },
            },
          },
        },
        {
          ...getRuntimeHelpContext(),
          usageValidator: (commandName, usage) =>
            commandName === 'start' && usage === 'dx start <bad>'
              ? { ok: false, reason: 'invalid usage for start' }
              : { ok: true },
        },
      ),
    ).toThrow('invalid usage for start')
  })

  test('rejects invalid examples through example validator callback', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()

    expect(() =>
      validateHelpConfig(
        {
          help: {
            commands: {
              start: {
                summary: 'Start services',
                examples: [{ command: 'dx start backend --dev', description: 'bad example' }],
              },
            },
          },
        },
        {
          ...getRuntimeHelpContext(),
          exampleValidator: command =>
            command === 'dx start backend --dev'
              ? { ok: false, reason: 'example rejected by parser' }
              : { ok: true },
        },
      ),
    ).toThrow('example rejected by parser')
  })

  test('accepts target help mounted at help.targets.<command>.<target>', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()

    expect(() =>
      validateHelpConfig(
        {
          start: {
            backend: {
              dev: {
                command: 'echo backend',
                description: 'Start backend',
              },
            },
          },
          help: {
            targets: {
              start: {
                backend: {
                  summary: 'Start backend target',
                  options: [{ flags: ['--dev'], description: 'Use development environment' }],
                  examples: [
                    {
                      command: 'dx start backend --dev',
                      description: 'Start backend in dev mode',
                    },
                  ],
                },
              },
            },
          },
        },
        getRuntimeHelpContext(),
      ),
    ).not.toThrow()
  })

  test('rejects target help safe mount for unknown commands', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()

    expect(() =>
      validateHelpConfig(
        {
          help: {
            targets: {
              nope: {
                backend: {
                  summary: 'bad mount',
                },
              },
            },
          },
        },
        getRuntimeHelpContext(),
      ),
    ).toThrow('help.targets.nope references unknown command')
  })

  test('rejects target help safe mount for unknown targets', async () => {
    const validateHelpConfig = await loadValidateHelpConfig()

    expect(() =>
      validateHelpConfig(
        {
          deploy: {
            front: {
              description: 'Deploy front',
            },
          },
          help: {
            targets: {
              deploy: {
                backend: {
                  summary: 'bad mount',
                },
              },
            },
          },
        },
        getRuntimeHelpContext(),
      ),
    ).toThrow('help.targets.deploy.backend references unknown target')
  })
})
