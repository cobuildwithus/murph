# Baseline Invariants

## Implementation Bias

- Prefer simple, composable primitives over complex abstractions. Add a new abstraction only when it removes real duplication, clarifies ownership, or makes an invariant easier to enforce.
- Do not introduce broad managers, speculative frameworks, or compatibility layers when a named primitive, package-owned seam, or direct function can express the behavior clearly.

## Canonical Storage

- Human-facing truth lives in Markdown: `CORE.md`, `journal/`, and `bank/`.
- Machine-facing truth lives in JSONL: `ledger/events`, display-grade `ledger/metric-samples`, explicit raw/debug `ledger/samples`, and `audit`. Generic `ledger/samples` shards are not part of the default query/read/browser model.
- Imported originals live in `raw/` and are immutable once copied into the vault, except for explicit core-owned repair tombstones that prove the old manifest byte/SHA and preserve durable product facts.

## Write Authority

- Only `packages/core` may mutate canonical vault data.
- `packages/importers` may parse and prepare external data, but all canonical writes must call core APIs.
- `packages/cli` may never write vault files directly.

## Assistant Boundary

- Agent layers, MCP surfaces, and future UIs call `murph`, `vault-cli`, or exported package APIs.
- Assistant runtime state is stored under `vault/.runtime/operations/assistant/**`.
- Durable user-facing memory and scheduled prompt configuration live in canonical vault records, not assistant runtime state.
- If a datum is user-facing, queryable, or something future product features will build on, it belongs in canonical vault records or explicit derived materializations, never in assistant runtime state.
- No agent gets arbitrary write access to vault files as part of the public contract.

## Hosted Foreground Priority

- User conversation messages are the highest-priority hosted runtime work.
- Background device sync, provider cleanup, browser-vault refresh, maintenance, and idle checkpointing must never block assistant admission or reply delivery for fresh user input.
- Idle-only work must be preemptible. If fresh user input arrives while background maintenance or idle checkpointing is running, that work must yield, abort, or reschedule instead of making the user message wait for completion.
- Assistant reply code must not import, call, await, or coordinate with device-sync execution. Device sync may preserve a follow-up wake or recovery marker, but it must stay out of the foreground reply path.
- Foreground preemption is not permission to publish partial or corrupt state. Wrong-user authority, stale lease, invalid auth, undecryptable mailbox payloads, and checkpoint compare-and-swap conflicts still fail closed.

## Observability And Logging

- Log errors at the root failure boundary, where the system first has enough context to classify the failing owner, operation, and cause. Do not scatter patchwork logs across callers, retries, or fallback layers to compensate for an unclear source.
- When an error is safe to log, preserve the full error chain and structured metadata, then pass it through the shared redaction helper before emission. The shared redactor must remove secrets, keys, credentials, tokens, authorization headers, local paths, and direct identifiers.
- Prefer shared redaction and complete structured errors over hand-crafted partial error strings, one-off scrubbers, or caller-local redaction rules.

## Append-Only Bias

- `raw/` is immutable by default; any repair rewrite must be a named core primitive with manifest proof, metadata-only audit, and no raw payload leakage.
- `ledger/*.jsonl` and `audit/*.jsonl` are append-only by default. The wearable storage repair may report dense provider-generated debug shard candidates, but v1 does not delete `ledger/samples/**`; any future shard deletion needs its own named repair proof and architecture update.
- Markdown docs may change only in explicitly human-facing areas.

## Deferred Complexity

- No SQLite as canonical health storage. Rebuildable SQLite projections belong under `.runtime/projections/**`. Durable non-canonical operational SQLite is allowed only for explicitly owned runtime stores with migrations and a documented snapshot/backup policy, such as device-sync control and credential state under `.runtime/operations/device-sync/state.sqlite`.
- Lexical search is allowed through the query projection.
- Vector search is deferred unless it is explicitly added to the contract.
- No OCR-heavy lab parser.
- No local-model requirement.
- No automatic promotion of local or provider chat transcripts into canonical health state.

## Frozen Current Choices

- Product CLI: `murph`
- Raw explicit-vault CLI and operator surface: `vault-cli`
- Public packages:
  - `@murphai/murph`
  - `@murphai/openclaw-plugin`
  - `@murphai/contracts`
  - `@murphai/hosted-execution`
  - `@murphai/gateway-core`
- Workspace-private package families:
  - `core`
  - `query`
  - `importers`
  - `device-syncd`
  - `inboxd`
  - `runtime-state`
  - `assistant-engine`
  - `assistant-runtime`
  - `assistantd`
  - `operator-config`
  - `messaging-ingress`
  - `vault-usecases`
  - `assistant-cli`
  - `setup-cli`
