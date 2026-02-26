---
name: doctor
description: Use when 需要在本机一次性体检并修复 Codex 开发环境，包括 python3/python 别名、dx 初始化、agent-browser+Chromium、ripgrep 与 multi_agent 特性状态。
---

# Doctor

## 概览

执行本技能时，优先运行 `scripts/doctor.sh`，由脚本完成并行检测、自动修复、最多三轮重试与最终报告。

## 适用场景

- 新机器初始化 Codex 开发环境。
- 发现命令缺失或版本漂移，希望一次性修复。
- 需要确认 `codex features list` 中 `multi_agent` 为 `experimental true`。

## 执行步骤

1. 直接运行：

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
bash "$CODEX_HOME/skills/doctor/scripts/doctor.sh"
```

2. 若需限制轮次（默认 3）：

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
bash "$CODEX_HOME/skills/doctor/scripts/doctor.sh" --max-rounds 3
```

## 脚本职责

- 并行检测：`python3`、`python` 别名、`pnpm`、`dx`、`agent-browser`、`rg`、`multi_agent`。
- 自动修复：按平台选择安装器修复缺失项。
- 强制执行：每轮都运行 `pnpm add -g @ranger1/dx@latest && dx initial`。
- agent-browser：安装/升级并执行 Chromium 安装。
- 结果输出：展示每项状态、版本、关键信息；全部通过则退出 0，否则最多三轮后退出 1。

## 注意

- 某些安装步骤可能需要管理员权限（例如 `sudo` 或 Homebrew 写权限）。
- 若系统缺少包管理器，脚本会给出明确失败原因。
