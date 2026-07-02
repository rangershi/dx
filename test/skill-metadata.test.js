import { describe, expect, test } from '@jest/globals'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()
const skillsDir = join(repoRoot, 'skills')

function readSkillFrontmatter(skillName) {
  const text = readFileSync(join(skillsDir, skillName, 'SKILL.md'), 'utf8')
  const match = text.match(/^---\n(?<frontmatter>[\s\S]*?)\n---/)
  if (!match?.groups?.frontmatter) {
    throw new Error(`Skill ${skillName} is missing YAML frontmatter`)
  }

  const fields = {}
  for (const line of match.groups.frontmatter.split('\n')) {
    const field = line.match(/^(?<key>[A-Za-z0-9_-]+):\s*(?<value>.*)$/)
    if (!field?.groups) continue
    fields[field.groups.key] = field.groups.value
  }
  return fields
}

describe('packaged skill metadata', () => {
  test('skills only trigger after explicit user invocation', () => {
    const skillNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(skillNames.length).toBeGreaterThan(0)

    for (const skillName of skillNames) {
      const metadata = readSkillFrontmatter(skillName)
      expect(metadata.name).toBe(skillName)
      expect(metadata.description).toContain(`明确要求使用 ${skillName} 技能`)
      expect(metadata.description).toContain('不要通过关键词、任务类型或上下文自动触发')
      expect(metadata.description).not.toMatch(/Use when|触发场景|用户提到|用于以下场景/)
    }
  })

  test('agent entry metadata disables implicit invocation', () => {
    const skillNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    for (const skillName of skillNames) {
      const agentMetadataPath = join(skillsDir, skillName, 'agents', 'openai.yaml')
      if (!existsSync(agentMetadataPath)) continue

      const text = readFileSync(agentMetadataPath, 'utf8')
      expect(text).toContain('allow_implicit_invocation: false')
    }
  })
})
