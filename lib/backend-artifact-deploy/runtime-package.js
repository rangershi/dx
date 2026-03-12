const UNSUPPORTED_LOCAL_DEP_PATTERN = /^(workspace:|file:|link:)/
const REQUIRED_DEPENDENCIES_FROM_DEV = ['prisma']

function assertSupportedDependencies(dependencies = {}) {
  for (const [name, version] of Object.entries(dependencies)) {
    if (typeof version !== 'string') continue
    if (UNSUPPORTED_LOCAL_DEP_PATTERN.test(version)) {
      throw new Error(`检测到不支持的本地依赖引用: ${name} -> ${version}`)
    }
  }
}

export function createRuntimePackage({ appPackage, rootPackage }) {
  const runtimeDependencies = { ...(appPackage?.dependencies || {}) }
  const appDevDependencies = appPackage?.devDependencies || {}

  for (const dependencyName of REQUIRED_DEPENDENCIES_FROM_DEV) {
    if (!runtimeDependencies[dependencyName] && appDevDependencies[dependencyName]) {
      runtimeDependencies[dependencyName] = appDevDependencies[dependencyName]
    }
  }

  assertSupportedDependencies(runtimeDependencies)

  const runtimePackage = {
    name: appPackage?.name,
    version: appPackage?.version,
    dependencies: runtimeDependencies,
  }

  if (appPackage?.private !== undefined) runtimePackage.private = appPackage.private
  if (appPackage?.type) runtimePackage.type = appPackage.type
  if (rootPackage?.packageManager) runtimePackage.packageManager = rootPackage.packageManager

  const nodeEngine = rootPackage?.engines?.node || appPackage?.engines?.node
  if (nodeEngine) {
    runtimePackage.engines = { node: nodeEngine }
  }

  return runtimePackage
}
