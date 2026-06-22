<img src="docs/assets/readme-hero.jpg" alt="Murph hero" width="1200" height="685">

# Murph 🌙

Murph is the experiment layer for personal health.

It helps people run bounded protocols, measure what changed, and, when they choose, contribute structured outcomes to a living Health Commons. The assistant is the interface into that loop, not the whole category by itself.

Underneath that product loop, Murph keeps durable human-reviewed truth in Markdown, append-only machine event ledgers in JSONL, and layers a typed CLI, local daemons, and hosted control/execution surfaces on top of that vault.

The main installable product entrypoint is `@murphai/murph`, which gives you the `murph` command.

## What ships here

- a file-native vault with canonical writes owned by `packages/core`
- the installable `@murphai/murph` package, which provides the `murph` CLI and onboarding flow
- provider-backed local assistant chat and automation, with runtime state under `vault/.runtime/operations/assistant/**`
- a public Health Commons in `packages/health-commons` for protocol pages, biomarker pages, source pages, exact revisions, and generated outcome summaries
- a two-layer knowledge system: stable health reference pages under `bank/library/**` plus a non-canonical compiled personal wiki under `derived/knowledge/**`, synthesized by the active assistant, persisted through shared assistant/CLI write surfaces, searchable locally, and kept rebuildable
- inbox capture, assistant attachment evidence, and parser-driven audio/video transcription
- local wearable/device sync through the workspace-private `packages/device-syncd` runtime bundled into `@murphai/murph`
- a hosted Next.js integration control plane in `apps/web`
- a hosted Cloudflare execution plane in `apps/cloudflare`
- a private hosted Temporal worker in `packages/hosted-orchestrator-temporal`,
  with a root Render Background Worker Blueprint for production orchestration
- shared hosted execution contracts and env/client helpers in `@murphai/hosted-execution`
- workspace-private headless owner/runtime packages such as `@murphai/assistant-engine`, `@murphai/operator-config`, `@murphai/assistant-runtime`, and `@murphai/assistantd`, plus the public contract package `@murphai/gateway-core`

## Install

Runtime: Node `>= 24.14.1`.

Preferred install for most users:

```bash
npm install -g @murphai/murph@latest
# or
pnpm add -g @murphai/murph@latest

murph onboard
```

`@murphai/murph` is the full local Murph package. The repo keeps many internal workspace packages, but the public npm surface is intentionally narrow: `@murphai/murph`, `@murphai/openclaw-plugin`, `@murphai/contracts`, `@murphai/hosted-execution`, and `@murphai/gateway-core`. The remaining owner packages stay workspace-private and are bundled into those public tarballs only when a public package still needs them at runtime.

`murph` is the simple product entrypoint: it operates on one active vault at a time, selected during onboarding or later with `murph use <path>`. The lower-level `vault-cli` binary remains the raw explicit-vault surface for development, automation, and other contract-level consumers.

## OpenClaw integration

If you already use OpenClaw, install the first-party Murph OpenClaw bundle after onboarding:

```bash
openclaw plugins install @murphai/openclaw-plugin
openclaw gateway restart
```

That bundle intentionally stays vault-first. It ships a Murph skill that teaches OpenClaw to use the existing `vault-cli` surface against your configured Murph vault through OpenClaw's built-in `exec` tool, rather than creating a second Murph assistant runtime inside OpenClaw.

## From this repo

Supported host setup path: macOS and Linux.

Preferred setup from a checkout:

```bash
pnpm onboard --vault ./vault
```

`pnpm onboard` is the repo-local install and onboarding entrypoint. It sets up the host wrapper, installs or reuses local dependencies, builds the workspace, initializes the target vault, saves that vault as the default CLI vault, installs `murph` and `vault-cli` shims for future shells, and hands off to the interactive onboarding flow for assistant defaults, channels, and optional wearable setup.

If `pnpm` is not available yet, use:

```bash
./scripts/setup-host.sh --vault ./vault
```

