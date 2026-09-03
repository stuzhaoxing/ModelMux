#!/bin/bash
# 本地构建 + 远程部署脚本
# 用法: ./deploy.sh [--skip-build] [--logs]
#
# 服务器只负责运行，所有构建都在本地完成。
# 服务器密码放在 .deploy.local（已被 .gitignore 的 *.local 规则忽略），
# 或通过项目专用环境变量 MODELMUX_DEPLOY_PASSWORD 传入。

set -euo pipefail

# ========== 服务器配置 ==========
SERVER_HOST="${SERVER_HOST:-47.116.44.143}"
SERVER_PORT="${SERVER_PORT:-22}"
SERVER_USER="${SERVER_USER:-root}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/modelmux}"
APP_USER="${APP_USER:-modelmux}"
SERVICE_NAME="${SERVICE_NAME:-modelmux}"
APP_PORT="${APP_PORT:-4000}"
PUBLIC_URL="${PUBLIC_URL:-https://dbw.lic-inc.com}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 密码：优先环境变量，其次 .deploy.local
if [ -z "${MODELMUX_DEPLOY_PASSWORD:-}" ] && [ -f "$SCRIPT_DIR/.deploy.local" ]; then
    # shellcheck disable=SC1091
    . "$SCRIPT_DIR/.deploy.local"
fi

# ========== 颜色输出 ==========
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${BLUE}==>${NC} ${GREEN}$1${NC}"; }

SKIP_BUILD=false
SHOW_LOGS=false
for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=true ;;
        --logs)       SHOW_LOGS=true ;;
        -h|--help)
            sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) log_error "未知参数: $arg"; exit 1 ;;
    esac
done

PKG="/tmp/modelmux-deploy.tar.gz"
SSH_CONTROL_PATH="/tmp/modelmux-ssh-${UID}-$$"
SSH_OPTIONS=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o LogLevel=ERROR
    -o PubkeyAuthentication=no
    -o PreferredAuthentications=password,keyboard-interactive
    -o ConnectTimeout=25
    -o ServerAliveInterval=15
    -o "Port=$SERVER_PORT"
    -o "ControlPath=$SSH_CONTROL_PATH"
    -o ControlMaster=auto
)

# ========== 预检 ==========
preflight() {
    log_step "Step 0: 环境预检"

    if ! command -v sshpass &> /dev/null; then
        log_error "sshpass 未安装，请先执行: brew install sshpass"
        exit 1
    fi
    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm 未安装，请先执行: corepack enable && corepack prepare pnpm@11.9.0 --activate"
        exit 1
    fi
    if [ -z "${MODELMUX_DEPLOY_PASSWORD:-}" ]; then
        log_error "未找到服务器密码。请创建 $SCRIPT_DIR/.deploy.local，内容为:"
        log_error "    MODELMUX_DEPLOY_PASSWORD='你的root密码'"
        log_error "或者临时使用: MODELMUX_DEPLOY_PASSWORD='...' ./deploy.sh"
        exit 1
    fi

    local node_major
    node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
    if [ "$node_major" -lt 22 ]; then
        log_error "本地 Node.js 版本过低（当前 $(node -v)，需要 >= 22）"
        exit 1
    fi

    log_info "本地 node $(node -v) / pnpm $(pnpm -v)"
    log_info "目标服务器 $SERVER_USER@$SERVER_HOST:$SERVER_PORT → $DEPLOY_DIR"

    if ! open_ssh_master; then
        log_error "SSH 认证失败，请检查 MODELMUX_DEPLOY_PASSWORD 和服务器登录策略"
        exit 1
    fi
    log_info "SSH 认证完成，后续上传和部署将复用同一连接"
}

# ========== SSH / SCP 封装 ==========
open_ssh_master() {
    SSHPASS="$MODELMUX_DEPLOY_PASSWORD" sshpass -e ssh \
        "${SSH_OPTIONS[@]}" \
        -M -N -f "$SERVER_USER@$SERVER_HOST"
}

