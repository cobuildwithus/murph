# Murph 🫀

Murph is your personal health assistant.

Think OpenClaw, but built specifically to help you live longer and healthier.

Underneath that assistant, Murph keeps durable human-reviewed truth in Markdown, append-only machine history in JSONL, and layers a typed CLI, local daemons, a local read-only web app, and hosted control/execution surfaces on top of that vault.

## What ships here

- a file-native vault with canonical writes owned by `packages/core`
- a typed CLI and onboarding flow in `packages/cli`
- provider-backed local assistant chat and automation, with runtime state in sibling `assistant-state/**`
- inbox capture, indexing, and parser-driven attachment extraction
- local wearable/device sync through `@murphai/device-syncd`
- a local read-only observability app in `packages/local-web`
- a hosted Next.js integration control plane in `apps/web`
- a hosted Cloudflare execution plane in `apps/cloudflare`
- shared hosted execution contracts and env/client helpers in `@murphai/hosted-execution`
- headless package boundaries plus the explicit local gateway runtime package: `@murphai/assistant-core`, `@murphai/gateway-core`, `@murphai/gateway-local`, `@murphai/assistant-runtime`, and `@murphai/assistantd`

## Recommended setup

Runtime: Node `>= 22.16.0`.

Supported host setup path: macOS and Linux. iMessage remains macOS-only.

Preferred setup from this repo:

```bash
pnpm onboard --vault ./vault
```

`pnpm onboard` is the repo-local install and onboarding entrypoint. It bootstraps the host wrapper, installs or reuses local dependencies, builds the workspace, initializes the target vault, saves that vault as the default CLI vault, installs `murph` and `vault-cli` shims for future shells, and hands off to the interactive onboarding flow for assistant defaults, channels, and optional wearable setup.

If `pnpm` is not available yet, use:

```bash
./scripts/setup-host.sh --vault ./vault
```

The repo already carries a fixed-version monorepo release flow for the publishable package set, but until a public release is actually cut the recommended install path remains "run from this checkout".

`pnpm onboard` is the only supported repo-local onboarding command. `pnpm` reserves `setup` as a built-in command, so this repo no longer exposes a root `setup` script.

Direct dependency installs and review flows should prefer `corepack pnpm ...` so the exact pnpm version pinned in `package.json#packageManager` is used automatically.
After intentional dependency refreshes on a trusted machine, review blocked install scripts with `corepack pnpm deps:ignored-builds` and record any required approvals with `corepack pnpm deps:approve-builds`.

## Quick start

```bash
pnpm onboard --vault ./vault

pnpm chat
murph chat
vault-cli vault stats
vault-cli inbox doctor

VAULT=./vault pnpm local-web:dev
```

For a quick local web demo against the checked-in fixture vault:

```bash
VAULT=fixtures/demo-web-vault pnpm local-web:dev
```

For the always-on assistant loop after setup:

```bash
murph run
# or
vault-cli run
```

## Mental model

Murph is opinionated about storage boundaries:

- Markdown is the human-facing source of truth for durable documents such as `CORE.md`, journals, profile state, goals, conditions, protocols, and registries.
- JSONL ledgers are the machine-facing source of truth for append-only records such as events, samples, assessments, and audit entries.
- Imported source artifacts are copied into `raw/**` and treated as immutable.
- Derived parser output lives under `derived/**` and stays rebuildable.
- Local machine state lives under `.runtime/**` and stays rebuildable.
- Assistant transcripts, metadata, and distilled memory live outside the vault under `assistant-state/**` and are not canonical health truth.

The result is a system you can inspect with normal filesystem tools while still keeping write paths disciplined.

## Repo structure

| Path | Responsibility |
| --- | --- |
| `packages/contracts` | Canonical Zod contracts, types, examples, and generated JSON Schema artifacts. |
| `packages/hosted-execution` | Shared hosted dispatch contracts, env readers, signing helpers, and typed clients. |
| `packages/runtime-state` | Shared `.runtime` path and rebuildable local-state helpers. |
| `packages/core` | The only package allowed to mutate canonical vault data. |
| `packages/importers` | External adapters that normalize inputs and delegate writes to `core`. |
| `packages/inboxd` | Inbox capture, canonical evidence persistence, runtime indexing, and attachment parse-job orchestration. |
| `packages/parsers` | Local-first attachment parsing and derived artifact publication. |
| `packages/query` | Read helpers, summaries, list/search helpers, and export-pack generation. |
| `packages/device-syncd` | Local wearable/device OAuth, webhook, and reconcile daemon. |
| `packages/assistant-core` | Headless local-only assistant/inbox/vault/operator-config boundary for non-CLI consumers. |
| `packages/gateway-core` | Headless transport-neutral gateway boundary. |
| `packages/gateway-local` | Local vault-backed gateway runtime and projection store. |
| `packages/assistant-runtime` | Headless hosted execution surface used by Cloudflare runner paths. |
| `packages/assistantd` | Local assistant daemon with a loopback-only bearer-authenticated control plane. |
| `packages/cli` | The published `@murphai/murph` package, exposing the `murph` / `vault-cli` binaries and the main operator surface. |
| `packages/local-web` | Local-only Next.js observability app over the query layer. |
| `apps/web` | Hosted Next.js control plane for onboarding, billing, OAuth, webhooks, and execution dispatch/outbox. |
| `apps/cloudflare` | Hosted execution plane for signed internal dispatch, per-user coordination, encrypted hosted bundles, and container-backed runs. |
| `fixtures` and `e2e` | Deterministic fixtures and smoke coverage. |

