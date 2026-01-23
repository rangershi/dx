#!/usr/bin/env bash
set -euo pipefail

REGISTRY="https://registry.npmjs.org"
OTP=""

print_help() {
  cat <<'EOF'
用法:
  ./publish.sh [选项]

说明:
  发布当前目录的 npm 包到 npm 官方仓库。
  2FA 开启时需要 OTP。

发布前置要求:
  - 当前目录必须是 git 仓库，且工作区干净（所有变更已提交）。
  - 本机必须已 npm login。
  - package.json 中 name/version 必须可发布，且该 version 在 registry 中不存在。

选项:
  -o, --otp <code>        2FA 一次性验证码（6 位）
  -r, --registry <url>    npm registry（默认: https://registry.npmjs.org）
  -h, --help              显示帮助

示例:
  # 交互式输入 OTP（本机已 npm login）
  ./publish.sh

  # 直接传 OTP
  ./publish.sh --otp 123456
EOF
}

is_tty() {
  [[ -t 0 ]] && [[ -t 1 ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

if ! npm whoami --registry="$REGISTRY" >/dev/null 2>&1; then
  echo "错误: 当前机器未登录 npm（registry: $REGISTRY）。" >&2
  echo "请先执行: npm login --registry=$REGISTRY" >&2
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

if npm view "${PKG_NAME}@${PKG_VERSION}" version --registry="$REGISTRY" >/dev/null 2>&1; then
  echo "错误: ${PKG_NAME}@${PKG_VERSION} 已存在于 registry，拒绝覆盖发布。" >&2
  exit 2
fi

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

npm publish --access public --registry="$REGISTRY" --otp="$OTP"
