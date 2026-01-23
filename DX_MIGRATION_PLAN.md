# DX 工具独立化改造方案

## 目标
将 dx 从 ai-monorepo 的内部工具改造成独立的、可安装到任何项目的通用构建管理工具。

## 核心设计原则

1. **配置外部化**: 所有项目特定配置通过配置文件注入
2. **零侵入**: 不修改目标项目的现有结构
3. **灵活适配**: 支持不同的项目结构（monorepo/单体）
4. **向后兼容**: 保持 ai-monorepo 项目可以继续使用

## 改造方案

### 1. 包结构设计

```
dx/
├── package.json              # 独立 npm 包配置
├── bin/
│   └── dx                    # CLI 入口（全局命令）
├── lib/                      # 核心逻辑
│   ├── cli/
│   │   ├── dx-cli.js        # 主 CLI 类
│   │   ├── commands/        # 命令处理器
│   │   ├── flags.js
│   │   ├── args.js
│   │   └── help.js
│   ├── config-loader.js     # 配置加载器（新增）
│   ├── env.js               # 环境管理
│   ├── exec.js              # 命令执行
│   ├── logger.js            # 日志
│   ├── validate-env.js      # 环境验证
│   └── ...
├── templates/               # 配置模板
│   ├── dx.config.js         # 主配置文件模板
│   ├── commands.json        # 命令配置模板
│   └── env-layers.json      # 环境层级模板
└── README.md
```

### 2. 配置加载机制

#### 2.1 配置文件查找顺序

```javascript
// lib/config-loader.js
const CONFIG_SEARCH_PATHS = [
  'dx.config.js',           // 项目根目录
  'dx.config.json',
  '.dxrc.js',
  '.dxrc.json',
  'scripts/config/dx.config.js',  // 兼容旧结构
]
```

#### 2.2 配置文件格式

```javascript
// dx.config.js (项目根目录)
export default {
  // 项目根目录（默认为配置文件所在目录）
  rootDir: process.cwd(),

  // 命令配置文件路径（相对于 rootDir）
  commandsConfig: './scripts/config/commands.json',

  // 环境层级配置
  envLayersConfig: './scripts/config/env-layers.json',

  // 环境验证配置
  validation: {
    requiredEnvConfig: './scripts/config/required-env.jsonc',
    exemptedKeysConfig: './scripts/config/exempted-keys.jsonc',
    localEnvAllowlist: './scripts/config/local-env-allowlist.jsonc',
  },

  // 项目结构标识（用于验证是否在正确目录执行）
  projectMarkers: [
    'pnpm-workspace.yaml',
    'package.json',
    'apps',
  ],

  // 包管理器
  packageManager: 'pnpm',  // 'pnpm' | 'npm' | 'yarn'

  // 构建工具
  buildTool: 'nx',  // 'nx' | 'turbo' | 'custom'

  // 自定义钩子
  hooks: {
    beforeCommand: async (command, args) => {
      // 命令执行前的钩子
    },
    afterCommand: async (command, args, result) => {
      // 命令执行后的钩子
    },
  },
}
```

### 3. 核心改造点

#### 3.1 配置加载器（新增）

