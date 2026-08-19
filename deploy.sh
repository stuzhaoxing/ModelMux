#!/bin/bash
# 本地构建 + 远程部署脚本
# 用法: ./deploy.sh [--skip-build] [--logs]
#
# 服务器只负责运行，所有构建都在本地完成。
# 服务器密码放在 .deploy.local（已被 .gitignore 的 *.local 规则忽略），
# 或通过环境变量 SERVER_PASS 传入。

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
if [ -z "${SERVER_PASS:-}" ] && [ -f "$SCRIPT_DIR/.deploy.local" ]; then
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
    if [ -z "${SERVER_PASS:-}" ]; then
        log_error "未找到服务器密码。请创建 $SCRIPT_DIR/.deploy.local，内容为:"
        log_error "    SERVER_PASS='你的root密码'"
        log_error "或者临时使用: SERVER_PASS='...' ./deploy.sh"
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
}

# ========== SSH / SCP 封装 ==========
ssh_cmd() {
    sshpass -p "$SERVER_PASS" ssh \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o LogLevel=ERROR \
        -o PubkeyAuthentication=no \
        -o PreferredAuthentications=password,keyboard-interactive \
        -o ConnectTimeout=25 \
        -o ServerAliveInterval=15 \
        -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "$1"
}

scp_cmd() {
    sshpass -p "$SERVER_PASS" scp \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o LogLevel=ERROR \
        -o PubkeyAuthentication=no \
        -o PreferredAuthentications=password,keyboard-interactive \
        -o ConnectTimeout=25 \
        -P "$SERVER_PORT" "$1" "$SERVER_USER@$SERVER_HOST:$2"
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

    # 排除 macOS 原生二进制：本地是 darwin-arm64，服务器是 linux-x64。
    # sharp 仅在使用 next/image 时才加载，本项目未使用，故整体剔除（约 17MB）。
    # --no-xattrs/--no-mac-metadata 避免 bsdtar 写入 macOS 扩展属性，
    # 否则 Linux 上 GNU tar 解包时会刷大量 LIBARCHIVE.xattr 警告
    COPYFILE_DISABLE=1 tar -czf "$PKG" \
        --no-xattrs \
        --no-mac-metadata \
        --exclude='*darwin*' \
        --exclude='.next/cache' \
        --exclude='.DS_Store' \
        --exclude='._*' \
        .next/standalone \
        scripts/start-local.sh

    # 兜底检查：确认包里没有残留的平台二进制
    local leftover
    leftover=$(tar -tzf "$PKG" | grep -icE 'darwin|\.node$' || true)
    if [ "$leftover" -gt 0 ]; then
        log_warn "包内仍有 $leftover 个平台相关文件，请检查:"
        tar -tzf "$PKG" | grep -iE 'darwin|\.node$' | head -5
    fi

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

    ssh_cmd "
        set -e
        DEPLOY_DIR='$DEPLOY_DIR'
        APP_USER='$APP_USER'
        SERVICE_NAME='$SERVICE_NAME'
        APP_PORT='$APP_PORT'

        cd \"\$DEPLOY_DIR\"

        # 环境变量文件由服务器维护，部署流程绝不覆盖（内含密钥）
        if [ ! -f .env.local ]; then
            echo \"缺少 \$DEPLOY_DIR/.env.local，请先在服务器创建后再部署\" >&2
            exit 1
        fi

        echo '=== 备份当前版本 ==='
        rm -rf .next.backup scripts.backup
        [ -d .next ] && cp -a .next .next.backup || true
        [ -d scripts ] && cp -a scripts scripts.backup || true

        echo '=== 停止服务 ==='
        systemctl stop \"\$SERVICE_NAME\" 2>/dev/null || true

        echo '=== 解压新版本 ==='
        rm -rf .next/standalone
        tar -xzf /tmp/modelmux-deploy.tar.gz -C \"\$DEPLOY_DIR\"
        rm -f /tmp/modelmux-deploy.tar.gz
        chmod +x scripts/start-local.sh

        echo '=== 修正属主与权限 ==='
        chown -R \"\$APP_USER:\$APP_USER\" .next scripts
        chown \"\$APP_USER:\$APP_USER\" .env.local
        chmod 600 .env.local
        mkdir -p data logs
        chown \"\$APP_USER:\$APP_USER\" data logs
        chmod 700 data logs

        echo '=== 启动服务 ==='
        systemctl daemon-reload
        systemctl enable \"\$SERVICE_NAME\" >/dev/null 2>&1 || true
        systemctl restart \"\$SERVICE_NAME\"

        echo '=== 健康检查 ==='
        OK=false
        for i in \$(seq 1 20); do
            sleep 2
            CODE=\$(curl -s -o /tmp/health.json -w '%{http_code}' \"http://127.0.0.1:\$APP_PORT/health\" || echo 000)
            # 200=就绪；503=进程正常但配置未完成（例如尚未填写供应商 Key）
            if [ \"\$CODE\" = '200' ] || [ \"\$CODE\" = '503' ]; then
                OK=true
                break
            fi
            echo \"  等待应用启动... (\$i/20, http=\$CODE)\"
        done

        if [ \"\$OK\" != true ]; then
            echo '应用启动失败，回滚到上一版本' >&2
            journalctl -u \"\$SERVICE_NAME\" -n 40 --no-pager >&2 || true
            systemctl stop \"\$SERVICE_NAME\" 2>/dev/null || true
            rm -rf .next scripts
            [ -d .next.backup ] && mv .next.backup .next || true
            [ -d scripts.backup ] && mv scripts.backup scripts || true
            systemctl start \"\$SERVICE_NAME\" 2>/dev/null || true
            exit 1
        fi

        echo \"健康检查 http=\$CODE\"
        cat /tmp/health.json; echo
        rm -f /tmp/health.json

        rm -rf .next.backup scripts.backup
        echo '=== 部署完成 ==='
    "
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
    cleanup
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

main "$@"
