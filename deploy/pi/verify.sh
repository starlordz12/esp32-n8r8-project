#!/usr/bin/env bash
set -euo pipefail

expect_live=false
if [[ "${1:-}" == "--expect-live" ]]; then
  expect_live=true
  shift
fi
if (($#)); then
  printf 'Usage: %s [--expect-live]\n' "$0" >&2
  exit 2
fi

for command in docker curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"
if [[ ! -f .env ]]; then
  printf 'Missing %s/.env; copy .env.example and generate a token first.\n' "$script_dir" >&2
  exit 1
fi

mapfile -t token_lines < <(grep -E '^RUVIEW_API_TOKEN=[[:xdigit:]]{64}$' .env || true)
if ((${#token_lines[@]} != 1)); then
  printf '.env must contain exactly one 64-character hexadecimal RUVIEW_API_TOKEN.\n' >&2
  exit 1
fi
api_token=${token_lines[0]#*=}

header_file=$(mktemp)
health_file=$(mktemp)
latest_file=$(mktemp)
dashboard_file=$(mktemp)
cleanup() {
  rm -f -- "$header_file" "$health_file" "$latest_file" "$dashboard_file"
}
trap cleanup EXIT
chmod 600 "$header_file"
printf 'Authorization: Bearer %s\n' "$api_token" >"$header_file"
unset api_token token_lines

docker compose config --quiet
for service in sensing-server dashboard; do
  if ! docker compose ps --status running --services | grep -Fxq "$service"; then
    printf 'Service is not running: %s\n' "$service" >&2
    exit 1
  fi
done

expected_digest=$(jq -er \
  '.image.manifestDigest | select(test("^sha256:[a-f0-9]{64}$"))' \
  ruview-server.lock.json)
server_image_id=$(docker compose images -q sensing-server)
if [[ -z "$server_image_id" ]] ||
   ! docker image inspect "$server_image_id" --format '{{range .RepoDigests}}{{println .}}{{end}}' |
     grep -Fq "@$expected_digest"; then
  printf 'The running RuView server image does not match the reviewed digest.\n' >&2
  exit 1
fi

curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  -H "@$header_file" http://127.0.0.1:3000/health >"$health_file"
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  -H "@$header_file" http://127.0.0.1:3000/api/v1/sensing/latest >"$latest_file"
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  http://127.0.0.1:8080/api/ruvview/snapshot >"$dashboard_file"

jq -e 'type == "object"' "$health_file" "$latest_file" >/dev/null
jq -e '.schemaVersion == 1 and (.mode == "live" or .mode == "preview")' \
  "$dashboard_file" >/dev/null

if [[ "$expect_live" == true ]]; then
  jq -e '(.source | ascii_downcase | startswith("esp32")) and
    ((.source | ascii_downcase | contains("offline")) | not)' "$health_file" >/dev/null
  jq -e '.mode == "live" and .connection == "connected" and (.nodes | length) >= 1' \
    "$dashboard_file" >/dev/null
  printf 'PASS: pinned RuView server, dashboard, and at least one live ESP32 node are connected.\n'
else
  mode=$(jq -r '.mode' "$dashboard_file")
  connection=$(jq -r '.connection' "$dashboard_file")
  printf 'PASS: pinned RuView server and dashboard are healthy (dashboard: %s/%s).\n' \
    "$mode" "$connection"
fi