```javascript
// lib/config-loader.js
import { existsSync, readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { pathToFileURL } from 'url'

export class ConfigLoader {
  constructor() {
    this.config = null
    this.configPath = null
  }

  async loadConfig(startDir = process.cwd()) {
    // 1. 查找配置文件
    const configPath = this.findConfigFile(startDir)

    if (!configPath) {
      throw new Error('未找到 dx 配置文件，请运行 `dx init` 初始化配置')
    }

    // 2. 加载配置
    this.configPath = configPath
    this.config = await this.parseConfig(configPath)

    // 3. 解析相对路径
    this.resolveConfigPaths()

    return this.config
  }

  findConfigFile(startDir) {
    const searchPaths = [
      'dx.config.js',
      'dx.config.json',
      '.dxrc.js',
      '.dxrc.json',
      'scripts/config/dx.config.js',
    ]

    for (const searchPath of searchPaths) {
      const fullPath = join(startDir, searchPath)
      if (existsSync(fullPath)) {
        return fullPath
      }
    }

    return null
  }

  async parseConfig(configPath) {
    if (configPath.endsWith('.json')) {
      return JSON.parse(readFileSync(configPath, 'utf8'))
    } else {
      // 动态导入 .js 配置
      const configUrl = pathToFileURL(configPath).href
      const module = await import(configUrl)
      return module.default || module
    }
  }

  resolveConfigPaths() {
    const baseDir = dirname(this.configPath)

    // 解析所有相对路径配置
    if (this.config.commandsConfig) {
      this.config.commandsConfig = resolve(baseDir, this.config.commandsConfig)
    }
    if (this.config.envLayersConfig) {
      this.config.envLayersConfig = resolve(baseDir, this.config.envLayersConfig)
    }
    // ... 解析其他路径配置
  }

  getConfig() {
    return this.config
  }
}
```

#### 3.2 修改 DxCli 类

```javascript
// lib/cli/dx-cli.js
import { ConfigLoader } from '../config-loader.js'

class DxCli {
  constructor() {
    this.configLoader = new ConfigLoader()
    this.config = null
    // ... 其他初始化
  }

  async init() {
    // 加载项目配置
    this.config = await this.configLoader.loadConfig()

    // 使用配置加载命令定义
    this.commands = this.loadCommands()

    // ... 其他初始化
  }

  loadCommands() {
    try {
      const configPath = this.config.commandsConfig
      return JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (error) {
      logger.error('无法加载命令配置文件')
      logger.error(error.message)
      process.exit(1)
    }
  }

  // 修改路径检查逻辑
  ensureRepoRoot() {
    const cwd = process.cwd()
    const markers = this.config.projectMarkers || [
      'package.json',
    ]

    const missing = markers.filter(p => !existsSync(join(cwd, p)))
    if (missing.length) {
      logger.error(`请从项目根目录运行此命令。缺少标识文件/目录: ${missing.join(', ')}`)
      process.exit(1)
    }
  }
}
```

### 4. 安装和使用流程

#### 4.1 安装到新项目

```bash
# 方式 1: 作为 npm 包安装
cd /path/to/your-project
npm install @your-org/dx --save-dev

# 方式 2: 本地开发安装
npm install /path/to/dx --save-dev
```

#### 4.2 初始化配置

```bash
# 生成配置文件
npx dx init

# 或者手动复制配置
mkdir -p scripts/config
cp /path/to/ai-monorepo/scripts/config/* scripts/config/
```

#### 4.3 配置文件生成

```javascript
// lib/cli/commands/init.js
export async function handleInit(cli, args) {
  const targetDir = process.cwd()

  // 1. 检测项目类型
  const projectType = detectProjectType(targetDir)

  // 2. 生成配置文件
  await generateConfig(targetDir, projectType)

  // 3. 复制配置模板
  await copyConfigTemplates(targetDir)

  logger.success('dx 配置初始化完成！')
  logger.info('请编辑以下文件以适配你的项目：')
  logger.info('  - dx.config.js')
  logger.info('  - scripts/config/commands.json')
  logger.info('  - scripts/config/env-layers.json')
}

function detectProjectType(dir) {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    return 'pnpm-monorepo'
  }
  if (existsSync(join(dir, 'lerna.json'))) {
    return 'lerna-monorepo'
  }
  if (existsSync(join(dir, 'nx.json'))) {
    return 'nx-monorepo'
  }
  return 'single'
}
```

### 5. package.json 配置

