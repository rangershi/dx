import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { execManager } from '../exec.js'
import { basenameOrThrow, resolveWithinBase } from './path-utils.js'
import { createRuntimePackage } from './runtime-package.js'

const execFileAsync = promisify(execFile)
const tarEnv = {
  ...process.env,
  COPYFILE_DISABLE: '1',
  COPY_EXTENDED_ATTRIBUTES_DISABLE: '1',
}

function assertSafeNamePart(value, label) {
  const text = String(value || '').trim()
  if (!text || text.includes('/') || text.includes('\\') || text.includes('..')) {
    throw new Error(`${label} 越界，已拒绝: ${text}`)
  }
  return text
}

function defaultNowTag() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('') + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

async function defaultReadVersion(versionFile) {
  const pkg = JSON.parse(await readFile(versionFile, 'utf8'))
  return String(pkg.version || '').trim()
}

export function buildFlagsForEnvironment(environment) {
  switch (environment || 'development') {
    case 'production':
      return { prod: true }
    case 'staging':
      return { staging: true }
    case 'development':
    default:
      return { dev: true }
  }
}

async function defaultRunBuild(build, environment = 'development') {
  if (!build?.command) {
    throw new Error('缺少构建命令: build.command')
  }
  await execManager.executeCommand(build.command, {
    app: build.app || undefined,
    flags: buildFlagsForEnvironment(environment),
  })
}

async function defaultPrepareOutputDir(outputDir) {
  await mkdir(outputDir, { recursive: true })
}

async function copyIntoDir(source, destinationDir) {
  if (!existsSync(source)) {
    throw new Error(`缺少必需文件或目录: ${source}`)
  }
  await cp(source, destinationDir, { recursive: true })
}

async function defaultStageFiles({ config, stageDir, stagePlan }) {
  await rm(stageDir, { recursive: true, force: true })
  await mkdir(stageDir, { recursive: true })

  for (const entry of await readdir(stagePlan.dist.source)) {
    await copyIntoDir(join(stagePlan.dist.source, entry), join(stageDir, entry))
  }

  const appPackage = JSON.parse(await readFile(stagePlan.appPackage.source, 'utf8'))
  const rootPackage = JSON.parse(await readFile(stagePlan.rootPackage.source, 'utf8'))
  const runtimePackage = createRuntimePackage({ appPackage, rootPackage })
  await writeFile(join(stageDir, stagePlan.runtimePackage.destination), `${JSON.stringify(runtimePackage, null, 2)}\n`)

  await copyIntoDir(stagePlan.lockfile.source, join(stageDir, stagePlan.lockfile.destination))

  if (stagePlan.prismaSchema) {
    await mkdir(join(stageDir, dirname(stagePlan.prismaSchema.destination)), { recursive: true })
    await copyIntoDir(stagePlan.prismaSchema.source, join(stageDir, stagePlan.prismaSchema.destination))
  }
  if (stagePlan.prismaConfig) {
    await mkdir(join(stageDir, dirname(stagePlan.prismaConfig.destination)), { recursive: true })
    await copyIntoDir(stagePlan.prismaConfig.source, join(stageDir, stagePlan.prismaConfig.destination))
  }
  if (stagePlan.ecosystemConfig) {
    await copyIntoDir(stagePlan.ecosystemConfig.source, join(stageDir, stagePlan.ecosystemConfig.destination))
  }
}

async function defaultAssertNoEnvFiles(stageDir) {
  const envFiles = []
  const queue = ['.']

  while (queue.length > 0) {
    const currentRelativeDir = queue.shift()
    const currentDir = currentRelativeDir === '.' ? stageDir : join(stageDir, currentRelativeDir)
    const entries = await readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const entryRelativePath =
        currentRelativeDir === '.' ? entry.name : join(currentRelativeDir, entry.name)

      if (entry.name.startsWith('.env')) {
        envFiles.push(entryRelativePath.replace(/\\/g, '/'))
      }

      if (entry.isDirectory()) {
        queue.push(entryRelativePath)
      }
    }
  }

  if (envFiles.length > 0) {
    throw new Error(`制品目录包含 .env* 文件: ${envFiles.join(', ')}`)
  }
}

async function defaultCreateInnerArchive({ stageDir, innerArchivePath }) {
  await mkdir(dirname(innerArchivePath), { recursive: true })
  await execFileAsync('tar', ['-czf', innerArchivePath, '.'], {
    cwd: stageDir,
    env: tarEnv,
  })
}

