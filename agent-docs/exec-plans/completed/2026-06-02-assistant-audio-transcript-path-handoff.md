# Assistant Attachment Audio Transcript Path Handoff

## Goal

Keep assistant attachment handoff path-first for files the model can inspect
itself, while preserving synchronous Whisper transcription for audio/video
before the model turn starts.

## Success Criteria

- PDF, CSV, document, and image attachments are handed to the assistant through
  validated `raw/inbox/...` paths and metadata, without automatic parser jobs.
- Audio/video attachments still run through the configured ffmpeg/Whisper parser
  path and expose transcript evidence before the assistant prompt when the
  parser succeeds.
- Hosted mailbox import does not block lane watermark progress on generic
  document/image parsing work.
- Stale document/image `decode` and `reparse` surfaces are removed or narrowed so
  they cannot pretend a non-existent parser job will run.
- Raw attachment path validation uses one consistent policy across stored input
  and prompt rendering.

## Constraints

- Keep the architecture simple: no new queue, scheduler, table, or second file
  location.
- Do not reintroduce prompt-only `raw/assistant-input/...` copies.
- Treat audio/video as the explicit media exception because the assistant cannot
  reliably self-transcribe local audio/video bytes.
- Preserve unrelated dirty files and active ledger rows.
- Do not expose local absolute paths, secrets, provider URLs, or direct user
  identifiers in logs, docs, tests, or prompts.

## Plan

1. Inspect the current hosted projection, assistant prompt evidence, and inbox
   parse/decode seams.
2. Add or reuse one strict raw attachment path validator for assistant input and
   prompt rendering.
3. Narrow stale document/image parse/decode surfaces to audio/video.
4. Keep audio/video parser evidence available before prompt construction while
   avoiding document/image parser coupling.
5. Add focused regressions for audio transcript preservation, document/image
   decode narrowing, and strict prompt path validation.
6. Run package/diff verification, required audits, and commit through
   `scripts/finish-task`.

## Verification

- Focused assistant-engine tests covering prompt path validation and audio
  transcript evidence.
- Focused inbox-services/CLI tests covering audio/video-only parse/decode
  behavior.
- Focused assistant-runtime hosted conversation import tests covering audio
  parser preservation and non-audio path-first behavior.
- `pnpm typecheck`.
- `git diff --check` and privacy-oriented diff scan.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
