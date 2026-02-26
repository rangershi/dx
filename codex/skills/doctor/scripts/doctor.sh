#!/usr/bin/env bash
set -euo pipefail

MAX_ROUNDS=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-rounds)
      MAX_ROUNDS="${2:-3}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if ! [[ "$MAX_ROUNDS" =~ ^[0-9]+$ ]] || [[ "$MAX_ROUNDS" -lt 1 ]]; then
  echo "[doctor] --max-rounds 必须是正整数" >&2
  exit 2
fi

CACHE_ROOT="${PWD}/.cache/doctor"
mkdir -p "$CACHE_ROOT"

LAST_CHECK_DIR=""
DX_FORCE_OK=0
DX_FORCE_MSG=""

run_silent() {
  "$@" >/dev/null 2>&1
}

detect_pkg_manager() {
  if command -v brew >/dev/null 2>&1; then echo "brew"; return; fi
  if command -v apt-get >/dev/null 2>&1; then echo "apt"; return; fi
  if command -v dnf >/dev/null 2>&1; then echo "dnf"; return; fi
  if command -v yum >/dev/null 2>&1; then echo "yum"; return; fi
  if command -v pacman >/dev/null 2>&1; then echo "pacman"; return; fi
  echo "none"
}

install_python3() {
  local pm
  pm="$(detect_pkg_manager)"
  case "$pm" in
    brew)
      brew install python
      ;;
    apt)
      sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip
      ;;
    dnf)
      sudo dnf install -y python3 python3-pip
      ;;
    yum)
      sudo yum install -y python3 python3-pip
      ;;
    pacman)
      sudo pacman -Sy --noconfirm python
      ;;
    *)
      echo "未检测到可用包管理器，无法安装 python3" >&2
      return 1
      ;;
  esac
}

ensure_python_alias() {
  local py3 py3_dir target_dir target
  py3="$(command -v python3 || true)"
  if [[ -z "$py3" ]]; then
    echo "python3 不存在，无法创建 python 别名" >&2
    return 1
  fi

  if command -v python >/dev/null 2>&1; then
    return 0
  fi

  py3_dir="$(dirname "$py3")"
  if [[ -w "$py3_dir" ]]; then
    target_dir="$py3_dir"
  elif [[ -w "/usr/local/bin" ]]; then
    target_dir="/usr/local/bin"
  elif [[ -w "/opt/homebrew/bin" ]]; then
    target_dir="/opt/homebrew/bin"
  else
    target_dir="$HOME/.local/bin"
    mkdir -p "$target_dir"
  fi

  target="$target_dir/python"
  ln -sf "$py3" "$target"

  if [[ "$target_dir" == "$HOME/.local/bin" ]]; then
    export PATH="$HOME/.local/bin:$PATH"
  fi

  command -v python >/dev/null 2>&1
}

install_rg() {
  local pm
  pm="$(detect_pkg_manager)"
  case "$pm" in
    brew)
      brew install ripgrep
      ;;
    apt)
      sudo apt-get update && sudo apt-get install -y ripgrep
      ;;
    dnf)
      sudo dnf install -y ripgrep
      ;;
    yum)
      sudo yum install -y ripgrep
      ;;
    pacman)
      sudo pacman -Sy --noconfirm ripgrep
      ;;
    *)
      echo "未检测到可用包管理器，无法安装 rg" >&2
      return 1
      ;;
  esac
}

install_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    npm install -g pnpm@latest
  elif command -v brew >/dev/null 2>&1; then
    brew install pnpm
  else
    echo "缺少 npm/brew，无法安装 pnpm" >&2
    return 1
  fi
}

ensure_agent_browser() {
  if command -v npm >/dev/null 2>&1; then
    npm install -g agent-browser@latest
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm add -g agent-browser@latest
  elif command -v brew >/dev/null 2>&1; then
    brew install agent-browser
  else
    echo "缺少 npm/pnpm/brew，无法安装 agent-browser" >&2
    return 1
  fi

  if ! command -v agent-browser >/dev/null 2>&1; then
    echo "agent-browser 安装后仍不可用" >&2
    return 1
  fi

  if ! run_silent agent-browser install; then
    run_silent agent-browser install --with-deps || {
      echo "agent-browser Chromium 安装失败" >&2
      return 1
    }
  fi
}

