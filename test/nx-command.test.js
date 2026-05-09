import { describe, expect, test } from '@jest/globals'
import { appendNxVerboseFlag } from '../lib/cli/nx-command.js'

describe('appendNxVerboseFlag', () => {
  test('inserts --verbose before Nx passthrough args', () => {
    expect(
      appendNxVerboseFlag('npx nx run-many -t lint --skip-nx-cache -- --max-warnings=2'),
    ).toBe('npx nx run-many -t lint --skip-nx-cache --verbose -- --max-warnings=2')
  })

  test('appends --verbose when command has no passthrough separator', () => {
    expect(appendNxVerboseFlag('npx nx run-many -t lint')).toBe(
      'npx nx run-many -t lint --verbose',
    )
  })

  test('leaves non-Nx and already verbose commands unchanged', () => {
    expect(appendNxVerboseFlag('pnpm test -- --runInBand')).toBe('pnpm test -- --runInBand')
    expect(appendNxVerboseFlag('npx nx test backend --verbose')).toBe(
      'npx nx test backend --verbose',
    )
  })
})