## Local and hosted surfaces

Murph now has three distinct runtime tiers:

### 1. Local operator surface

- `vault-cli` / `murph` for vault operations, assistant chat, automation, onboarding, and diagnostics
- `packages/local-web` for local read-only observability
- `@murphai/device-syncd` for local wearable sync
- `@murphai/assistantd` for the local assistant control plane

### 2. Hosted control plane

- `apps/web` owns hosted onboarding, billing, OAuth callbacks, webhook intake, token escrow, sparse routing state, and the durable `execution_outbox`
- it does not own canonical health data

### 3. Hosted execution plane

- `apps/cloudflare` restores encrypted hosted bundles, coordinates per-user runs, and executes one-shot inbox/parser/assistant/device-sync/share-import work through `@murphai/assistant-runtime`
- it is intentionally separate from the public hosted web app

## CLI surface

The root CLI is no longer just a vault editor. The built command surface includes:

- health-vault operations such as `init`, `show`, `list`, `timeline`, `journal`, `document`, `meal`, `samples`, `audit`, `vault`, and the health registry commands
- `assistant` for local chat, status, outbox, cron, automation, and provider-backed runtime control
- `inbox` for inbox runtime setup, review, and daemon operations
- `device` for local wearable/device auth, status, and daemon control
- root shortcuts such as `chat`, `run`, `status`, `doctor`, and `stop`
- AI-assisted maintainer helpers such as `research` and `deepthink`

Quick help:

```bash
pnpm exec tsx packages/cli/src/bin.ts --help
```

## Common workflows

### Operator flows

```bash
pnpm onboard --vault ./vault
pnpm chat
murph run
murph device daemon start --vault ./vault
VAULT=./vault pnpm local-web:dev
```

### Developer flows

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm local-web:dev
pnpm --dir apps/web dev
pnpm --dir apps/cloudflare verify
```

The repo verification baseline for docs/process-only and ordinary repo work remains:

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Maintainer helpers

The repo also carries local review and ChatGPT-thread tooling for maintainers:

- `pnpm review:gpt`
- `pnpm review:gpt:full`
- `pnpm review:gpt:delay --delay 50m --chat-url <url>`
- `pnpm chatgpt:thread:export --chat-url <url> --output <path>`
- `pnpm chatgpt:thread:download --chat-url <url> --attachment-text <filename> --output-dir <dir>`
- `pnpm chatgpt:thread:watch --delay 70m --chat-url <url> [--session-id <uuid>]`
- `pnpm review:gpt:data --vault ./vault --chat-url <url>`

`pnpm review:gpt` now stages the lean default bundle: repo source plus the durable `agent-docs` context, while leaving out broad test trees, CI workflows, generated `agent-docs`, historical completed plans, prompt boilerplate, and the wider `docs/**` set beyond `docs/architecture.md`. Use `pnpm review:gpt:full` when you explicitly want the larger audit context.

Those are contributor workflows, not the main product entrypoint, which is why they belong down here instead of near the top of the README.

## Development notes

- Root workspace scripts live in [`package.json`](package.json).
- The release source of truth is [`scripts/release-manifest.json`](scripts/release-manifest.json).
- The Cloudflare deployment path is documented in [`apps/cloudflare/DEPLOY.md`](apps/cloudflare/DEPLOY.md).
- Package-local operational details live in each package `README.md`.

## Read next

- [`ARCHITECTURE.md`](ARCHITECTURE.md) for the top-level system map and trust boundaries
- [`docs/architecture.md`](docs/architecture.md) for the one-page architecture summary
- [`packages/cli/README.md`](packages/cli/README.md) for the CLI package and release flow
- [`packages/local-web/README.md`](packages/local-web/README.md) for the local web app
- [`apps/web/README.md`](apps/web/README.md) for the hosted control plane
- [`apps/cloudflare/README.md`](apps/cloudflare/README.md) for the hosted execution plane
