# `@murphai/parsers`

Local-first multimedia parsing for inbox attachments and other vault-backed media.

This package consumes attachment-level parse jobs from the inbox runtime, selects the best available local parser from a deterministic priority stack, and writes normalized derived artifacts under `derived/inbox/...` for later chat/model layers. The default ordering is text/native CLI first, with raw-PDF routing fallback handled in the model layer rather than by a second PDF OCR pass, and remote APIs nowhere in the default stack.

## Current default stack

- text-like documents: built-in Node text reader
- native-text PDFs: `pdftotext` when available
- audio and extracted video audio: `whisper.cpp`
- media normalization: `ffmpeg`

## Design rules

- original raw evidence stays under `raw/inbox/...`
- parse outputs are derived files, never canonical vault state
- provider discovery stays explicit and local-first
- adapters remain thin wrappers around mature open-source tools
- all modalities normalize into one parse result shape (`text`, `markdown`, `chunks`, `tables`, metadata)

## Integration seams

- `createInboxParserService(...)` wraps scoped drain and requeue flows for an inbox runtime
- `@murphai/inboxd` now owns the inbox-plus-parser composition helpers:
  `createParsedInboxPipeline(...)` processes a capture and immediately drains any newly enqueued attachment jobs
  `runInboxDaemonWithParsers(...)` backfills parser jobs on startup and keeps future captures auto-drained

This keeps parsing additive to `@murphai/inboxd`: raw inbox evidence remains canonical, while parser outputs stay rebuildable under `derived/inbox/**`.

## Toolchain config and discovery

- `writeParserToolchainConfig(...)` persists local command and model-path overrides under `<vault>/.runtime/operations/parsers/toolchain.json`
- `discoverParserToolchain(...)` reports which local tools are currently available plus where each setting came from
- `createConfiguredParserRegistry(...)` builds a default registry from the discovered toolchain state
