#!/bin/bash
# Creates a ucweb API key on one Unfolded Circle remote and stores it as <keys-dir>/<hostname>.key.
# Usage: create-api-key.sh <remote-ip> [--replace]   |   create-api-key.sh <remote-ip> --check
# The keys folder is $UC_KEYS_DIR, or ./keys when it is not set.
set -euo pipefail

IP=${1:?usage: create-api-key.sh <remote-ip> [--replace|--check]}
MODE=${2:-}
NAME=ucweb
DIR=${UC_KEYS_DIR:-./keys}
BASE="http://$IP/api"

for tool in curl python3; do
  command -v "$tool" >/dev/null || { echo "This script needs $tool." >&2; exit 1; }
done

version=$(curl -fsS -m 5 "$BASE/pub/version") || { echo "No Unfolded Circle remote answered at $IP." >&2; exit 1; }
host=$(printf '%s' "$version" | python3 -c 'import sys,json; print(json.load(sys.stdin)["hostname"].removesuffix(".local"))')
device=$(printf '%s' "$version" | python3 -c 'import sys,json; print(json.load(sys.stdin)["device_name"])')
FILE="$DIR/$host.key"

check() {
  local code
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat "$FILE")" "$BASE/system")
  case $code in
    200) echo "The key in $FILE works on $device ($IP)." ;;
    401|403) echo "The key for $device is stored but not active yet. Approve the \"$NAME\" request on the remote's screen, then run: $0 $IP --check" ;;
    *) echo "Unexpected HTTP $code from $device when testing the key." >&2; return 1 ;;
  esac
}

if [ "$MODE" = "--check" ]; then
  [ -f "$FILE" ] || { echo "No key stored for $device at $FILE." >&2; exit 1; }
  check; exit
fi

read -rsp "Web-configurator PIN for $device ($IP): " PIN; echo
AUTH="web-configurator:$PIN"
code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -u "$AUTH" "$BASE/system")
[ "$code" = 200 ] || { echo "The PIN was not accepted (HTTP $code). Nothing was created." >&2; exit 1; }

if [ "$MODE" = "--replace" ]; then
  ids=$(curl -fsS -m 5 -u "$AUTH" "$BASE/auth/api_keys" | python3 -c 'import sys,json; print(" ".join(k["key_id"] for k in json.load(sys.stdin) if k.get("name")=="ucweb"))')
  for id in $ids; do curl -fsS -m 5 -u "$AUTH" -X DELETE "$BASE/auth/api_keys/$id" >/dev/null && echo "Revoked the old $NAME key ($id)."; done
fi

body=$(python3 -c 'import json; print(json.dumps({"name":"ucweb","scopes":["admin"],"description":"ucweb web remote"}))')
response=$(curl -s -m 10 -u "$AUTH" -H 'Content-Type: application/json' -d "$body" -w '\n%{http_code}' "$BASE/auth/api_keys")
code=${response##*$'\n'}; json=${response%$'\n'*}
case $code in
  201) ;;
  422) echo "$device already has a key named \"$NAME\". Run again with --replace to revoke it and issue a new one." >&2; exit 1 ;;
  *) echo "Creating the key failed (HTTP $code): $json" >&2; exit 1 ;;
esac
key=$(printf '%s' "$json" | python3 -c 'import sys,json; print(json.load(sys.stdin)["api_key"])')
[ -n "$key" ] || { echo "The remote returned no key." >&2; exit 1; }

install -d -m 700 "$DIR"
umask 077; printf '%s' "$key" > "$FILE"
echo "Created the $NAME key for $device and stored it in $FILE."
check
