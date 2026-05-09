export function appendNxVerboseFlag(command) {
  const text = String(command || '').trim()
  if (!text) return text
  if (!/\bnx(?:\.js)?\b/.test(text)) return text
  if (/(?:^|\s)--verbose(?:\s|$)/.test(text)) return text

  const passthroughIndex = text.indexOf(' -- ')
  if (passthroughIndex === -1) {
    return `${text} --verbose`
  }

  return `${text.slice(0, passthroughIndex)} --verbose${text.slice(passthroughIndex)}`
}
