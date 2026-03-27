# Telegram local-first migration guide

Last verified: 2026-03-16

## Goal

Add Telegram as a local-first inbox source without turning `@murph/inboxd` into a pile of per-channel special cases.

This migration follows the same overall direction as OpenClaw's Telegram channel:

- long polling first
- webhook optional later
- normalize every inbound transport into one shared inbox envelope
- keep canonical storage local to the Murph vault

## What changed

### 1. Generic normalized chat ingress

`packages/inboxd/src/connectors/chat/*` now provides a reusable poll-connector factory for chat-like transports.

Use it whenever a source can provide:

- a batch read for backfill
- a watch/stream loop for live delivery
- a source-specific normalization step into `InboundCapture`
- an optional source-native checkpoint shape

### 2. Source-native checkpoints

The old daemon/CLI path implicitly assumed every source cursor could be reconstructed from:

- `occurredAt`
- `externalId`
- `receivedAt`

That assumption breaks for Telegram, where the true replay cursor is `update_id`.

Connectors can now emit an explicit checkpoint alongside each normalized capture, and the daemon/CLI runtime will persist that checkpoint instead of forcing the generic timestamp cursor.

### 3. In-memory attachment bytes

`InboundAttachment` can now carry `data: Uint8Array` so remote sources can persist downloaded media directly into the vault without staging temp files first.

### 4. Telegram poll connector

`packages/inboxd/src/connectors/telegram/*` adds:

- Telegram Bot API type shims
- update/message normalization
- attachment hydration via `getFile`
- local-first poll connector
- a grammY-backed poll driver
- app-code injection of an existing grammY `Api`

## Recommended runtime shape

### Lowest-friction path

Use the built-in grammY-backed poll driver from the CLI/runtime:

```bash
export TELEGRAM_BOT_TOKEN='123456:abc...'
vault-cli inbox source add telegram --id telegram:bot --account bot --vault ./vault
vault-cli inbox doctor --source-id telegram:bot --vault ./vault
vault-cli inbox backfill --source telegram:bot --vault ./vault
vault-cli inbox run --vault ./vault
```

### If you already use grammY

Instantiate a grammY `Api` object in app code and pass it to `createTelegramApiPollDriver({ api })`.

That keeps grammY as the transport/runtime layer while `@murph/inboxd` stays the canonical sink.

## Current wiring status

- Telegram long-poll ingestion now plugs into the same assistant auto-reply loop as iMessage.
- Assistant session reuse is keyed by the normalized Telegram thread id, so one bot chat or topic can keep reusing the same Murph assistant session.
- Outbound assistant delivery accepts either a plain Telegram chat id or `<chatId>:topic:<messageThreadId>` so replies can land back in the exact same chat topic.

## Environment variables

The CLI/runtime now looks for these Telegram settings:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_API_BASE_URL` (optional; useful for a local Bot API server)
- `TELEGRAM_API_BASE_URL` (optional)
- `TELEGRAM_FILE_BASE_URL` (optional)
- `TELEGRAM_FILE_BASE_URL` (optional)

## Operational notes

- Telegram long polling and webhooks are mutually exclusive. If a webhook is active, the local poll connector will delete it on start by default.
- Telegram is a forward-capture source, not a durable historical archive like iMessage.
- Telegram backfill now advances `update_id` page-by-page after local persistence rather than acknowledging multiple pages up front.
- When using a local Bot API server, attachment hydration can read absolute local `file_path` values directly.
- Doctor checks intentionally avoid calling `getUpdates`, because consuming updates during diagnostics would drain pending bot traffic.

## Extension pattern for future channels

For any new message source, prefer this shape:

1. transport-specific driver
2. normalize into `ChatMessage` / `InboundCapture`
3. emit source-native checkpoint when needed
4. let `@murph/inboxd` own persistence, dedupe, search, and attachment jobs

That keeps new channels thin and avoids duplicating vault-write logic across every connector.
