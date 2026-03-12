import { readFileSync } from 'node:fs'
import { describe, expect, test } from '@jest/globals'

describe('backend artifact deploy docs and example config', () => {
  test('example commands config documents backend artifact deploy shape', () => {
    const source = readFileSync(new URL('../example/dx/config/commands.json', import.meta.url), 'utf8')
    const config = JSON.parse(source)

    expect(config.deploy.backend.internal).toBe('backend-artifact-deploy')
    expect(config.deploy.backend.backendDeploy.build.commands.production).toContain('npx nx build backend')
    expect(config.deploy.backend.backendDeploy.remote.baseDir).toBe('/srv/example-app')
  })

  test('README documents backend artifact deploy command and fixed remote layout', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    const exampleReadme = readFileSync(new URL('../example/README.md', import.meta.url), 'utf8')
    const designSpec = readFileSync(
      new URL('../docs/superpowers/specs/2026-03-12-backend-artifact-deploy-design.md', import.meta.url),
      'utf8',
    )
    const plan = readFileSync(
      new URL('../docs/superpowers/plans/2026-03-12-backend-artifact-deploy.md', import.meta.url),
      'utf8',
    )

    expect(readme).toContain('dx deploy backend --prod')
    expect(readme).toContain('--build-only')
    expect(readme).toContain('--skip-migration')
    expect(readme).toContain('<baseDir>/releases/<version-name>')
    expect(readme).toContain('<baseDir>/current')
    expect(readme).toContain('<baseDir>/shared/.env.<environment>')
    expect(readme).toContain('如果应用把 `prisma` 放在 `devDependencies`')
    expect(readme).toContain('任意层级出现 `.env*` 文件都会直接失败')
    expect(readme).toContain('所有本地路径字段都会被解析为相对项目根目录')
    expect(readme).toContain('`remote.baseDir` 必须是绝对路径')
    expect(readme).toContain('只能包含 `/`、字母、数字、`.`、`_`、`-`')
    expect(exampleReadme).toContain('internal: "backend-artifact-deploy"')
    expect(exampleReadme).toContain('dx deploy backend --build-only')
    expect(exampleReadme).toContain('所有本地路径字段都会先约束在项目根目录内')
    expect(exampleReadme).toContain('`remote.baseDir` 必须使用绝对路径')
    expect(designSpec).toContain('reject local config paths that escape project root')
    expect(designSpec).toContain('require `remote.baseDir` to be an absolute POSIX path')
    expect(plan).toContain("test('rejects local paths that escape projectRoot'")
    expect(plan).toContain("test('rejects remote.baseDir containing unsafe shell characters'")
    expect(plan).toContain("test('quotes remote mkdir directories to avoid shell metacharacter execution'")
  })
})
