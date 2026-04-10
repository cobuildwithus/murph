<img src="docs/assets/readme-hero.jpg" alt="Murph hero" width="1200" height="685">

# Murph

Murph is your personal health assistant.

Think OpenClaw, but built specifically to help you live longer and healthier.

Underneath that assistant, Murph keeps durable human-reviewed truth in Markdown, append-only machine event ledgers in JSONL, and layers a typed CLI, local daemons, and hosted control/execution surfaces on top of that vault.

The main installable product entrypoint is `@murphai/murph`, which gives you the `murph` command.

## What ships here

- a file-native vault with canonical writes owned by `packages/core`
- the installable `@murphai/murph` package, which provides the `murph` CLI and onboarding flow
- provider-backed local assistant chat and automation, with runtime state under `vault/.runtime/operations/assistant/**`
- a two-layer knowledge system: stable health reference pages under `bank/library/**` plus a non-canonical compiled personal wiki under `derived/knowledge/**`, synthesized by the active assistant, persisted through shared assistant/CLI write surfaces, searchable locally, and kept rebuildable
- inbox capture, indexing, and parser-driven attachment extraction
- local wearable/device sync through the workspace-private `packages/device-syncd` runtime bundled into `@murphai/murph`
- a hosted Next.js integration control plane in `apps/web`
- a hosted Cloudflare execution plane in `apps/cloudflare`
- shared hosted execution contracts and env/client helpers in `@murphai/hosted-execution`
- workspace-private headless owner/runtime packages such as `@murphai/assistant-engine`, `@murphai/operator-config`, `@murphai/gateway-local`, `@murphai/assistant-runtime`, and `@murphai/assistantd`, plus the public contract package `@murphai/gateway-core`

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

## OpenClaw integration

If you already use OpenClaw, install the first-party Murph OpenClaw bundle after onboarding:

```bash
openclaw plugins install @murphai/openclaw-plugin
openclaw gateway restart
```

That bundle intentionally stays vault-first. It ships a Murph skill that teaches OpenClaw to use the existing `vault-cli` surface against your configured Murph vault through OpenClaw's built-in `exec` tool, rather than creating a second Murph assistant runtime inside OpenClaw.

## From this repo

Supported host setup path: macOS and Linux. iMessage remains macOS-only.

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
murph model
murph chat
murph run
vault-cli inbox doctor
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

| Path | Responsibility |
| --- | --- |
| `packages/contracts` | Canonical Zod contracts, types, examples, and generated JSON Schema artifacts. |
| `packages/hosted-execution` | Shared hosted dispatch contracts, env readers, signing helpers, and typed clients. |
| `packages/runtime-state` | Workspace-private shared local-state taxonomy, `.runtime` path resolution, JSON-state versioning, and SQLite schema-version helpers. |
| `packages/core` | Workspace-private canonical mutation owner. No other package may write canonical vault data directly. |
| `packages/importers` | Workspace-private external adapters that normalize inputs and delegate writes to `core`. |
| `packages/inboxd` | Workspace-private inbox capture, canonical evidence persistence, runtime indexing, and attachment parse-job orchestration. |
| `packages/parsers` | Workspace-private local-first attachment parsing and derived artifact publication. |
| `packages/query` | Workspace-private read helpers, summaries, list/search helpers, export-pack generation, and derived-knowledge parser/search/index helpers. |
| `packages/device-syncd` | Workspace-private local wearable/device OAuth, webhook, and reconcile daemon. |
| `packages/assistant-engine` | Workspace-private headless assistant execution/runtime owner. |
| `packages/operator-config` | Workspace-private operator config, setup/runtime-env, and hosted assistant config owner. |
| `packages/assistant-cli` | Workspace-private CLI-only assistant wrappers, commands, terminal logging, and Ink chat UI. |
| `packages/setup-cli` | Workspace-private CLI-only onboarding, host setup, and setup-wizard package. |
| `packages/gateway-core` | Headless transport-neutral gateway boundary. |
| `packages/gateway-local` | Workspace-private local vault-backed gateway runtime and projection store. |
| `packages/assistant-runtime` | Workspace-private headless hosted execution surface used by Cloudflare runner paths. |
| `packages/assistantd` | Workspace-private local assistant daemon with a loopback-only bearer-authenticated control plane. |
| `packages/cli` | The published `@murphai/murph` package, exposing the `murph` / `vault-cli` binaries and the main operator surface. |
| `packages/openclaw-plugin` | The published OpenClaw-compatible bundle that teaches OpenClaw to use `vault-cli` directly against the configured Murph vault. |
| `apps/web` | Hosted Next.js control plane for onboarding, billing, OAuth, webhooks, and execution dispatch/outbox. |
| `apps/cloudflare` | Hosted execution plane for signed internal dispatch, per-user coordination, encrypted hosted bundles, and container-backed runs. |
| `fixtures` and `e2e` | Deterministic fixtures and smoke coverage. |

## Local and hosted surfaces

Murph now has three distinct runtime tiers:

### 1. Local operator surface

- `vault-cli` / `murph` for vault operations, assistant chat, automation, onboarding, and diagnostics
- the workspace-private `packages/device-syncd` runtime for local wearable sync
- the workspace-private `packages/assistantd` daemon for the local assistant control plane

### 2. Hosted control plane

- `apps/web` owns hosted onboarding, billing, OAuth callbacks, webhook intake, token escrow, sparse routing state, and the durable `execution_outbox`
- it does not own canonical health data

### 3. Hosted execution plane

- `apps/cloudflare` restores encrypted hosted bundles, coordinates per-user runs, and executes one-shot inbox/parser/assistant/device-sync/share-import work through the workspace-private `@murphai/assistant-runtime` package
- it is intentionally separate from the public hosted web app

## CLI surface

The root CLI is no longer just a vault editor. The built command surface includes:

- health-vault operations such as `init`, `show`, `list`, `timeline`, `journal`, `document`, `meal`, `samples`, `audit`, `vault`, and the health registry commands
- `assistant` for local chat, status, outbox, cron, automation, and provider-backed runtime control
- `inbox` for inbox runtime setup, review, and daemon operations
- `device` for local wearable/device auth, status, and daemon control
- root shortcuts such as `chat`, `run`, `status`, `doctor`, and `stop`
- AI-assisted synthesis helpers such as `research`, `deepthink`, and `knowledge`

The `knowledge` surface is intentionally narrow: use it to persist pages, inspect saved pages, lint the wiki, rebuild the index, and tail the append-only wiki log. The assistant's wiki-maintainer workflow itself lives in the runtime prompt plus the dedicated `assistant.knowledge.*` tools, not in repo `AGENTS.md`.

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
pnpm chat
murph run
murph device daemon start --vault ./vault
```

### Developer flows

```bash
pnpm typecheck
pnpm test
pnpm verify:acceptance
pnpm --dir apps/web dev
pnpm --dir apps/cloudflare verify
```

The repo verification baseline for docs/process-only and ordinary repo work remains:

```bash
pnpm typecheck
pnpm test
pnpm verify:acceptance
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

Those are contributor workflows, not the main product entrypoint, which is why they belong down here instead of near the top of the README. Their thread export/download/wake behavior is owned by the packaged `@cobuild/review-gpt` CLI rather than repo-local helper mirrors.

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