async function defaultWriteChecksum({ archivePath, checksumPath }) {
  const archiveName = basename(archivePath)
  try {
    const { stdout } = await execFileAsync('sha256sum', [archiveName], {
      cwd: dirname(archivePath),
    })
    await writeFile(checksumPath, stdout)
  } catch {
    const { stdout } = await execFileAsync('shasum', ['-a', '256', archiveName], {
      cwd: dirname(archivePath),
    })
    await writeFile(checksumPath, stdout)
  }
}

async function defaultCreateBundle({ outputDir, bundlePath, innerArchivePath, checksumPath }) {
  await execFileAsync(
    'tar',
    ['-czf', bundlePath, basename(innerArchivePath), basename(checksumPath)],
    {
      cwd: outputDir,
      env: tarEnv,
    },
  )
}

export function createArtifactNames({ version, timeTag, bundleName }) {
  const safeVersion = assertSafeNamePart(version, 'version')
  const safeTimeTag = assertSafeNamePart(timeTag, 'timeTag')
  const safeBundleName = assertSafeNamePart(bundleName, 'bundleName')
  const versionName = `backend-v${safeVersion}-${safeTimeTag}`
  const innerArchiveName = `${versionName}.tgz`
  return {
    versionName,
    innerArchiveName,
    checksumName: `${innerArchiveName}.sha256`,
    bundleName: `${safeBundleName}-v${safeVersion}-${safeTimeTag}.tgz`,
  }
}

export function createStagePlan(config) {
  const projectRoot = config.projectRoot || '/'
  const relativeToProject = targetPath =>
    relative(projectRoot, targetPath).replace(/\\/g, '/').replace(/^repo\//, '')
  const plan = {
    dist: {
      source: config.build.distDir,
      destination: '.',
    },
    runtimePackage: {
      destination: 'package.json',
    },
    lockfile: {
      source: config.runtime.lockfile,
      destination: 'pnpm-lock.yaml',
    },
    appPackage: {
      source: config.runtime.appPackage,
    },
    rootPackage: {
      source: config.runtime.rootPackage,
    },
  }

  if (config.runtime.prismaSchemaDir) {
    plan.prismaSchema = {
      source: config.runtime.prismaSchemaDir,
      destination: relativeToProject(config.runtime.prismaSchemaDir),
    }
  }
  if (config.runtime.prismaConfig) {
    plan.prismaConfig = {
      source: config.runtime.prismaConfig,
      destination: relativeToProject(config.runtime.prismaConfig),
    }
  }
  if (config.runtime.ecosystemConfig) {
    plan.ecosystemConfig = {
      source: config.runtime.ecosystemConfig,
      destination: basenameOrThrow(config.runtime.ecosystemConfig, 'runtime.ecosystemConfig'),
    }
  }

  return plan
}

export async function buildBackendArtifact(config, deps = {}) {
  const nowTag = deps.nowTag || defaultNowTag
  const readVersion = deps.readVersion || defaultReadVersion
  const runBuild = deps.runBuild || defaultRunBuild
  const prepareOutputDir = deps.prepareOutputDir || defaultPrepareOutputDir
  const stageFiles = deps.stageFiles || defaultStageFiles
  const assertNoEnvFiles = deps.assertNoEnvFiles || defaultAssertNoEnvFiles
  const createInnerArchive = deps.createInnerArchive || defaultCreateInnerArchive
  const writeChecksum = deps.writeChecksum || defaultWriteChecksum
  const createBundle = deps.createBundle || defaultCreateBundle
  const version = await readVersion(config.build.versionFile)
  const timeTag = nowTag()
  const names = createArtifactNames({
    version,
    timeTag,
    bundleName: config.artifact.bundleName,
  })

  const outputDir = resolveWithinBase(config.artifact.outputDir, '.', 'artifact.outputDir')
  const stageDir = resolveWithinBase(outputDir, names.versionName, 'stageDir')
  const innerArchivePath = resolveWithinBase(outputDir, names.innerArchiveName, 'innerArchivePath')
  const checksumPath = resolveWithinBase(outputDir, names.checksumName, 'checksumPath')
  const bundlePath = resolveWithinBase(outputDir, names.bundleName, 'bundlePath')

  await runBuild(config.build, config.environment)
  await prepareOutputDir(outputDir)
  await stageFiles({
    config,
    stageDir,
    stagePlan: createStagePlan(config),
  })
  await assertNoEnvFiles(stageDir)
  await createInnerArchive({ stageDir, innerArchivePath })
  await writeChecksum({ archivePath: innerArchivePath, checksumPath })
  await createBundle({ outputDir, bundlePath, innerArchivePath, checksumPath })

  return {
    version,
    timeTag,
    versionName: names.versionName,
    bundlePath,
    innerArchivePath,
    checksumPath,
  }
}
