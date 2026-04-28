# Codex Best-Effort Attachment Runtime

## Goal

Make Codex assistant turns robust when inbox parsing, document preservation, or restored runtime state is incomplete.

Success means:

- A hosted capture that was accepted by the webhook is durable before parser setup or enrichment runs.
- Codex can reply from the best available context instead of waiting for perfect parser output.
- Parser failures, pending parser jobs, missing inbox runtime config, and document preservation failures do not block the assistant reply path.
- Voice memos have a first-class route into the prompt through transcript text when Whisper output is available.
- Raw PDF/image evidence can still reach Codex when the parser is pending or failed and a stored attachment exists.
- `.runtime` restore is simple: include runtime state by default, denylist secrets and process-local files, and bootstrap missing non-secret config when needed.

## Problem

The current assistant path lets enrichment work gate the primary reply path.

Observed failure shape:

- The incoming conversation webhook was accepted.
- The hosted assistant scan found the capture.
- Document attachment preservation ran before the reply.
- Preservation called inbox initialization and failed because the restored hosted runtime did not have inbox runtime config.
- The scan emitted a capture failure and stopped before outbox/reply work.
- The user saw no assistant reply.

That failure is the wrong ownership boundary. Document preservation is useful enrichment. It is not required for Codex to understand and answer a message.

There is a second related problem in the prompt assembly path. Attachment parser state is treated as a global readiness gate. If any attachment is `pending` or `running`, `prepareAssistantAutoReplyInput` defers even when useful context already exists: message text, stored raw file, attachment metadata, image evidence, or a prior transcript.

There is a third related problem in hosted ingestion. The parsed inbox pipeline is constructed before the capture is persisted. If parser registry setup fails before persistence, a capture that reached hosted infrastructure may never become visible to Codex.

## Architectural Invariant

Accepted user input is the product-critical lane. Parsing and preservation are enrichment lanes.

The assistant should operate from:

1. Message text.
2. Parsed attachment text or transcript when available.
3. Raw stored attachment evidence when the model/runtime can consume it.
4. Attachment metadata and explicit parser status when no richer evidence exists.

No parser, preservation, or canonical import step should be able to make Codex silent after the system has accepted a user message.

## Design Principles

- Keep one primary state machine: assistant reply/outbox state.
- Keep parser state in the existing attachment parser fields.
- Do not add a broad second queue for document preservation unless retries need stronger guarantees later.
- Convert enrichment failures into structured diagnostics and retry hints, not reply-path failures.
- Make prompt input assembly pure or close to pure: it should read capture state and build best-effort model input, not mutate runtime state.
- Prefer small helpers with explicit inputs over a new cross-package orchestration layer.
- Treat raw attachments and transcripts as sensitive user data. Do not add raw content to logs.

## Proposed Shape

### 1. Persist First, Parse Later

Change hosted conversation ingestion so capture persistence happens before parser registry construction or parser drains.

Current high-risk shape:

1. Normalize hosted conversation capture.
2. Open inbox runtime.
3. Create configured parser registry.
4. Create parsed inbox pipeline.
5. Persist capture and drain parsers through that pipeline.

Proposed shape:

1. Normalize hosted conversation capture.
2. Open or bootstrap inbox runtime.
3. Persist capture through the plain inbox pipeline.
4. Mark the hosted conversation read only after successful persistence.
5. Start a best-effort parse drain for the persisted capture.
6. If parser setup or parser execution fails, record a diagnostic and leave the capture visible to Codex.

Expected code targets:

- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- The plain inbox pipeline owner in `packages/inboxd`
- Existing parser registry/drain helpers in `packages/parsers` and `packages/inboxd`

The important behavior is simple: parsing can lag; persistence cannot.

### 2. Best-Effort Assistant Input Assembly

Change assistant prompt construction so pending parser state is not a global defer.

Current high-risk shape:

- `prepareAssistantAutoReplyInput` calls `hasAssistantAutoReplyPendingAttachments`.
- Any `pending` or `running` attachment returns `kind: "defer"`.
- Hosted and active-turn paths can wait forever if parser jobs are stuck, missing runtime state, or not drainable in the current environment.

Proposed shape:

- Always build attachment bundles for captures under consideration.
- Include parsed text when `extractedText` exists.
- Include transcript text when `transcriptText` exists.
- Include raw PDF/image evidence when the stored path exists and the model input layer can attach it.
- Include metadata and parser status for pending, running, and failed attachments.
- Use explicit prompt language for missing parser output, for example:
  - "Transcript unavailable yet."
  - "Attachment parser is still running."
  - "Attachment parser failed; use the visible/raw evidence if available."
