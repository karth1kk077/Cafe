# Deployment Guide

## Requirements
- Node.js 20+ (tested on 24)
- PostgreSQL 14+ (tested on 18)
- npm 10+
- (Optional) Docker + Docker Compose for a containerized Postgres

## Environment variables
Copy `.env.example` to `.env` and fill in real values. Never commit `.env`.
| Var | Purpose | Prod note |
|-----|---------|-----------|
| `DATABASE_URL` | Postgres connection string | use a managed DB / strong password |
| `JWT_SECRET` / `SESSION_SECRET` | token signing | use long random secrets (≥32 chars) |
| `COOKIE_SECURE` | Secure cookie flag | `true` in production |
| `COOKIE_SAME_SITE` | SameSite policy | `none` if cross-site + HTTPS, else `lax` |
| `WEB_ORIGIN` | CORS origin | your real frontend origin |
| `API_PORT` | API port | 4000 default |
| `TAX`/currency | via Settings table | configure in admin UI |

## Local development
```bash
npm install
# Start Postgres (Docker) or use a local install:
docker compose up -d postgres
# or point DATABASE_URL at your own Postgres

cp .env.example .env
npm run db:generate          # prisma generate
npm run db:migrate -- --name init   # create schema (dev)
npm run db:seed              # sample café + staff + tables + menu

# Terminal 1 — API
npm run dev:api              # http://localhost:4000

# Terminal 2 — Web
npm run dev:web              # http://localhost:5173 (proxies /api + socket to :4000)
```
Seeded logins (password `Password123!`): `admin@cafe.local`, `waiter@cafe.local`, `chef@cafe.local`.
The seed prints each table's QR route `/t/<qrToken>`.

## Docker Compose
`docker-compose.yml` runs PostgreSQL with a healthcheck and a named volume. Extend with
`Dockerfile.api` / `Dockerfile.web` (see `docker/`) to containerize the apps for production.

## Production build
```bash
npm run build                 # builds shared, api, web
node apps/api/dist/index.js   # run API
# serve apps/web/dist via a static host or the reverse proxy
```

## HTTPS & reverse proxy (nginx example)
Terminate TLS at nginx and proxy to the API; enable WebSocket upgrade for Socket.IO:
```nginx
server {
  listen 443 ssl;
  server_name cafe.example.com;
  # ssl_certificate ...; ssl_certificate_key ...;

  location /api/ { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; }
  location /socket.io/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
  location / { root /var/www/cafe/web; try_files $uri /index.html; }
}
```
Set `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none` (cross-site) or `lax` (same-site),
`WEB_ORIGIN=https://cafe.example.com`, and strong secrets.

## Migrations
- Dev: `npm run db:migrate -- --name <name>`
- Prod: `npx prisma migrate deploy --schema prisma/schema.prisma` (applies committed migrations
  without prompting). Run before releasing a new version.

## Backups & restore
```bash
pg_dump -Fc cafe_db -f backup.dump
pg_restore --clean --if-exists -d cafe_db backup.dump
```
Schedule regular backups; test restores periodically. For managed Postgres use the provider's
point-in-time recovery.

## Health checks & logging
- Liveness: `GET /api/health` → `{status:"ok"}`
- Readiness: `GET /api/ready` → `{status:"ready",database:"up"}`
- Logs: structured JSON in production via Winston (secrets redacted).

## Troubleshooting
- `Invalid environment configuration` → missing/short secrets in `.env`.
- `P1017` / connection errors → Postgres not running or wrong `DATABASE_URL`.
- Socket not connecting in prod → proxy missing WebSocket upgrade headers.
- Orders rejected with `SESSION_CLOSED` → table has no ACTIVE session (open it in the waiter
  dashboard); this is expected behavior, not a bug.
