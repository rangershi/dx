function escapeShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function buildRemoteDeployScript(phaseModel = []) {
  const payload = phaseModel[0]?.payload || {}
  const remote = payload.remote || {}
  const runtime = payload.runtime || {}
  const startup = payload.startup || {}
  const deploy = payload.deploy || {}
  const verify = payload.verify || {}
  const healthCheck = verify.healthCheck || null
  const environment = String(payload.environment || 'production')
  const expectedAppEnv = environment
  const expectedNodeEnv = environment === 'development' ? 'development' : 'production'
  const baseDir = String(remote.baseDir || '.')
  const releaseDir = `${baseDir}/releases/${payload.versionName || 'unknown'}`
  const currentLink = `${baseDir}/current`
  const uploadsDir = `${baseDir}/uploads`
  const uploadedBundlePath = String(payload.uploadedBundlePath || '')
  const envFileName = `.env.${environment}`
  const envLocalFileName = `.env.${environment}.local`
  const prismaSchema = runtime.prismaSchemaDir ? `./${runtime.prismaSchemaDir}` : ''
  const prismaConfig = runtime.prismaConfig ? `./${runtime.prismaConfig}` : ''
  const ecosystemConfig = runtime.ecosystemConfig ? `./${runtime.ecosystemConfig}` : './ecosystem.config.cjs'
  const installCommand = String(deploy.installCommand || 'pnpm install --prod --no-frozen-lockfile --ignore-workspace')
  const startupEntry = String(startup.entry || '')
  const startupMode = String(startup.mode || 'pm2')
  const serviceName = String(startup.serviceName || 'backend')
  const keepReleases = Number(deploy.keepReleases || 5)
  const shouldGenerate = deploy.prismaGenerate !== false
  const shouldMigrate = deploy.prismaMigrateDeploy !== false && deploy.skipMigration !== true
  const healthCheckUrl = healthCheck?.url ? String(healthCheck.url) : ''
  const healthCheckTimeoutSeconds = Number(healthCheck?.timeoutSeconds || 10)

  return `#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=${escapeShell(baseDir)}
UPLOADS_DIR=${escapeShell(uploadsDir)}
ARCHIVE=${escapeShell(uploadedBundlePath)}
RELEASE_DIR=${escapeShell(releaseDir)}
CURRENT_LINK=${escapeShell(currentLink)}
ENV_NAME=${escapeShell(environment)}
EXPECTED_APP_ENV=${escapeShell(expectedAppEnv)}
EXPECTED_NODE_ENV=${escapeShell(expectedNodeEnv)}
ENV_FILE_NAME=${escapeShell(envFileName)}
ENV_LOCAL_FILE_NAME=${escapeShell(envLocalFileName)}
PRISMA_SCHEMA=${escapeShell(prismaSchema)}
PRISMA_CONFIG=${escapeShell(prismaConfig)}
ECOSYSTEM_CONFIG=${escapeShell(ecosystemConfig)}
INSTALL_COMMAND=${escapeShell(installCommand)}
START_MODE=${escapeShell(startupMode)}
SERVICE_NAME=${escapeShell(serviceName)}
START_ENTRY=${escapeShell(startupEntry)}
HEALTHCHECK_URL=${escapeShell(healthCheckUrl)}
HEALTHCHECK_TIMEOUT_SECONDS=${healthCheckTimeoutSeconds}
KEEP_RELEASES=${keepReleases}
SHOULD_GENERATE=${shouldGenerate ? '1' : '0'}
SHOULD_MIGRATE=${shouldMigrate ? '1' : '0'}

LOCK_FILE="$APP_ROOT/.deploy.lock"
LOCK_DIR="$APP_ROOT/.deploy.lock.d"
SHARED_DIR="$APP_ROOT/shared"
RELEASES_DIR="$APP_ROOT/releases"
PREVIOUS_CURRENT_TARGET=""
BUNDLE_TEMP_DIR=""
INNER_ARCHIVE=""
INNER_ARCHIVE_SHA256_FILE=""
VERSION_NAME=""
DOTENV_BIN=""
PRISMA_BIN=""
CURRENT_PHASE="init"
RESULT_EMITTED=0
ROLLBACK_ATTEMPTED=false
ROLLBACK_SUCCEEDED=null
MIGRATION_EXECUTED=0

emit_result() {
  local ok="$1"
  local phase="$2"
  local message="$3"
  local rollback_attempted="$4"
  local rollback_succeeded="$5"
  if [[ "$RESULT_EMITTED" -eq 1 ]]; then
    return
  fi
  RESULT_EMITTED=1
  message="\${message//\\\\/\\\\\\\\}"
  message="\${message//\"/\\\\\"}"
  message="\${message//$'\\n'/\\\\n}"
  printf 'DX_REMOTE_RESULT={"ok":%s,"phase":"%s","message":"%s","rollbackAttempted":%s,"rollbackSucceeded":%s}\\n' \\
    "$ok" "$phase" "$message" "$rollback_attempted" "$rollback_succeeded"
}

cleanup() {
  rm -rf "$BUNDLE_TEMP_DIR" 2>/dev/null || true
  if [[ -n "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

on_error() {
  local code=$?
  emit_result false "$CURRENT_PHASE" "phase failed (exit $code)" "$ROLLBACK_ATTEMPTED" "$ROLLBACK_SUCCEEDED"
  exit "$code"
}

trap cleanup EXIT
trap on_error ERR

validate_path_within_base() {
  local base="$1"
  local target="$2"
  case "$target" in
    "$base"/*|"$base") ;;
    *)
      echo "目标路径越界: $target" >&2
      exit 1
      ;;
  esac
}

validate_archive_entries() {
  local archive="$1"
  local entry
  local tar_line
  local link_target

  while IFS= read -r entry; do
    if [[ "$entry" == /* ]]; then
      echo "包含绝对路径条目: $entry" >&2
      exit 1
    fi
    if [[ "$entry" =~ (^|/)\\.\\.(/|$) || "$entry" =~ \\.\\.\\\\ ]]; then
      echo "包含可疑路径条目: $entry" >&2
      exit 1
    fi
  done < <(tar -tzf "$archive")

  while IFS= read -r tar_line; do
    if [[ "$tar_line" == *" -> "* ]]; then
      link_target="\${tar_line##* -> }"
      if [[ "$link_target" == /* ]]; then
        echo "包含可疑链接目标: $link_target" >&2
        exit 1
      fi
      if [[ "$link_target" =~ (^|/)\\.\\.(/|$) || "$link_target" =~ \\.\\.\\\\ ]]; then
        echo "包含可疑链接目标: $link_target" >&2
        exit 1
      fi
    fi
  done < <(tar -tvzf "$archive")
}

find_single_bundle_file() {
  local bundle_dir="$1"
  local pattern="$2"
  shopt -s nullglob
  local matches=("$bundle_dir"/$pattern)
  shopt -u nullglob
  if [[ "\${#matches[@]}" -ne 1 ]]; then
    return 1
  fi
  printf '%s\\n' "\${matches[0]}"
}

sha256_check() {
  local checksum_file="$1"
  local checksum file actual
  checksum="$(awk '{print $1}' "$checksum_file")"
  file="$(awk '{print $2}' "$checksum_file")"
  file="$(basename "$file")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  [[ "$checksum" == "$actual" ]]
}

run_with_env() {
  local cwd="$1"
  shift
  (
    cd "$cwd"
    APP_ENV="$EXPECTED_APP_ENV" NODE_ENV="$EXPECTED_NODE_ENV" \\
      "$DOTENV_BIN" -o -e "$ENV_FILE_NAME" -e "$ENV_LOCAL_FILE_NAME" -- "$@"
  )
}

read_pm2_env_var() {
  local key="$1"
  pm2 jlist | node -e '
    const fs = require("node:fs")
    const key = process.argv[1]
    const list = JSON.parse(fs.readFileSync(0, "utf8"))
    const app = list.find(item => item?.name === process.argv[2])
    process.stdout.write(String(app?.pm2_env?.[key] || ""))
  ' "$key" "$SERVICE_NAME"
}

attempt_pm2_restore() {
  if [[ -z "$PREVIOUS_CURRENT_TARGET" || ! -e "$PREVIOUS_CURRENT_TARGET/$ECOSYSTEM_CONFIG" ]]; then
    ROLLBACK_SUCCEEDED=false
    return
  fi
  if (
    cd "$PREVIOUS_CURRENT_TARGET"
    APP_ENV="$EXPECTED_APP_ENV" NODE_ENV="$EXPECTED_NODE_ENV" \\
      "$DOTENV_BIN" -o -e "$ENV_FILE_NAME" -e "$ENV_LOCAL_FILE_NAME" -- \\
      pm2 start "$ECOSYSTEM_CONFIG" --only "$SERVICE_NAME" --update-env
    pm2 save
  ); then
    ROLLBACK_SUCCEEDED=true
  else
    ROLLBACK_SUCCEEDED=false
  fi
}

CURRENT_PHASE="lock"
echo "DX_REMOTE_PHASE=lock"
mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$UPLOADS_DIR"
validate_path_within_base "$APP_ROOT" "$ARCHIVE"
validate_path_within_base "$APP_ROOT" "$RELEASE_DIR"

PREVIOUS_CURRENT_TARGET="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9
else
  mkdir "$LOCK_DIR"
fi

CURRENT_PHASE="extract"
echo "DX_REMOTE_PHASE=extract"
validate_archive_entries "$ARCHIVE"
BUNDLE_TEMP_DIR="$(mktemp -d "$APP_ROOT/.bundle-extract.XXXXXX")"
tar -xzf "$ARCHIVE" -C "$BUNDLE_TEMP_DIR"

INNER_ARCHIVE="$(find_single_bundle_file "$BUNDLE_TEMP_DIR" 'backend-v*.tgz')"
INNER_ARCHIVE_SHA256_FILE="$(find_single_bundle_file "$BUNDLE_TEMP_DIR" 'backend-v*.tgz.sha256')"
VERSION_NAME="$(basename "$INNER_ARCHIVE" .tgz)"
validate_path_within_base "$RELEASES_DIR" "$RELEASE_DIR"

(cd "$BUNDLE_TEMP_DIR" && sha256_check "$(basename "$INNER_ARCHIVE_SHA256_FILE")")
validate_archive_entries "$INNER_ARCHIVE"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$INNER_ARCHIVE" -C "$RELEASE_DIR" --strip-components=1

CURRENT_PHASE="env"
echo "DX_REMOTE_PHASE=env"
if [[ ! -f "$SHARED_DIR/$ENV_FILE_NAME" ]]; then
  echo "未找到基础环境文件: $SHARED_DIR/$ENV_FILE_NAME" >&2
  exit 1
fi
if [[ ! -f "$SHARED_DIR/$ENV_LOCAL_FILE_NAME" ]]; then
  echo "未找到本地覆盖环境文件: $SHARED_DIR/$ENV_LOCAL_FILE_NAME" >&2
  exit 1
fi
ln -sfn "$SHARED_DIR/$ENV_FILE_NAME" "$RELEASE_DIR/$ENV_FILE_NAME"
ln -sfn "$SHARED_DIR/$ENV_LOCAL_FILE_NAME" "$RELEASE_DIR/$ENV_LOCAL_FILE_NAME"

CURRENT_PHASE="install"
echo "DX_REMOTE_PHASE=install"
command -v node >/dev/null 2>&1
command -v pnpm >/dev/null 2>&1
if [[ "$START_MODE" == "pm2" ]]; then
  command -v pm2 >/dev/null 2>&1
fi
(
  cd "$RELEASE_DIR"
  bash -lc "$INSTALL_COMMAND"
)

DOTENV_BIN="$RELEASE_DIR/node_modules/.bin/dotenv"
if [[ ! -x "$DOTENV_BIN" ]]; then
  echo "缺少可执行文件: $DOTENV_BIN" >&2
  exit 1
fi

if [[ "$SHOULD_GENERATE" == "1" ]]; then
  CURRENT_PHASE="prisma-generate"
  echo "DX_REMOTE_PHASE=prisma-generate"
  PRISMA_BIN="$RELEASE_DIR/node_modules/.bin/prisma"
  if [[ ! -x "$PRISMA_BIN" ]]; then
    echo "缺少可执行文件: $PRISMA_BIN" >&2
    exit 1
  fi
  run_with_env "$RELEASE_DIR" "$PRISMA_BIN" generate --schema="$PRISMA_SCHEMA" --config="$PRISMA_CONFIG"
fi

if [[ "$SHOULD_MIGRATE" == "1" ]]; then
  CURRENT_PHASE="prisma-migrate"
  echo "DX_REMOTE_PHASE=prisma-migrate"
  PRISMA_BIN="$RELEASE_DIR/node_modules/.bin/prisma"
  if [[ ! -x "$PRISMA_BIN" ]]; then
    echo "缺少可执行文件: $PRISMA_BIN" >&2
    exit 1
  fi
  run_with_env "$RELEASE_DIR" "$PRISMA_BIN" migrate deploy --schema="$PRISMA_SCHEMA" --config="$PRISMA_CONFIG"
  MIGRATION_EXECUTED=1
fi

CURRENT_PHASE="switch-current"
echo "DX_REMOTE_PHASE=switch-current"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

CURRENT_PHASE="startup"
echo "DX_REMOTE_PHASE=startup"
if [[ "$START_MODE" == "pm2" ]]; then
  if ! (
    cd "$CURRENT_LINK"
    pm2 delete "$SERVICE_NAME" || true
    APP_ENV="$EXPECTED_APP_ENV" NODE_ENV="$EXPECTED_NODE_ENV" \\
      "$DOTENV_BIN" -o -e "$ENV_FILE_NAME" -e "$ENV_LOCAL_FILE_NAME" -- \\
      pm2 start "$ECOSYSTEM_CONFIG" --only "$SERVICE_NAME" --update-env
    pm2 save
  ); then
    if [[ "$MIGRATION_EXECUTED" -eq 0 && -n "$PREVIOUS_CURRENT_TARGET" ]]; then
      ROLLBACK_ATTEMPTED=true
      ln -sfn "$PREVIOUS_CURRENT_TARGET" "$CURRENT_LINK"
      attempt_pm2_restore
    fi
    emit_result false "startup" "pm2 startup failed" "$ROLLBACK_ATTEMPTED" "$ROLLBACK_SUCCEEDED"
    exit 1
  fi
else
  if ! (
    cd "$CURRENT_LINK"
    APP_ENV="$EXPECTED_APP_ENV" NODE_ENV="$EXPECTED_NODE_ENV" \\
      "$DOTENV_BIN" -o -e "$ENV_FILE_NAME" -e "$ENV_LOCAL_FILE_NAME" -- \\
      node "$START_ENTRY"
  ); then
    emit_result false "startup" "direct startup failed" false null
    exit 1
  fi
  emit_result true "startup" "direct mode attached" false null
  exit 0
fi

CURRENT_PHASE="verify"
echo "DX_REMOTE_PHASE=verify"
if [[ ! -L "$CURRENT_LINK" ]]; then
  echo "current 软链接不存在: $CURRENT_LINK" >&2
  exit 1
fi

current_release="$(readlink -f "$CURRENT_LINK")"
expected_release="$(readlink -f "$RELEASE_DIR")"
if [[ -z "$current_release" || ! -d "$current_release" ]]; then
  echo "current 软链接未指向有效目录: \${current_release:-<empty>}" >&2
  exit 1
fi
if [[ "$current_release" != "$expected_release" ]]; then
  echo "current 软链接未指向本次 release: expected=$expected_release actual=$current_release" >&2
  exit 1
fi

if [[ "$START_MODE" == "pm2" ]]; then
  if ! pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    echo "PM2 进程不存在: $SERVICE_NAME" >&2
    pm2 list || true
    exit 1
  fi

  pm2_app_env="$(read_pm2_env_var APP_ENV)"
  if [[ "$pm2_app_env" != "$EXPECTED_APP_ENV" ]]; then
    echo "APP_ENV 不匹配，期望=$EXPECTED_APP_ENV，实际=\${pm2_app_env:-<empty>}" >&2
    pm2 describe "$SERVICE_NAME" || true
    exit 1
  fi

  pm2_node_env="$(read_pm2_env_var NODE_ENV)"
  if [[ "$pm2_node_env" != "$EXPECTED_NODE_ENV" ]]; then
    echo "NODE_ENV 不匹配，期望=$EXPECTED_NODE_ENV，实际=\${pm2_node_env:-<empty>}" >&2
    pm2 describe "$SERVICE_NAME" || true
    exit 1
  fi
fi

if [[ -n "$HEALTHCHECK_URL" ]]; then
  curl -fsS --max-time "$HEALTHCHECK_TIMEOUT_SECONDS" "$HEALTHCHECK_URL" >/dev/null
fi

CURRENT_PHASE="cleanup"
echo "DX_REMOTE_PHASE=cleanup"
release_count=0
shopt -s nullglob
release_dirs=("$RELEASES_DIR"/*)
shopt -u nullglob
while IFS= read -r old_release; do
  release_count=$((release_count + 1))
  if [[ "$release_count" -gt "$KEEP_RELEASES" ]]; then
    rm -rf "$old_release"
  fi
done < <(
  if [[ "\${#release_dirs[@]}" -gt 0 ]]; then
    ls -1dt "\${release_dirs[@]}"
  fi
)

emit_result true "cleanup" "ok" false null
`
}
