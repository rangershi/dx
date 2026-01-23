#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REGISTRY="https://registry.npmjs.org"
REGISTRY="${REGISTRY:-$DEFAULT_REGISTRY}"
TOKEN=""
OTP="" # 可选：当账号强制要求 OTP 时使用

print_help() {
  cat <<EOF
用法:
  ./publish.sh [选项]

说明:
  使用 Granular Access Token 发布当前目录的 npm 包到 npm 官方仓库。
  默认不需要 npm login；脚本会为本次发布临时注入 token（不会写入仓库文件）。
  如果你的账号/包策略强制要求 2FA，仍可能需要提供 OTP。

发布前置要求:
  - 当前目录必须是 git 仓库，且工作区干净（所有变更已提交）。
  - 必须提供可发布该包的 npm token（建议使用 Granular Access Token）。
  - package.json 中 name/version 必须可发布，且该 version 在 registry 中不存在。

选项:
  -t, --token <token>     npm token（推荐 Granular Access Token）
  -o, --otp <code>        2FA 一次性验证码（6 位，可选）
  -r, --registry <url>    npm registry（默认: ${DEFAULT_REGISTRY}）
  -h, --help              显示帮助

示例:
  # 交互式输入 token
  ./publish.sh

  # 直接传 token
  ./publish.sh --token "npm_xxx"

  # 若 registry 策略要求 OTP
  ./publish.sh --token "npm_xxx" --otp 123456
EOF
}

is_tty() {
  [[ -t 0 ]] && [[ -t 1 ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--token)
      TOKEN="${2:-}"; shift 2 ;;
    -o|--otp)
      OTP="${2:-}"; shift 2 ;;
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

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误: 当前目录不是 git 仓库，拒绝发布。" >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 检测到未提交的变更（工作区不干净），拒绝发布。" >&2
  echo "请先提交所有变更后再执行。" >&2
  exit 2
fi

umask 077
TMP_NPMRC=""
cleanup() {
  if [[ -n "${TMP_NPMRC}" ]]; then
    rm -f "${TMP_NPMRC}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${TOKEN}" ]]; then
  if is_tty; then
    read -rs -p "请输入 NPM Token: " TOKEN
    echo
  else
    echo "缺少 token，请使用 --token 传入。" >&2
    echo >&2
    print_help
    exit 2
  fi
fi

if [[ -z "${TOKEN}" ]]; then
  echo "token 不能为空" >&2
  exit 2
fi

TMP_NPMRC="$(mktemp -t npmrc.dx-publish.XXXXXX)"
cat >"${TMP_NPMRC}" <<EOF
registry=${REGISTRY}
//registry.npmjs.org/:_authToken=${TOKEN}
EOF

if ! NPM_CONFIG_USERCONFIG="${TMP_NPMRC}" npm whoami --registry="${REGISTRY}" >/dev/null 2>&1; then
  echo "错误: token 无效或无权限（registry: ${REGISTRY}）。" >&2
  exit 2
fi

if [[ ! -f package.json ]]; then
  echo "错误: 当前目录未找到 package.json" >&2
  exit 2
fi

PKG_NAME="$(node -p "require('./package.json').name" 2>/dev/null || true)"
PKG_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
PKG_PRIVATE="$(node -p "Boolean(require('./package.json').private)" 2>/dev/null || echo false)"

if [[ -z "$PKG_NAME" || -z "$PKG_VERSION" ]]; then
  echo "错误: package.json 缺少 name 或 version" >&2
  exit 2
fi

if [[ "$PKG_PRIVATE" == "true" ]]; then
  echo "错误: package.json 标记为 private=true，拒绝发布。" >&2
  exit 2
fi

# 简单 semver 校验：x.y.z 或 x.y.z-xxx
if ! [[ "$PKG_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([\-\+][0-9A-Za-z\.-]+)?$ ]]; then
  echo "错误: version 不符合 semver 规范: $PKG_VERSION" >&2
  exit 2
fi

if [[ "$PKG_VERSION" == "0.0.0" ]]; then
  echo "错误: version=0.0.0 通常不用于发布，请先设定正确版本号。" >&2
  exit 2
fi

if NPM_CONFIG_USERCONFIG="${TMP_NPMRC}" npm view "${PKG_NAME}@${PKG_VERSION}" version --registry="${REGISTRY}" >/dev/null 2>&1; then
  echo "错误: ${PKG_NAME}@${PKG_VERSION} 已存在于 registry，拒绝覆盖发布。" >&2
  exit 2
fi

if [[ -n "${OTP}" ]]; then
  NPM_CONFIG_USERCONFIG="${TMP_NPMRC}" npm publish --access public --registry="${REGISTRY}" --otp="${OTP}"
else
  NPM_CONFIG_USERCONFIG="${TMP_NPMRC}" npm publish --access public --registry="${REGISTRY}"
fi