- Skip only when there is no usable message text, no attachment evidence, and no metadata worth surfacing.

Expected code targets:

- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- Shared active-turn input path in `packages/assistant-engine/src/assistant/automation/reply.ts`

This makes the behavior monotonic. More parser output improves the prompt, but missing parser output does not erase the input.

### 3. Voice Memo Path

Keep audio parsing first class through transcript text.

The current parse completion path writes audio/video parser output to `transcriptText`. The prompt path already has support for `attachment_transcript` fragments. The issue is the readiness gate before prompt assembly.

Desired behavior:

- If Whisper/transcription output is available, Codex sees it as a transcript, not as a generic blob.
- If transcription is pending, Codex still sees the sender text and attachment metadata.
- If transcription failed, Codex sees that the audio transcript is unavailable.
- Raw audio should not be added as a new model input type in this pass unless the provider/runtime already supports it cleanly.

Expected code targets:

- `packages/parsers/src/pipelines/worker.ts`
- `packages/inboxd/src/kernel/sqlite/parse-jobs.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`

Non-goal: replace Whisper or redesign parser artifacts.

### 4. Document Preservation as Enrichment

Keep `preserveDocumentAttachments` because it imports canonical document attachments into the vault. Move it out of the pre-reply gate.

Current high-risk shape:

- The scanner calls preservation before considering or replying to a capture.
- If preservation throws, the scan breaks before reply work.

Proposed shape:

- Remove preservation from the critical pre-reply path.
- Run document preservation after reply input has been accepted, after the reply attempt, or in a separate enrichment pass.
- Wrap preservation in a helper that returns a structured result:
  - `succeeded`
  - `skipped`
  - `retryable_failed`
  - `terminal_failed`
- On `INBOX_NOT_INITIALIZED`, bootstrap safe missing config when possible and retry later.
- Do not advance assistant reply cursors or suppress reply attempts based on preservation failure.

Expected code targets:

- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/inbox-services/src/inbox-services/promotions.ts`
- `packages/inbox-services/src/inbox-services/state.ts`

The preservation function can still enforce its own invariants. The change is where its failures are allowed to propagate.

### 5. Runtime Continuity and Bootstrap

Store and restore `.runtime` broadly with a denylist, then bootstrap any missing non-secret config.

The current allowlist/descriptor approach makes important runtime state easy to omit. The safer hosted default is:

- Include `.runtime/**` by default.
- Exclude secrets.
- Exclude process-local files.
- Exclude temp/cache/build artifacts.
- Exclude locks, sockets, pid files, and active process control files.
- Keep explicit tests for the denylist so secret-like files are never serialized.

At minimum, hosted restore must preserve or recreate:

- `.runtime/operations/inbox/config.json`
- Assistant runtime state needed to resume reply/outbox state.
- Parser job state and attachment metadata when those live in runtime-backed stores.

Expected code targets:

- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/inbox-local-state-descriptors.ts`
- Hosted workspace restore/bootstrap code under `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/inbox-services/src/inbox-services/state.ts`

Bootstrap rule:

- If a required non-secret config file is missing, create the minimal valid file.
- If a secret or credential is missing, fail the dependent integration clearly but do not block unrelated assistant reply work.

## Detailed Flow

### Incoming Hosted Message

1. Webhook normalizes the message into a capture.
2. Hosted runtime opens or bootstraps inbox runtime config.
3. The plain inbox pipeline persists the capture and raw attachments.
4. The hosted source is marked read or acknowledged.
5. Parser drain starts best-effort.
6. Assistant automation wakes.
7. Prompt assembly reads the capture and builds best available input.
8. Codex replies or records a model/provider failure.
9. Enrichment work preserves canonical documents and retries failed parser/preservation work where appropriate.

### Pending PDF

1. Capture has text plus a PDF attachment with a stored path.
2. Parser state is `pending` or `running`.
3. Prompt assembly includes message text, attachment metadata, parser status, and raw PDF evidence if supported.
4. Codex can answer immediately.
5. Parser completion later adds extracted text for future context.

### Voice Memo

1. Capture has an audio attachment.
2. Before transcription, Codex sees message text and attachment metadata.
3. After transcription, parser completion writes `transcriptText`.
4. Prompt assembly includes the transcript as an attachment transcript section.

### Missing Inbox Runtime Config

1. Hosted workspace restore lacks inbox config.
2. Runtime bootstrap creates minimal non-secret inbox config before persistence/enrichment.
3. If preservation still fails, the assistant reply path continues.
4. A retry/diagnostic records the enrichment failure without marking the user message handled as failed.

## Tests

Add focused regression tests before or with implementation.

### Hosted Ingestion

- Hosted conversation import persists the capture even when parser registry creation fails.
- Hosted conversation import persists raw attachments before parser drain.
- Parser drain failure records a diagnostic and does not remove or hide the capture.

### Assistant Reply Path

- `preserveDocumentAttachments` throwing `INBOX_NOT_INITIALIZED` does not prevent a reply attempt or outbox intent.
- A pending PDF with a stored path does not produce `kind: "defer"`.
- A failed PDF parser state still produces prompt input with status and raw evidence when available.
- A text message plus pending voice memo does not defer solely because transcription is pending.
- A voice memo with `transcriptText` renders transcript text as first-class attachment content.
- Active-turn late input with a pending attachment does not throw only because parser output is not ready.

### Runtime Restore

- Hosted restore round-trips inbox runtime config.
- Hosted restore bootstraps missing non-secret inbox config.
- Hosted snapshot denylist excludes secret-like files and process-local files under `.runtime`.
- Hosted automation does not skip solely because inbox runtime config was absent before bootstrap.

### Diagnostics

- Parser and preservation failures emit privacy-safe structured diagnostics.
- Diagnostics include capture id and failure category, but not raw attachment content, raw paths, phone numbers, emails, auth headers, or secrets.

## Verification Plan

For implementation, run focused checks first:

- `pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-linq-document-preservation-e2e.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/runtime-state test -- hosted-bundle.test.ts`
- `pnpm --dir packages/runtime-state typecheck`

Then run broader checks before landing:

- `pnpm typecheck`
- `pnpm test:diff <touched test files>`
- `git diff --check`
- Privacy scan over touched files for local usernames, home paths, secrets, auth headers, phone numbers, and emails.

Docs-only edits for this plan only need exact-file diff checks and privacy scanning.

## Migration Plan

Phase 1: Persist-first hosted ingestion.

- Split hosted conversation import into durable persistence and best-effort parser drain.
- Add the parser-registry-failure persistence regression.

Phase 2: Best-effort prompt input.

- Remove pending/running attachment global defer.
- Render parser status and missing transcript/extracted text explicitly.
- Allow raw PDF/image evidence while parser state is pending or failed when stored evidence exists.

Phase 3: Preservation enrichment.

- Remove document preservation from the scan pre-reply gate.
- Add best-effort preservation result handling.
- Add focused no-silent-reply regression coverage.

Phase 4: Runtime continuity.

- Preserve `.runtime` by default with a denylist.
- Bootstrap missing non-secret inbox config during hosted restore/open.
- Add snapshot and bootstrap tests.

Phase 5: Cleanup.

- Update durable runtime docs after behavior is implemented.
- Remove obsolete comments or tests that assume parser completion is a reply precondition.

## Risks and Tradeoffs

- Codex may reply before a transcript or extracted PDF text is ready. That is acceptable if the prompt clearly marks missing parser output.
- Raw PDF/image evidence may increase model input cost. Limit this to stored evidence that the current prompt builder already knows how to attach.
- Preservation retry can duplicate work if idempotency is weak. Keep current canonical match checks and add tests before adding any retry loop.
- Broad `.runtime` inclusion can accidentally capture sensitive files. The denylist must be explicit, tested, and privacy-reviewed.
- Bootstrap must not fabricate secrets. Only create non-secret structural config.

## Non-Goals

- Do not replace the parser stack.
- Do not add a new broad assistant/enrichment state machine.
- Do not make canonical document import required for reply.
- Do not pass raw audio to Codex unless the provider/runtime supports it through an existing clean interface.
- Do not weaken secret handling to make snapshot restore easier.
- Do not log raw attachment content or local filesystem paths for debugging.

## Open Questions

- Should audio attachments get a short grace window before reply when the message contains no text, or should Codex always reply best-effort immediately?
- Should document preservation retry be opportunistic during assistant scans, or should it become a narrow maintenance pass?
- Which `.runtime` paths are definitely process-local and should be denied before the default-include policy lands?
- Should parser completion trigger a follow-up assistant wake only when no reply has happened yet, or also when the transcript materially changes available context?

## Working Set

Likely implementation files:

- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- `packages/inbox-services/src/inbox-services/promotions.ts`
- `packages/inbox-services/src/inbox-services/state.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/inbox-local-state-descriptors.ts`
