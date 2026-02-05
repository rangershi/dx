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

**同时执行以下 4 个 Bash 调用（真正并行）：**

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
```

```bash
# 批次 3: OpenCode 插件检测
# 注意:插件名可能带版本号(如 @1.3.0),使用模糊匹配
echo "=== OPENCODE_PLUGINS ===";
echo "oh-my-opencode:" && (opencode plugin list 2>/dev/null | grep -q 'oh-my-opencode' && echo "INSTALLED" || echo "NOT_INSTALLED");
echo "opencode-openai-codex-auth:" && (opencode plugin list 2>/dev/null | grep -q 'opencode-openai-codex-auth' && echo "INSTALLED" || echo "NOT_INSTALLED");
```

```bash
# 批次 4: attach 配置（统一）
echo "=== OPENCODE_ATTACH ===";
echo "attach:" && (python3 ~/.opencode/commands/opencode_attach.py --dry-run >/dev/null 2>&1 && echo "READY" || echo "NOT_READY");
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
oh-my-opencode 插件                   | <状态>   | -
opencode-openai-codex-auth 插件       | <状态>   | -
agent-browser                         | <状态>   | <版本>
attach（全局配置写入）                 | <状态>   | -
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

### 3.9 自动 attach（推荐）

执行 attach（会自动覆盖/新建对应节点，其它不动，并生成备份文件）：

```bash
python3 ~/.opencode/commands/opencode_attach.py
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
