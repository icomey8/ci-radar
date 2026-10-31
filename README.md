# CI Radar

CI Radar watches GitHub Actions history for the repos you point it at and ranks jobs by how
flaky they are.

This is a learning project, built to explore the GitHub API, job queues, and native UI developement.

## Running the macOS app

You'll need Docker, Node 24, pnpm, and Xcode 27 at `/Applications/Xcode.app`. Ingest also needs a
GitHub App installed on the repos you want to watch.

### First run

Install dependencies and create your `.env`, then fill in the GitHub App credentials:

```sh
pnpm install
cp .env.example .env
```

Then create the database and load some real data:

```sh
docker compose up -d
pnpm exec drizzle-kit migrate
pnpm seed
pnpm add-repo icomey8/flaky-test
pnpm backfill --repo icomey8/flaky-test --days 14
```

### Daily loop

Postgres stays up until you stop it. Run `pnpm dev` in one terminal and the app from another:

```sh
docker compose up -d
pnpm dev
macos/scripts/run.sh
```

`pnpm dev` runs `api` (the HTTP API on `localhost:8787`) and `serve` (the hourly ingest) together,
with their output prefixed `[api]` and `[serve]`. Ctrl-C stops both. Without GitHub App credentials
it warns and starts only `api`, so you can still browse existing data.

To use another port, set `API_PORT` for both commands:

```sh
API_PORT=9000 pnpm dev
API_PORT=9000 macos/scripts/run.sh
```
