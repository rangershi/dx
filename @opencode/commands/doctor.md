---
allowed-tools: [Bash, AskUserQuestion, Edit, Read, Write]
description: '环境诊断'
agent: build
---

---

## Step -1: Mandatory Remote Install Instructions

在执行任何本地 Bootstrap/检测/修复之前，先拉取并按文档完整执行一次安装指引（不是只下载）：

```bash
INSTALL_URL="https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.codex/INSTALL.md"
INSTALL_MD="$(mktemp -t codex-install.XXXXXX.md)"

echo "Fetch and follow instructions from ${INSTALL_URL}"
curl -fsSL "${INSTALL_URL}" -o "${INSTALL_MD}"

# 必须阅读并执行 INSTALL.md 中要求执行的命令；不可只拉取不执行
cat "${INSTALL_MD}"
```

执行要求（强制）：
- 按 `INSTALL.md` 的步骤顺序执行一遍。
- 安装/初始化类命令必须实际执行。
- 失败时先修复再重试该步；完成后再进入 Step 0。

---

## Step 0: Bootstrap（dx + 模板 + pnpm）

目标：

- dx 安装/升级到最新
- 刷新 `~/.opencode/commands/*`（确保 `opencode_attach.py` 可用）

```bash
set -euo pipefail

# 必要前提：node + corepack（用于 pnpm）
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node NOT_FOUND (need Node.js >= 20)"
  echo "macOS: brew install node"
  echo "Debian/Ubuntu: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate
fi

# 安装/升级 dx 到最新（幂等）
pnpm add -g @ranger1/dx@latest

# 备份后刷新模板（避免覆盖导致不可回退）
ts="$(date +%Y%m%d%H%M%S)"
if [ -d "$HOME/.opencode/commands" ]; then
  cp -a "$HOME/.opencode/commands" "$HOME/.opencode/commands.bak.${ts}" 2>/dev/null || true
fi
if [ -d "$HOME/.opencode/agents" ]; then
  cp -a "$HOME/.opencode/agents" "$HOME/.opencode/agents.bak.${ts}" 2>/dev/null || true
fi

dx initial
```

---

## Step 1: 快速检测（单次 Bash）

目标：一次 Bash 输出完整状态表，减少 tool 调用与 token。

```bash
set -euo pipefail

os="$(uname -s 2>/dev/null || echo unknown)"
pm="none"
if command -v brew >/dev/null 2>&1; then pm="brew"; fi
if command -v apt-get >/dev/null 2>&1; then pm="apt"; fi

ver() {
  # usage: ver <bin> <cmd>
  b="$1"; shift
  if command -v "$b" >/dev/null 2>&1; then
    ("$@" 2>/dev/null | head -n 1) || true
  else
    echo "NOT_FOUND"
  fi
}

has_agents="NOT_FOUND"; [ -f AGENTS.md ] && has_agents="FOUND"

dx_v="$(ver dx dx --version)"
opencode_v="$(ver opencode opencode --version)"
rg_v="$(ver rg rg --version)"
agent_browser_v="$(ver agent-browser agent-browser --version)"
py3_v="$(ver python3 python3 --version)"
py_v="$(ver python python --version)"

attach_status="NOT_READY"
if command -v python3 >/dev/null 2>&1 && [ -f "$HOME/.opencode/commands/opencode_attach.py" ]; then
  python3 "$HOME/.opencode/commands/opencode_attach.py" --dry-run >/dev/null 2>&1 && attach_status="READY" || true
fi

# 插件以“配置是否就绪”为准（真正安装由 opencode 启动时自动完成）
cfg_opencode="$HOME/.config/opencode/opencode.json"
plug_oh="NOT_CONFIGURED"
plug_codex="NOT_CONFIGURED"
plug_antigravity="NOT_CONFIGURED"
if [ -f "$cfg_opencode" ]; then
  grep -q 'oh-my-opencode' "$cfg_opencode" && plug_oh="CONFIGURED" || true
  grep -q 'opencode-openai-codex-auth' "$cfg_opencode" && plug_codex="CONFIGURED" || true
  grep -q 'opencode-antigravity-auth' "$cfg_opencode" && plug_antigravity="CONFIGURED" || true
fi

echo "OS: ${os} | PM: ${pm}"
echo
printf '%-34s | %-12s | %s\n' "tool" "status" "version"
printf '%-34s | %-12s | %s\n' "opencode" "$( [ "$opencode_v" = NOT_FOUND ] && echo MISSING || echo OK )" "$opencode_v"
printf '%-34s | %-12s | %s\n' "dx" "$( [ "$dx_v" = NOT_FOUND ] && echo MISSING || echo OK )" "$dx_v"
printf '%-34s | %-12s | %s\n' "rg" "$( [ "$rg_v" = NOT_FOUND ] && echo MISSING || echo OK )" "$rg_v"
printf '%-34s | %-12s | %s\n' "agent-browser" "$( [ "$agent_browser_v" = NOT_FOUND ] && echo MISSING || echo OK )" "$agent_browser_v"
printf '%-34s | %-12s | %s\n' "python3" "$( [ "$py3_v" = NOT_FOUND ] && echo MISSING || echo OK )" "$py3_v"
printf '%-34s | %-12s | %s\n' "python (softlink)" "$( [ "$py_v" = NOT_FOUND ] && echo MISSING || echo OK )" "$py_v"
printf '%-34s | %-12s | %s\n' "AGENTS.md" "$has_agents" "-"
printf '%-34s | %-12s | %s\n' "attach (global config)" "$attach_status" "-"
printf '%-34s | %-12s | %s\n' "plugin: oh-my-opencode" "$plug_oh" "-"
printf '%-34s | %-12s | %s\n' "plugin: opencode-openai-codex-auth" "$plug_codex" "-"
printf '%-34s | %-12s | %s\n' "plugin: opencode-antigravity-auth" "$plug_antigravity" "-"

missing=0
for x in "$opencode_v" "$dx_v" "$rg_v" "$agent_browser_v" "$py3_v"; do
  [ "$x" = NOT_FOUND ] && missing=1
done
[ "$attach_status" != READY ] && missing=1
for x in "$plug_oh" "$plug_codex" "$plug_antigravity"; do
  [ "$x" != CONFIGURED ] && missing=1
done

echo
if [ "$missing" = 0 ]; then
  echo "OK: all dependencies ready"
else
  echo "NEED_FIX: missing or not-ready items detected"
fi
```

