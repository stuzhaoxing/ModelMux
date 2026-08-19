#!/bin/sh
set -eu

MODELMUX_INSTALL_DIR="${MODELMUX_INSTALL_DIR:-/opt/modelmux}"
MODELMUX_ENV_FILE="${MODELMUX_ENV_FILE:-$MODELMUX_INSTALL_DIR/.env.local}"

if [ ! -f "$MODELMUX_ENV_FILE" ]; then
  echo "Competition system environment file not found: $MODELMUX_ENV_FILE" >&2
  exit 1
fi

set -a
. "$MODELMUX_ENV_FILE"
set +a

export NODE_ENV=production
export HOSTNAME="${HOSTNAME:-10.20.0.1}"
export PORT="${PORT:-4000}"

MODELMUX_NODE_BINARY="${MODELMUX_NODE_BINARY:-}"
if [ -z "$MODELMUX_NODE_BINARY" ]; then
  for MODELMUX_NODE_CANDIDATE in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
  do
    if [ -x "$MODELMUX_NODE_CANDIDATE" ]; then
      MODELMUX_NODE_BINARY="$MODELMUX_NODE_CANDIDATE"
      break
    fi
  done
fi

if [ -z "$MODELMUX_NODE_BINARY" ] || [ ! -x "$MODELMUX_NODE_BINARY" ]; then
  echo "Node.js executable not found; set MODELMUX_NODE_BINARY in $MODELMUX_ENV_FILE" >&2
  exit 1
fi

cd "$MODELMUX_INSTALL_DIR"
exec "$MODELMUX_NODE_BINARY" .next/standalone/server.js
