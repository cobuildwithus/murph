# `@healthybob/parsers`

Local-first multimedia parsing on top of `@healthybob/inboxd`.

This package consumes attachment-level parse jobs from the inbox runtime,
selects the best available local parser from a deterministic priority stack,
and writes normalized derived artifacts under `derived/inbox/...` for later
chat/model layers. The default ordering is text/native CLI first, OCR second,
and remote APIs nowhere in the default stack.

## Current default stack

- text-like documents: built-in Node text reader
- native-text PDFs: `pdftotext` when available
- audio and extracted video audio: `whisper.cpp`
- images and OCR/layout PDFs: PaddleOCR CLI
- media normalization: `ffmpeg`

## Design rules

- original raw evidence stays under `raw/inbox/...`
- parse outputs are derived files, never canonical vault state
- provider discovery stays explicit and local-first
- adapters remain thin wrappers around mature open-source tools
- all modalities normalize into one parse result shape (`text`, `markdown`, `chunks`, `tables`, metadata)
