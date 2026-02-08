import { getCleanArgs, getCleanArgsWithConsumedValues } from '../lib/cli/args.js'

describe('cli args cleaning', () => {
  test('getCleanArgs() keeps flag values (historical behavior)', () => {
    const argv = ['deploy', 'telegram-bot', '--webhook-path', '/webhook', '--staging']
    expect(getCleanArgs(argv)).toEqual(['deploy', 'telegram-bot', '/webhook'])
  })

  test('getCleanArgsWithConsumedValues() removes consumed flag values', () => {
    const argv = ['deploy', 'telegram-bot', '--webhook-path', '/webhook', '--staging']
    // '/webhook' is at index 3
    const clean = getCleanArgsWithConsumedValues(argv, new Set([3]))
    expect(clean).toEqual(['deploy', 'telegram-bot'])
  })

  test('getCleanArgsWithConsumedValues() stops at --', () => {
    const argv = ['db', 'script', 'x', '--name', 'ignored', '--', '--name', 'kept']
    const clean = getCleanArgsWithConsumedValues(argv, new Set())
    // Should not include anything after `--`
    expect(clean).toEqual(['db', 'script', 'x', 'ignored'])
  })
})
