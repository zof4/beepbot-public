# BeepBot MVP Control Plane PoC

This repository implements a control-plane-first PoC aligned to the architecture plan, with a repeatable end-to-end smoke test.

## What runs

`docker-compose.yml` starts 4 containers:

1. `platform-control-plane` (API, WebSocket routing, Docker spawn authority)
2. `agent-tester` (single-user agent runtime)
3. `platform-caddy` (caddy-docker-proxy)
4. `platform-monitoring` (Uptime Kuma)

## Current MVP scope

- user registry driven (not hardcoded in code): `config/users.json`
- user API token auth on control-plane endpoints (`x-user-token`)
- agent token validation per user (internal agent/control-plane path)
- control plane can spawn site containers with runtime profiles:
  - `static` (busybox httpd)
  - `node` (node:20-alpine with `npm run <script>` and persistent runtime data mount)
- model-backed agent generation via OpenAI SDK, with deterministic fallback template if model call fails or key is unavailable
- score-tracker fallback now defaults to Node + SQLite persistence (cross-browser/device data retention)
- no Clerk/JWT, memory/LCM, `unf`, or full monitoring stack yet

## Quick start

1. `docker compose up -d --build`
2. Send a prompt from control-plane CLI:
   - `docker compose exec platform-control-plane npm run cli -- send --user tester "Build me a basketball score tracker website"`
3. Check status:
   - `docker compose exec platform-control-plane npm run cli -- status tester`
4. Clear user sites when needed:
   - `docker compose exec platform-control-plane npm run cli -- clear-sites tester`
5. Force deterministic runtime for testing:
   - `docker compose exec platform-control-plane npm run cli -- send --user tester "[runtime:node] Build a score tracker"`
   - `docker compose exec platform-control-plane npm run cli -- send --user tester "[runtime:static] Build a score tracker"`

## Smoke test

Run this to validate full MVP path:

- `./scripts/smoke-test.sh`
- `./scripts/smoke-test-node.sh`

What it validates:

1. stack boots
2. control plane health endpoint responds
3. existing managed site containers for the test user are cleared
4. CLI prompt produces a project
5. files are written under `data/users/<user>/workspace/`
6. live URL returns HTTP 200

The node smoke test additionally validates:

1. deterministic node runtime generation using `[runtime:node]`
2. runtime profile is `node`
3. `/health` endpoint on the spawned site reports `runtime=node`

## Auth notes

- `config/users.json` contains both:
  - `userToken` for external control-plane API calls (`/api/messages`, `/api/status`, `/api/sites`)
  - `agentToken` for internal agent->control-plane calls
- CLI sends `x-user-token` automatically via `CLI_USER_TOKEN` env (defaults to `tester-app-token`).

## Environment notes

- macOS/Docker Desktop:
  - bind mounts for sister containers use `USER_DATA_ROOT_HOST=${PWD}/data/users`
- Oracle Linux production target:
  - set both `USER_DATA_ROOT` and `USER_DATA_ROOT_HOST` to `/data/users`
  - use the Oracle Linux overlay and runbook:
    - `deploy/oracle-linux/docker-compose.oracle-linux.yml`
    - `docs/oracle-linux-staging-runbook.md`

## Key files

- `docker-compose.yml`
- `config/users.json`
- `apps/control-plane/src/server.js`
- `apps/control-plane/src/docker.js`
- `apps/control-plane/src/users.js`
- `apps/agent-tester/src/agent.js`
- `apps/agent-tester/src/project-generator.js`
- `scripts/smoke-test.sh`
- `scripts/smoke-test-node.sh`
- `deploy/oracle-linux/docker-compose.oracle-linux.yml`
- `docs/oracle-linux-staging-runbook.md`
- `docs/mvp-control-plane-handoff.md`
