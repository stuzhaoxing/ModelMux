#!/bin/bash
# 赛中本地服务启动器：预检 → 组装 standalone → 启动 → 健康校验
#
# 用法:
#   ./scripts/start-competition.sh            前台启动
#   ./scripts/start-competition.sh --build    先重新构建再启动
#   ./scripts/start-competition.sh --check    只跑预检，不启动
#   ./scripts/start-competition.sh --force    连本项目之外的占用进程也一并杀掉
#
# 端口被本项目自己的旧实例（或忘关的 next dev）占用时会直接接管，无需加参数。
#
# launchd 调用的是同一个脚本，两条路径共用一份逻辑，避免出现互相矛盾的启动方式。
#
# 端口和对外 IP 全部从 .env.local 的 MODELMUX_INTERNAL_BASE_URL 推导：
# 那是选手在大屏、API 文档和访问资料里看到的地址，让它成为唯一事实来源，
# 服务就不可能监听在一个和公示地址不同的端口上。

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ENV_FILE="${MODELMUX_ENV_FILE:-$PROJECT_DIR/.env.local}"
BIND_HOST="${MODELMUX_BIND_HOST:-0.0.0.0}"
STANDALONE_DIR="$PROJECT_DIR/.next/standalone"
SERVER_JS="$STANDALONE_DIR/server.js"

DO_BUILD=false
CHECK_ONLY=false
PORT_ONLY=false
FORCE=false
for arg in "$@"; do
    case "$arg" in
        --build) DO_BUILD=true ;;
        --check) CHECK_ONLY=true ;;
        --port)  PORT_ONLY=true ;;
        --force) FORCE=true ;;
        --) ;;  # pnpm run 会把分隔符原样透传，忽略掉
        -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "未知参数: $arg" >&2; exit 1 ;;
    esac
done

# 从公示地址里拆出主机和端口。package.json 的 dev 脚本也调这里（--port），
# 保证开发和生产两种模式监听的端口永远等于管理后台公示给选手的端口。
load_env() {
    [ -f "$ENV_FILE" ] || { echo "环境文件不存在: $ENV_FILE" >&2; exit 1; }
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
}
parse_advertised() {
    local hostport="${MODELMUX_INTERNAL_BASE_URL:-}"
    [ -n "$hostport" ] || { echo "MODELMUX_INTERNAL_BASE_URL 未配置" >&2; exit 1; }
    hostport="${hostport#*://}"; hostport="${hostport%%/*}"
    ADVERTISED_HOST="${hostport%%:*}"
    if [ "$hostport" = "$ADVERTISED_HOST" ]; then PORT_NUM=80; else PORT_NUM="${hostport##*:}"; fi
    case "$PORT_NUM" in
        ''|*[!0-9]*) echo "无法从 MODELMUX_INTERNAL_BASE_URL 解析端口: $MODELMUX_INTERNAL_BASE_URL" >&2; exit 1 ;;
    esac
}

if [ "$PORT_ONLY" = true ]; then
    load_env
    parse_advertised
    echo "$PORT_NUM"
    exit 0
fi

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
ok()   { echo "${GREEN}  ✓${NC} $1"; }
warn() { echo "${YELLOW}  !${NC} $1"; }
die()  { echo "${RED}  ✗ $1${NC}" >&2; exit 1; }
step() { echo "${BLUE}==>${NC} $1"; }

step "预检"

