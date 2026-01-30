---
allowed-tools: [Bash, AskUserQuestion, Edit, Read, Write]
description: '环境诊断'
agent: sisyphus
---

---

## Step 0: 强制安装 dx CLI

**无论当前是否安装，必须执行：**

```bash
pnpm i -g @ranger1/dx
```

---

## Step 1: 并行检测

**同时执行以下 3 个 Bash 调用（真正并行）：**

```bash
# 批次 1: CLI 版本检测
echo "=== CLI_VERSIONS ===";
echo "opencode:" && (which opencode && opencode --version 2>/dev/null || echo "NOT_FOUND");
echo "dx:" && (which dx && dx --version 2>/dev/null || echo "NOT_FOUND");
echo "agent-browser:" && (which agent-browser && agent-browser --version 2>/dev/null || echo "NOT_FOUND");
```

```bash
# 批次 2: 项目文件检测
echo "=== PROJECT_FILES ===";
echo "AGENTS.md:" && (test -f AGENTS.md && echo "FOUND" || echo "NOT_FOUND");
echo "opencode.json:" && (test -f opencode.json && echo "CONFIGURED" || echo "NOT_FOUND");
echo "instructions:" && (if [ -f opencode.json ]; then grep -q '"AGENTS.md"' opencode.json && grep -q '"ruler/' opencode.json && echo "VALID" || echo "INVALID"; else echo "SKIP"; fi);
```

```bash
# 批次 3: OpenCode 插件检测
# 注意:插件名可能带版本号(如 @1.3.0),使用模糊匹配
echo "=== OPENCODE_PLUGINS ===";
echo "oh-my-opencode:" && (grep -q 'oh-my-opencode' ~/.config/opencode/opencode.json 2>/dev/null && echo "INSTALLED" || echo "NOT_INSTALLED");
echo "opencode-openai-codex-auth:" && (grep -q 'opencode-openai-codex-auth' ~/.config/opencode/opencode.json 2>/dev/null && echo "INSTALLED" || echo "NOT_INSTALLED");
```

```bash
# 批次 4: oh-my-opencode.json 配置检测
echo "=== OMO_CONFIG ===";
echo "sisyphus_agent:" && (grep -q '"sisyphus_agent"' ~/.config/opencode/oh-my-opencode.json 2>/dev/null && echo "CONFIGURED" || echo "NOT_CONFIGURED");
echo "agents.sisyphus.variant:" && (node -e "const fs=require('node:fs');const os=require('node:os');const p=os.homedir()+'/.config/opencode/oh-my-opencode.json';try{const j=JSON.parse(fs.readFileSync(p,'utf8'));process.exit(j?.agents?.sisyphus?.variant==='none'?0:1)}catch(e){process.exit(1)}" 2>/dev/null && echo "CONFIGURED" || echo "NOT_CONFIGURED");
echo "agent.quick:" && (grep -Eq '"agent"[[:space:]]*:' ~/.config/opencode/opencode.json 2>/dev/null && grep -Eq '"quick"[[:space:]]*:' ~/.config/opencode/opencode.json 2>/dev/null && echo "CONFIGURED" || echo "NOT_CONFIGURED");
echo "agent.middle:" && (grep -Eq '"agent"[[:space:]]*:' ~/.config/opencode/opencode.json 2>/dev/null && grep -Eq '"middle"[[:space:]]*:' ~/.config/opencode/opencode.json 2>/dev/null && echo "CONFIGURED" || echo "NOT_CONFIGURED");
```

---

## Step 2: 输出报告

汇总结果，输出表格：

```
工具                           | 状态     | 版本
opencode                       | <状态>   | <版本>
dx                             | <状态>   | <版本>
AGENTS.md                      | <状态>   | -
opencode.json                  | <状态>   | -
配置指令                       | <状态>   | -
oh-my-opencode                 | <状态>   | -
opencode-openai-codex-auth     | <状态>   | -
agent-browser                  | <状态>   | <版本>
sisyphus_agent 配置            | <状态>   | -
agents.sisyphus.variant 配置    | <状态>   | -
agent.quick 配置              | <状态>   | -
agent.middle 配置             | <状态>   | -
```

---

## Step 3: 统一处理缺失项

**如检测到任何缺失项，统一询问一次：**

`AskUserQuestion`: 检测到以下缺失项，是否自动安装/配置所有？

确认后按顺序处理：

### 3.1 opencode CLI 未安装

执行安装：

```bash
# brew 优先
brew install opencode || npm install -g opencode
```

