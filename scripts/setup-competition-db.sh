#!/bin/sh
set -eu

MODELMUX_DB_NAME="${MODELMUX_DB_NAME:-modelmux}"
MODELMUX_DB_USER="${MODELMUX_DB_USER:-modelmux}"
MODELMUX_DB_HOST="${MODELMUX_DB_HOST:-127.0.0.1}"

case "$MODELMUX_DB_NAME" in *[!a-zA-Z0-9_]*) echo "MODELMUX_DB_NAME contains unsupported characters" >&2; exit 1;; esac
case "$MODELMUX_DB_USER" in *[!a-zA-Z0-9_]*) echo "MODELMUX_DB_USER contains unsupported characters" >&2; exit 1;; esac

if [ -z "${MODELMUX_DB_PASSWORD:-}" ]; then
  echo "Set MODELMUX_DB_PASSWORD before running this script." >&2
  exit 1
fi
case "$MODELMUX_DB_PASSWORD" in
  *[!a-zA-Z0-9._~-]*)
    echo "MODELMUX_DB_PASSWORD may only contain URL-safe letters, numbers, dot, underscore, tilde and hyphen." >&2
    exit 1
    ;;
esac
if [ "${#MODELMUX_DB_PASSWORD}" -lt 16 ]; then
  echo "MODELMUX_DB_PASSWORD must contain at least 16 characters." >&2
  exit 1
fi

mysql -u "${MODELMUX_MYSQL_ADMIN_USER:-root}" -p <<SQL
CREATE DATABASE IF NOT EXISTS \`${MODELMUX_DB_NAME}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '${MODELMUX_DB_USER}'@'${MODELMUX_DB_HOST}' IDENTIFIED BY '${MODELMUX_DB_PASSWORD}';
ALTER USER '${MODELMUX_DB_USER}'@'${MODELMUX_DB_HOST}' IDENTIFIED BY '${MODELMUX_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${MODELMUX_DB_NAME}\`.* TO '${MODELMUX_DB_USER}'@'${MODELMUX_DB_HOST}';
FLUSH PRIVILEGES;
SQL

echo "Competition database is ready."
echo "MODELMUX_DATABASE_URL=mysql://${MODELMUX_DB_USER}:<password>@127.0.0.1:3306/${MODELMUX_DB_NAME}"
