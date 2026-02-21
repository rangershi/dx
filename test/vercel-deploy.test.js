import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  deployToVercel,
  isSupportedDeployMode,
  resolveTargetDeployMode,
  resolveTargetPrebuiltCwd,
  resolveTargetRunCwd,
} from '../lib/vercel-deploy.js'
import { logger } from '../lib/logger.js'

describe('deployToVercel()', () => {
  let originalCwd
  let tempDir
  let errorSpy

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = mkdtempSync(join(tmpdir(), 'dx-vercel-deploy-'))
    process.chdir(tempDir)

    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})
    jest.spyOn(logger, 'info').mockImplementation(() => {})

    process.env.VERCEL_TOKEN = 'test-token'
    process.env.VERCEL_ORG_ID = 'team_xxx'
    process.env.VERCEL_PROJECT_ID_FRONT = 'prj_front'
    process.env.VERCEL_PROJECT_ID_ADMIN = 'prj_admin'
    process.env.VERCEL_PROJECT_ID_TELEGRAM_BOT = 'prj_bot'
    process.env.VERCEL_GIT_COMMIT_AUTHOR_EMAIL = ''
    process.env.APP_ENV = 'staging'
    process.env.NODE_ENV = 'production'

    mkdirSync(join(tempDir, 'apps/front'), { recursive: true })
    mkdirSync(join(tempDir, 'apps/admin-front'), { recursive: true })
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true, force: true })

    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_ORG_ID
    delete process.env.VERCEL_PROJECT_ID_FRONT
    delete process.env.VERCEL_PROJECT_ID_ADMIN
    delete process.env.VERCEL_PROJECT_ID_TELEGRAM_BOT
    delete process.env.APP_ENV
    delete process.env.NODE_ENV
    delete process.env.NEXT_PUBLIC_API_BASE
    delete process.env.VERCEL_GIT_COMMIT_AUTHOR_EMAIL

    jest.restoreAllMocks()
    process.exitCode = undefined
  })

  test('returns failure quickly when required vars are missing', async () => {
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_ORG_ID
    delete process.env.VERCEL_PROJECT_ID_FRONT

    writeFileSync(join(tempDir, 'vercel.front.json'), '{}')

    const run = jest.fn().mockResolvedValue({ code: 0 })

    await deployToVercel('front', { environment: 'staging', run })

    expect(run).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('缺少以下 Vercel 环境变量'))
  })

  test('front uses prebuilt deploy mode with separate prebuiltCwd', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.front.json'), '{}')

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    process.env.NEXT_PUBLIC_API_BASE = 'https://api.example.test'

    await deployToVercel('front', {
      environment: 'staging',
      run,
    })

    expect(process.exitCode).toBeUndefined()
    expect(run).toHaveBeenCalledTimes(2)

    const buildArgs = run.mock.calls[0][0]
    const deployArgs = run.mock.calls[1][0]

    expect(buildArgs).toEqual([
      'build',
      '--local-config',
      join(cwd, 'vercel.front.json'),
      '--yes',
      '--scope',
      'team_xxx',
      '--token',
      'test-token',
      '--prod',
    ])

    expect(deployArgs).toEqual([
      'deploy',
      '--prebuilt',
      '--local-config',
      join(cwd, 'vercel.front.json'),
      '--yes',
      '--scope',
      'team_xxx',
      '--token',
      'test-token',
      '--prod',
    ])

    expect(run.mock.calls[0][1].cwd).toBe(cwd)
    expect(run.mock.calls[1][1].cwd).toBe(cwd)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[deploy-context]'))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('mode=prebuilt'))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`runCwd=${cwd}`))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`prebuiltCwd=${cwd}`))
  })

  test('admin keeps prebuilt deploy mode', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.admin.json'), '{}')

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('admin', {
      environment: 'staging',
      run,
    })

    expect(process.exitCode).toBeUndefined()
    expect(run).toHaveBeenCalledTimes(2)

    const buildArgs = run.mock.calls[0][0]
    const deployArgs = run.mock.calls[1][0]
    expect(buildArgs).toEqual([
      'build',
      '--local-config',
      join(cwd, 'vercel.admin.json'),
      '--yes',
      '--scope',
      'team_xxx',
      '--token',
      'test-token',
      '--prod',
    ])
    expect(deployArgs).toEqual([
      'deploy',
      '--prebuilt',
      '--local-config',
      join(cwd, 'vercel.admin.json'),
      '--yes',
      '--scope',
      'team_xxx',
      '--token',
      'test-token',
      '--prod',
    ])
    expect(run.mock.calls[0][1].cwd).toBe(cwd)
    expect(run.mock.calls[1][1].cwd).toBe(cwd)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('mode=prebuilt'))
  })

  test('deploy all keeps prebuilt mode while honoring target prebuilt cwd', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.front.json'), '{}')
    writeFileSync(join(cwd, 'vercel.admin.json'), '{}')

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('all', {
      environment: 'staging',
      strictContext: false,
      run,
    })

    expect(process.exitCode).toBeUndefined()
    expect(run).toHaveBeenCalledTimes(4)

    expect(run.mock.calls[0][1].cwd).toBe(cwd)
    expect(run.mock.calls[1][1].cwd).toBe(cwd)
    expect(run.mock.calls[2][1].cwd).toBe(cwd)
    expect(run.mock.calls[3][1].cwd).toBe(cwd)

    const frontDeployArgs = run.mock.calls[1][0]
    const adminDeployArgs = run.mock.calls[3][0]
    expect(frontDeployArgs).toEqual([
      'deploy',
      '--prebuilt',
      '--local-config',
      join(cwd, 'vercel.front.json'),
      '--yes',
      '--scope',
      'team_xxx',
      '--token',
      'test-token',
      '--prod',
    ])
    expect(adminDeployArgs).toEqual([
      'deploy',
      '--prebuilt',
      '--local-config',
      join(cwd, 'vercel.admin.json'),
      '--yes',
      '--scope',
      'team_xxx',
      '--token',
      'test-token',
      '--prod',
    ])
  })

  test('fails fast when target config file is missing', async () => {
    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('front', {
      environment: 'production',
      run,
    })

    expect(run).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('缺少以下 Vercel 配置文件'))
  })

  test('rejects unsupported target early', async () => {
    const run = jest.fn().mockResolvedValue({ code: 0 })

    await deployToVercel('unknown', { run })

    expect(run).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('不支持的部署目标'))
  })

  test('auto-cleans and continues on linked project mismatch when strictContext enabled', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.front.json'), '{}')
    mkdirSync(join(cwd, '.vercel'), { recursive: true })
    writeFileSync(
      join(cwd, '.vercel/project.json'),
      JSON.stringify({ orgId: 'team_old', projectId: 'prj_old' }),
    )

    const run = jest.fn().mockResolvedValue({ code: 0 })

    await deployToVercel('front', {
      environment: 'staging',
      strictContext: true,
      run,
    })

    expect(run).toHaveBeenCalledTimes(2)
    expect(process.exitCode).toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('检测到 .vercel 链接冲突'))
    expect(existsSync(join(cwd, '.vercel'))).toBe(false)
  })

  test('continues on linked project mismatch when strictContext disabled', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.front.json'), '{}')
    mkdirSync(join(cwd, '.vercel'), { recursive: true })
    writeFileSync(
      join(cwd, '.vercel/project.json'),
      JSON.stringify({ orgId: 'team_old', projectId: 'prj_old' }),
    )

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('front', {
      environment: 'staging',
      strictContext: false,
      run,
    })

    expect(run).toHaveBeenCalledTimes(2)
    expect(process.exitCode).toBeUndefined()
  })

  test('removes linked project file before deploy in strict mode', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.front.json'), '{}')
    mkdirSync(join(cwd, '.vercel'), { recursive: true })
    writeFileSync(
      join(cwd, '.vercel/project.json'),
      JSON.stringify({ orgId: 'team_xxx', projectId: 'prj_front' }),
    )

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('front', {
      environment: 'staging',
      strictContext: true,
      run,
    })

    expect(run).toHaveBeenCalledTimes(2)
    expect(existsSync(join(cwd, '.vercel/project.json'))).toBe(false)
  })

  test('cleans stale .vercel/output before build to avoid EEXIST conflicts', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.front.json'), '{}')
    mkdirSync(join(cwd, '.vercel/output/functions'), { recursive: true })
    writeFileSync(join(cwd, '.vercel/output/functions/stale.txt'), 'stale')

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('front', {
      environment: 'staging',
      strictContext: true,
      run,
    })

    expect(run).toHaveBeenCalledTimes(2)
    expect(process.exitCode).toBeUndefined()
    expect(existsSync(join(cwd, '.vercel/output'))).toBe(false)
  })

  test('deploy all isolates stale link context between targets in strict mode', async () => {
    const cwd = process.cwd()
    const adminCwd = cwd
    writeFileSync(join(cwd, 'vercel.front.json'), '{}')
    writeFileSync(join(cwd, 'vercel.admin.json'), '{}')
    mkdirSync(join(cwd, '.vercel'), { recursive: true })
    writeFileSync(
      join(cwd, '.vercel/project.json'),
      JSON.stringify({ orgId: 'team_xxx', projectId: 'prj_front' }),
    )

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('all', {
      environment: 'staging',
      strictContext: true,
      run,
    })

    expect(process.exitCode).toBeUndefined()
    expect(run).toHaveBeenCalledTimes(4)
    expect(existsSync(join(cwd, '.vercel/project.json'))).toBe(false)
    expect(existsSync(join(adminCwd, '.vercel/project.json'))).toBe(false)

    const adminBuildEnv = run.mock.calls[2][1].env
    const adminDeployEnv = run.mock.calls[3][1].env
    expect(adminBuildEnv.VERCEL_PROJECT_ID).toBe('prj_admin')
    expect(adminDeployEnv.VERCEL_PROJECT_ID).toBe('prj_admin')
  })

  test('admin deploy cwd defaults to project root and still runs when apps/admin-front is missing', async () => {
    const cwd = process.cwd()
    writeFileSync(join(cwd, 'vercel.admin.json'), '{}')
    rmSync(join(cwd, 'apps/admin-front'), { recursive: true, force: true })

    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await deployToVercel('admin', {
      environment: 'staging',
      run,
    })

    expect(run).toHaveBeenCalledTimes(2)
    expect(process.exitCode).toBeUndefined()
  })

})

