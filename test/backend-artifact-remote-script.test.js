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
})