`pnpm onboard` is the only supported repo-local onboarding command. `pnpm` reserves `setup` as a built-in command, so this repo no longer exposes a root `setup` script.

Direct dependency installs and review flows should prefer `corepack pnpm ...` so the exact pnpm version pinned in `package.json#packageManager` is used automatically.
After intentional dependency refreshes on a trusted machine, review blocked install scripts with `corepack pnpm deps:ignored-builds` and record any required approvals with `corepack pnpm deps:approve-builds`.

## Quick start

Installed package:

```bash
murph onboard
murph use ./vault
murph model
murph chat
murph run
```

Use `murph model` any time after onboarding to reopen the assistant model/provider picker and switch the saved default model without rerunning the full setup flow.

From this repo:

```bash
pnpm onboard --vault ./vault
vault-cli vault stats
```

## Mental model

Murph is opinionated about storage boundaries:

- Markdown is the human-facing source of truth for durable documents such as `CORE.md`, journals, memory, goals, conditions, protocols, registries, and the derived personal wiki.
- JSONL ledgers are the machine-facing source of truth for append-only records such as events, samples, assessments, and audit entries.
- Blood tests remain user-facing reads over canonical `kind: "test"` event-ledger records; they do not introduce a second storage family.
- Imported source artifacts are copied into `raw/**` and treated as immutable.
- Derived parser output and compiled knowledge pages live under `derived/**` and stay rebuildable. For the knowledge wiki specifically, `derived/knowledge/index.md` is the content catalog, `derived/knowledge/log.md` is the append-only write log, and `derived/knowledge/pages/*.md` are the assistant-authored personal synthesis pages.
- Local machine state lives under `.runtime/**`, with durable non-canonical operational state in `.runtime/operations/**`, rebuildable projections in `.runtime/projections/**`, and ephemeral scratch state in `.runtime/cache/**` plus `.runtime/tmp/**`.
- Assistant transcripts, metadata, receipts, outbox state, and related execution residue live under `vault/.runtime/operations/assistant/**`; durable user-facing `memory` and `automation` are canonical vault records.
- If a datum is user-facing, queryable, or a future product building block, it does not belong in assistant runtime first. Treat assistant runtime as execution residue, not as a staging area for product state.

The result is a system you can inspect with normal filesystem tools while still keeping write paths disciplined.

## Repo structure

Only five packages are published to npm: `@murphai/murph`, `@murphai/openclaw-plugin`, `@murphai/contracts`, `@murphai/hosted-execution`, and `@murphai/gateway-core`. The remaining `packages/*` entries are workspace-private owner packages that stay installable from a checkout and can be bundled into public tarballs, but they are not intended to be consumed as standalone npm products.

