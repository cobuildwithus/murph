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
- The CLI runtime expects a bot token in `HEALTHYBOB_TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN` when it instantiates the grammY-backed Telegram poll driver.

## iMessage adapter contract

The iMessage connector is optional and macOS-only. `@healthybob/inboxd` keeps
the adapter behind a dynamic import so non-iMessage consumers do not need the
dependency at all.

- Install `@photon-ai/imessage-kit` only in the same project/workspace that
  runs `@healthybob/inboxd` or `vault-cli`.
- The runtime imports that package only when `loadImessageKitDriver()` or an
  iMessage-backed CLI flow is exercised.
- If the package is missing or incompatible, `vault-cli inbox doctor` fails the
  `driver-import` check and reports the import error directly.
- Other inbox connectors can use this package without installing the iMessage
  adapter.

## Operator notes

- Use `vault-cli inbox doctor --source-id imessage:self` before `backfill` or
  `run` to confirm macOS access, Messages database readability, and adapter
  importability.
- A `driver-import` failure usually means `@photon-ai/imessage-kit` is not
  installed where the runtime is executing, or it does not expose the expected
  `getMessages` and `startWatching` functions.