ssh_cmd() {
    ssh "${SSH_OPTIONS[@]}" "$SERVER_USER@$SERVER_HOST" "$1"
}

scp_cmd() {
    scp "${SSH_OPTIONS[@]}" "$1" "$SERVER_USER@$SERVER_HOST:$2"
}

# ========== Step 1: 本地构建 ==========
local_build() {
    if [ "$SKIP_BUILD" = true ]; then
        log_step "Step 1: 跳过构建（--skip-build）"
        if [ ! -d ".next/standalone" ]; then
            log_error ".next/standalone 不存在，无法跳过构建"
            exit 1
        fi
        return
    fi

    log_step "Step 1: 本地构建"
    pnpm install --frozen-lockfile
    pnpm build

    if [ ! -f ".next/standalone/server.js" ]; then
        log_error "构建产物缺失: .next/standalone/server.js"
        log_error "请确认 next.config.ts 中 output: \"standalone\""
        exit 1
    fi
    log_info "构建完成"
}

# ========== Step 2: 组装 standalone ==========
assemble() {
    log_step "Step 2: 组装 standalone 产物"

    # Next 的 standalone 不含静态资源，需要手动放进去
    mkdir -p .next/standalone/.next
    rm -rf .next/standalone/.next/static
    cp -R .next/static .next/standalone/.next/static
    log_info "已复制 .next/static ($(du -sh .next/static | awk '{print $1}'))"

    # public/ 为空目录时 Next 不会生成，存在内容才复制
    if [ -d "public" ] && [ -n "$(ls -A public 2>/dev/null)" ]; then
        rm -rf .next/standalone/public
        cp -R public .next/standalone/public
        log_info "已复制 public/"
    fi

    # 构建时在 standalone 内生成的默认数据目录，不应带到线上
    rm -rf .next/standalone/.modelmux-data
}

# ========== Step 3: 打包 ==========
package() {
    log_step "Step 3: 打包"
    rm -f "$PKG"

    # 先验证 standalone 内的 pnpm 依赖链接完整。这里只验证 JS 依赖图；
    # Linux 原生插件会在打包清单和服务器切换版本前分别验证。
    if ! (cd .next/standalone && node -e 'require("sharp")'); then
        log_error "standalone 中 Sharp 依赖无法加载，已停止打包"
        exit 1
    fi

    # 排除 macOS 原生二进制：本地是 darwin-arm64，服务器是 linux-x64。
    # 答卷导出使用 sharp 处理图片，必须保留 linux-x64 的 sharp 和 libvips。
    # --no-xattrs/--no-mac-metadata 避免 bsdtar 写入 macOS 扩展属性，
    # 否则 Linux 上 GNU tar 解包时会刷大量 LIBARCHIVE.xattr 警告
    COPYFILE_DISABLE=1 tar -czf "$PKG" \
        --no-xattrs \
        --no-mac-metadata \
        --exclude='*darwin*' \
        --exclude='*win32*' \
        --exclude='*linuxmusl*' \
        --exclude='*linux-arm*' \
        --exclude='*linux-ppc64*' \
        --exclude='*linux-riscv64*' \
        --exclude='*linux-s390x*' \
        --exclude='*freebsd*' \
        --exclude='*wasm32*' \
        --exclude='.next/cache' \
        --exclude='.DS_Store' \
        --exclude='._*' \
        .next/standalone \
        scripts/start-local.sh

    # 兜底检查：不得携带 macOS 产物，且 Linux Sharp 的插件和 libvips 必须齐全。
    local darwin_files linux_sharp_files linux_libvips_files
    darwin_files=$(tar -tzf "$PKG" | grep -ic 'darwin' || true)
    linux_sharp_files=$(tar -tzf "$PKG" | grep -cE '/@img/sharp-linux-x64/.*/sharp-linux-x64[^/]*\.node$' || true)
    linux_libvips_files=$(tar -tzf "$PKG" | grep -cE '/@img/sharp-libvips-linux-x64/.*/libvips-cpp\.so' || true)
    if [ "$darwin_files" -gt 0 ]; then
        log_error "部署包仍包含 $darwin_files 个 macOS 文件，已停止上传"
        exit 1
    fi
    if [ "$linux_sharp_files" -lt 1 ] || [ "$linux_libvips_files" -lt 1 ]; then
        log_error "部署包缺少 Linux x64 Sharp 运行时，已停止上传"
        log_error "sharp addon=$linux_sharp_files, libvips=$linux_libvips_files"
        exit 1
    fi
    log_info "Sharp 依赖与 Linux x64 原生文件校验通过"

    log_info "打包完成: $(ls -lh "$PKG" | awk '{print $5}')"
}

