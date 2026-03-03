# BeepBot MVP Control Plane PoC

This repository now contains a working MVP slice focused on the control plane path:

- hardcoded user: `tester`
- hardcoded auth token: `tester-dev-token`
- no LCM/memory/auth integrations yet
- Docker-based agent routing + sister site spawning via Caddy labels

## What runs

`docker-compose.yml` starts 4 containers:

1. `platform-control-plane` (Node.js API + WS routing + Docker spawn)
2. `agent-tester` (hardcoded agent runtime)
3. `platform-caddy` (caddy-docker-proxy)
4. `platform-monitoring` (Uptime Kuma)

## Quick start

1. `docker compose up -d --build`
2. Wait for `agent-tester` and `platform-control-plane` to be healthy/logging.
3. Send a prompt:
   - `docker compose exec platform-control-plane npm run cli -- send "Build me a basketball score tracker website"`
4. Check state:
   - `docker compose exec platform-control-plane npm run cli -- status`

The agent writes generated project files to:

- `data/users/tester/workspace/<project-slug>/index.html`

The response includes a live URL routed by Caddy on host port `8080`.

## CLI commands

Run these in `platform-control-plane` container:

- `npm run cli -- status`
- `npm run cli -- sites`
- `npm run cli -- send "<message>"`

## Important MVP constraints

- hardcoded single-user flow only
- no Clerk/JWT/OpenAI OAuth
- no persistent memory DB or LCM compaction
- no per-user quotas or billing
- no restore/versioning integration yet
- macOS note: spawned site bind mounts use `USER_DATA_ROOT_HOST=${PWD}/data/users`

See `docs/mvp-control-plane-handoff.md` for detailed implementation status and next steps.
