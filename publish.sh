#!/usr/bin/env bash
set -euo pipefail

REGISTRY="https://registry.npmjs.org"
PKG_DIR="."
OTP=""
TOKEN=""

print_help() {
  cat <<'EOF'
用法:
  ./publish.sh [选项]

说明:
  发布当前目录（或指定目录）的 npm 包到 npm 官方仓库。
  2FA 开启时需要 OTP。

选项:
  -d, --dir <path>        包目录（默认: 当前目录）
  -o, --otp <code>        2FA 一次性验证码（6 位）
  -t, --token <token>     npm token（可选；未登录时需要）
  -r, --registry <url>    npm registry（默认: https://registry.npmjs.org）
  -h, --help              显示帮助

示例:
  # 交互式输入 OTP（本机已 npm login）
  ./publish.sh

  # 直接传 OTP
  ./publish.sh --otp 123456

  # 未登录时，用 token + OTP 发布（不要把 token 写进脚本或提交到 git）
  ./publish.sh --token "${NPM_TOKEN:-<your_token>}" --otp 123456
EOF
}

is_tty() {
  [[ -t 0 ]] && [[ -t 1 ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dir)
      PKG_DIR="${2:-}"; shift 2 ;;
    -o|--otp)
      OTP="${2:-}"; shift 2 ;;
    -t|--token)
      TOKEN="${2:-}"; shift 2 ;;
    -r|--registry)
      REGISTRY="${2:-}"; shift 2 ;;
    -h|--help)
      print_help; exit 0 ;;
    *)
      echo "未知参数: $1" >&2
      echo >&2
      print_help
      exit 2
      ;;
  esac
done

if [[ -z "$PKG_DIR" ]]; then
  echo "缺少 --dir 参数值" >&2
  echo >&2
  print_help
  exit 2
fi

cd "$PKG_DIR"

if [[ -z "$OTP" ]]; then
  if is_tty; then
    read -r -p "请输入 OTP(6位): " OTP
  else
    echo "缺少 OTP，请使用 --otp 传入。" >&2
    echo >&2
    print_help
    exit 2
  fi
fi

if [[ -z "$OTP" ]]; then
  echo "OTP 不能为空" >&2
  echo >&2
  print_help
  exit 2
fi

if npm whoami --registry="$REGISTRY" >/dev/null 2>&1; then
  npm publish --access public --registry="$REGISTRY" --otp="$OTP"
  exit 0
fi

if [[ -z "$TOKEN" ]]; then
  echo "当前未 npm login，且未提供 --token。" >&2
  echo "请先执行: npm login --registry=$REGISTRY" >&2
  echo "或传入: --token <npm_token>" >&2
  echo >&2
  print_help
  exit 2
fi

umask 077
TMP_NPMRC="$(mktemp -t npmrc.XXXXXX)"
cleanup() { rm -f "$TMP_NPMRC"; }
trap cleanup EXIT

cat >"$TMP_NPMRC" <<EOF
registry=$REGISTRY
//registry.npmjs.org/:_authToken=$TOKEN
EOF

NPM_CONFIG_USERCONFIG="$TMP_NPMRC" npm publish --access public --registry="$REGISTRY" --otp="$OTP"
