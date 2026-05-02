# Baseline Invariants

## Canonical Storage

- Human-facing truth lives in Markdown: `CORE.md`, `journal/`, and `bank/`.
- Machine-facing truth lives in JSONL: `ledger/events`, `ledger/samples`, and `audit`.
- Imported originals live in `raw/` and are immutable once copied into the vault.

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

## Append-Only Bias

- `raw/` is immutable.
- `ledger/*.jsonl` and `audit/*.jsonl` are append-only.
- Markdown docs may change only in explicitly human-facing areas.

## Deferred Complexity

- No SQLite as canonical storage. SQLite is allowed only for rebuildable local/runtime projections under `.runtime/**`.
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
  - `gateway-local`
  - `messaging-ingress`
  - `vault-usecases`
  - `assistant-cli`
  - `setup-cli`
