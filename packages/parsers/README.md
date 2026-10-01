# `@murphai/parsers`

Workspace-private local-first multimedia parsing for inbox attachments and other vault-backed media.

This package consumes attachment-level parse jobs from the inbox runtime, selects the best available local parser from a deterministic priority stack, and writes one normalized, versioned `result.json` bundle per attempt under `derived/inbox/...` for later chat/model layers. The default ordering is text/native CLI first, with remote APIs nowhere in the default stack.

## Current default stack

- text-like documents: built-in Node text reader
- born-digital PDFs: Poppler `pdfinfo` + `pdftotext`
- image QR/barcode scanning: `zxing-wasm`
- audio and extracted video audio: `whisper.cpp` when installed locally, or the `remote-transcription` HTTP provider when a `transcription.endpoint` is configured in the parser toolchain (hosted execution points it at the Worker-mediated Workers AI transcribe host)
- media normalization: `ffmpeg`

## Design rules

- canonical attachment evidence stays under `raw/inbox/...`
- parse outputs are derived files, never canonical vault state
- provider discovery stays explicit and local-first
- adapters remain thin wrappers around mature open-source tools
- all modalities normalize into one parse result shape (`text`, `markdown`, `blocks`, `tables`, metadata)
- one attempt is consumed as one `murph.parser-output.v1` bundle; it does not fan that result back out into manifest, chunk, Markdown, text, or table sidecars
- `compactLegacyParserAttempts(...)` is dry-run-first and removes legacy sidecars only after exact path, identity, and semantic-equivalence validation; apply passes compact at most 100 eligible attempts

## Integration seams

- `createInboxParserService(...)` wraps scoped drain and requeue flows for an inbox runtime
- `@murphai/inboxd` now owns the inbox-plus-parser composition helpers:
  `createParsedInboxPipeline(...)` processes a capture and immediately drains any newly enqueued attachment jobs
  `runInboxDaemonWithParsers(...)` backfills parser jobs on startup and keeps future captures auto-drained

A bounded owner can use `service.prepareOnce(capture/attachment filters)` to
claim one existing job synchronously and overlap only its artifact reading and
parser work. The returned handle's non-rejecting `ready` promise includes scratch
cleanup. Its memoized `complete()` publishes and finalizes through the same
attempt-CAS owner as `drainOnce`; stale attempts clean up only their own output.
The caller must bound the number of live handles and complete every claimed handle,
in publication order, before closing the runtime, including on failure or caller
cancellation. This API does not take a cooperative abort signal or own a queue,
retry loop, or durable state. Serial `drain`/`drainOnce` retain their existing
behavior. A parser failure is finalized only by completion, not by `ready`.

This keeps parsing additive to `@murphai/inboxd`: canonical inbox evidence remains under inbox ownership, while parser outputs stay rebuildable under `derived/inbox/**`.

## Toolchain config and discovery

- `writeParserToolchainConfig(...)` persists local command and model-path overrides under `<vault>/.runtime/operations/parsers/toolchain.json`
- `discoverParserToolchain(...)` reports which local tools are currently available plus where each setting came from (`FFMPEG_COMMAND`, `PDFINFO_COMMAND`, `PDFTOTEXT_COMMAND`, `WHISPER_COMMAND`, `WHISPER_MODEL_PATH`, or persisted config)
- `createConfiguredParserRegistry(...)` builds a default registry from the discovered toolchain state, and can also accept an explicit platform toolchain so hosted runners can pass absolute native binary/model paths without relying on env or `PATH` discovery
