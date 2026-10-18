#!/usr/bin/env bash
set -euo pipefail

server=/opt/screenbridge/server
backup_dir="$server/backups/secure-device-reconnect-20261017-1"
stage="$backup_dir/staging"
backup="$backup_dir/predeploy.tar.gz"
restore_dir=
unit=/etc/systemd/system/screenbridge-relay.service
service=screenbridge-relay
publish_switched=0

cleanup_next_files() {
  rm -f -- \
    "$server/.relay.js.next" \
    "$server/.security-store.js.next" \
    "$server/public/.index.html.next" \
    "$server/public/.viewer.css.next" \
    "$server/public/.viewer.js.next" \
    "$server/public/.workbench.js.next" \
    "$unit.next"
}

restore_file() {
  local source="$1"
  local target="$2"
  local temporary="${target}.rollback-new"
  install -o root -g root -m 0644 "$source" "$temporary"
  mv -f -- "$temporary" "$target"
}

check_http_200() {
  local status
  if ! status="$(curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' "$1")"; then
    return 1
  fi
  [[ "$status" == 200 ]] || return 1
  return 0
}

wait_for_health() {
  local attempt response status body
  for attempt in {1..15}; do
    if response="$(curl --silent --show-error --max-time 4 --write-out $'\n%{http_code}' https://screenbridge.zahml.top/healthz)"; then
      status="${response##*$'\n'}"
      body="${response%$'\n'*}"
      if [[ "$status" == 200 ]] \
        && printf '%s' "$body" | /opt/screenbridge/node/bin/node -e 'const data = JSON.parse(require("node:fs").readFileSync(0, "utf8")); if (data.ok !== true) process.exit(1)'; then
        return 0
      fi
    fi
    if ! sleep 2; then
      return 1
    fi
  done
  return 1
}

rollback() {
  local result="${1:-$?}"
  local restore_dir
  trap - ERR
  trap '' INT TERM HUP
  set +e
  cleanup_next_files
  if (( publish_switched )); then
    if systemctl stop "$service"; then
      if restore_dir="$(mktemp -d "$backup_dir/rollback-20261017.XXXXXX")" \
        && tar -xzf "$backup" -C "$restore_dir" --no-same-owner \
        && restore_file "$restore_dir/relay.js" "$server/relay.js" \
        && restore_file "$restore_dir/public/index.html" "$server/public/index.html" \
        && restore_file "$restore_dir/public/viewer.css" "$server/public/viewer.css" \
        && restore_file "$restore_dir/public/viewer.js" "$server/public/viewer.js" \
        && restore_file "$restore_dir/public/workbench.js" "$server/public/workbench.js" \
        && restore_file "$restore_dir/screenbridge-relay.service" "$unit" \
        && rm -f -- "$server/security-store.js" \
        && systemctl daemon-reload \
        && systemctl start "$service" \
        && systemctl is-active --quiet "$service"; then
        echo "发布失败；已恢复旧版本并确认服务 active，认证状态目录已保留。" >&2
      else
        echo "发布失败且旧版本恢复或启动验证未完成；请检查服务和备份。" >&2
      fi
    else
      echo "发布失败且无法停止当前服务；未继续覆盖文件，请检查服务和备份。" >&2
    fi
  fi
  exit "$result"
}
trap rollback ERR
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM

backup_hash="$(sha256sum "$backup" | awk '{print $1}')"
[[ "$backup_hash" == 422e70dbba1f3580cbd1bad73a03d5e6e39767f5facd2b19cc3f4df08c7f17bd ]]
relay_hash="$(sha256sum "$server/relay.js" | awk '{print $1}')"
[[ "$relay_hash" == f9f7c105e879cac73c4c95f78c5b30a3f5fce76bceb53e89b6b42b1ae2983e46 ]]
command -v curl >/dev/null
if [[ -e /var/lib/screenbridge ]]; then
  [[ -d /var/lib/screenbridge ]]
  [[ "$(stat -c '%a %U:%G' /var/lib/screenbridge)" == '700 screenbridge:screenbridge' ]]
fi

/opt/screenbridge/node/bin/node --check "$stage/relay.js"
/opt/screenbridge/node/bin/node --check "$stage/security-store.js"
chmod 0644 "$stage/deploy/screenbridge-relay.service"
systemd-analyze verify "$stage/deploy/screenbridge-relay.service"
install -d -o screenbridge -g screenbridge -m 0700 /var/lib/screenbridge

install -o root -g root -m 0644 "$stage/relay.js" "$server/.relay.js.next"
install -o root -g root -m 0644 "$stage/security-store.js" "$server/.security-store.js.next"
install -o root -g root -m 0644 "$stage/public/index.html" "$server/public/.index.html.next"
install -o root -g root -m 0644 "$stage/public/viewer.css" "$server/public/.viewer.css.next"
install -o root -g root -m 0644 "$stage/public/viewer.js" "$server/public/.viewer.js.next"
install -o root -g root -m 0644 "$stage/public/workbench.js" "$server/public/.workbench.js.next"
install -o root -g root -m 0644 "$stage/deploy/screenbridge-relay.service" "$unit.next"

publish_switched=1
systemctl stop "$service"
mv -f -- "$server/.relay.js.next" "$server/relay.js"
mv -f -- "$server/.security-store.js.next" "$server/security-store.js"
mv -f -- "$server/public/.index.html.next" "$server/public/index.html"
mv -f -- "$server/public/.viewer.css.next" "$server/public/viewer.css"
mv -f -- "$server/public/.viewer.js.next" "$server/public/viewer.js"
mv -f -- "$server/public/.workbench.js.next" "$server/public/workbench.js"
mv -f -- "$unit.next" "$unit"
systemctl daemon-reload
systemctl start "$service"
systemctl is-active --quiet "$service"
[[ "$(stat -c '%a %U:%G' /var/lib/screenbridge)" == '700 screenbridge:screenbridge' ]]
if ! wait_for_health; then
  echo "HTTPS health check failed after deployment." >&2
  rollback 1
fi
for resource in / /viewer.css /viewer.js /workbench.js; do
  if ! check_http_200 "https://screenbridge.zahml.top${resource}"; then
    echo "HTTP resource check failed: ${resource}" >&2
    rollback 1
  fi
done
unauth_status="$(curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' https://screenbridge.zahml.top/api/devices)"
[[ "$unauth_status" == 401 ]]
if ! cleanup_next_files; then
  echo "Could not remove temporary deployment files." >&2
  rollback 1
fi
trap - ERR
trap - INT TERM HUP
echo "ScreenBridge relay 0.4.4 deployed; service active and state directory protected."
