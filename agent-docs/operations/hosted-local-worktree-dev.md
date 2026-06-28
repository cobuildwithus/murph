# Hosted Local Worktree Dev

Last verified: 2026-06-23

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

The harness supports most isolation knobs. A secondary worktree must set unique
ports, database URL, Wrangler persist dir, Next dist suffix, MinIO data dir,
Temporal port, generated crypto-state path, Linq registration cache, and tunnel
config together.

The root `dev` profile still owns the main checkout lane and keeps broad local
cleanup behavior. Secondary checkouts should use the `worktree` profile through
the helper below. That profile scopes runner cleanup to the slug-derived local
build id, skips broad image cleanup, keeps generated hosted-local crypto state
under the worktree's `.tmp/`, and never coordinates by symlinking
`apps/cloudflare/.dev.vars`.

## Worktree Helper

Use a short lowercase slug for the worktree, for example the branch slug:

```bash
pnpm hosted-local worktree doctor <slug>
pnpm dev:worktree <slug>
```

`pnpm dev:worktree <slug>` is an alias for:

```bash
pnpm hosted-local worktree up <slug>
```

The helper:

- validates `<slug>` as lowercase letters, digits, and hyphens
- derives deterministic local ports for web, Worker, Temporal, and MinIO from
  stable per-slug ranges; a duplicate slug must fail normal startup port checks
  instead of selecting alternate ports
- creates or verifies the slug-specific local Postgres database
- sets the worktree profile, local database URL, web/Worker ports, managed
  Temporal port, Wrangler persist dir, MinIO data dir, generated
  crypto-state path, Linq webhook registration cache path, Linq tunnel config,
  `NEXT_DIST_DIR_MODE=smoke`, and `NEXT_DIST_DIR_SUFFIX=<slug>`
- publishes the browser-facing hosted web origin as `localhost:<web-port>` by
  default, overwrites inherited remote public web origins locally, and allows
  both `localhost:<web-port>` and `127.0.0.1:<web-port>` for hosted-onboarding
  browser mutations
- preserves live Stripe support
- disables live Linq tunnel startup and webhook registration by default; a
  worktree must opt in with a dedicated public URL or tunnel config
- keeps generated local crypto state paired with the slug-specific database

Companion commands:

```bash
pnpm hosted-local worktree doctor <slug> [--json]
pnpm hosted-local worktree env <slug>
```

`doctor` applies the worktree env internally and checks the resolved non-secret
config. `env` is inspection-only: it prints the resolved exports with the
database URL redacted, so do not source it as a complete startup env.

There is intentionally no out-of-band `worktree down` lifecycle command yet.
Stop the foreground `pnpm hosted-local worktree up <slug>` process directly.
Do not kill worktree resources by port number alone; add an ownership record
before introducing a background cleanup command.

## Manual Fallback

Use a short lowercase slug for the worktree, for example the branch slug. Pick
ports that are not used by the main checkout. Use this only when the helper
cannot run and the task does not require concurrent hosted runner/container
proof beside another active `pnpm dev`.

```bash
MURPH_HOSTED_LOCAL_PROFILE=dev \
MURPH_DEV_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/murph_dev_<slug>' \
MURPH_DEV_WEB_HOST=localhost \
MURPH_DEV_WEB_PORT=3101 \
DEVICE_SYNC_PUBLIC_BASE_URL='http://localhost:3101/api/device-sync' \
HOSTED_ONBOARDING_PUBLIC_BASE_URL='http://localhost:3101' \
HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS='http://localhost:3101,http://127.0.0.1:3101' \
HOSTED_WEB_BASE_URL='http://localhost:3101' \
MURPH_DEV_WORKER_HOST=127.0.0.1 \
MURPH_DEV_WORKER_PORT=8801 \
MURPH_DEV_TEMPORAL=managed \
MURPH_DEV_TEMPORAL_PORT=7301 \
MURPH_DEV_CF_PERSIST_DIR='../.tmp/hosted-local-worktrees/<slug>/wrangler-state' \
MURPH_DEV_MINIO_DATA_DIR='.tmp/hosted-local-worktrees/<slug>/minio-r2' \
MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH='.tmp/hosted-local-worktrees/<slug>/hosted-local-crypto-state.dev.vars' \
MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE='.tmp/hosted-local-worktrees/<slug>/linq-webhook-registration.json' \
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
`worktree` profile helper.

## Auth And Secret Sources

Do not copy secret values into committed files, examples, shell history, or
assistant messages.

For browser auth, use the helper's printed `http://localhost:<web-port>` URL.
The helper overwrites Murph's local hosted-onboarding mutation origins, but it
cannot mutate Privy dashboard/app-client allowed origins. Privy checks the full
browser origin, including the port, so live Privy signup on a worktree port
requires a development app/client with no allowed-origin restriction or an
app/client whose allowed origins include the exact `http://localhost:<web-port>`
being tested. Do not use `127.0.0.1` for Privy browser testing unless that exact
origin is also configured in Privy.

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
  existing secret-safe env handoff. Set `MURPH_DEV_USE_OPENAI_API_KEY=1` to
  bypass the subscription seed and bill `OPENAI_API_KEY` for assistant turns
  instead — opt-in escape hatch for when the local Codex subscription is
  exhausted or unavailable; off by default so dev never silently re-routes to
  the API key.
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

The helper sets these defaults. Agents should keep them unless the task
explicitly requires inbound provider delivery:

```bash
MURPH_DEV_LINQ_WEBHOOK_TUNNEL=0 \
MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1
```

When live Linq delivery is required, set the local inbound phone allowlist and
use a dedicated tunnel target. Do not reuse the main checkout's tunnel name or
hostname unless its service has been intentionally repointed to this worktree.

## Implementation Notes

The implementation lives inside `packages/hosted-local-harness`; do not add a
parallel shell runner. The relevant surfaces are:

- profile defaults in `packages/hosted-local-harness/src/profiles.ts`
- config parsing in `packages/hosted-local-harness/src/dev-hosted-local/config.ts`
- runner cleanup scope in `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- local state redaction in `packages/hosted-local-harness/src/state.ts`
- Linq tunnel resolution in
  `packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts`

The helper uses small, typed primitives:

- `resolveHostedLocalWorktreeConfig({ slug, env })`
- `ensureHostedLocalWorktreeDatabase(config)`
- `MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE` config parsing instead of a
  hard-coded shared cache

Do not add a generic port manager, background daemon, or second process
supervisor. The hosted-local harness already owns process lifecycle.

## Agent Workflow

When an agent needs `pnpm dev` from a secondary worktree:

1. Run `pnpm hosted-local worktree doctor <slug>` before startup.
2. Start the stack with `pnpm dev:worktree <slug>` or
   `pnpm hosted-local worktree up <slug>`.
3. Use the manual fallback only when unique ports, database, generated crypto
   state, temp state, Wrangler state, Next dist suffix, Linq registration cache,
   and optional tunnel target are all set.
4. Never paste secret values into the chat, docs, commits, logs, or examples.
5. Stop the foreground `pnpm hosted-local worktree up <slug>` process directly
   when the proof is done or before reusing the slug for a different branch.
