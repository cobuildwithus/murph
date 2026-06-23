# Hosted Local Worktree Dev

Last verified: 2026-06-22

## Purpose

This doc specifies how agents should run the hosted-local `pnpm dev` stack from
a secondary git worktree without colliding with the main checkout's local hosted
stack.

The target is not a second bespoke dev runner. The target is one namespaced
hosted-local profile layered on the existing `pnpm hosted-local up` harness.

## Current Shape

`pnpm dev` is `pnpm hosted-local up --profile dev`. It starts:

- hosted web on `MURPH_DEV_WEB_HOST` / `MURPH_DEV_WEB_PORT`
- local Cloudflare Worker/Containers on `MURPH_DEV_WORKER_HOST` /
  `MURPH_DEV_WORKER_PORT`
- managed or reused Temporal based on `MURPH_DEV_TEMPORAL` and
  `MURPH_DEV_TEMPORAL_PORT`
- optional MinIO R2 sidecar when `MURPH_HOSTED_LOCAL_PROFILE=dev`
- optional Stripe listener
- optional Linq cloudflared tunnel and webhook registration

The harness already supports most isolation knobs. A secondary worktree can set
unique ports, database URL, temp dir, Wrangler persist dir, Next dist suffix,
MinIO data dir, Temporal port, and tunnel config.

Two gaps remain for truly concurrent full stacks:

1. The current `dev` profile uses broad local runner container/image cleanup.
   Starting or stopping a second full runner stack can disturb the first stack's
   runner containers.
2. The current non-E2E path may temporarily symlink `apps/cloudflare/.dev.vars`
   to a generated per-run file. That is local-only, but it is still a global file
   inside that checkout and is not a good multi-worktree coordination primitive.

Until the worktree profile below exists, use the manual profile for web/control
plane debugging and avoid concurrent full runner-container testing beside an
active main `pnpm dev`.

## Manual Profile Today

Use a short lowercase slug for the worktree, for example the branch slug. Pick
ports that are not used by the main checkout.

```bash
MURPH_HOSTED_LOCAL_PROFILE=dev \
MURPH_DEV_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_<slug>' \
MURPH_DEV_WEB_PORT=3101 \
MURPH_DEV_WORKER_PORT=8801 \
MURPH_DEV_TEMPORAL=managed \
MURPH_DEV_TEMPORAL_PORT=7301 \
MURPH_DEV_TEMP_DIR='.tmp/hosted-local-worktrees/<slug>/temp' \
MURPH_DEV_CF_PERSIST_DIR='../.tmp/hosted-local-worktrees/<slug>/wrangler-state' \
MURPH_DEV_MINIO_DATA_DIR='.tmp/hosted-local-worktrees/<slug>/minio-r2' \
MURPH_DEV_LINQ_WEBHOOK_TUNNEL=0 \
MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1 \
NEXT_DIST_DIR_MODE=smoke \
NEXT_DIST_DIR_SUFFIX='<slug>' \
pnpm hosted-local up --profile dev
```

Rules for this manual profile:

- Create the local database named in `MURPH_DEV_DATABASE_URL` before startup, or
  let a local Postgres admin command create it. Do not point a worktree at the
  main checkout's `murph_device_sync` database unless it also uses the same local
  hosted crypto state.
- Keep `.tmp/hosted-local-dev-crypto-state.dev.vars` worktree-local. It is
  generated local secret material and must stay paired with that worktree's local
  database.
- `MURPH_DEV_CF_PERSIST_DIR` is interpreted by Wrangler from `apps/cloudflare`,
  so use `../.tmp/...` when the intended storage is under the repo-root `.tmp/`.
- Run `pnpm hosted-local doctor --profile dev` with the same env to confirm the
  resolved web and worker URLs before startup.
- Keep `MURPH_DEV_REUSE_EXISTING_WORKER` unset for a secondary full stack.

For frontend-only work where the Worker/runner is not needed, prefer the
app-local web command with the same port/dist isolation:

```bash
cd apps/web
NEXT_DIST_DIR_MODE=smoke NEXT_DIST_DIR_SUFFIX='<slug>' \
pnpm dev -- --hostname 127.0.0.1 --port 3101
```

For hosted runner/container proof, stop the main stack or wait for the
`worktree` profile below.

## Auth And Secret Sources

Do not copy secret values into committed files, examples, shell history, or
assistant messages.

Worktree-local startup should get authority from the same existing sources as
the main checkout:

- Vercel project metadata: run `vercel link --repo` in the worktree, or copy only
  ignored Vercel link metadata from a trusted local checkout. The Vercel CLI
  login and OIDC token generation remain CLI-owned.
- Vercel development env: let the harness run `vercel env pull`. Use
  `MURPH_DEV_SKIP_VERCEL_PULL=1` only when the shell already has every required
  hosted env var.
- Codex subscription auth: let the harness read the normal local Codex auth
  location. The helper must never print or persist token JSON outside its
  existing secret-safe env handoff.
