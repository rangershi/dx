export const FLAG_DEFINITIONS = {
  _global: [
    { flag: '--dev' },
    { flag: '--development' },
    { flag: '--prod' },
    { flag: '--production' },
    { flag: '--staging' },
    { flag: '--stage' },
    { flag: '--test' },
    { flag: '--e2e' },
    { flag: '--no-env-check' },
    { flag: '-Y' },
    { flag: '--yes' },
    { flag: '-v' },
    { flag: '--verbose' },
    { flag: '-h' },
    { flag: '--help' },
    { flag: '--parallel' },
    { flag: '-P' },
  ],
  db: [
    { flag: '--name', expectsValue: true },
    { flag: '-n', expectsValue: true },
  ],
  test: [{ flag: '-t', expectsValue: true }],
  package: [
    { flag: '--skip-build' },
    { flag: '--keep-workdir' },
  ],
  worktree: [
    { flag: '--base', expectsValue: true },
    { flag: '-b', expectsValue: true },
    { flag: '--all' },
  ],
  lint: [
    { flag: '--fix' },
  ],
}

export function parseFlags(args = []) {
  const flags = {}

  for (const flag of args) {
    if (flag === '--') break
    if (!flag.startsWith('-')) continue
    switch (flag) {
      case '--dev':
      case '--development':
        flags.dev = true
        break
      case '--prod':
      case '--production':
        flags.prod = true
        break
      case '--staging':
      case '--stage':
        flags.staging = true
        break
      case '--test':
        flags.test = true
        break
      case '--e2e':
        flags.e2e = true
        break
      case '-Y':
      case '--yes':
        flags.Y = true
        break
      case '-v':
      case '--verbose':
        flags.verbose = true
        break
      case '-h':
      case '--help':
        flags.help = true
        break
      case '--no-env-check':
        flags.noEnvCheck = true
        break
      case '--fix':
        flags.fix = true
        break
      case '--parallel':
      case '-P':
        flags.parallel = true
        break
      case '--all':
        flags.all = true
        break
      default:
        break
    }
  }

  return flags
}
