# `@murph/parsers`

Local-first multimedia parsing on top of `@murph/inboxd`.

This package consumes attachment-level parse jobs from the inbox runtime,
selects the best available local parser from a deterministic priority stack,
and writes normalized derived artifacts under `derived/inbox/...` for later
chat/model layers. The default ordering is text/native CLI first, OCR second,
and remote APIs nowhere in the default stack.

## Current default stack

- text-like documents: built-in Node text reader
- native-text PDFs: `pdftotext` when available
- audio and extracted video audio: `whisper.cpp`
- images and PDFs that need OCR/layout recovery: PaddleOCR CLI
- media normalization: `ffmpeg`

## Design rules

- original raw evidence stays under `raw/inbox/...`
- parse outputs are derived files, never canonical vault state
- provider discovery stays explicit and local-first
- adapters remain thin wrappers around mature open-source tools
- all modalities normalize into one parse result shape (`text`, `markdown`, `chunks`, `tables`, metadata)

## Integration seams

- `createInboxParserService(...)` wraps scoped drain and requeue flows for an inbox runtime
- `createParsedInboxPipeline(...)` processes a capture and immediately drains any newly enqueued attachment jobs
- `runInboxDaemonWithParsers(...)` backfills parser jobs on startup and keeps future captures auto-drained

These helpers keep parsing additive to `@murph/inboxd`: raw inbox evidence remains canonical, while parser outputs stay rebuildable under `derived/inbox/**`.

## Toolchain config and discovery

- `writeParserToolchainConfig(...)` persists local command and model-path overrides under `<vault>/.runtime/parsers/toolchain.json`
- `discoverParserToolchain(...)` reports which local tools are currently available plus where each setting came from
- `createConfiguredParserRegistry(...)` builds a default registry from the discovered toolchain state
