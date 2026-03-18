# `@healthybob/inboxd`

Source-agnostic inbox ingestion for Healthy Bob.

This package keeps canonical inbox evidence in the vault and uses a local SQLite
runtime database for cursors, transient dedupe caches, capture-local search
tables, and attachment job state.

## Runtime expectations

- Run on Node.js `>=22.16.0`.
- `@healthybob/inboxd` resolves runtime paths and opens its SQLite runtime
  database through `@healthybob/runtime-state`, storing machine-local state
  under `<vault>/.runtime/inboxd.sqlite`.
- Query-owned lexical search state lives separately under
  `<vault>/.runtime/search.sqlite`.
- The package writes runtime state next to the vault and expects normal local
  filesystem read/write access there.

## Core model

- every inbound source normalizes into a single `InboundCapture` envelope
- raw source evidence is persisted under `raw/inbox/<source>/...`
- append-only vault events and audits record the canonical import trail
- inbox SQLite runtime state lives under `<vault>/.runtime/inboxd.sqlite`
- any idempotent promotion from inbox captures into canonical records must be
  derivable from canonical vault evidence rather than local `.runtime` state alone

## Current scope

- connector contracts for polling and webhook sources
- a generic normalized chat-poll connector factory for source-specific transports
- iMessage and Telegram poll connectors over injected driver boundaries
- source-specific checkpoints for connectors whose cursors are not derivable from `occurredAt`/`externalId`
- capture pipeline with raw persistence, event/audit append, dedupe, and FTS
- runtime list, show, and search helpers for future CLI/agent surfaces
- `vault-cli inbox ...` is the intended human/operator surface layered on top of this package

## Parser-facing runtime operations

The inbox runtime exposes attachment-job primitives that stay safely outside canonical storage:

- `claimNextAttachmentParseJob(...)`
- `completeAttachmentParseJob(...)`
- `failAttachmentParseJob(...)`
- `requeueAttachmentParseJobs(...)`

These methods mutate only inbox-local runtime state such as `.runtime/inboxd.sqlite` and attachment parse metadata. They do not write canonical health records directly.

When combined with `@healthybob/parsers`, operators can drive those queues through `vault-cli inbox setup|doctor|parse|requeue` without mixing parser state into canonical health records.

## Telegram adapter contract

The Telegram connector is local-first and poll-first by default.

- Use `createTelegramBotApiPollDriver(...)` when you want the package to construct a grammY-backed poll driver from a bot token.
- Use `createTelegramApiPollDriver({ api })` when you already have a grammY `Api` instance.
- The connector stores source-native cursors such as Telegram `update_id` checkpoints instead of forcing every source through the same `occurredAt`/`externalId` cursor shape.
- Downloaded media can be persisted directly from in-memory bytes, so remote transports do not need temp files just to enter the vault.
- Telegram backfill drains pending updates page-by-page so source-native cursors only advance after captures have been normalized and persisted locally.
- Local Bot API servers that return absolute file paths from `getFile` are supported during attachment hydration.
- The CLI runtime expects a bot token in `HEALTHYBOB_TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN` when it instantiates the grammY-backed Telegram poll driver.

## iMessage adapter contract

The iMessage connector is macOS-only. `@healthybob/inboxd` now depends directly
on `@photon-ai/imessage-kit`, and `loadImessageKitDriver()` adapts its
`IMessageSDK` surface onto the inboxd polling driver contract.

- Any workspace that runs `@healthybob/inboxd` or `vault-cli` must install the
  package dependency tree, including the native SQLite dependency chain that
  `@photon-ai/imessage-kit` expects at runtime.
- `vault-cli inbox doctor` still separates adapter wiring from the live probe:
  `driver-import` confirms the driver boundary is available, while `probe`
  exercises the actual SDK/database access.
- Other inbox connectors remain source-agnostic, but the package install now
  always includes the iMessage adapter.

## Operator notes

- Use `vault-cli inbox doctor --source-id imessage:self` before `backfill` or
  `run` to confirm macOS access, Messages database readability, and adapter
  importability.
- A `probe` failure usually means macOS denied Messages database access or the
  underlying SQLite/native dependency stack failed to initialize cleanly.