# ========== Step 4: 上传 ==========
upload() {
    log_step "Step 4: 上传到服务器"
    scp_cmd "$PKG" "/tmp/"
    log_info "上传完成"
}

# ========== Step 5: 服务器端部署 ==========
remote_deploy() {
    log_step "Step 5: 服务器端部署"

    local remote_command
    printf -v remote_command 'bash -s -- %q %q %q %q' \
        "$DEPLOY_DIR" "$APP_USER" "$SERVICE_NAME" "$APP_PORT"

    ssh "${SSH_OPTIONS[@]}" "$SERVER_USER@$SERVER_HOST" "$remote_command" <<'REMOTE_SCRIPT'
set -euo pipefail

DEPLOY_DIR="$1"
APP_USER="$2"
SERVICE_NAME="$3"
APP_PORT="$4"
HEALTH_FILE="/tmp/modelmux-deploy-health-$$.json"

rollback() {
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    rm -rf .next scripts
    [ -d .next.backup ] && mv .next.backup .next || true
    [ -d scripts.backup ] && mv scripts.backup scripts || true
    systemctl start "$SERVICE_NAME" 2>/dev/null || true
}

cd "$DEPLOY_DIR"

# 环境变量文件由服务器维护，部署流程绝不覆盖（内含密钥）
if [ ! -f .env.local ]; then
    echo "缺少 $DEPLOY_DIR/.env.local，请先在服务器创建后再部署" >&2
    exit 1
fi

echo '=== 备份当前版本 ==='
rm -rf .next.backup scripts.backup
[ -d .next ] && cp -a .next .next.backup || true
[ -d scripts ] && cp -a scripts scripts.backup || true

echo '=== 停止服务 ==='
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

echo '=== 解压新版本 ==='
rm -rf .next/standalone
tar -xzf /tmp/modelmux-deploy.tar.gz -C "$DEPLOY_DIR"
rm -f /tmp/modelmux-deploy.tar.gz
chmod +x scripts/start-local.sh

echo '=== 修正属主与权限 ==='
chown -R "$APP_USER:$APP_USER" .next scripts
chown "$APP_USER:$APP_USER" .env.local
chmod 600 .env.local
mkdir -p data logs
chown "$APP_USER:$APP_USER" data logs
chmod 700 data logs

echo '=== 校验 Linux Sharp 运行时 ==='
if ! SHARP_VERSION=$(
    cd .next/standalone &&
    runuser -u "$APP_USER" -- node -e 'const sharp = require("sharp"); process.stdout.write(sharp.versions.sharp)'
); then
    echo 'Linux Sharp 运行时加载失败，回滚到上一版本' >&2
    rollback
    exit 1
fi
echo "Sharp runtime v$SHARP_VERSION"

echo '=== 启动服务 ==='
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"

echo '=== 健康检查 ==='
OK=false
for i in $(seq 1 20); do
    sleep 2
    CODE=$(curl -s -o "$HEALTH_FILE" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/health" || true)
    # 200=就绪；503=进程正常但配置未完成（例如尚未填写供应商 Key）
    if [ "$CODE" = '200' ] || [ "$CODE" = '503' ]; then
        OK=true
        break
    fi
    echo "  等待应用启动... ($i/20, http=${CODE:-000})"
done

if [ "$OK" != true ]; then
    echo '应用启动失败，回滚到上一版本' >&2
    journalctl -u "$SERVICE_NAME" -n 40 --no-pager >&2 || true
    rollback
    exit 1
fi

echo "健康检查 http=$CODE"
cat "$HEALTH_FILE"; echo
rm -f "$HEALTH_FILE"

rm -rf .next.backup scripts.backup
echo '=== 部署完成 ==='
REMOTE_SCRIPT
}

# ========== Step 6: 外部验证 ==========
verify() {
    log_step "Step 6: 公网验证"

    local code
    code=$(curl -s -o /tmp/mm-health.json -w '%{http_code}' --max-time 20 "$PUBLIC_URL/health" || echo 000)
    local status
    status=$(grep -o '"status":"[^"]*"' /tmp/mm-health.json 2>/dev/null | cut -d'"' -f4 || echo "")

    case "$status" in
        ok)
            log_info "服务正常: $PUBLIC_URL (http=$code, status=ok)"
            ;;
        needs_config)
            log_info "应用已启动 (http=$code)"
            log_warn "状态 needs_config：还有必填配置未完成"
            log_warn "请在服务器 $DEPLOY_DIR/.env.local 填写供应商 Key 后执行:"
            log_warn "    systemctl restart $SERVICE_NAME"
            ;;
        suspended)
            log_info "应用已启动，当前为停服状态 (http=$code, status=suspended)"
            log_warn "如需恢复模型 API，请到 $PUBLIC_URL/admin/settings 打开开关"
            ;;
        degraded)
            log_error "应用已启动，但考核数据库不可用 (http=$code, status=degraded)"
            log_error "健康检查里的 database 字段给出了原因分类："
            grep -o '"database":{[^}]*}' /tmp/mm-health.json 2>/dev/null || true
            log_error "请在服务器检查 MySQL 与 $DEPLOY_DIR/.env.local 里的 MODELMUX_DATABASE_URL"
            rm -f /tmp/mm-health.json
            exit 1
            ;;
        *)
            log_error "公网健康检查异常 (http=$code)"
            cat /tmp/mm-health.json 2>/dev/null | head -5
            rm -f /tmp/mm-health.json
            exit 1
            ;;
    esac
    rm -f /tmp/mm-health.json
}