### 3.2 AGENTS.md 未找到

提示用户：

- AGENTS.md 文件不存在，OpenCode 需要此文件作为项目指令入口
- 建议创建或检查文件路径

### 3.3 opencode.json 未配置

使用 Write 工具创建配置文件：

文件路径：`<项目根目录>/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["AGENTS.md", "ruler/**/*.md"]
}
```

### 3.4 配置指令无效

使用 Edit 工具修复 opencode.json，确保包含：

- `"AGENTS.md"`: 主配置文件
- `"ruler/**/*.md"`: 自动加载 ruler 目录下所有 .md 文件（因 OpenCode 不支持 @ 引用）

### 3.5 OpenCode 插件安装

**OpenCode 插件通过编辑 `~/.config/opencode/opencode.json` 的 `plugin` 数组安装。**

1. 先读取现有配置：

```bash
cat ~/.config/opencode/opencode.json
```

2. 使用 Edit 工具在 `plugin` 数组中添加缺失的插件：
   - `oh-my-opencode`
   - `opencode-openai-codex-auth`

示例 plugin 配置：

```json
"plugin": [
  "oh-my-opencode",
  "opencode-openai-codex-auth"
]
```

3. 验证安装：

```bash
grep -E 'oh-my-opencode|opencode-openai-codex-auth' ~/.config/opencode/opencode.json
```

### 3.6 agent-browser 未安装

执行安装：

```bash
npm install -g agent-browser && agent-browser install
```

### 3.7 oh-my-opencode.json 配置缺失

**检查并修复 `~/.config/opencode/oh-my-opencode.json` 配置。**

1. 先读取现有配置：

```bash
cat ~/.config/opencode/oh-my-opencode.json
```

2. 使用 Edit 工具添加缺失的配置节点：

#### 3.7.1 sisyphus_agent 配置缺失

如果根节点缺少 `sisyphus_agent`，使用 Edit 工具添加：

```json
{
  "sisyphus_agent": {
    "disabled": false,
    "default_builder_enabled": true,
    "planner_enabled": true,
    "replace_plan": false
  }
}
```

注意：这是根节点配置，应添加到 JSON 的第一层级。

#### 3.7.2 agents.sisyphus.variant 不是 none

如果 `~/.config/opencode/oh-my-opencode.json` 的 `agents.sisyphus.variant` 缺失或不是 `none`，使用 Edit 工具修复为：

```json
{
  "agents": {
    "sisyphus": {
      "variant": "none"
    }
  }
}
```

3. 验证配置：

```bash
# 检查 sisyphus_agent
grep -q '"sisyphus_agent"' ~/.config/opencode/oh-my-opencode.json && echo "✅ sisyphus_agent 已配置" || echo "❌ sisyphus_agent 缺失"

# 检查 agents.sisyphus.variant
node -e "const fs=require('node:fs');const os=require('node:os');const p=os.homedir()+'/.config/opencode/oh-my-opencode.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j?.agents?.sisyphus?.variant||'MISSING');process.exit(j?.agents?.sisyphus?.variant==='none'?0:1)" && echo "✅ agents.sisyphus.variant=none" || echo "❌ agents.sisyphus.variant 不是 none"
```

### 3.8 opencode.json agent 配置缺失

如果 `~/.config/opencode/opencode.json` 缺少 `agent.quick` 或 `agent.middle`，使用 Edit 工具添加：

```json
{
  "agent": {
    "quick": {
      "model": "github-copilot/claude-haiku-4.5"
    },
    "middle": {
      "model": "github-copilot/claude-sonnet-4.5"
    }
  }
}
```

验证配置：

```bash
# 检查 agent.quick
grep -Eq '"agent"[[:space:]]*:' ~/.config/opencode/opencode.json && grep -Eq '"quick"[[:space:]]*:' ~/.config/opencode/opencode.json && echo "✅ agent.quick 已配置" || echo "❌ agent.quick 缺失"

# 检查 agent.middle
grep -Eq '"agent"[[:space:]]*:' ~/.config/opencode/opencode.json && grep -Eq '"middle"[[:space:]]*:' ~/.config/opencode/opencode.json && echo "✅ agent.middle 已配置" || echo "❌ agent.middle 缺失"
```

---

## 输出格式

**全部就绪：**

```
✅ 所有依赖已就绪
```

**有缺失：**

```
⚠️ <工具> 未安装/未配置
```

**修复完成后：**
输出最终状态表格，确认所有项目均为 ✅