ensure_multi_agent() {
  if ! command -v codex >/dev/null 2>&1; then
    echo "codex 命令不存在" >&2
    return 1
  fi
  codex features enable multi_agent >/dev/null 2>&1 || true
  local line
  line="$(codex features list 2>/dev/null | awk '$1=="multi_agent" {print $0}')"
  [[ -n "$line" ]] || return 1
  echo "$line" | grep -E "experimental[[:space:]]+true" >/dev/null 2>&1
}

force_dx() {
  if ! install_pnpm; then
    DX_FORCE_OK=0
    DX_FORCE_MSG="pnpm 不可用，无法执行 dx 强制初始化"
    return 1
  fi

  if pnpm add -g @ranger1/dx@latest >/dev/null 2>&1 && dx initial >/dev/null 2>&1; then
    DX_FORCE_OK=1
    DX_FORCE_MSG="已执行 pnpm add -g @ranger1/dx@latest && dx initial"
    return 0
  fi

  DX_FORCE_OK=0
  DX_FORCE_MSG="强制命令执行失败：pnpm add -g @ranger1/dx@latest && dx initial"
  return 1
}

write_check_file() {
  local key="$1" ok="$2" ver="$3" msg="$4" file="$5"
  printf '%s|%s|%s|%s\n' "$key" "$ok" "$ver" "$msg" >"$file"
}

read_field() {
  local key="$1" field="$2"
  local f="$LAST_CHECK_DIR/${key}.res"
  if [[ ! -f "$f" ]]; then
    echo ""
    return 0
  fi
  awk -F'|' -v idx="$field" '{print $idx}' "$f"
}

check_ok() {
  local key="$1"
  [[ "$(read_field "$key" 2)" == "1" ]]
}

run_parallel_checks() {
  local round="$1"
  local dir="$CACHE_ROOT/round-${round}"
  mkdir -p "$dir"

  (
    if command -v python3 >/dev/null 2>&1; then
      write_check_file "python3" "1" "$(python3 --version 2>&1 | head -n1)" "ok" "$dir/python3.res"
    else
      write_check_file "python3" "0" "" "python3 未安装" "$dir/python3.res"
    fi
  ) &

  (
    if command -v python >/dev/null 2>&1; then
      write_check_file "python_alias" "1" "$(python --version 2>&1 | head -n1)" "ok" "$dir/python_alias.res"
    else
      write_check_file "python_alias" "0" "" "python 别名不可用" "$dir/python_alias.res"
    fi
  ) &

  (
    if command -v pnpm >/dev/null 2>&1; then
      write_check_file "pnpm" "1" "pnpm $(pnpm --version 2>/dev/null | head -n1)" "ok" "$dir/pnpm.res"
    else
      write_check_file "pnpm" "0" "" "pnpm 未安装" "$dir/pnpm.res"
    fi
  ) &

  (
    if command -v dx >/dev/null 2>&1; then
      local v
      v="$(dx --version 2>/dev/null | head -n1 || true)"
      if [[ -z "$v" ]]; then
        v="$(dx -v 2>/dev/null | head -n1 || true)"
      fi
      write_check_file "dx" "1" "${v:-dx (版本未知)}" "ok" "$dir/dx.res"
    else
      write_check_file "dx" "0" "" "dx 未安装" "$dir/dx.res"
    fi
  ) &

  (
    if command -v agent-browser >/dev/null 2>&1; then
      write_check_file "agent_browser" "1" "$(agent-browser --version 2>/dev/null | head -n1)" "ok" "$dir/agent_browser.res"
    else
      write_check_file "agent_browser" "0" "" "agent-browser 未安装" "$dir/agent_browser.res"
    fi
  ) &

  (
    if command -v rg >/dev/null 2>&1; then
      write_check_file "rg" "1" "$(rg --version 2>/dev/null | head -n1)" "ok" "$dir/rg.res"
    else
      write_check_file "rg" "0" "" "rg 未安装" "$dir/rg.res"
    fi
  ) &

  (
    if command -v codex >/dev/null 2>&1; then
      local line
      line="$(codex features list 2>/dev/null | awk '$1=="multi_agent" {print $0}')"
      if [[ -n "$line" ]] && echo "$line" | grep -E "experimental[[:space:]]+true" >/dev/null 2>&1; then
        write_check_file "multi_agent" "1" "$line" "ok" "$dir/multi_agent.res"
      else
        write_check_file "multi_agent" "0" "${line:-missing}" "multi_agent 不是 experimental true" "$dir/multi_agent.res"
      fi
    else
      write_check_file "multi_agent" "0" "" "codex 命令不存在" "$dir/multi_agent.res"
    fi
  ) &

  wait
  LAST_CHECK_DIR="$dir"
}

