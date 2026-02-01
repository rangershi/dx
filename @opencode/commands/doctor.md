---
allowed-tools: [Bash, AskUserQuestion, Edit, Read, Write]
description: '环境诊断'
agent: build
---

---

## Step 0: 强制安装 dx CLI

**无论当前是否安装，必须执行：**

```bash
pnpm add -g @ranger1/dx@latest  && dx initial
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
echo "instructions:" && (grep -q '"AGENTS.md"' ~/.config/opencode/opencode.json 2>/dev/null && grep -q '"ruler/' ~/.config/opencode/opencode.json 2>/dev/null && echo "CONFIGURED" || echo "NOT_CONFIGURED");
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

```bash
# 批次 5: Python 检测（python3 + python 软链接）
echo "=== PYTHON ===";
echo "python3:" && (which python3 && python3 --version 2>/dev/null || echo "NOT_FOUND");
echo "python:" && (which python && python --version 2>/dev/null || echo "NOT_FOUND");
```

---

## Step 2: 输出报告

汇总结果，输出表格：

```
工具                                  | 状态     | 版本
opencode                              | <状态>   | <版本>
dx                                    | <状态>   | <版本>
python3                               | <状态>   | <版本>
python(软链接)                         | <状态>   | <版本>
AGENTS.md                             | <状态>   | -
全局 instructions 配置                 | <状态>   | -
oh-my-opencode 插件                   | <状态>   | -
opencode-openai-codex-auth 插件       | <状态>   | -
agent-browser                         | <状态>   | <版本>
全局 sisyphus_agent 配置              | <状态>   | -
全局 agents.sisyphus.variant 配置     | <状态>   | -
全局 agent.quick 配置                 | <状态>   | -
全局 agent.middle 配置                | <状态>   | -
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
- AGENTS.md 应位于项目根目录，并在全局 `~/.config/opencode/opencode.json` 的 `instructions` 中引用

### 3.3 全局 opencode.json instructions 配置缺失

**注意：instructions 配置应在全局配置文件 `~/.config/opencode/opencode.json` 中，而非项目根目录。项目根目录不需要 opencode.json 文件。**

1. 先读取现有全局配置：

```bash
cat ~/.config/opencode/opencode.json
```

2. 使用 Edit 工具在 `~/.config/opencode/opencode.json` 中添加或修改 `instructions` 配置：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["AGENTS.md", "ruler/**/*.md"]
}
```

### 3.4 全局配置指令无效

使用 Edit 工具修复 `~/.config/opencode/opencode.json`，确保包含：

- `"AGENTS.md"`: 主配置文件
- `"ruler/**/*.md"`: 自动加载 ruler 目录下所有 .md 文件（因 OpenCode 不支持 @ 引用）

### 3.5 全局 OpenCode 插件安装

**注意：OpenCode 插件配置应在全局配置文件 `~/.config/opencode/opencode.json` 中，而非项目根目录。**

1. 先读取现有全局配置：

```bash
cat ~/.config/opencode/opencode.json
```

2. 使用 Edit 工具在 `~/.config/opencode/opencode.json` 的 `plugin` 数组中添加缺失的插件：
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

### 3.6.1 python3 未安装

执行安装：

```bash
# macOS (Homebrew)
brew install python
```

### 3.6.2 python 命令缺失（需要软链接到 python3）

如果 `python` 不存在但 `python3` 存在，执行：

```bash
set -e

if command -v python >/dev/null 2>&1; then
  python --version
  exit 0
fi

PY3="$(command -v python3 2>/dev/null || true)"
if [ -z "$PY3" ]; then
  echo "python3 NOT_FOUND"
  exit 1
fi

PY_DIR="$(dirname "$PY3")"
if [ -w "$PY_DIR" ]; then
  ln -sf "$PY3" "$PY_DIR/python"
  echo "linked: $PY_DIR/python -> $PY3"
else
  ln -sf "$PY3" "$HOME/.local/bin/python"
  echo "linked: $HOME/.local/bin/python -> $PY3"
  echo "NOTE: ensure $HOME/.local/bin is in PATH"
fi

python --version
```

### 3.7 全局 oh-my-opencode.json 配置缺失

**注意：oh-my-opencode 配置应在全局配置文件 `~/.config/opencode/oh-my-opencode.json` 中，而非项目根目录。**

1. 先读取现有全局配置：

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

### 3.8 全局 opencode.json agent 配置缺失

**注意：agent 配置应在全局配置文件 `~/.config/opencode/opencode.json` 中，而非项目根目录。**

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
