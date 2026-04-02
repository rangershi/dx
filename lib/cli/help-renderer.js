function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function pushSection(lines, title, entries = []) {
  const normalizedEntries = entries.filter(Boolean)
  if (normalizedEntries.length === 0) return

  lines.push('', title, ...normalizedEntries)
}

function formatExample(example = {}, indent = '  ') {
  const command = typeof example.command === 'string' ? example.command : ''
  const description = typeof example.description === 'string' ? example.description : ''

  if (!command) return ''
  if (!description) return `${indent}${command}`
  return `${indent}${command}  # ${description}`
}

function formatOption(option = {}, indent = '  ') {
  const flags = normalizeArray(option.flags).filter(Boolean).join(', ')
  const description = typeof option.description === 'string' ? option.description : ''

  if (!flags && !description) return ''
  if (!description) return `${indent}${flags}`
  return `${indent}${flags}  ${description}`
}

function getVisibleTargets(targets = []) {
  return normalizeArray(targets).filter(target => target?.nodeType !== 'orchestration-node')
}

function formatTarget(target = {}, width = 0) {
  const name = typeof target.name === 'string' ? target.name : ''
  const summary = typeof target.summary === 'string' ? target.summary : ''
  const lines = []

  if (!name) return lines

  lines.push(summary ? `  ${name.padEnd(width)}  ${summary}` : `  ${name}`)

  normalizeArray(target.notes).forEach(note => {
    if (!note) return
    lines.push(`    提示: ${note}`)
  })

  normalizeArray(target.options).forEach(option => {
    const rendered = formatOption(option, '    选项: ')
    if (rendered) lines.push(rendered)
  })

  normalizeArray(target.examples).forEach(example => {
    const rendered = formatExample(example, '    示例: ')
    if (rendered) lines.push(rendered)
  })

  return lines
}

export function renderGlobalHelp(model = {}) {
  const lines = []
  const invocation = model.invocation || 'dx'
  const title = [model.title, model.summary].filter(Boolean).join(' - ') || model.title || model.summary
  const commands = normalizeArray(model.commands)
  const commandWidth = Math.max(0, ...commands.map(command => String(command?.name || '').length))

  if (title) {
    lines.push('', title)
  }

  pushSection(lines, '用法:', [`  ${invocation} <命令> [选项] [参数...]`])
  pushSection(
    lines,
    '命令:',
    commands.map(command => {
      const name = String(command?.name || '')
      const summary = String(command?.summary || '')
      if (!name) return ''
      return summary ? `  ${name.padEnd(commandWidth)}  ${summary}` : `  ${name}`
    }),
  )
  pushSection(lines, '选项:', normalizeArray(model.globalOptions).map(option => formatOption(option)))
  pushSection(lines, '示例:', normalizeArray(model.examples).map(example => formatExample(example)))

  return lines.join('\n')
}

export function renderCommandHelp(model = {}) {
  const name = typeof model.name === 'string' ? model.name : ''
  const usage = typeof model.usage === 'string' ? model.usage : ''
  const args = normalizeArray(model.args)
  const notes = normalizeArray(model.notes)
  const options = normalizeArray(model.options)
  const examples = normalizeArray(model.examples)
  const targets = getVisibleTargets(model.targets)
  const targetWidth = Math.max(0, ...targets.map(target => String(target?.name || '').length))
  const lines = []

  if (name) {
    lines.push('', `${name} 命令用法:`)
  }

  if (usage) {
    lines.push(`  ${usage}`)
  }

  if (model.summary) {
    pushSection(lines, '摘要:', [`  ${model.summary}`])
  }

  pushSection(
    lines,
    '参数说明:',
    args.map(arg => {
      const argName = typeof arg.name === 'string' ? arg.name : ''
      const description = typeof arg.description === 'string' ? arg.description : ''

      if (!argName && !description) return ''
      if (!description) return `  ${argName}`
      return `  ${argName}: ${description}`
    }),
  )

  pushSection(
    lines,
    '可用 target:',
    targets.flatMap(target => formatTarget(target, targetWidth)),
  )
  pushSection(lines, '选项:', options.map(option => formatOption(option)))
  pushSection(lines, '提示:', notes.map(note => (note ? `  ${note}` : '')))
  pushSection(lines, '示例:', examples.map(example => formatExample(example)))

  return lines.join('\n')
}