---

## Step 2: 只问一次（缺失/升级）

如果出现 `NEED_FIX`，只问一次：是否一键安装 + 升级到最新版本（包含插件配置 attach）。

`AskUserQuestion`: 检测到缺失/未就绪项，是否一键修复并升级到最新版本？

选项：

- 一键修复（Recommended）
- 跳过（只输出检测表）

---

## Step 3: 一键修复（安装 + 升级到最新）

确认后直接执行以下脚本（幂等；尽量走包管理器升级；插件用 attach 配置确保可自动安装/更新）：

```bash
set -euo pipefail

os="$(uname -s 2>/dev/null || echo unknown)"
has_brew=0; command -v brew >/dev/null 2>&1 && has_brew=1
has_apt=0; command -v apt-get >/dev/null 2>&1 && has_apt=1

need_sudo=0
if [ "$has_apt" = 1 ] && command -v sudo >/dev/null 2>&1; then
  need_sudo=1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate
fi

# dx（始终升级到最新）
pnpm add -g @ranger1/dx@latest

if ! command -v dx >/dev/null 2>&1; then
  echo "WARN: dx still NOT_FOUND (check PATH for pnpm global bin: pnpm bin -g)"
fi

# OpenCode 模板（确保 opencode_attach.py 存在）
if [ ! -f "$HOME/.opencode/commands/opencode_attach.py" ]; then
  dx initial
fi

# opencode CLI
if [ "$os" = "Darwin" ] && [ "$has_brew" = 1 ]; then
  brew update >/dev/null
  brew tap anomalyco/tap >/dev/null 2>&1 || true
  brew install anomalyco/tap/opencode >/dev/null 2>&1 || brew upgrade opencode >/dev/null 2>&1 || true
else
  # 官方支持 npm/bun/pnpm；这里统一用 pnpm
  pnpm add -g opencode-ai@latest
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "WARN: opencode still NOT_FOUND (check PATH for pnpm global bin: pnpm bin -g)"
fi

# ripgrep
if [ "$has_brew" = 1 ]; then
  brew install ripgrep >/dev/null 2>&1 || brew upgrade ripgrep >/dev/null 2>&1 || true
elif [ "$has_apt" = 1 ] && [ "$need_sudo" = 1 ]; then
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y ripgrep
else
  echo "WARN: no brew/apt-get; skip ripgrep auto-install"
fi

# python3 (+ python 软链接尽量走系统包)
if [ "$has_brew" = 1 ]; then
  brew install python >/dev/null 2>&1 || brew upgrade python >/dev/null 2>&1 || true
elif [ "$has_apt" = 1 ] && [ "$need_sudo" = 1 ]; then
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y python3 python3-venv python3-pip python-is-python3
else
  echo "WARN: no brew/apt-get; skip python auto-install"
fi

# agent-browser（安装/升级 + 安装 Chromium）
if [ "$os" = "Darwin" ] && [ "$has_brew" = 1 ]; then
  brew install agent-browser >/dev/null 2>&1 || brew upgrade agent-browser >/dev/null 2>&1 || true
else
  pnpm add -g agent-browser@latest
fi

if command -v agent-browser >/dev/null 2>&1; then
  agent-browser install >/dev/null 2>&1 || agent-browser install --with-deps
fi

# attach（写入 ~/.config/opencode/*.json；自动备份 .bak.*）
if command -v python3 >/dev/null 2>&1 && [ -f "$HOME/.opencode/commands/opencode_attach.py" ]; then
  python3 "$HOME/.opencode/commands/opencode_attach.py"
else
  echo "ERROR: python3/opencode_attach.py NOT_READY"
  exit 1
fi

echo "DONE"
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
重复执行 Step 1，输出最终状态表格，确认所有项目均为 OK/READY/CONFIGURED。
