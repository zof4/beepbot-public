# Oracle Linux Staging Runbook

This runbook deploys the current MVP stack on an Oracle Linux host using the target host layout from the architecture plan.

## 1) Host prerequisites

1. Docker Engine + Docker Compose plugin installed.
2. DNS wildcard configured to this host for your staging domain.
3. Firewall open for ports 80, 443, 3001, 3002 (or your chosen bindings).

## 2) Host directories

```bash
sudo mkdir -p /opt/platform/config
sudo mkdir -p /opt/platform/monitoring/data
sudo mkdir -p /data/users/tester/workspace
```

Place the user registry at:

- `/opt/platform/config/users.json`

Use this starter content and adjust tokens/users as needed:

```json
{
  "users": [
    {
      "id": "tester",
      "userToken": "tester-app-token",
      "agentToken": "tester-dev-token",
      "quotas": {
        "maxActiveSites": 3,
        "dailyTokenLimit": 1000000
      }
    }
  ]
}
```

## 3) Environment file

1. Copy `deploy/oracle-linux/.env.example` to `deploy/oracle-linux/.env`.
2. Set real values for:
   - `SISTER_DOMAIN_SUFFIX`
   - `CADDY_SITE_SCHEME` (`https` for real domain/TLS, `http` for local-only staging)
   - `CLI_USER_TOKEN` (must match `users.json -> userToken` for CLI/API calls)
   - `AGENT_DISPATCH_RETRY_DELAYS_MS` (optional; defaults to `0,2000,6000,15000,30000`)
   - any bind port overrides

OpenAI OAuth configuration (required to enable user-connected model generation):

- `OPENAI_OAUTH_AUTHORIZATION_URL`
- `OPENAI_OAUTH_TOKEN_URL`
- `OPENAI_OAUTH_CLIENT_ID`
- `OPENAI_OAUTH_CLIENT_SECRET` (if required by your OpenAI OAuth app type)
- `OPENAI_OAUTH_REDIRECT_URI` (must point to `https://<control-plane-domain>/auth/openai/callback`)
- `OPENAI_OAUTH_SCOPES`

## 4) Start stack

From repo root:

```bash
docker compose \
  -f docker-compose.yml \
  -f deploy/oracle-linux/docker-compose.oracle-linux.yml \
  --env-file deploy/oracle-linux/.env \
  up -d --build
```

## 5) Validate

```bash
curl http://localhost:3001/health
docker compose exec platform-control-plane npm run cli -- status tester
docker compose exec platform-control-plane npm run cli -- send --user tester "Build me a basketball score tracker website"
docker compose exec platform-control-plane npm run cli -- oauth-status tester
docker compose exec platform-control-plane npm run cli -- oauth-start tester
```

Then open the returned URL:

- `http://<subdomain>.<SISTER_DOMAIN_SUFFIX>`

Optional API auth check:

```bash
curl -H 'x-user-token: tester-app-token' \
  'http://localhost:3001/api/status?userId=tester'
```

Connect OpenAI account manually:

1. Run `npm run cli -- oauth-start tester`.
2. Open `authorizationUrl` in browser and complete consent.
3. Ensure callback returns `OpenAI account connected for user tester`.

## 6) Stop stack

```bash
docker compose \
  -f docker-compose.yml \
  -f deploy/oracle-linux/docker-compose.oracle-linux.yml \
  --env-file deploy/oracle-linux/.env \
  down
```
