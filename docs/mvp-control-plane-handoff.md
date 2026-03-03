# MVP Control Plane PoC Handoff

## Purpose

This document records implemented work, how it maps to the architecture plan, and what remains for later milestones.

## Implemented in this phase

### 1) Repeatable PoC verification (smoke tests)

Added:

- `scripts/smoke-test.sh` for default flow
- `scripts/smoke-test-node.sh` for deterministic node runtime flow

These validate the full control-plane path:

1. `docker compose up -d --build`
2. waits for `GET /health`
3. clears existing managed site containers for the target user
4. sends a CLI prompt
5. verifies workspace files were created
6. verifies the published URL returns HTTP 200

Node smoke additionally verifies:

1. runtime profile returned is `node`
2. generated project contains node runtime files
3. spawned site `/health` returns `runtime=node`

This converts the PoC from one-off demo behavior into repeatable quality gates for both runtime branches.

### 2) Control plane user/config layer + API auth

Replaced hardcoded user logic with a registry loaded from `config/users.json`.

Implemented in:

- `apps/control-plane/src/users.js`
- `apps/control-plane/src/config.js`
- `apps/control-plane/src/server.js`

Behavior now includes:

- per-user API token validation for external control-plane endpoints
- token-to-user boundary enforcement (user token can access only its own `userId`)
- per-user agent token validation
- configurable default user
- quota stubs per user (`maxActiveSites`, `dailyTokenLimit`)
- status endpoint scoped by `userId`
- site cleanup endpoint (`DELETE /api/sites`) via control plane API/CLI
- retry-based agent dispatch before failing user requests
- OpenAI OAuth endpoints for user credential connect/disconnect/status

### 3) Sister container runtime profiles

Expanded `spawn-site` from static-only to runtime profiles.

Implemented in:

- `apps/control-plane/src/docker.js`
- `apps/control-plane/src/server.js`

Supported profiles:

- `static`
  - busybox `httpd` serving mounted files on internal port `8080`
- `node`
  - Node container copies source from read-only mount
  - installs dependencies (`npm ci` or `npm install`)
  - executes `npm run <startScript>`
  - mounts per-project persistent runtime data directory (`.runtime-data`) for server-side state
  - reverse-proxied to configured internal port

Control plane still remains the only Docker API authority.

### 4) Model-backed agent generation

Replaced template-only generation with model-backed generation path using OpenAI SDK, with deterministic fallback.

Implemented in:

- `apps/agent-tester/src/project-generator.js`
- `apps/agent-tester/src/project-template.js`
- `apps/agent-tester/src/agent.js`

Behavior:

- attempts structured JSON project generation from model (`AGENT_MODEL`, default `gpt-5-codex`) when a user OpenAI credential exists
- validates output shape and node runtime requirements
- fallback for score-tracker prompts now defaults to Node + SQLite persistence
- falls back to local static template for non-score-tracker prompts
- supports deterministic runtime hints in prompt:
  - `[runtime:static]`
  - `[runtime:node]`
- sends runtime profile to control plane for matching site spawn
- no longer depends on a mandatory platform-wide OpenAI API key

## Mapping to architecture sections

### Section 4 (Agent Runtime)

Now closer to intended behavior:

- control plane message -> agent execution -> generated project artifacts -> streamed response
- model-backed generation is active (with fallback safeguard)
- score-tracker fallback now uses server-side SQLite persistence

### Section 8 (Website Hosting / Sister Containers)

Now partially covers both static and app-runtime deployment styles:

- static publishing via hardened lightweight HTTP server profile
- Node runtime publishing with constrained resources
- Caddy route creation through container labels

### Section 9 (Control Plane)

Improved authority and lifecycle controls:

- user-config-driven routing
- quota checks before site spawn
- user API auth + agent auth token validation tied to user registry
- retry-and-reason dispatch policy when agent is unavailable

### Section 12 (Data Flow)

The end-to-end path is now continuously testable through smoke automation.

## Operational commands

1. Start stack:
   - `docker compose up -d --build`
2. Send prompt:
   - `docker compose exec platform-control-plane npm run cli -- send --user tester "Build me a basketball score tracker website"`
3. Check status:
   - `docker compose exec platform-control-plane npm run cli -- status tester`
4. Clear sites:
   - `docker compose exec platform-control-plane npm run cli -- clear-sites tester`
5. OAuth status/start:
   - `docker compose exec platform-control-plane npm run cli -- oauth-status tester`
   - `docker compose exec platform-control-plane npm run cli -- oauth-start tester`
6. Run full smoke:
   - `./scripts/smoke-test.sh`
7. Run node runtime smoke:
   - `./scripts/smoke-test-node.sh`

## What remains unimplemented

1. Clerk/JWT full auth flow (Section 10).
2. Persistent memory system (`MEMORY.md`, sqlite-vec, FTS5) (Section 5).
3. LCM immutable context + compaction DAG (Section 6).
4. `unf` backup/rewind integration and restore workflow (Section 7).
5. Full monitoring stack integration (Prometheus/Grafana/Loki) (Section 11).
6. Real multi-user container lifecycle orchestration (agent start/stop policies, warm pools).
7. Strict sister-container egress firewall rules.
8. Billing/resource enforcement beyond simple active-site quota checks.
9. OAuth token refresh flow and encryption-at-rest hardening for stored credentials.

## Production path notes (Oracle Linux)

- Production should set:
  - `USER_DATA_ROOT=/data/users`
  - `USER_DATA_ROOT_HOST=/data/users`
- macOS dev requires host-visible paths (`${PWD}/data/users`) for Docker Desktop bind validation.
- Control plane design remains compatible with Oracle Linux host layout in the architecture doc.
- Added deployment assets:
  - `deploy/oracle-linux/docker-compose.oracle-linux.yml`
  - `deploy/oracle-linux/.env.example`
  - `docs/oracle-linux-staging-runbook.md`

## Relevant files

- `docker-compose.yml`
- `config/users.json`
- `apps/control-plane/src/server.js`
- `apps/control-plane/src/docker.js`
- `apps/control-plane/src/users.js`
- `apps/agent-tester/src/agent.js`
- `apps/agent-tester/src/project-generator.js`
- `apps/agent-tester/src/project-template.js`
- `scripts/smoke-test.sh`
- `scripts/smoke-test-node.sh`
- `deploy/oracle-linux/docker-compose.oracle-linux.yml`
- `docs/oracle-linux-staging-runbook.md`
- `README.md`