```json
{
  "name": "@your-org/dx",
  "version": "1.0.0",
  "type": "module",
  "description": "通用项目构建管理工具",
  "bin": {
    "dx": "./bin/dx"
  },
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./config": "./lib/config-loader.js"
  },
  "files": [
    "bin",
    "lib",
    "templates"
  ],
  "engines": {
    "node": ">=20.0.0"
  },
  "keywords": [
    "build-tool",
    "monorepo",
    "cli",
    "development"
  ],
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^11.1.0"
  },
  "peerDependencies": {
    "@prisma/client": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "@prisma/client": {
      "optional": true
    }
  }
}
```

### 6. 在 ai-monorepo 中使用

#### 6.1 创建配置文件

```javascript
// ai-monorepo/dx.config.js
export default {
  rootDir: process.cwd(),
  commandsConfig: './scripts/config/commands.json',
  envLayersConfig: './scripts/config/env-layers.json',
  validation: {
    requiredEnvConfig: './scripts/config/required-env.jsonc',
    exemptedKeysConfig: './scripts/config/exempted-keys.jsonc',
    localEnvAllowlist: './scripts/config/local-env-allowlist.jsonc',
  },
  projectMarkers: [
    'pnpm-workspace.yaml',
    'package.json',
    'apps',
    'scripts/dx',
  ],
  packageManager: 'pnpm',
  buildTool: 'nx',
}
```

#### 6.2 修改 package.json

```json
{
  "devDependencies": {
    "@your-org/dx": "file:../dx"
  },
  "scripts": {
    "dx": "dx"
  }
}
```

#### 6.3 保持向后兼容

```bash
# 方式 1: 使用 npx
npx dx start backend --dev

# 方式 2: 保留原有的 scripts/dx 作为包装器
# scripts/dx
#!/usr/bin/env node
import('../node_modules/@your-org/dx/bin/dx')
```

### 7. 迁移步骤

#### 步骤 1: 创建独立项目

```bash
mkdir -p /Users/a1/work/dx
cd /Users/a1/work/dx
npm init -y
```

#### 步骤 2: 复制核心代码

```bash
# 复制代码
cp -r /Users/a1/work/ai-monorepo/scripts/lib ./
cp -r /Users/a1/work/ai-monorepo/scripts/config ./templates

# 创建 bin 目录
mkdir bin
cp /Users/a1/work/ai-monorepo/scripts/dx ./bin/
```

#### 步骤 3: 创建配置加载器

创建 `lib/config-loader.js`（见上文）

#### 步骤 4: 修改核心类

修改 `lib/cli/dx-cli.js` 以支持配置加载

#### 步骤 5: 添加 init 命令

创建 `lib/cli/commands/init.js`

#### 步骤 6: 更新 package.json

配置 bin、exports 等字段

#### 步骤 7: 在 ai-monorepo 中测试

```bash
cd /Users/a1/work/ai-monorepo
npm install ../dx --save-dev
npx dx --help
```

### 8. 优势

1. **完全独立**: dx 成为独立的 npm 包，可以发布到 npm registry
2. **配置灵活**: 每个项目通过配置文件定制行为
3. **零侵入**: 不修改目标项目结构
4. **易于维护**: 核心逻辑和项目配置分离
5. **可复用**: 可以在多个项目中使用
6. **向后兼容**: ai-monorepo 只需添加配置文件即可继续使用

### 9. 后续优化

1. **插件系统**: 支持自定义命令插件
2. **配置验证**: 使用 JSON Schema 验证配置
3. **交互式初始化**: `dx init` 提供交互式配置向导
4. **配置继承**: 支持配置文件继承和合并
5. **多环境支持**: 更灵活的环境配置系统

## 下一步行动

1. 创建 `/Users/a1/work/dx` 项目结构
2. 实现 `ConfigLoader` 类
3. 修改 `DxCli` 类以支持配置加载
4. 实现 `dx init` 命令
5. 在 ai-monorepo 中测试集成
6. 编写文档和示例

---

需要我帮你开始实施这个方案吗？