- Stripe: rely on the local Stripe CLI login and the harness-managed
  `stripe listen` child. A worktree with a unique web port gets its own forward
  target.
- Cloudflare Workers AI: rely on `wrangler login`, or set
  `MURPH_DEV_SKIP_WORKERS_AI=1` when transcription is not under test.
- Local `.env`, `apps/web/.env`, and `apps/web/.env.local` files remain ignored
  secret inputs. If a temporary worktree needs them, copy or symlink them only as
  local ignored files and never commit the link or file.

## Webhook Tunnels

Linq webhook testing needs a tunnel that routes to the worktree web port, not
the main checkout's web port.

Use one of these:

- Set `MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL` to a dedicated HTTPS tunnel origin or
  full `/api/hosted-onboarding/linq/webhook` URL for this worktree.
- Or set `MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG` to a worktree-local
  `.tmp/cloudflared-linq-webhook.<slug>.yml` whose ingress service targets the
  worktree web port.

Agents should keep live Linq registration disabled unless the task explicitly
requires inbound provider delivery:

```bash
MURPH_DEV_LINQ_WEBHOOK_TUNNEL=0 \
MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1
```

When live Linq delivery is required, set the local inbound phone allowlist and
use a dedicated tunnel target. Do not reuse the main checkout's tunnel hostname
unless its service has been intentionally repointed to this worktree.

## Proposed Helper

Add one first-class command:

```bash
pnpm hosted-local worktree up <slug>
```

`pnpm dev:worktree <slug>` may be a package-script alias for that command.

The command should:

- validate `<slug>` as lowercase letters, digits, and hyphens
- derive and probe unique local ports for web, Worker, Temporal, and optional
  MinIO from a stable per-slug range
- derive a local database name from the slug and fail with a clear message when
  the database does not exist or cannot be created
- set `MURPH_DEV_DATABASE_URL`, `MURPH_DEV_WEB_PORT`,
  `MURPH_DEV_WORKER_PORT`, `MURPH_DEV_TEMPORAL=managed`,
  `MURPH_DEV_TEMPORAL_PORT`, `MURPH_DEV_TEMP_DIR`,
  `MURPH_DEV_CF_PERSIST_DIR`, `MURPH_DEV_MINIO_DATA_DIR`,
  `NEXT_DIST_DIR_MODE=smoke`, and `NEXT_DIST_DIR_SUFFIX`
- create a worktree-local state manifest under
  `.tmp/hosted-local-worktrees/<slug>/manifest.json`
- keep generated hosted-local crypto state in the worktree and require a paired
  worktree-local database
- add a hosted-local `worktree` profile whose runner cleanup scope is
  current-build only, whose image cleanup does not remove unrelated running
  dev images, and whose startup never symlinks `apps/cloudflare/.dev.vars`
- preserve live Stripe and Linq support; E2E isolation is not enough because it
  intentionally disables those surfaces
- write a worktree-local Linq webhook registration cache instead of the shared
  `.tmp/linq-webhook-registration.json`
- print only URLs, ports, profile name, and state paths with repo/home paths
  redacted through the existing hosted-local state redactor

Add companion commands:

```bash
pnpm hosted-local worktree doctor <slug>
pnpm hosted-local worktree env <slug>
pnpm hosted-local worktree down <slug>
```

`doctor` should show the resolved non-secret config and port availability.
`env` should print `KEY=value` exports for humans and agents to inspect without
revealing secret values. `down` should stop only the processes and containers
whose manifest/build id matches that slug.

## Implementation Notes

Keep the implementation inside `packages/hosted-local-harness`; do not add a
parallel shell runner. The relevant seams already exist:

- profile defaults in `packages/hosted-local-harness/src/profiles.ts`
- config parsing in `packages/hosted-local-harness/src/dev-hosted-local/config.ts`
- runner cleanup scope in `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- local state redaction in `packages/hosted-local-harness/src/state.ts`
- Linq tunnel resolution in
  `packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts`

The helper should add small, typed primitives:

- `deriveHostedLocalWorktreeConfig(slug, env)`
- `writeHostedLocalWorktreeManifest(config)`
- `applyHostedLocalWorktreeProfile(config, env)`
- `resolveLinqWebhookRegistrationCachePath(env)` exposed through config instead
  of a hard-coded shared cache

Do not add a generic port manager, background daemon, or second process
supervisor. The hosted-local harness already owns process lifecycle.

## Agent Workflow

When an agent needs `pnpm dev` from a secondary worktree:

1. Prefer the future `pnpm hosted-local worktree up <slug>` helper once it
   exists.
2. Until then, use the manual profile above only when unique ports, database,
   temp state, Wrangler state, Next dist suffix, and optional tunnel target are
   all set.
3. Run `pnpm hosted-local doctor --profile dev` with the same env before
   startup.
4. Never paste secret values into the chat, docs, commits, logs, or examples.
5. Stop the worktree stack before running full hosted runner/container proof in
   another checkout.
