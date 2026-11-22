# STORVA — setup summary (updated 2026-11-18)

This replaces the original export notes. Details live in:
- [docs/INSTALL_DEPLOY.md](docs/INSTALL_DEPLOY.md) — install, database, deploy
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — environment variables and their status
- [docs/TESTING.md](docs/TESTING.md) — tests

## Contents
- `src/` — full app source (pages, components, server functions, webhooks, tests)
- `drizzle/migrations/` — the migrations applied to the current backend (`0000` base schema + plans, `0001` modules 7–15)
- `database/schema.legacy.sql`, `database/legacy-migrations/` — the original export, kept unchanged for reference
- `e2e/` — browser journey test
- `.env.example` — template; no `.env` and no secret values are shipped

## Run locally
```sh
bun install      # or: npm install
bun run dev      # or: npm run dev
bun run test     # all Vitest suites
```
