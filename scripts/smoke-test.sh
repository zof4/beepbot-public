#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

USER_ID="${1:-tester}"
PROMPT="${SMOKE_PROMPT:-Build me a basketball score tracker website}"

wait_for_health() {
  local url="$1"
  local timeout_s="$2"
  local start
  start="$(date +%s)"

  while true; do
    if curl -fsS --connect-timeout 2 --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi

    if [ $(( $(date +%s) - start )) -ge "$timeout_s" ]; then
      return 1
    fi

    sleep 2
  done
}

extract_json_payload() {
  sed -n '/^{/,$p'
}

echo "[smoke] starting stack"
docker compose up -d --build

echo "[smoke] waiting for control plane health"
if ! wait_for_health "http://localhost:3001/health" 120; then
  echo "[smoke] control plane health check failed"
  exit 1
fi

echo "[smoke] clearing existing managed sites for user=$USER_ID"
docker compose exec -T platform-control-plane npm run cli -- clear-sites "$USER_ID" >/dev/null

echo "[smoke] sending prompt"
raw_output="$(docker compose exec -T platform-control-plane npm run cli -- send --user "$USER_ID" "$PROMPT")"
json_output="$(printf '%s' "$raw_output" | extract_json_payload)"

if [ -z "$json_output" ]; then
  echo "[smoke] failed to parse CLI JSON output"
  echo "$raw_output"
  exit 1
fi

project_dir="$(printf '%s' "$json_output" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.reply.metadata.projectDir);});')"
url="$(printf '%s' "$json_output" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.reply.metadata.site.url);});')"

project_root="data/users/${USER_ID}/workspace/${project_dir}"

if [ ! -d "$project_root" ]; then
  echo "[smoke] expected project directory not found: $project_root"
  exit 1
fi

if [ -z "$(find "$project_root" -type f | head -n 1)" ]; then
  echo "[smoke] no files were generated in project directory: $project_root"
  exit 1
fi

echo "[smoke] waiting for live URL: $url"
url_ok="false"
for _ in $(seq 1 45); do
  if curl -fsS --connect-timeout 2 --max-time 2 "$url" >/tmp/beepbot-smoke-response.html 2>/dev/null; then
    url_ok="true"
    break
  fi
  sleep 2
done

if [ "$url_ok" != "true" ]; then
  echo "[smoke] live URL did not become healthy in time: $url"
  exit 1
fi

echo "[smoke] success"
echo "[smoke] project=$project_root"
echo "[smoke] url=$url"
