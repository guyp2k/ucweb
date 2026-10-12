#!/bin/sh
set -eu

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

mkdir -p "$UCWEB_CONFIG_DIR/keys"
chown -R "$PUID:$PGID" "$UCWEB_CONFIG_DIR"
chmod 700 "$UCWEB_CONFIG_DIR/keys"
exec su-exec "$PUID:$PGID" "$@"