| Path                         | Responsibility                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts`         | Canonical Zod contracts, types, examples, and generated JSON Schema artifacts.                                                             |
| `packages/hosted-execution`  | Shared hosted mailbox, workspace checkpoint, runtime log/status, Temporal processing, and auth contracts for the hosted `apps/web` control plane and Cloudflare worker. |
| `packages/hosted-orchestrator-temporal` | Workspace-private Temporal worker package for pointer-only hosted runtime orchestration. |
| `packages/runtime-state`     | Workspace-private shared local-state taxonomy, `.runtime` path resolution, JSON-state versioning, and SQLite schema-version helpers.       |
| `packages/core`              | Workspace-private canonical mutation owner. No other package may write canonical vault data directly.                                      |
| `packages/importers`         | Workspace-private external adapters that normalize inputs and delegate writes to `core`.                                                   |
| `packages/inboxd`            | Workspace-private inbox capture, canonical evidence persistence, runtime indexing, and attachment parse-job orchestration.                 |
| `packages/parsers`           | Workspace-private local-first attachment parsing and derived artifact publication.                                                         |
| `packages/query`             | Workspace-private read helpers, summaries, list/search helpers, export-pack generation, and derived-knowledge parser/search/index helpers. |
| `packages/health-commons`    | Workspace-private public Health Commons owner for protocol pages, biomarker pages, sources, generated catalogs, and aggregate outcome summaries. |
| `packages/device-syncd`      | Workspace-private local wearable/device OAuth, webhook, and reconcile daemon.                                                              |
| `packages/assistant-engine`  | Workspace-private headless assistant execution/runtime owner.                                                                              |
| `packages/operator-config`   | Workspace-private operator config, setup/runtime-env, and hosted assistant config owner.                                                   |
| `packages/assistant-cli`     | Workspace-private CLI-only assistant wrappers, commands, terminal logging, and Ink chat UI.                                                |
| `packages/setup-cli`         | Workspace-private CLI-only onboarding, host setup, and setup-wizard package.                                                               |
| `packages/gateway-core`      | Headless transport-neutral gateway boundary.                                                                                               |
| `packages/assistant-runtime` | Workspace-private headless hosted execution surface used by Cloudflare runner paths.                                                       |
| `packages/assistantd`        | Workspace-private local assistant daemon with a loopback-only bearer-authenticated control plane.                                          |
| `packages/cli`               | The published `@murphai/murph` package, exposing the `murph` / `vault-cli` binaries and the main operator surface.                         |
| `packages/openclaw-plugin`   | The published OpenClaw-compatible bundle that teaches OpenClaw to use `vault-cli` directly against the configured Murph vault.             |
| `apps/web`                   | Hosted Next.js control plane for onboarding, billing, OAuth, webhooks, encrypted mailbox intake, workspace checkpoints, and hosted runtime status/logs. |
| `apps/cloudflare`            | Thin hosted runner for signed Temporal processing requests, status, per-user coordination, encrypted hosted bundles, and container-backed workspace runtime passes. |
| `fixtures` and `e2e`         | Deterministic fixtures and smoke coverage.                                                                                                 |

## Local and hosted surfaces

Murph now has three distinct runtime tiers:

### 1. Local operator surface

- `vault-cli` / `murph` for vault operations, assistant chat, automation, onboarding, and diagnostics
- the workspace-private `packages/device-syncd` runtime for local wearable sync
- the workspace-private `packages/assistantd` daemon for the local assistant control plane

### 2. Hosted control plane

- `apps/web` owns hosted onboarding, billing, OAuth callbacks, webhook intake, device-sync control-plane metadata, sparse routing state, encrypted hosted mailbox rows, workspace checkpoint metadata, and hosted runtime status/logs
- it does not own canonical health data
- webhook and app paths append durable mailbox facts and signal Temporal only; they do not directly nudge a user runner in Cloudflare

### 3. Hosted execution plane

- `apps/cloudflare` restores encrypted hosted bundles, coordinates per-user runtime passes, keeps only DO-local runner coordination state, and invokes the workspace-private `@murphai/assistant-runtime` package against web-owned mailbox/checkpoint/log ports
- `packages/hosted-orchestrator-temporal` runs the per-user Temporal workflow worker that reads web-owned reconciliation facts, calls Cloudflare `ensure-processing`, and stores only pointer-level orchestration state
- Cloudflare returns `runtime_processing_accepted` or `retry_later` and owns start, wake, active-fence alarm cleanup, and execution cleanup for the active runner through `ensure-processing`
- the hosted execution plane is intentionally separate from the public hosted web app

## CLI surface

The root CLI is no longer just a vault editor. The built command surface includes:

- health-vault operations such as `init`, `show`, `list`, `timeline`, `journal`, `document`, `meal`, `samples`, `audit`, `vault`, and the health registry commands
- `assistant` for local chat, status, outbox, cron, automation, and provider-backed runtime control
- `device` for local wearable/device auth, status, and daemon control
- env-gated route estimation through `vault-cli route estimate`, which uses temporary Mapbox geocoding and Search Box lookups for distance, duration, hiking POIs, and optional approximate elevation between two points without persisting the route payload in Murph state
- root shortcuts such as `chat`, `run`, `status`, `doctor`, and `stop`
- AI-assisted synthesis helpers such as `knowledge`

The `knowledge` surface is intentionally narrow: use it to persist pages, inspect saved pages, lint the wiki, rebuild the index, and tail the append-only wiki log. The assistant's wiki-maintainer workflow itself lives in the runtime prompt plus the dedicated `assistant.knowledge.*` tools, not in repo `AGENTS.md`.

For operator UX, prefer `murph`. It resolves one active vault and no longer expects ad hoc `--vault` switching on normal commands. Use `murph use <path>` to select a different existing vault, or `murph onboard --vault <path>` to create/select one during setup. Use `vault-cli` when you intentionally need the raw explicit-vault contract.

### Choosing a read command

- Use `vault-cli show <id>` when you already know one exact query-layer record id to inspect.
- Use `vault-cli list` when you need structured filtering by family, kind, status, stream, tag, or date range.
- Use `vault-cli search query --text "..."` when the target is fuzzy, remembered by phrase, or buried across notes and record bodies.
- Use `vault-cli timeline` when the question is chronological: what changed, what happened over a window, or what stood out over time.
- Use `vault-cli memory show`, targeted `vault-cli knowledge ...` reads, and the relevant preferences surface when you need the user's saved current-state context.
- Use `vault-cli wearables day` or the `wearables ... list` commands for semantic wearable summaries before drilling into raw events or samples.
- Use family `manifest` commands such as `meal manifest`, `document manifest`, `intake manifest`, and `workout manifest` when you need immutable import provenance or raw-source context.

Quick help:

```bash
pnpm exec tsx packages/cli/src/bin.ts --help
```

## Common workflows

### Operator flows

```bash
pnpm onboard --vault ./vault
murph use ./vault
pnpm chat
murph run
murph device daemon start
```

### Developer flows

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm verify:acceptance
pnpm --dir apps/cloudflare verify
```

