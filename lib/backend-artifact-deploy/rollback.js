export function shouldAttemptRollback({ migrationExecuted, startupMode }) {
  if (migrationExecuted) return false
  if (startupMode === 'direct') return false
  return true
}
