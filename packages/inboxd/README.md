# `@murphai/inboxd`

Workspace-private source-agnostic inbox ingestion for Murph.

This package keeps canonical inbox evidence in the vault and uses local runtime state for source cursors, a durable local capture mutation cursor, transient dedupe caches, capture-local search tables, and attachment job state.

Stateless provider ingress semantics that need to be shared with hosted callers now live in `@murphai/messaging-ingress`. `@murphai/inboxd` consumes that package for provider webhook parsing/minimization and keeps ownership of polling drivers, runtime state, and capture persistence.

Consumers that only need shared Linq or Telegram webhook parsing, verification, targets, summaries, or sparse minimization should depend on `@murphai/messaging-ingress` directly instead of `@murphai/inboxd` convenience subpaths.

Consumers that need inbox-owned normalization without the full inboxd barrel should use the focused connector exports such as `@murphai/inboxd/connectors/linq/normalize`, `@murphai/inboxd/connectors/telegram/normalize`, or `@murphai/inboxd/connectors/hosted-conversation` for hosted mailbox conversation wakes.

## Runtime expectations

- Run on Node.js `>=24.14.1`.
- `@murphai/inboxd` resolves runtime paths and opens its SQLite projection database through `@murphai/runtime-state`, storing rebuildable capture/search state under `<vault>/.runtime/projections/inboxd.sqlite`.
- Inbox daemon/config state lives separately under `<vault>/.runtime/operations/inbox/*.json`.
- Query-owned lexical search state lives separately under `<vault>/.runtime/projections/query.sqlite`.
- The package writes runtime state next to the vault and expects normal local filesystem read/write access there.

## Core model

- every inbound source normalizes into a single `InboundCapture` envelope
- canonical source and attachment evidence is persisted under `raw/inbox/<source>/...`; image attachment bytes are normalized to bounded static WebP before storage or left unstored, and canonical raw metadata drops size-like provider fields instead of retaining original byte sizes
- append-only `ledger/inbox-captures/YYYY/YYYY-MM.jsonl` records the authoritative structured inbox-capture trail; inbound message content is retired 14 days after receipt from inline and out-of-line text, provider raw fields, parser bundles, SQLite/FTS projections, and migrated legacy copies while structural capture metadata remains
- append-only `ledger/inbox-attachment-retention/YYYY/YYYY-MM.jsonl` records 14-day raw inbox image/audio/video byte expiration, preserving descriptors, hashes, and message relationships while projecting expired bytes as `retention_expired`; parser derivatives survive an earlier media-byte pass only until the owning message-content deadline
- assistant admission must not depend on hidden local inbox projection rows; decoded assistant input belongs in the assistant input store, while inbox capture remains a canonical/searchable projection
- inbox intake and runtime rebuild rely on canonical inbox-capture ledger evidence, but they will backfill a missing inbox-capture record from a deterministic current-format raw envelope only when an unresolved `inbox_capture_persist` write operation shows raw writes completed before the ledger append
- crash recovery opens write-operation metadata only for operations whose staging directory still exists; clean terminal metadata without stage residue is skipped on a fresh-capture miss, while residue remains visible for validation and diagnostics
- inbox SQLite projection state lives under `<vault>/.runtime/projections/inboxd.sqlite`
- any idempotent promotion from inbox captures into canonical records must be derivable from canonical vault evidence rather than local `.runtime` state alone

## Current scope

- connector contracts for polling and webhook sources
- a generic normalized chat-poll connector factory for source-specific transports
- Telegram and email/Linq inbox connector ownership plus shared connector primitives for supported inbox sources
- source-specific checkpoints for connectors whose cursors are not derivable from `occurredAt`/`externalId`
- capture pipeline with atomic raw persistence, inbox-capture ledger append, dedupe, FTS, and a durable local capture mutation cursor for downstream inbox/query projections
- rebuilds and replay dedupe treat raw envelopes as source evidence, not a legacy persistence lane, except for the narrow current-format crash-recovery path gated by unresolved `inbox_capture_persist` metadata
- runtime list, show, and search helpers for future agent/runtime surfaces

## Parser-facing runtime operations

The inbox runtime exposes attachment-job primitives that stay safely outside canonical storage:

- `claimNextAttachmentParseJob(...)`
- `completeAttachmentParseJob(...)`
- `failAttachmentParseJob(...)`
- `requeueAttachmentParseJobs(...)`

These methods mutate only inbox-local projection state such as `.runtime/projections/inboxd.sqlite` and attachment parse metadata. They do not write canonical health records directly.

When combined with `@murphai/parsers`, runtime consumers can drain those queues without mixing parser state into canonical health records.

`@murphai/inboxd` also owns the optional inbox-plus-parser composition helpers `createParsedInboxPipeline(...)` and `runInboxDaemonWithParsers(...)`, so the parser package stays focused on parser contracts, registry/toolchain discovery, and parse execution rather than on inbox runtime orchestration.
