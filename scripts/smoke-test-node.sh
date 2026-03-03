#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

USER_ID="${1:-tester}"
PROMPT="${SMOKE_NODE_PROMPT:-[runtime:node] Build me a basketball score tracker website with API endpoints}"

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

echo "[smoke-node] starting stack"
docker compose up -d --build

echo "[smoke-node] waiting for control plane health"
if ! wait_for_health "http://localhost:3001/health" 120; then
  echo "[smoke-node] control plane health check failed"
  exit 1
fi

echo "[smoke-node] clearing existing managed sites for user=$USER_ID"
docker compose exec -T platform-control-plane npm run cli -- clear-sites "$USER_ID" >/dev/null

echo "[smoke-node] sending prompt"
raw_output="$(docker compose exec -T platform-control-plane npm run cli -- send --user "$USER_ID" "$PROMPT")"
json_output="$(printf '%s' "$raw_output" | extract_json_payload)"

if [ -z "$json_output" ]; then
  echo "[smoke-node] failed to parse CLI JSON output"
  echo "$raw_output"
  exit 1
fi

runtime_profile="$(printf '%s' "$json_output" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.reply.metadata.runtime.profile);});')"
project_dir="$(printf '%s' "$json_output" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.reply.metadata.projectDir);});')"
url="$(printf '%s' "$json_output" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.reply.metadata.site.url);});')"

if [ "$runtime_profile" != "node" ]; then
  echo "[smoke-node] expected runtime profile node, got: $runtime_profile"
  exit 1
fi

project_root="data/users/${USER_ID}/workspace/${project_dir}"
if [ ! -f "$project_root/package.json" ] || [ ! -f "$project_root/server.js" ]; then
  echo "[smoke-node] expected node project files missing in: $project_root"
  exit 1
fi

echo "[smoke-node] waiting for site URL: $url"
site_ok="false"
for _ in $(seq 1 60); do
  if curl -fsS --connect-timeout 2 --max-time 2 "$url" >/tmp/beepbot-smoke-node-index.html 2>/dev/null; then
    site_ok="true"
    break
  fi
  sleep 2
done

if [ "$site_ok" != "true" ]; then
  echo "[smoke-node] site URL did not become healthy in time: $url"
  exit 1
fi

health_url="${url%/}/health"
health_runtime=""
for _ in $(seq 1 30); do
  health_json="$(curl -fsS --connect-timeout 2 --max-time 3 "$health_url" 2>/dev/null || true)"
  if [ -z "$health_json" ]; then
    sleep 1
    continue
  fi

  health_runtime="$(printf '%s' "$health_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);process.stdout.write(o.runtime || "");}catch(_){process.stdout.write("");}});')"
  if [ "$health_runtime" = "node" ]; then
    break
  fi
  sleep 1
done

if [ "$health_runtime" != "node" ]; then
  echo "[smoke-node] expected /health runtime=node, got: ${health_runtime:-<empty>}"
  echo "[smoke-node] last health payload: ${health_json:-<empty>}"
  exit 1
fi

echo "[smoke-node] success"
echo "[smoke-node] project=$project_root"
echo "[smoke-node] url=$url"
echo "[smoke-node] health=$health_url"
