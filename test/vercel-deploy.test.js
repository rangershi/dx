import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deployToVercel } from '../lib/vercel-deploy.js'
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

  test('build/deploy run with explicit scope/project/cwd/env args', async () => {
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
      '--build-env',
      'APP_ENV=staging',
      '--build-env',
      'NEXT_PUBLIC_API_BASE=https://api.example.test',
      '--build-env',
      'NODE_ENV=production',
      '--cwd',
      cwd,
      '--scope',
      'team_xxx',
      '--project',
      'prj_front',
      '--prod',
    ])

    expect(deployArgs).toEqual([
      'deploy',
      '--prebuilt',
      '--local-config',
      join(cwd, 'vercel.front.json'),
      '--yes',
      '--env',
      'APP_ENV=staging',
      '--env',
      'NEXT_PUBLIC_API_BASE=https://api.example.test',
      '--env',
      'NODE_ENV=production',
      '--cwd',
      cwd,
      '--scope',
      'team_xxx',
      '--project',
      'prj_front',
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

  test('fails on linked project mismatch when strictContext enabled', async () => {
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

    expect(run).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('检测到 .vercel 链接冲突'))
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

  test('deploy all isolates stale link context between targets in strict mode', async () => {
    const cwd = process.cwd()
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

    const adminBuildArgs = run.mock.calls[2][0]
    const adminDeployArgs = run.mock.calls[3][0]
    expect(adminBuildArgs).toContain('prj_admin')
    expect(adminDeployArgs).toContain('prj_admin')
  })
})