all_good() {
  local keys="python3 python_alias pnpm dx agent_browser rg multi_agent"
  local k
  for k in $keys; do
    if ! check_ok "$k"; then
      return 1
    fi
  done
  [[ "$DX_FORCE_OK" == "1" ]]
}

print_report() {
  local round="$1"
  echo
  echo "===== Doctor 报告（第 ${round} 轮）====="
  printf '%-14s | %-4s | %-40s | %s\n' "检查项" "状态" "版本" "说明"
  printf '%-14s-+-%-4s-+-%-40s-+-%s\n' "--------------" "----" "----------------------------------------" "------------------------------"

  local keys="python3 python_alias pnpm dx agent_browser rg multi_agent"
  local k ok txt ver msg
  for k in $keys; do
    ok="$(read_field "$k" 2)"
    txt="FAIL"
    [[ "$ok" == "1" ]] && txt="PASS"
    ver="$(read_field "$k" 3)"
    msg="$(read_field "$k" 4)"
    printf '%-14s | %-4s | %-40s | %s\n' "$k" "$txt" "$ver" "$msg"
  done

  if [[ "$DX_FORCE_OK" == "1" ]]; then
    printf '%-14s | %-4s | %-40s | %s\n' "dx_force" "PASS" "@ranger1/dx@latest" "$DX_FORCE_MSG"
  else
    printf '%-14s | %-4s | %-40s | %s\n' "dx_force" "FAIL" "@ranger1/dx@latest" "$DX_FORCE_MSG"
  fi

  if command -v node >/dev/null 2>&1; then
    echo "node: $(node -v 2>/dev/null | head -n1)"
  fi
  if command -v npm >/dev/null 2>&1; then
    echo "npm: $(npm -v 2>/dev/null | head -n1)"
  fi
}

for round in $(seq 1 "$MAX_ROUNDS"); do
  echo "[doctor] 第 ${round}/${MAX_ROUNDS} 轮：并行检测"
  run_parallel_checks "$round"

  echo "[doctor] 第 ${round}/${MAX_ROUNDS} 轮：修复阶段"

  if ! check_ok "python3"; then
    echo "[doctor] 安装 python3"
    install_python3 || true
  fi

  if ! check_ok "python_alias"; then
    echo "[doctor] 建立 python -> python3 调用能力"
    ensure_python_alias || true
  fi

  if ! check_ok "rg"; then
    echo "[doctor] 安装 rg"
    install_rg || true
  fi

  if ! check_ok "agent_browser"; then
    echo "[doctor] 安装/升级 agent-browser 并安装 Chromium"
    ensure_agent_browser || true
  else
    echo "[doctor] agent-browser 已存在，执行升级与 Chromium 安装"
    ensure_agent_browser || true
  fi

  if ! check_ok "multi_agent"; then
    echo "[doctor] 修正 multi_agent 特性开关"
    ensure_multi_agent || true
  fi

  echo "[doctor] 强制执行 dx 安装与初始化"
  force_dx || true

  echo "[doctor] 第 ${round}/${MAX_ROUNDS} 轮：复检"
  run_parallel_checks "${round}-post"
  print_report "$round"

  if all_good; then
    echo "[doctor] 全部检查通过"
    exit 0
  fi

done

echo "[doctor] 达到最大轮次 ${MAX_ROUNDS}，仍有未通过项"
exit 1
