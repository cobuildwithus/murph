# `@murphai/inboxd`

Workspace-private source-agnostic inbox ingestion for Murph.

This package keeps canonical inbox evidence in the vault and uses local runtime state for source cursors, a durable local capture mutation cursor, transient dedupe caches, capture-local search tables, and attachment job state.

Stateless provider ingress semantics that need to be shared with hosted callers now live in `@murphai/messaging-ingress`. `@murphai/inboxd` consumes that package for provider webhook parsing/minimization and keeps ownership of polling drivers, runtime state, and capture persistence.

Consumers that only need shared Linq or Telegram webhook parsing, verification, targets, summaries, or sparse minimization should depend on `@murphai/messaging-ingress` directly instead of `@murphai/inboxd` convenience subpaths.

Consumers that need inbox-owned normalization without the full inboxd barrel should use the focused connector exports such as `@murphai/inboxd/connectors/linq/normalize` and `@murphai/inboxd/connectors/telegram/normalize`.

## Runtime expectations

- Run on Node.js `>=22.16.0`.
- `@murphai/inboxd` resolves runtime paths and opens its SQLite projection database through `@murphai/runtime-state`, storing rebuildable capture/search state under `<vault>/.runtime/projections/inboxd.sqlite`.
- Inbox daemon/config state lives separately under `<vault>/.runtime/operations/inbox/*.json`.
- Query-owned lexical search state lives separately under `<vault>/.runtime/projections/search.sqlite`.
- The package writes runtime state next to the vault and expects normal local filesystem read/write access there.

## Core model

- every inbound source normalizes into a single `InboundCapture` envelope
- raw source evidence is persisted under `raw/inbox/<source>/...`
- append-only `ledger/inbox-captures/YYYY/YYYY-MM.jsonl` records the authoritative structured inbox-capture trail
- generic events and audits are derived compatibility or reference projections; intake capture itself is canonical without requiring peer event/audit rows
- inbox SQLite projection state lives under `<vault>/.runtime/projections/inboxd.sqlite`
- any idempotent promotion from inbox captures into canonical records must be derivable from canonical vault evidence rather than local `.runtime` state alone

## Current scope

- connector contracts for polling and webhook sources
- a generic normalized chat-poll connector factory for source-specific transports
- iMessage and Telegram poll connectors over injected driver boundaries
- source-specific checkpoints for connectors whose cursors are not derivable from `occurredAt`/`externalId`
- capture pipeline with atomic raw persistence, inbox-capture ledger append, dedupe, FTS, and a durable local capture mutation cursor for downstream projections like the gateway store
- runtime list, show, and search helpers for future CLI/agent surfaces
- `vault-cli inbox ...` is the intended human/operator surface layered on top of this package

## Parser-facing runtime operations

The inbox runtime exposes attachment-job primitives that stay safely outside canonical storage:

- `claimNextAttachmentParseJob(...)`
- `completeAttachmentParseJob(...)`
- `failAttachmentParseJob(...)`
- `requeueAttachmentParseJobs(...)`

These methods mutate only inbox-local projection state such as `.runtime/projections/inboxd.sqlite` and attachment parse metadata. They do not write canonical health records directly.

When combined with `@murphai/parsers`, operators can drive those queues through `vault-cli inbox setup|doctor|parse|requeue` without mixing parser state into canonical health records.

`@murphai/inboxd` also owns the optional inbox-plus-parser composition helpers `createParsedInboxPipeline(...)` and `runInboxDaemonWithParsers(...)`, so the parser package stays focused on parser contracts, registry/toolchain discovery, and parse execution rather than on inbox runtime orchestration.
