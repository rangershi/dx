export function getCleanArgs(args = []) {
  const result = []
  for (const arg of args) {
    if (arg === '--') {
      break
    }
    if (arg.startsWith('-')) continue
    result.push(arg)
  }
  return result
}

// Like getCleanArgs(), but also strips values consumed by flags that expect a value.
// consumedFlagValueIndexes: Set<number> of indexes in the original argv that should be skipped.
export function getCleanArgsWithConsumedValues(args = [], consumedFlagValueIndexes = new Set()) {
  const result = []
  const consumed = consumedFlagValueIndexes instanceof Set
    ? consumedFlagValueIndexes
    : new Set(consumedFlagValueIndexes || [])

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') {
      break
    }
    if (consumed.has(i)) continue
    if (arg.startsWith('-')) continue
    result.push(arg)
  }

  return result
}

export function getPassthroughArgs(args = []) {
  const doubleDashIndex = args.indexOf('--')
  if (doubleDashIndex === -1) return []
  return args.slice(doubleDashIndex + 1)
}
