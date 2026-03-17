import { describe, expect, test } from '@jest/globals'
import { createRemotePhaseModel } from '../lib/backend-artifact-deploy/remote-phases.js'
import { buildRemoteDeployScript } from '../lib/backend-artifact-deploy/remote-script.js'

function createPayload() {
  return {
    environment: 'production',
    versionName: 'backend-v1.2.3-20260312-010203',
    uploadedBundlePath: '/srv/example-app/uploads/backend-bundle-v1.2.3-20260312-010203.tgz',
    remote: {
      host: 'deploy.example.com',
      port: 22,
      user: 'deploy',
      baseDir: '/srv/example-app',
    },
    runtime: {
      prismaSchemaDir: 'apps/backend/prisma/schema',
      prismaConfig: 'apps/backend/prisma.config.ts',
      ecosystemConfig: 'ecosystem.config.cjs',
    },
    startup: {
      mode: 'pm2',
      serviceName: 'backend',
      entry: null,
    },
    deploy: {
      keepReleases: 5,
      installCommand: 'pnpm install --prod --no-frozen-lockfile --ignore-workspace',
      prismaGenerate: true,
      prismaMigrateDeploy: true,
      skipMigration: false,
    },
    verify: {
      healthCheck: {
        url: 'http://127.0.0.1:3005/api/v1/health',
        timeoutSeconds: 10,
        maxWaitSeconds: 24,
        retryIntervalSeconds: 2,
      },
    },
  }
}

describe('remote deploy script', () => {
  test('builds a bash script that emits DX_REMOTE_RESULT JSON', () => {
    const script = buildRemoteDeployScript(createRemotePhaseModel(createPayload()))

    expect(script).toContain('#!/usr/bin/env bash')
    expect(script).toContain('set -euo pipefail')
    expect(script).toContain('DX_REMOTE_PHASE=lock')
    expect(script).toContain('DX_REMOTE_RESULT=')
    expect(script.match(/DX_REMOTE_RESULT=/g)).toHaveLength(1)
  })

  test('prefers flock and falls back to lock directory when flock is unavailable', () => {
    const script = buildRemoteDeployScript(createRemotePhaseModel(createPayload()))

    expect(script).toContain('command -v flock >/dev/null 2>&1')
    expect(script).toContain('.deploy.lock')
    expect(script).toContain('.deploy.lock.d')
  })

  test('rejects unsafe archive entries and escaped remote paths', () => {
    const script = buildRemoteDeployScript(createRemotePhaseModel(createPayload()))

    expect(script).toContain('包含绝对路径条目')
    expect(script).toContain('包含可疑路径条目')
    expect(script).toContain('包含可疑链接目标')
    expect(script).toContain('目标路径越界')
  })

  test('extracts outer bundle without stripping the top-level files and normalizes checksum lookup', () => {
    const script = buildRemoteDeployScript(createRemotePhaseModel(createPayload()))

    expect(script).toContain('tar -xzf "$ARCHIVE" -C "$BUNDLE_TEMP_DIR"')
    expect(script).not.toContain('tar -xzf "$ARCHIVE" -C "$BUNDLE_TEMP_DIR" --strip-components=1')
    expect(script).toContain('file="$(basename "$file")"')
  })

  test('validates current symlink, pm2 runtime state, and configured health endpoint after startup', () => {
    const script = buildRemoteDeployScript(createRemotePhaseModel(createPayload()))

    expect(script).toContain('CURRENT_PHASE="verify"')
    expect(script).toContain('current 软链接不存在')
    expect(script).toContain('current 软链接未指向本次 release')
    expect(script).toContain('pm2 describe "$SERVICE_NAME"')
    expect(script).toContain('pm2 jlist')
    expect(script).toContain('APP_ENV 不匹配')
    expect(script).toContain('NODE_ENV 不匹配')
    expect(script).toContain('HEALTHCHECK_MAX_WAIT_SECONDS=24')
    expect(script).toContain('HEALTHCHECK_RETRY_DELAY_SECONDS=2')
    expect(script).toContain('health check failed within')
    expect(script).toContain('sleep "$HEALTHCHECK_RETRY_DELAY_SECONDS"')
    expect(script).toContain('DX_REMOTE_RESULT={"ok":%s,"phase":"%s","message":"%s","rollbackAttempted":%s,"rollbackSucceeded":%s,"summary":%s}')
    expect(script).toContain('"releaseName":"')
    expect(script).toContain('"currentRelease":"')
    expect(script).toContain('"serviceName":"')
    expect(script).toContain('"serviceStatus":"')
    expect(script).toContain('"appEnv":"')
    expect(script).toContain('"nodeEnv":"')
    expect(script).toContain('"healthUrl":"')
    expect(script).toContain('curl -fsS --max-time "$HEALTHCHECK_TIMEOUT_SECONDS" "$HEALTHCHECK_URL"')
  })

  test('includes prisma-seed phase when prismaSeed is enabled', () => {
    const payload = createPayload()
    payload.deploy.prismaSeed = true

    const script = buildRemoteDeployScript(createRemotePhaseModel(payload))

    expect(script).toContain('SHOULD_SEED=1')
    expect(script).toContain('CURRENT_PHASE="prisma-seed"')
    expect(script).toContain('DX_REMOTE_PHASE=prisma-seed')
    expect(script).toContain('db seed --schema=')
  })

  test('skips prisma-seed phase when prismaSeed is not enabled', () => {
    const script = buildRemoteDeployScript(createRemotePhaseModel(createPayload()))

    expect(script).toContain('SHOULD_SEED=0')
  })

  test('skips health check when no verify.healthCheck is configured', () => {
    const payload = createPayload()
    payload.verify = { healthCheck: null }

    const script = buildRemoteDeployScript(createRemotePhaseModel(payload))

    expect(script).toContain('HEALTHCHECK_URL=')
    expect(script).toContain('if [[ -n "$HEALTHCHECK_URL" ]]; then')
  })
})
