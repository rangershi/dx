function parseResultLine(line) {
  if (!line.startsWith('DX_REMOTE_RESULT=')) return null
  return JSON.parse(line.slice('DX_REMOTE_RESULT='.length))
}

function getLastPhase(output = '') {
  const lines = String(output).split('\n')
  let phase = 'cleanup'
  for (const line of lines) {
    if (line.startsWith('DX_REMOTE_PHASE=')) {
      phase = line.slice('DX_REMOTE_PHASE='.length).trim() || phase
    }
  }
  return phase
}

export function parseRemoteResult({ stdout = '', stderr = '', exitCode = 0 }) {
  const allLines = `${stdout}\n${stderr}`.trim().split('\n').filter(Boolean)
  for (let index = allLines.length - 1; index >= 0; index -= 1) {
    const parsed = parseResultLine(allLines[index])
    if (parsed) return parsed
  }

  if (exitCode === 0) {
    return {
      ok: true,
      phase: getLastPhase(stdout),
      message: 'ok',
      rollbackAttempted: false,
      rollbackSucceeded: null,
    }
  }

  const message = [stderr, stdout].filter(Boolean).join('\n').trim() || 'remote execution failed'
  return {
    ok: false,
    phase: getLastPhase(`${stdout}\n${stderr}`),
    message,
    rollbackAttempted: false,
    rollbackSucceeded: null,
  }
}
