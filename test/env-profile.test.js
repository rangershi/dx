import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  executeWithEnvProfile,
  loadEnvProfileConfig,
  validateEnvProfile,
} from '../lib/env-profile.js'

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'dx-env-profile-'))
  const configDir = join(root, 'dx', 'config')
  mkdirSync(configDir, { recursive: true })
  writeJson(join(configDir, 'commands.json'), {})
  writeJson(join(configDir, 'env-profiles.json'), {
    version: 1,
    environments: ['staging', 'production'],
    profiles: { br: { label: 'Desejo IA' } },
    requiredLocalKeys: { staging: ['PUBLIC_URL'], production: ['PUBLIC_URL'] },
  })
  writeFileSync(
    join(configDir, 'env-policy.jsonc'),
    JSON.stringify({
      version: 1,
      environments: ['staging', 'production'],
      layout: { forbidExact: ['.env', '.env.local'], allowRoot: [], allowSubdirGlobs: [] },
      secretPlaceholder: '__SET_IN_env.local__',
      keys: { secret: ['APP_SECRET'], localOnly: [], localOverride: ['PUBLIC_URL'] },
      appToTarget: { backend: 'backend' },
      targets: {
        backend: {
          files: { committed: '.env.{env}', local: '.env.{env}.local' },
          required: { _common: ['APP_ENV', 'APP_SECRET'], staging: ['PUBLIC_URL'] },
        },
      },
    }),
  )
  writeFileSync(join(root, '.env.staging'), 'APP_ENV=staging\nAPP_SECRET=__SET_IN_env.local__\n')
  const profileDirectory = join(root, 'dx', 'env', 'templates', 'br')
  mkdirSync(profileDirectory, { recursive: true })
  const source = join(profileDirectory, 'staging.local')
  writeFileSync(source, 'APP_SECRET=real-secret\nPUBLIC_URL=https://staging.desejo.ai\n', { mode: 0o600 })
  chmodSync(source, 0o600)
  return { root, configDir, source, target: join(root, '.env.staging.local') }
}

describe('env profile module', () => {
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test('loads profile config and validates a complete private profile', () => {
    const project = createProject()
    roots.push(project.root)

    expect(loadEnvProfileConfig(project.configDir).profiles.br.label).toBe('Desejo IA')
    expect(
      validateEnvProfile({
        projectRoot: project.root,
        configDir: project.configDir,
        profile: 'br',
        environment: 'staging',
      }),
    ).toEqual(expect.objectContaining({ profile: 'br', environment: 'staging', keyCount: 2 }))
  })

  test('rejects profiles with broad filesystem permissions', () => {
    const project = createProject()
    roots.push(project.root)
    chmodSync(project.source, 0o644)

    expect(() =>
      validateEnvProfile({
        projectRoot: project.root,
        configDir: project.configDir,
        profile: 'br',
        environment: 'staging',
      }),
    ).toThrow('chmod 600')
  })

  test('rejects a profile that is not ignored inside a Git repository', () => {
    const project = createProject()
    roots.push(project.root)
    spawnSync('git', ['init', '-q'], { cwd: project.root })

    expect(() =>
      validateEnvProfile({
        projectRoot: project.root,
        configDir: project.configDir,
        profile: 'br',
        environment: 'staging',
      }),
    ).toThrow('未被 Git 忽略')

    writeFileSync(join(project.root, '.gitignore'), '/dx/env/templates/**/*.local\n')
    expect(() =>
      validateEnvProfile({
        projectRoot: project.root,
        configDir: project.configDir,
        profile: 'br',
        environment: 'staging',
      }),
    ).not.toThrow()
  })

  test('materializes the profile only for the child lifetime and removes it afterwards', async () => {
    const project = createProject()
    roots.push(project.root)

    const code = await executeWithEnvProfile({
      projectRoot: project.root,
      configDir: project.configDir,
      profile: 'br',
      environment: 'staging',
      command: process.execPath,
      args: [
        '-e',
        "const fs=require('fs'); const value=fs.readFileSync('.env.staging.local','utf8'); process.exit(value.includes('real-secret') && process.env.APP_SECRET === 'real-secret' ? 0 : 9)",
      ],
    })

    expect(code).toBe(0)
    expect(existsSync(project.target)).toBe(false)
  })

  test('rejects a persistent canonical local file instead of preserving legacy state', async () => {
    const project = createProject()
    roots.push(project.root)
    writeFileSync(project.target, 'ORIGINAL=yes\n', { mode: 0o600 })

    await expect(
      executeWithEnvProfile({
        projectRoot: project.root,
        configDir: project.configDir,
        profile: 'br',
        environment: 'staging',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
      }),
    ).rejects.toThrow('不允许存在持久根配置')

    expect(readFileSync(project.target, 'utf8')).toBe('ORIGINAL=yes\n')
  })

  test('removes the transient file when the child command fails', async () => {
    const project = createProject()
    roots.push(project.root)

    const code = await executeWithEnvProfile({
      projectRoot: project.root,
      configDir: project.configDir,
      profile: 'br',
      environment: 'staging',
      command: process.execPath,
      args: ['-e', 'process.exit(7)'],
    })

    expect(code).toBe(7)
    expect(existsSync(project.target)).toBe(false)
  })

  test('recovers a profile transaction left by a killed process before the next execution', async () => {
    const project = createProject()
    roots.push(project.root)
    const temporary = `${project.target}.dx-profile-stale`
    writeFileSync(project.target, readFileSync(project.source), { mode: 0o600 })
    writeFileSync(temporary, 'STALE=temp\n', { mode: 0o600 })
    const lockKey = createHash('sha256')
      .update(`${project.root}\0staging`)
      .digest('hex')
      .slice(0, 20)
    writeFileSync(
      join(tmpdir(), `dx-env-profile-${lockKey}.lock`),
      JSON.stringify({
        pid: 2147483647,
        profile: 'br',
        environment: 'staging',
        transaction: { target: project.target, temporary },
      }),
      { mode: 0o600 },
    )

    const code = await executeWithEnvProfile({
      projectRoot: project.root,
      configDir: project.configDir,
      profile: 'br',
      environment: 'staging',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
    })

    expect(code).toBe(0)
    expect(existsSync(project.target)).toBe(false)
    expect(existsSync(temporary)).toBe(false)
  })

  test('CLI requires an explicit environment and rejects nested dx environment mismatches', () => {
    const project = createProject()
    roots.push(project.root)
    writeFileSync(join(project.root, '.gitignore'), '/dx/env/templates/**/*.local\n')
    spawnSync('git', ['init', '-q'], { cwd: project.root })
    const bin = resolve(process.cwd(), 'bin', 'dx.js')

    const missingFlag = spawnSync(
      process.execPath,
      [bin, '--config-dir', project.configDir, 'env', 'validate', 'br'],
      { cwd: project.root, encoding: 'utf8' },
    )
    expect(missingFlag.status).toBe(1)
    expect(`${missingFlag.stdout}${missingFlag.stderr}`).toContain('必须显式指定')

    const mismatch = spawnSync(
      process.execPath,
      [bin, '--config-dir', project.configDir, 'env', 'exec', 'br', '--staging', '--', 'dx', 'status', '--prod'],
      { cwd: project.root, encoding: 'utf8' },
    )
    expect(mismatch.status).toBe(1)
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('内部 dx 命令指定了 production')
  })
})
