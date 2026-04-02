import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function loadHelpModel() {
  return import('../lib/cli/help-model.js')
}

async function loadHelpRenderer() {
  return import('../lib/cli/help-renderer.js')
}

async function loadHelpRuntime() {
  return import('../lib/cli/help.js')
}

async function loadCoreCommands() {
  return import('../lib/cli/commands/core.js')
}

async function loadDxCli() {
  return import('../lib/cli/dx-cli.js')
}

function createTempConfig(commands) {
  const configDir = mkdtempSync(join(tmpdir(), 'dx-help-config-'))
  writeFileSync(join(configDir, 'commands.json'), JSON.stringify(commands, null, 2))
  return configDir
}

const tempPaths = new Set()
const originalDxConfigDir = process.env.DX_CONFIG_DIR

afterEach(() => {
  process.env.DX_CONFIG_DIR = originalDxConfigDir
  for (const path of tempPaths) {
    rmSync(path, { recursive: true, force: true })
  }
  tempPaths.clear()
})

describe('dynamic help model', () => {
  test('global help uses registered commands instead of raw config roots', async () => {
    const { getGlobalHelpModel } = await loadHelpModel()

    const model = getGlobalHelpModel(
      {
        help: { summary: 'DX CLI summary' },
        start: { help: { summary: 'Start services' } },
        deploy: { help: { summary: 'Deploy apps' } },
        development: { help: { summary: 'Development build' } },
      },
      {
        registeredCommands: ['start', 'deploy'],
      },
    )

    expect(model.commands.map(command => command.name)).toEqual(['start', 'deploy'])
  })

  test('help model hides internal config bags and category nodes from target list', async () => {
    const { getCommandHelpModel } = await loadHelpModel()

    const model = getCommandHelpModel(
      {
        start: {
          stack: {
            internal: 'pm2-stack',
            description: 'PM2 stack',
            stack: {
              services: ['backend', 'front', 'admin'],
            },
          },
          suites: {
            help: { nodeType: 'category-node' },
            description: 'Target grouping only',
            full: {
              command: 'echo grouped target',
              description: 'Grouped target',
            },
          },
          stagewise: {
            command: 'echo stagewise bridge',
            description: 'Stagewise bridge',
          },
        },
      },
      'start',
      {
        registeredCommands: ['start'],
      },
    )

    expect(model.targets.map(target => target.name)).toEqual(['stack', 'stagewise'])
  })

  test('help model hides orchestration nodes by default unless help.expose=true', async () => {
    const { getCommandHelpModel } = await loadHelpModel()

    const model = getCommandHelpModel(
      {
        build: {
          shared: {
            command: 'echo build shared',
            description: 'Build shared package',
          },
          parallelWeb: {
            concurrent: true,
            commands: ['build.shared'],
            description: 'Parallel web build bridge',
          },
          releaseTrain: {
            help: { expose: true },
            sequential: true,
            commands: ['build.shared'],
            description: 'Visible release train',
          },
        },
      },
      'build',
      {
        registeredCommands: ['build'],
      },
    )

    expect(model.targets.map(target => target.name)).toEqual(['shared', 'releaseTrain'])
    expect(model.targets.find(target => target.name === 'releaseTrain')?.nodeType).toBe(
      'orchestration-node',
    )
  })

  test('summary prefers help.summary and falls back to description', async () => {
    const { getCommandHelpModel } = await loadHelpModel()

    const summaryFromHelp = getCommandHelpModel(
      {
        start: {
          help: { summary: '启动/桥接服务' },
          description: '旧摘要',
        },
      },
      'start',
      { registeredCommands: ['start'] },
    )

    const summaryFromDescription = getCommandHelpModel(
      {
        deploy: {
          description: '构建并部署 backend 制品到远端主机',
        },
      },
      'deploy',
      { registeredCommands: ['deploy'] },
    )

    expect(summaryFromHelp.summary).toBe('启动/桥接服务')
    expect(summaryFromDescription.summary).toBe('构建并部署 backend 制品到远端主机')
  })

  test('usage fallback is command-aware when help.usage is absent', async () => {
    const { getCommandHelpModel } = await loadHelpModel()

    const startModel = getCommandHelpModel(
      {
        start: {
          backend: {
            development: {
              command: 'echo start backend',
            },
          },
          stack: {
            internal: 'pm2-stack',
          },
        },
      },
      'start',
      { registeredCommands: ['start'] },
    )

    const buildModel = getCommandHelpModel(
      {
        build: {
          backend: {
            development: {
              command: 'echo build backend',
            },
          },
          shared: {
            command: 'echo build shared',
          },
        },
      },
      'build',
      { registeredCommands: ['build'] },
    )

    expect(startModel.usage).toBe('dx start <service> [环境标志]')
    expect(buildModel.usage).toBe('dx build <target> [环境标志]')
  })
})

