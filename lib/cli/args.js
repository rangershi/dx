export function getCleanArgs(args = []) {
  const result = []
  let afterDoubleDash = false
  for (const arg of args) {
    if (arg === '--') {
      afterDoubleDash = true
      break
    }
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