describe('resolveTargetRunCwd()', () => {
  test('falls back to project root when deployCwd is missing', () => {
    const projectRoot = '/repo'
    expect(resolveTargetRunCwd(projectRoot, { configFile: 'vercel.telegram-bot.json' })).toBe(projectRoot)
  })

  test('resolves absolute run cwd when deployCwd is configured', () => {
    const projectRoot = '/repo'
    expect(resolveTargetRunCwd(projectRoot, { deployCwd: 'apps/front' })).toBe('/repo/apps/front')
  })
})

describe('resolveTargetDeployMode()', () => {
  test('defaults to prebuilt when deployMode is missing', () => {
    expect(resolveTargetDeployMode({ configFile: 'vercel.front.json' })).toBe('prebuilt')
  })

  test('uses target deployMode when configured', () => {
    expect(resolveTargetDeployMode({ deployMode: 'prebuilt' })).toBe('prebuilt')
  })
})

describe('resolveTargetPrebuiltCwd()', () => {
  test('falls back to runCwd when prebuiltCwd is missing', () => {
    expect(resolveTargetPrebuiltCwd('/repo', { deployCwd: 'apps/front' }, '/repo/apps/front')).toBe(
      '/repo/apps/front',
    )
  })

  test('resolves prebuiltCwd relative to project root', () => {
    expect(resolveTargetPrebuiltCwd('/repo', { prebuiltCwd: '.' }, '/repo/apps/front')).toBe('/repo')
  })
})

describe('isSupportedDeployMode()', () => {
  test('accepts prebuilt only', () => {
    expect(isSupportedDeployMode('prebuilt')).toBe(true)
  })

  test('rejects non-prebuilt mode', () => {
    expect(isSupportedDeployMode('source')).toBe(false)
  })
})
