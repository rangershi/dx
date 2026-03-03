import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('start stack configuration', () => {
  test('handleStart no longer hard-codes stack branch', () => {
    const file = join(process.cwd(), 'lib', 'cli', 'commands', 'start.js')
    const source = readFileSync(file, 'utf8')

    expect(source.includes("service === 'stack'")).toBe(false)
    expect(source.includes("import('./stack.js')")).toBe(false)
  })

  test('default commands config provides start.stack internal runner', () => {
    const file = join(process.cwd(), 'dx', 'config', 'commands.json')
    const commands = JSON.parse(readFileSync(file, 'utf8'))

    expect(commands?.start?.stack).toBeDefined()
    expect(commands.start.stack.internal).toBe('pm2-stack')
    expect(Array.isArray(commands.start.stack?.stack?.services)).toBe(true)
  })
})