cleanup() {
    rm -f "$PKG"
    if [ -S "$SSH_CONTROL_PATH" ]; then
        ssh "${SSH_OPTIONS[@]}" -O exit "$SERVER_USER@$SERVER_HOST" >/dev/null 2>&1 || true
    fi
    rm -f "$SSH_CONTROL_PATH"
}

main() {
    echo -e "${BLUE}=========================================${NC}"
    echo -e "${BLUE} ModelMux 部署 → $SERVER_HOST${NC}"
    echo -e "${BLUE}=========================================${NC}"

    preflight
    local_build
    assemble
    package
    upload
    remote_deploy
    verify

    echo ""
    log_info "========================================="
    log_info "部署成功！"
    log_info "访问地址: $PUBLIC_URL"
    log_info "管理后台: $PUBLIC_URL/admin"
    log_info "========================================="

    if [ "$SHOW_LOGS" = true ]; then
        log_step "实时日志 (Ctrl+C 退出)"
        ssh_cmd "journalctl -u $SERVICE_NAME -f -n 50 --no-pager"
    else
        echo ""
        log_info "查看日志: ./deploy.sh --logs  或  ssh $SERVER_USER@$SERVER_HOST 'journalctl -u $SERVICE_NAME -f'"
    fi
}

trap cleanup EXIT
main "$@"
