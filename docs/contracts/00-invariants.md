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

- Agent layers, MCP surfaces, and future UIs call `vault-cli` or exported package APIs.
- Assistant runtime state is stored under `vault/.runtime/operations/assistant/**`.
- Durable user-facing memory and scheduled prompt configuration live in canonical vault records, not assistant runtime state.
- No agent gets arbitrary write access to vault files as part of the public contract.

## Append-Only Bias

- `raw/` is immutable.
- `ledger/*.jsonl` and `audit/*.jsonl` are append-only.
- Markdown docs may change only in explicitly human-facing areas.

## Deferred Complexity

- No SQLite as canonical storage.
- No vector database.
- No OCR-heavy lab parser.
- No semantic search.
- No local-model requirement.
- No automatic promotion of local or provider chat transcripts into canonical health state.

## Frozen Bootstrap Choices

- Package names:
  - `@murphai/contracts`
  - `@murphai/core`
  - `@murphai/cli`
  - `@murphai/importers`
  - `@murphai/query`
- Command namespace root: `vault-cli`
- Recommended branch lanes:
  - `track/contracts`
  - `track/core`
  - `track/cli`
  - `track/importers`
  - `track/query-export`
  - `track/qa-release`
  - `track/integration`
