# MVP Control Plane PoC Handoff

## Purpose

This document records what has been implemented, how it maps to the architecture plan, and what is intentionally unimplemented for this first proof-of-concept.

## What was implemented

### 1) Infrastructure scaffold

- Added `docker-compose.yml` with these services:
  - `platform-control-plane`
  - `agent-tester`
  - `platform-caddy`
  - `platform-monitoring`
- Added local data roots:
  - `data/users/tester/workspace/`
  - `opt/platform/monitoring/data/`

### 2) Control plane MVP

Implemented in `apps/control-plane`:

- HTTP API endpoints:
  - `GET /health`
  - `GET /api/status`
  - `POST /api/messages`
  - `POST /internal/spawn-site` (agent-only token gate)
- WebSocket endpoint:
  - `GET /agent?userId=tester&token=tester-dev-token`
- Agent routing:
  - Maintains connected agent socket map by user ID
  - Correlates request/response with request IDs and timeout
- Sister container spawn:
  - Uses Docker Engine via mounted socket
  - Starts `nginx:alpine` site containers
  - Applies Caddy labels for dynamic routing
  - Enforces per-container CPU/RAM caps for spawned site
  - Mounts generated project dir read-only into site container

### 3) Agent runtime MVP

Implemented in `apps/agent-tester`:

- Connects to control plane over WebSocket using hardcoded user/token.
- Handles incoming `user_message` events.
- Creates a score-tracker static web app in `/workspace/<slug>/`.
- Calls `POST /internal/spawn-site` on control plane.
- Returns `agent_response` with project and live URL metadata.

### 4) Control plane CLI

Implemented in `apps/control-plane/src/cli.js`:

- `status`
- `sites`
- `send "<message>"`

The CLI allows initial operation without mobile/desktop app, matching the architecture recommendation to mimic app interactions first.

## How this maps to the architecture writeup

### Section 1 / Section 9 (30,000 ft + Control Plane)

Implemented core responsibility path:

- app-like client message entry (via CLI)
- control plane routing to agent container
- control plane-managed sister container lifecycle
- Caddy route exposure

### Section 3 / Section 12 (User Journey + Full Request Data Flow)

Implemented an MVP equivalent of steps 1-9:

- input message arrives
- routed to agent
- agent writes project files
- agent requests site spawn
- control plane starts site container
- Caddy picks labels and exposes URL
- response returned to caller

### Section 8 (Website Hosting Sister Containers)

Partially implemented:

- sister container is isolated on `site-net`
- spawned by control plane only
- served through Caddy label-based routing
- read-only mount from user workspace

### Sections 5/6/7/10/11 (Memory, LCM, Backup, Auth, Monitoring)

Not implemented in this MVP, except minimal uptime container presence.

## Current known gaps / unimplemented pieces

1. Auth is hardcoded; no Clerk/JWT validation.
2. OpenAI integration is not yet active in agent execution path.
3. No memory subsystem (`MEMORY.md`, sqlite-vec, FTS5).
4. No LCM immutable log / summary DAG / compaction loop.
5. No `unf` backup and rewind integration.
6. Monitoring stack is minimal (Uptime Kuma container only, not integrated with metrics/log pipelines).
7. No per-user quotas, no multi-user container lifecycle.
8. No egress firewall policy enforcement for sister containers.
9. No persistence/cleanup policies for spawned site history beyond subdomain replacement.
10. No mobile/desktop app transport; CLI only.

## Improvement plan from here

1. Replace hardcoded auth with JWT validation and user registry.
2. Add real OpenAI-backed agent runtime for non-template generation.
3. Introduce control-plane persistence (sqlite/postgres) for session/site metadata.
4. Implement resource quota middleware on spawn requests.
5. Expand monitoring to Prometheus + Grafana + Loki and expose key metrics.
6. Introduce LCM and memory systems after control-plane flow is stable.
7. Add restore pipeline and `unf` tooling hooks once filesystem lifecycle is finalized.

## Operational notes for other agents

1. Start stack:
   - `docker compose up -d --build`
2. Use control plane CLI from inside container for stable networking:
   - `docker compose exec platform-control-plane npm run cli -- send "Build me a basketball score tracker website"`
3. Check project outputs on host:
   - `data/users/tester/workspace/`
4. Check live route:
   - URL from CLI response (served through Caddy on `:8080`)

## Relevant files

- `docker-compose.yml`
- `apps/control-plane/src/server.js`
- `apps/control-plane/src/docker.js`
- `apps/control-plane/src/cli.js`
- `apps/agent-tester/src/agent.js`
- `README.md`