`pnpm dev` is the repo-root local hosted lane. It pulls the linked Vercel development env for `apps/web`, runs hosted-web Prisma generate plus local schema sync, and starts both `apps/web` and the local Cloudflare worker together. One-time local prerequisites:

- either `cd apps/web && vercel link` or run `vercel link --repo` from the repo root
- log into Vercel CLI and enable project OIDC for the linked web project
- optional: copy `apps/cloudflare/.dev.vars.example` to `apps/cloudflare/.dev.vars` when you want to pin local Worker secrets or add provider-specific Worker vars; otherwise `pnpm dev` uses Wrangler's documented local process-env path for required Worker secrets and CLI `--var` overrides for local non-secret vars
- run local Postgres on `127.0.0.1:5432`; by default `pnpm dev` ignores a pulled Vercel `DATABASE_URL` and uses the `murph_device_sync` database there
- treat `127.0.0.1:5432/murph_device_sync` as the canonical local hosted debugging database for local Docker runs, including hosted runtime logs and AI usage rows
- install or check the Temporal CLI with `pnpm temporal:cli:setup` or `pnpm temporal:cli:check`; `pnpm dev` and hosted-local E2E manage the local Temporal dev server and worker automatically. The managed dev server exposes the Temporal Web UI at `http://127.0.0.1:8233` by default, or at `MURPH_DEV_TEMPORAL_PORT + 1000` when the Temporal frontend port is overridden. Set `TEMPORAL_DEV_HEADLESS=1` only when you intentionally want no dashboard.
- optional: set `MURPH_DEV_DATABASE_URL` or shell `DATABASE_URL` for a different local database; set `MURPH_DEV_USE_VERCEL_DATABASE_URL=1` only when you intentionally want the pulled Vercel development database
- keep the linked Vercel development env populated with the real hosted signup secrets you need locally, such as Privy credentials
- optional: put local-only Stripe test checkout values in `.tmp/.env.hosted-local-stripe`; root `pnpm dev` loads that file after the Vercel env pull and before shell env overrides, so local `sk_test_...` and `price_...` values can override shared Development env without being committed
- optional: install the [Stripe CLI](https://docs.stripe.com/stripe-cli) (`brew install stripe/stripe-cli/stripe`) and run `stripe login` once. `pnpm dev` then auto-launches `stripe listen` for hosted onboarding webhooks and captures the per-developer `whsec_...` signing secret from the listener's startup output into the web child's env. Set `MURPH_DEV_SKIP_STRIPE_LISTEN=1` to opt out; see `apps/web/README.md` for the full contract.
- optional: for live local Linq webhook delivery, keep `LINQ_API_TOKEN` and `LINQ_WEBHOOK_SECRET` in local env and either set `MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL` to an HTTPS tunnel origin/webhook URL or keep a repo-local `cloudflared` config at `.tmp/cloudflared-linq-webhook.yml`. When those are present, `pnpm dev` starts `cloudflared tunnel --config ... run dev`, sets hosted onboarding public links to the tunnel origin, and registers `message.received` against `/api/hosted-onboarding/linq/webhook`. Successful registrations are cached under `.tmp/` to avoid duplicate creates on repeated starts; remove that cache to force a fresh registration. Set `MURPH_DEV_LINQ_WEBHOOK_TUNNEL=0` to disable this path or `MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1` to skip Linq API registration.

Repeatable launcher sanity check:

```bash
NEXT_DIST_DIR_MODE=smoke MURPH_DEV_WEB_PORT=3013 MURPH_DEV_WORKER_PORT=8793 pnpm dev
```

That variant keeps the check off the default `apps/web/.next-dev` lock and default localhost ports while still exercising the same root launcher, Vercel env pull, Prisma setup, and Wrangler/Containers startup path.

Startup readiness also POSTs the internal deploy-smoke route with `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`, so `pnpm dev` proves the local Worker can boot the runner container and observe the prepared runner bundle before printing ready. Set `MURPH_DEV_SKIP_RUNNER_SMOKE=1` for a focused Worker-only debugging loop.

For secondary worktrees, do not rely on ports alone. Use the hosted-local
worktree helper so the database, generated local crypto state, Wrangler state,
Next dist dir, optional MinIO data, and webhook tunnel target are isolated
together:

```bash
pnpm hosted-local worktree doctor <slug>
pnpm dev:worktree <slug>
pnpm hosted-local worktree down <slug>
```

See `agent-docs/operations/hosted-local-worktree-dev.md` for the full contract
and manual fallback.

The repo verification baseline for docs/process-only and ordinary repo work remains:

```bash
pnpm typecheck
pnpm test
pnpm verify:acceptance
```

## Development notes

- Root workspace scripts live in [`package.json`](package.json).
- The release source of truth is [`scripts/release-manifest.json`](scripts/release-manifest.json).
- The Cloudflare deployment path is documented in [`apps/cloudflare/DEPLOY.md`](apps/cloudflare/DEPLOY.md).
- Package-local operational details live in each package `README.md`.

## License

Murph is licensed under Apache-2.0. The published `@murphai/*` packages now carry Apache 2.0 metadata and include a copy of the license text in their package contents. See [`LICENSE`](LICENSE) for the full terms.

## Read next

- [`ARCHITECTURE.md`](ARCHITECTURE.md) for the top-level system map and trust boundaries
- [`docs/architecture.md`](docs/architecture.md) for the one-page architecture summary
- [`docs/device-provider-contribution-kit.md`](docs/device-provider-contribution-kit.md) for the wearable-provider contribution guide, compatibility matrix, and scaffolds
- [`packages/cli/README.md`](packages/cli/README.md) for the CLI package and release flow
- [`apps/web/README.md`](apps/web/README.md) for the hosted control plane
- [`apps/cloudflare/README.md`](apps/cloudflare/README.md) for the hosted execution plane