describe('dynamic help renderer', () => {
  test('command help renders target metadata and hides orchestration nodes by default', async () => {
    const { renderCommandHelp } = await loadHelpRenderer()

    const output = renderCommandHelp({
      name: 'deploy',
      usage: 'dx deploy <target> [环境标志]',
      summary: '部署前端到 Vercel 或后端制品到远端主机',
      notes: ['backend 制品发布目标默认 --dev'],
      examples: [
        {
          command: 'dx deploy backend --prod',
          description: '构建 backend 制品并部署到远端主机',
        },
      ],
      targets: [
        {
          name: 'backend',
          nodeType: 'target-leaf',
          summary: '构建并部署 backend 制品到远端主机',
          notes: ['支持跳过远端迁移'],
          options: [
            {
              flags: ['--build-only'],
              description: '仅构建制品，不执行远端部署',
            },
            {
              flags: ['--skip-migration'],
              description: '远端部署时跳过 prisma migrate deploy',
            },
          ],
          examples: [
            {
              command: 'dx deploy backend --build-only',
              description: '仅构建 backend 制品',
            },
          ],
        },
        {
          name: 'parallel-web',
          nodeType: 'orchestration-node',
          summary: '内部编排节点',
        },
      ],
    })

    expect(output).toContain('部署前端到 Vercel 或后端制品到远端主机')
    expect(output).toContain('构建并部署 backend 制品到远端主机')
    expect(output).toContain('--build-only')
    expect(output).toContain('--skip-migration')
    expect(output).toContain('dx deploy backend --build-only')
    expect(output).not.toContain('parallel-web')
  })

  test('global help wrapper falls back to generic dynamic output without explicit cli context', async () => {
    const { showHelp } = await loadHelpRuntime()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    try {
      showHelp()

      const output = logSpy.mock.calls.flat().join('\n')
      expect(output).toContain('DX CLI v')
      expect(output).toContain('用法:')
      expect(output).not.toContain('统一开发环境管理工具')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('global help stays dynamic when command summaries are missing', async () => {
    const { showHelp } = await loadHelpRuntime()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const cli = {
      invocation: 'dx',
      commands: {
        start: {},
        deploy: {},
      },
      commandHandlers: {
        start: () => {},
        deploy: () => {},
      },
      flagDefinitions: {
        _global: [],
      },
    }

    try {
      showHelp(cli)

      const output = logSpy.mock.calls.flat().join('\n')
      expect(output).toContain('DX CLI v')
      expect(output).toContain('用法:')
      expect(output).toContain('命令:')
      expect(output).toContain('  start')
      expect(output).toContain('  deploy')
      expect(output).not.toContain('统一开发环境管理工具')
      expect(output).not.toContain('initial')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('command help stays dynamic when migrated help metadata is missing', async () => {
    const { showCommandHelp } = await loadHelpRuntime()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const cli = {
      invocation: 'dx',
      commands: {
        start: {
          backend: {
            development: {
              command: 'echo start backend',
            },
          },
          stack: {
            internal: 'pm2-stack',
          },
        },
      },
      commandHandlers: {
        start: () => {},
      },
      flagDefinitions: {
        _global: [],
      },
    }

    try {
      showCommandHelp('start', cli)

      const output = logSpy.mock.calls.flat().join('\n')
      expect(output).toContain('start 命令用法:')
      expect(output).toContain('dx start <service> [环境标志]')
      expect(output).toContain('可用 target:')
      expect(output).toContain('backend')
      expect(output).toContain('stack')
      expect(output).not.toContain('服务说明:')
      expect(output).not.toContain('stagewise-front')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('handleHelp uses live cli context for global help output', async () => {
    const { handleHelp } = await loadCoreCommands()
    const configDir = createTempConfig({
      help: {
        summary: 'Scoped DX help',
        commands: {
          start: { summary: 'Start summary' },
        },
      },
      start: {},
      ghost: {},
    })
    tempPaths.add(configDir)
    process.env.DX_CONFIG_DIR = configDir

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const cli = {
      invocation: 'dx',
      commands: {
        help: {
          summary: 'Scoped DX help',
          commands: {
            start: { summary: 'Start summary' },
          },
        },
        start: {},
        ghost: {},
      },
      commandHandlers: {
        start: () => {},
      },
      flagDefinitions: {
        _global: [],
      },
    }

    try {
      handleHelp(cli, [])

      const output = logSpy.mock.calls.flat().join('\n')
      expect(output).toContain('Scoped DX help')
      expect(output).toContain('Start summary')
      expect(output).not.toContain('Ghost summary')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('help positional validation still rejects dx help <command> <target>', async () => {
    const { DxCli } = await loadDxCli()
    const argvBackup = process.argv
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit:${code}`)
    })
    const configDir = resolve(process.cwd(), 'example', 'dx', 'config')

    try {
      process.argv = ['node', 'dx', 'help', 'start', 'stack']
      const cli = new DxCli({ configDir })

      expect(() => cli.validateInputs()).toThrow('process.exit:1')
    } finally {
      process.argv = argvBackup
      exitSpy.mockRestore()
    }
  })
})
