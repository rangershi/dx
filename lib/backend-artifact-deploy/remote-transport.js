import { spawn } from 'node:child_process'
import { basename, relative } from 'node:path'
import { buildRemoteDeployScript } from './remote-script.js'
import { createRemotePhaseModel } from './remote-phases.js'
import { parseRemoteResult } from './remote-result.js'

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', exitCode => resolve({ stdout, stderr, exitCode }))
  })
}

async function defaultEnsureRemoteBaseDirs(remote) {
  const target = `${remote.user}@${remote.host}`
  const args = [
    '-p',
    String(remote.port || 22),
    target,
    `mkdir -p ${remote.baseDir}/releases ${remote.baseDir}/shared ${remote.baseDir}/uploads`,
  ]
  const result = await runProcess('ssh', args)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `ssh mkdir failed (${result.exitCode})`)
  }
}

async function defaultUploadBundle(remote, bundlePath) {
  const target = `${remote.user}@${remote.host}:${remote.baseDir}/uploads/${basename(bundlePath)}`
  const result = await runProcess('scp', ['-P', String(remote.port || 22), bundlePath, target])
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `scp failed (${result.exitCode})`)
  }
}

async function defaultRunRemoteScript(remote, script) {
  const target = `${remote.user}@${remote.host}`
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-p', String(remote.port || 22), target, 'bash -s'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', exitCode => resolve({ stdout, stderr, exitCode }))
    child.stdin.write(script)
    child.stdin.end()
  })
}

function createRemotePayload(config, bundle) {
  const toReleaseRelativePath = targetPath => {
    if (!targetPath) return null
    if (!config.projectRoot) return targetPath
    return relative(config.projectRoot, targetPath).replace(/\\/g, '/')
  }

  return {
    environment: config.environment,
    versionName: bundle.versionName,
    uploadedBundlePath: `${config.remote.baseDir}/uploads/${basename(bundle.bundlePath)}`,
    remote: config.remote,
    runtime: {
      prismaSchemaDir: toReleaseRelativePath(config.runtime.prismaSchemaDir),
      prismaConfig: toReleaseRelativePath(config.runtime.prismaConfig),
      ecosystemConfig: config.runtime.ecosystemConfig ? basename(config.runtime.ecosystemConfig) : null,
    },
    startup: config.startup,
    deploy: config.deploy,
  }
}

export async function deployBackendArtifactRemotely(config, bundle, deps = {}) {
  const ensureRemoteBaseDirs = deps.ensureRemoteBaseDirs || defaultEnsureRemoteBaseDirs
  const uploadBundle = deps.uploadBundle || defaultUploadBundle
  const runRemoteScript = deps.runRemoteScript || defaultRunRemoteScript

  await ensureRemoteBaseDirs(config.remote)
  await uploadBundle(config.remote, bundle.bundlePath)
  const payload = createRemotePayload(config, bundle)
  const phaseModel = createRemotePhaseModel(payload)
  const script = buildRemoteDeployScript(phaseModel)
  const commandResult = await runRemoteScript(config.remote, script)
  return parseRemoteResult(commandResult)
}