# --- 1. 外置卷必须真的挂着 ---------------------------------------------------
# 项目在可移动磁盘上，盘掉线时目录会静默变成空的，Node 起来后所有路由 500。
case "$PROJECT_DIR" in
    /Volumes/*)
        VOLUME="/$(echo "${PROJECT_DIR#/}" | cut -d/ -f1-2)"
        mount | grep -q " on $VOLUME " || die "外置卷未挂载: $VOLUME"
        ok "外置卷已挂载: $VOLUME"
        ;;
esac
[ -f "$PROJECT_DIR/package.json" ] || die "项目目录不完整: $PROJECT_DIR"

# --- 2. 环境文件 -------------------------------------------------------------
load_env
ok "已加载 $ENV_FILE"

# --- 3. 必填配置 -------------------------------------------------------------
for key in MODELMUX_ADMIN_PASSWORD MODELMUX_ADMIN_SESSION_SECRET \
           MODELMUX_DATABASE_URL MODELMUX_INTERNAL_BASE_URL; do
    [ -n "${!key:-}" ] || die "$key 未配置"
done
ok "必填配置齐全"

PROVIDER_COUNT=0
for key in DEEPSEEK_API_KEYS DASHSCOPE_API_KEYS ARK_API_KEYS; do
    [ -n "${!key:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
done
[ "$PROVIDER_COUNT" -gt 0 ] || die "没有配置任何供应商 Key，白名单会是空的"
ok "供应商 Key: $PROVIDER_COUNT 家"

# --- 4. 数据目录必须是绝对路径 ------------------------------------------------
# standalone 的 server.js 会 chdir 到 .next/standalone，相对路径会解析到构建产物
# 目录里；那个目录每次 next build 都会重建，附件会随之丢失。
DATA_DIR="${MODELMUX_DATA_DIR:-}"
[ -n "$DATA_DIR" ] || die "MODELMUX_DATA_DIR 未配置"
case "$DATA_DIR" in
    /*) ;;
    *)  die "MODELMUX_DATA_DIR 必须是绝对路径（当前: ${DATA_DIR}）
     standalone 会 chdir 到 .next/standalone，相对路径会落到构建产物里并在下次构建时被清空" ;;
esac
mkdir -p "$DATA_DIR/uploads"
ok "数据目录: $DATA_DIR"

# --- 5. 从公示地址推导端口，并校验 IP 确实在本机上 -----------------------------
parse_advertised

LOCAL_IPS="$(ifconfig 2>/dev/null | awk '/inet /{print $2}')"
case "$ADVERTISED_HOST" in
    localhost|127.0.0.1|0.0.0.0)
        warn "公示地址是 ${ADVERTISED_HOST}，选手无法从别的机器访问" ;;
    *)
        if echo "$LOCAL_IPS" | grep -qx "$ADVERTISED_HOST"; then
            ok "公示 IP $ADVERTISED_HOST 与本机网卡一致"
        else
            warn "公示地址 $ADVERTISED_HOST 不在本机网卡 IP 列表中，继续监听 $BIND_HOST
     本机现有地址: $(echo "$LOCAL_IPS" | tr '\n' ' ')
     如果现场 IP 已变更，更新 .env.local 的 MODELMUX_INTERNAL_BASE_URL / MODELMUX_PUBLIC_BASE_URL
     使用域名或端口转发时，请确认该地址能够到达本机"
        fi ;;
esac
ok "监听端口: $PORT_NUM (绑定 $BIND_HOST)"

# --- 6. 端口占用：抢占本项目的旧实例 -------------------------------------------
# 比赛现场重启服务时，端口上十有八九是自己的上一个实例或忘了关的 next dev，
# 停下来问一句纯属添乱，直接接管。但 80 是特权端口，别的服务也可能在上面，
# 所以只自动杀“属于本项目”的进程：靠 cwd 判定（Next 会把进程名改成
# next-server，命令行里看不出路径，cwd 才是可靠依据）。陌生进程要 --force。
release_port() {
    local pids="$1" pid cwd desc
    for pid in $pids; do
        cwd="$(lsof -p "$pid" -a -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2- | head -1)"
        desc="$(ps -o user=,command= -p "$pid" 2>/dev/null | sed 's/^ *//' | cut -c1-70)"
        case "$cwd" in
            "$PROJECT_DIR"|"$PROJECT_DIR"/*) ;;
            *)
                [ "$FORCE" = true ] || die "端口 $PORT_NUM 被本项目之外的进程占用，已停止
     PID $pid  $desc
     cwd: ${cwd:-未知}
     确认可以杀掉它就加 --force 重来: pnpm start --force" ;;
        esac
        kill "$pid" 2>/dev/null || true
        warn "已停止占用 ${PORT_NUM} 的进程 PID ${pid}（${desc}）"
    done

    local waited=0
    while [ "$waited" -lt 15 ]; do
        lsof -nP -iTCP:"$PORT_NUM" -sTCP:LISTEN -t >/dev/null 2>&1 || return 0
        sleep 1
        waited=$((waited + 1))
        # 前 10 秒给优雅退出的机会，之后上 KILL
        if [ "$waited" -eq 10 ]; then
            for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
            warn "优雅退出超时，已强制结束"
        fi
    done
    lsof -nP -iTCP:"$PORT_NUM" -sTCP:LISTEN -t >/dev/null 2>&1 \
        && die "端口 $PORT_NUM 仍未释放，手动检查: lsof -nP -iTCP:$PORT_NUM -sTCP:LISTEN"
    return 0
}

OCCUPIED="$(lsof -nP -iTCP:"$PORT_NUM" -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "$OCCUPIED" ]; then
    release_port "$OCCUPIED"
fi
ok "端口 $PORT_NUM 空闲"

# --- 7. Node ------------------------------------------------------------------
NODE_BIN="${MODELMUX_NODE_BINARY:-}"
if [ -z "$NODE_BIN" ]; then
    # launchd 只给最小 PATH，nvm/fnm 装的 node 不在里面，所以显式探测常见位置。
    # 探到 nvm 时取版本号最大的一个，但仍然提醒去 .env.local 里钉死。
    NVM_LATEST="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$NVM_LATEST" \
                     "$(command -v node 2>/dev/null || true)" /usr/bin/node; do
        [ -n "$candidate" ] && [ -x "$candidate" ] && { NODE_BIN="$candidate"; break; }
    done
    case "$NODE_BIN" in
        *"/.nvm/"*) warn "用的是 nvm 里的 node，建议在 $ENV_FILE 里设置 MODELMUX_NODE_BINARY 钉死版本" ;;
    esac
fi
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || die "找不到 node，在 $ENV_FILE 里设置 MODELMUX_NODE_BINARY"
ok "Node: $NODE_BIN ($("$NODE_BIN" -v))"

# 1024 以下是特权端口。这台机器上普通用户能绑 80，但这是 macOS 版本相关的行为，
# 系统升级后可能收回；真到那天要的是一条说得清的错误，而不是启动时一句 EACCES。
if [ "$PORT_NUM" -lt 1024 ] && [ "$(id -u)" -ne 0 ]; then
    if "$NODE_BIN" -e '
        require("net").createServer().listen(Number(process.argv[1]),"0.0.0.0")
          .on("listening",function(){this.close();process.exit(0)})
          .on("error",()=>process.exit(1))
    ' "$PORT_NUM" 2>/dev/null; then
        ok "特权端口 $PORT_NUM 可由当前用户绑定"
    else
        die "当前用户无法绑定特权端口 $PORT_NUM
     两条出路，任选其一：
       1) 把公示地址改回高位端口，例如 http://$ADVERTISED_HOST:1444
       2) 用 pf 做端口转发，服务仍监听 1444：
          echo \"rdr pass on lo0 inet proto tcp to any port $PORT_NUM -> 127.0.0.1 port 1444
          rdr pass inet proto tcp to any port $PORT_NUM -> 127.0.0.1 port 1444\" | sudo pfctl -ef -"
    fi
fi

# --- 8. MySQL 可达 ------------------------------------------------------------
DB_HOSTPORT="$(echo "$MODELMUX_DATABASE_URL" | sed -E 's|^[^@]*@||; s|/.*$||')"
DB_HOST="${DB_HOSTPORT%%:*}"; DB_PORT="${DB_HOSTPORT##*:}"
case "$DB_PORT" in ''|*[!0-9]*) DB_PORT=3306 ;; esac
if nc -z -G 3 "$DB_HOST" "$DB_PORT" 2>/dev/null; then
    ok "MySQL 可达: $DB_HOST:$DB_PORT"
else
    die "MySQL 连不上: $DB_HOST:$DB_PORT
     考核端会整体不可用（/health 返回 503 degraded）。先起库: brew services start mysql"
fi

# --- 9. 构建产物 --------------------------------------------------------------
if [ "$DO_BUILD" = true ]; then
    step "构建"
    pnpm build
elif [ ! -f "$SERVER_JS" ]; then
    die "没有构建产物，先跑一次: $0 --build"
fi

if [ -f "$PROJECT_DIR/.next/BUILD_ID" ]; then
    NEWER="$(find "$PROJECT_DIR/app" "$PROJECT_DIR/lib" "$PROJECT_DIR/src" "$PROJECT_DIR/next.config.ts" \
        -newer "$PROJECT_DIR/.next/BUILD_ID" -type f 2>/dev/null | head -1)"
    [ -n "$NEWER" ] && warn "源码比构建产物新（如 ${NEWER#"$PROJECT_DIR"/}），需要 --build 才会生效"
fi

# --- 10. 组装 standalone ------------------------------------------------------
# next build 不会把这两份静态资源放进 standalone，漏了会全站样式和 JS 404。
[ -d "$PROJECT_DIR/.next/static" ] || die ".next/static 缺失，构建不完整"
mkdir -p "$STANDALONE_DIR/.next"
rm -rf "$STANDALONE_DIR/.next/static" "$STANDALONE_DIR/public"
cp -R "$PROJECT_DIR/.next/static" "$STANDALONE_DIR/.next/static"
[ -d "$PROJECT_DIR/public" ] && cp -R "$PROJECT_DIR/public" "$STANDALONE_DIR/public"
ok "standalone 静态资源已同步"

if [ "$CHECK_ONLY" = true ]; then
    echo "${GREEN}预检全部通过${NC}"
    exit 0
fi

# --- 11. 启动 -----------------------------------------------------------------
step "启动"

# 后台守着 /health，服务真正可用时打印一次入口地址。exec 之后本进程被替换，
# 所以这段必须先派生出去；在 launchd 下它会写进日志文件。
(
    for _ in $(seq 1 60); do
        sleep 1
        BODY="$(curl -s --noproxy '*' --max-time 3 "http://127.0.0.1:$PORT_NUM/health" 2>/dev/null)" || continue
        [ -n "$BODY" ] || continue
        STATUS="$(echo "$BODY" | sed -E 's/.*"status":"([^"]*)".*/\1/')"
        echo ""
        case "$STATUS" in
            ok)          echo "${GREEN}服务就绪${NC}  status=ok" ;;
            degraded)    echo "${RED}服务已启动，但考核数据库连不上${NC}" ;;
            needs_config) echo "${YELLOW}服务已启动，但必填配置不全${NC}" ;;
            *)           echo "健康检查返回: $BODY" ;;
        esac
        echo "  选手答题   ${MODELMUX_INTERNAL_BASE_URL}/contestant/questions"
        echo "  API 文档   ${MODELMUX_INTERNAL_BASE_URL}/contestant/api-docs"
        echo "  模型接口   ${MODELMUX_INTERNAL_BASE_URL}/v1"
        echo "  比赛投屏   ${MODELMUX_INTERNAL_BASE_URL}/screen"
        echo "  管理后台   ${MODELMUX_INTERNAL_BASE_URL}/admin"
        exit 0
    done
    echo "${RED}健康检查 60 秒未通过，检查上方日志${NC}" >&2
) &

export NODE_ENV=production
export HOSTNAME="$BIND_HOST"
export PORT="$PORT_NUM"

exec "$NODE_BIN" "$SERVER_JS"
