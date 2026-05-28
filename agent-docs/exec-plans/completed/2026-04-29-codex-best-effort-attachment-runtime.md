# Codex Best-Effort Attachment Runtime

## Goal

Make Codex assistant turns robust when inbox parsing, document preservation, restored runtime state, or hosted mailbox sequencing is imperfect.

Success means:

- A hosted mailbox item cannot create a permanent lane gap when duplicate webhook appends race.
- A hosted capture that was accepted by the webhook is persisted and checkpointed before parser setup, parser drain, rebuild, or preservation work can run.
- Codex replies from the best available context instead of waiting for perfect parser output.
- Parser failures, pending parser jobs, missing non-secret inbox config, and document preservation failures do not block the assistant reply path.
- Voice memos have a first-class route into the prompt through `transcriptText` when Whisper output is available.
- Attachment prompt text only claims evidence that is actually available to the model.
- Hosted snapshots preserve durable operational runtime state while excluding projections, caches, temp files, secrets, process-local state, and secret-like unknown files.

## Problem

The current assistant path lets enrichment and runtime maintenance work gate the primary reply path.

Observed failure shape:

- The incoming conversation webhook was accepted.
- The hosted assistant scan found the capture.
- Document attachment preservation ran before the reply.
- Preservation called inbox initialization and failed because restored hosted runtime state was incomplete.
- The scan emitted a capture failure and stopped before outbox/reply work.
- The user saw no assistant reply.

That failure is the wrong ownership boundary. Document preservation is useful enrichment. It is not required for Codex to understand and answer a message.

The stress review found three more loss windows that need to be treated as part of the same robustness problem:

- Hosted mailbox append can burn a lane sequence number when duplicate webhook retries race, leaving a permanent `lane.gap`.
- Hosted conversation import currently uses the parsed inbox pipeline. That pipeline persists first, but it only returns after parser drain. Hosted checkpointing happens after import returns, so parser drain failure or hang can still delay durable hosted checkpointing.
- Hosted wake context prep can run rebuild work before local capture import. A stale/corrupt prior inbox record should not block persistence of a new accepted message.

There is also a prompt assembly problem. Attachment parser state is treated as a global readiness gate. If any attachment is `pending` or `running`, both the legacy string prompt path and the prepared multimodal path can defer even when useful context already exists: message text, attachment metadata, image evidence, or a prior transcript.

## Architectural Invariant

Accepted user input is the product-critical lane. Parsing, preservation, projection rebuild, and canonical import are enrichment lanes.

Conversation import is not conversation handling. A capture remains pending until durable terminal auto-reply evidence exists for that capture. Mailbox watermarks, inbox projections, and scan hints prove discovery/import only; they never prove assistant handling.

The assistant should operate from:

1. Message text.
2. Parsed attachment text or transcript when available.
3. Raw image evidence when it is actually attached to the model input.
4. File/PDF evidence only when the provider route proves file-part support.
5. Attachment metadata and explicit parser status when no richer evidence exists.

No parser, preservation, projection rebuild, raw artifact materialization, or canonical import step should be able to make Codex silent after the system has accepted a user message.

## Design Principles

- Keep one primary state machine: assistant reply/outbox state.
- Keep parser state in the existing attachment parser fields.
- Do not add a document-preservation queue or retry state in the first pass.
- Use existing assistant scan/wake behavior for opportunistic enrichment retries.
- Convert enrichment failures into privacy-safe diagnostics and wake hints, not reply-path failures.
- Make prompt input assembly read-only and best-effort: it should classify available evidence and build model input without mutating runtime state.
- Prefer one shared attachment evidence classifier over parallel legacy/prepared prompt branches.
- Treat local paths, raw attachments, transcripts, contact identifiers, and provider payloads as sensitive. Do not render local paths into model text or diagnostics.

## Final Shape

### Current Implementation Slice

This plan is now being implemented for the hosted conversation loss window:

- Delete the `afterCheckpointBeforeAssistant` phase from mailbox imports and runner orchestration. Read acknowledgements, parser drain, and provider cleanup cannot sit between import checkpoint and assistant admission.
- Make auto-reply selection evidence-based. A capture is excluded from pending work only when it has per-capture terminal handling evidence: reply intent committed, replied/deferred artifacts, or explicit suppression.
- Treat auto-reply channel state as a fixed enablement boundary. It must not advance after processing and must not hide unhandled captures behind it.
- Add explicit suppression evidence for intentional no-reply outcomes. Failed reply artifacts stay observability/retry evidence, not terminal handling proof.
- Keep eventual Linq provider cleanup by queueing inbound Linq message deletion after terminal handling evidence exists, then draining the existing hosted provider cleanup retry state after commit.

2026-04-29 update:

- Deleted the old chat-result/chat-deferred/group-outcome artifact authority from assistant auto-reply handling. `chat-error.json` remains non-terminal observability only.
- Kept terminal auto-reply evidence as the only replay/dedupe authority for handled captures, with repair for partially written group evidence.
- Added `checkpointRequired` propagation so terminal evidence writes count as hosted pass progress even when no scan cursor or automation state changes.
- Kept evidenced captures in the scanner candidate set when their terminal evidence group is incomplete, so missing sibling evidence can be repaired before duplicate reply work.
- Updated focused assistant-engine coverage and status fixtures to the fixed `eligibleAfter` channel state shape.
- Added a hosted runner regression that simulates a reset after mailbox import checkpointing and proves the next invocation still runs/checkpoints assistant work from the advanced watermark state.
- Updated the hosted Linq document-preservation E2E expectation to match the current best-effort parser drain: the capture is still preserved from raw inbox evidence after inbox runtime init, and one parser job may already have been processed.
- Documented the reset recovery invariant in the hosted runtime protocol and live architecture docs.

### 0. Close Hosted Mailbox Lane Gaps

Before the attachment/runtime changes, fix the mailbox append sequencing risk.

Current high-risk shape:

1. Append checks for an existing dedupe key.
2. Append allocates the next lane sequence.
3. Insert uses `ON CONFLICT DO NOTHING`.
4. Under a duplicate race, one transaction can burn a sequence number without inserting a row.
5. The next real message gets a later sequence and the hosted runtime sees a permanent lane gap.

Proposed shape:

- Serialize append per `(userId, lane)`, or allocate the lane sequence only in the transaction that wins the dedupe insert.
- Add a concurrent duplicate append test proving duplicate retries do not create lane gaps.
- Treat this as Phase 0 because no amount of parser best-effort behavior helps if the mailbox lane is already gapped.

Expected code targets:

- `apps/web/src/lib/hosted-mailbox/store.ts`
- Focused hosted mailbox store tests

### 1. Persist and Checkpoint Before Parse

Change hosted conversation ingestion so capture persistence and hosted checkpointing happen before parser registry construction, parser drain, rebuild, channel reconciliation, or document preservation.

Current high-risk shape:

1. Normalize hosted conversation capture.
2. Prepare hosted wake context, including rebuild work.
3. Open inbox runtime.
4. Create configured parser registry.
5. Create parsed inbox pipeline.
6. Persist capture and drain parsers through that pipeline.
7. Return from import.
8. Hosted mailbox checkpoint/watermark commits.

Proposed shape:

1. Normalize hosted conversation capture.
2. Open vault and create missing non-secret inbox config only.
3. Persist capture through the plain inbox pipeline.
4. Return the persisted capture to the mailbox checkpoint path.
5. Commit hosted mailbox checkpoint/watermark.
6. Start parser registry setup and parser drain as bounded best-effort post-checkpoint work.
7. Run rebuild, channel reconciliation, and document preservation after capture persistence.

Parser setup or parser drain failures should return imported capture metrics plus diagnostics. They should not make the mailbox import look failed after capture persistence.

Email has one extra durability condition: the raw email object must still exist. If the raw object is missing, the mailbox item should remain retryable and watermarks should not advance.

Expected code targets:

- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/email.ts`
- The plain inbox pipeline owner in `packages/inboxd`

The important behavior is simple: parser work can lag; accepted capture persistence and checkpointing cannot.

### 2. Shared Best-Effort Attachment Evidence Classifier

Replace the global pending-attachment defer with per-attachment evidence classification.

Current high-risk shape:

- `buildAssistantAutoReplyPrompt` calls `hasAssistantAutoReplyPendingAttachments`.
- `prepareAssistantAutoReplyInput` also calls `hasAssistantAutoReplyPendingAttachments`.
- Any `pending` or `running` attachment can return `kind: "defer"`.
- Metadata-only attachments are often invisible because `renderPreparedAttachmentPromptSection` drops attachments with no parsed text and no rich image/PDF candidate.

Proposed classifier output:

- `parsed_text`: `extractedText` or derived parser text is available.
- `transcript`: `transcriptText` is available.
- `raw_image`: image bytes are attached to model input.
- `raw_file_supported`: file/PDF bytes are attached to model input through a provider route that supports file parts.
- `metadata_status`: bounded attachment metadata and parser state only.
- `unusable`: no safe evidence can be shown.

Prompt assembly should:

- Remove both pending/running global defers.
- Build attachment bundles for captures under consideration.
- Render transcript text as transcript content when `transcriptText` exists.
- Render parser state for pending, running, failed, and unavailable parser output.
- Render metadata/status for pending or failed audio/PDF/image attachments even without parsed text.
- Avoid rendering `storedPath` and `derivedPath` into model text.
- Attach raw image evidence only when it is actually passed to the provider.
- Attach PDF/file evidence only when the provider capability route supports file parts.
- Generate prompt wording from actual attached content, not from candidate intent.

Expected code targets:

- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- Provider capability/rich-content routing code if PDF/file support is added in this pass

This keeps the behavior monotonic. More parser output improves the prompt, but missing parser output does not erase the input.

### 3. Voice Memo Path

Keep audio parsing first class through `transcriptText`.

The current parse completion path writes audio/video parser output to `transcriptText`. The prompt path already has support for `attachment_transcript` fragments. The issue is the readiness gate before prompt assembly.

Desired behavior:

- If Whisper/transcription output is available, Codex sees it as a transcript.
- If transcription is pending, Codex still sees sender text and bounded attachment status.
- If transcription failed, Codex sees that the audio transcript is unavailable.
- Raw audio should not be added as a model input type in this pass unless the provider/runtime already supports it through a clean interface.
- A no-text voice memo can produce metadata/status input instead of a parser wait loop.

Expected code targets:

- `packages/parsers/src/pipelines/worker.ts`
- `packages/inboxd/src/kernel/sqlite/parse-jobs.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`

Non-goal: replace Whisper or redesign parser artifacts.

### 4. Document Preservation as Nonblocking Enrichment

Keep `preserveDocumentAttachments` because it imports canonical document attachments into the vault. Move it out of the pre-reply gate.

Current high-risk shape:

- The scanner calls preservation before considering or replying to a capture.
- If preservation throws, the scan breaks before reply work.

Proposed shape:

- Remove preservation from the critical pre-reply path.
- Run document preservation after the reply attempt, or in a later assistant scan pass.
- Use a single best-effort helper such as `runDocumentPreservationBestEffort`.
- Catch preservation errors and emit a privacy-safe diagnostic.
- Optionally request a later wake, but do not add a durable preservation queue in the first pass.
- Do not advance or suppress assistant reply cursors based on preservation failure.

Expected code targets:

- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/inbox-services/src/inbox-services/promotions.ts`
- `packages/inbox-services/src/inbox-services/state.ts`

The preservation function can still enforce its own invariants. The change is where its failures are allowed to propagate.

### 5. Hosted Runtime Snapshot and Bootstrap

Codify and harden the current hosted snapshot policy rather than redesigning it.

Current reality:

- Hosted snapshots already include durable `.runtime/operations/**` by default unless excluded.
- Hosted snapshots exclude `.runtime/projections/**`, `.runtime/cache/**`, and `.runtime/tmp/**`.
- Inbox config and state can round-trip even though their descriptors say `machine_local`.
- Descriptors are taxonomy/audit metadata; the hosted snapshot predicate is the hosted portability gate.

Proposed shape:

- Preserve durable `.runtime/operations/**` by default.
- Keep projections, cache, temp, locks, pid/socket files, quarantine, device-sync state, parser toolchain overrides, and process-local files excluded.
- Harden the denylist for secret-like unknown files, including token/key/credential/private-key/cookie/session basenames and process logs.
- Centralize this in one helper such as `isHostedRuntimeSecretLikeBasename`.
- Restore snapshot files with private file permissions where the runtime requires it.
- Rebuild `.runtime/projections/inboxd.sqlite` from canonical inbox evidence on hosted restore/open if it is missing.
- Use `ensureConfigFile` for missing non-secret inbox config.
- Never overwrite invalid existing config.
- Never fabricate connector credentials or secrets.

Expected code targets:

- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/hosted-bundle-node.ts`
- `packages/runtime-state/src/local-state-taxonomy.ts`
- `packages/runtime-state/src/inbox-local-state-descriptors.ts`
- Hosted workspace restore/bootstrap code under `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/inbox-services/src/inbox-services/state.ts`

This gives the user the practical "restore runtime broadly" behavior without serializing arbitrary runtime secrets or rebuildable projections.

### 6. Raw Artifact Materialization

Best-effort prompt assembly should not assume externalized raw artifacts are already present on disk after hosted restore.

Proposed shape:

- Before attempting raw image or supported file/PDF evidence, materialize the needed externalized artifact if the restore path skipped it.
- If materialization fails or the provider route does not support that evidence type, degrade to metadata/status.
- Do not throw from per-attachment raw evidence reads.
- Do not tell the model to inspect evidence that was not attached.

Expected code targets:

- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- Rich-content routing/provider capability code

## Cursor and Reply Semantics

Parser and preservation outcomes must not decide whether the assistant reply cursor advances.

Cursor behavior should be explicit:

- Successful reply creation or queued outbox delivery advances according to existing reply result rules.
- Provider/model failure before an outbox intent should hold the cursor for retry.
- Prompt assembly should degrade per attachment. A raw evidence read failure should not throw the whole group into a generic failure path.
- Whole-input assembly failures that prevent any model attempt should hold the cursor, not mark the capture handled.
- Parser completion after a best-effort reply should not trigger a duplicate reply for the same capture.
- Active-turn late input should accept metadata/status-only captures when useful, or gracefully treat them as no-new-input. It should not convert pending parser state into a budget-exhaustion error.

## Diagnostics

Use concrete, privacy-safe diagnostic categories:

- `mailbox_lane_gap_prevented`
- `parser_registry_unavailable`
- `parser_drain_failed`
- `preservation_failed_nonblocking`
- `inbox_config_bootstrapped`
- `inbox_projection_rebuilt`
- `raw_artifact_unavailable`
- `best_effort_attachment_prompt`

Diagnostics may include:

- Capture id.
- Attachment id or ordinal.
- Parser state.
- Failure category.
- Retry/wake hint.

Diagnostics must not include:

- Raw attachment content.
- Message text or transcripts.
- Local filesystem paths.
- Phone numbers, emails, chat ids, provider ids, auth headers, or secrets.
- Provider request/response payloads.

## Detailed Flow

### Incoming Hosted Message

1. Webhook appends the mailbox item without creating lane gaps.
2. Hosted runtime receives the mailbox item.
3. Runtime performs only minimal vault/bootstrap work needed to persist input.
4. Plain inbox pipeline persists the capture and raw attachment references.
5. Hosted mailbox checkpoint/watermark commits.
6. Parser drain, rebuild, channel reconciliation, and preservation run best-effort.
7. Assistant automation wakes.
8. Prompt assembly classifies available attachment evidence.
9. Codex replies or records a model/provider failure.
10. Enrichment work continues opportunistically.

### Pending Attachment

1. Capture has text plus an attachment with parser state `pending` or `running`.
2. Prompt assembly includes message text and bounded attachment status.
3. If actual raw image evidence is attached, prompt text says image evidence is attached.
4. If PDF/file support is not available, prompt text does not claim the file is attached.
5. Codex can answer immediately from available context.
6. Parser completion later improves future context without duplicating the already-handled reply.

### Voice Memo

1. Capture has an audio attachment.
2. Before transcription, Codex sees message text if present plus audio attachment status.
3. After transcription, parser completion writes `transcriptText`.
4. Prompt assembly includes the transcript as first-class attachment transcript content.

### Missing Inbox Runtime Config

1. Hosted workspace restore lacks inbox config.
2. Runtime calls the narrow missing-only `ensureConfigFile` path.
3. Persistence and reply continue.
4. Invalid existing config fails clearly in the dependent path but does not cause unrelated assistant reply work to go silent.

## Tests

Add focused regression tests before or with implementation.

### Hosted Mailbox

- Concurrent duplicate appends do not burn lane sequence numbers.
- A real message after duplicate retries receives the next contiguous sequence.
- A lane gap is not introduced by `ON CONFLICT DO NOTHING`.

### Hosted Ingestion

- Hosted conversation import persists and checkpoints the capture before parser registry creation.
- Parser registry creation failure after persistence does not prevent checkpointing.
- Parser drain hang/failure after persistence does not prevent checkpointing.
- Hosted wake prep rebuild failure does not block persistence of a new accepted capture.
- Missing raw email object leaves the mailbox item retryable and does not advance watermarks.
- Hosted conversation import persists raw attachment references before parser drain.

### Assistant Reply Path

- `preserveDocumentAttachments` throwing `INBOX_NOT_INITIALIZED` does not prevent a reply attempt or outbox intent.
- Preservation failure does not decide reply cursor advancement.
- Parser failure does not block reply.
- Provider failure before outbox holds the cursor.
- Queued outbox advances the cursor according to existing reply rules.
- Parser completion after a best-effort reply does not trigger a duplicate reply.
- A pending attachment does not produce `kind: "defer"` in either prompt path.
- A pending audio attachment with no text can produce metadata/status input instead of a wait loop.
- A failed parser state still produces bounded status input when safe.
- Active-turn late input with a pending attachment does not throw only because parser output is not ready.

### Evidence and Prompt Safety

- Voice memo `transcriptText` renders as first-class transcript content.
- Prompt text does not include `storedPath` or `derivedPath`.
- Prompt text does not claim image/file/PDF evidence is attached unless the content part is actually routed to the provider.
- Raw image read failure degrades to metadata/status.
- PDF/file evidence is either capability-supported and tested end to end, or represented as metadata/status only.
- Restored externalized raw image/PDF artifacts are materialized before raw evidence use, or safely degrade to metadata/status.

### Runtime Restore

- Hosted restore round-trips `.runtime/operations/inbox/config.json`.
- Hosted restore bootstraps missing non-secret inbox config with `ensureConfigFile`.
- Invalid existing inbox config fails clearly and is not overwritten.
- Hosted snapshot excludes projections, cache, temp, process-local files, quarantines, parser toolchain overrides, and device-sync state.
- Hosted snapshot excludes secret-like basenames outside `secrets/`, including token/key/credential/private-key/cookie/session/log files.
- Restored runtime files use private permissions where required.
- Hosted restore/open rebuilds missing inbox projections from canonical inbox evidence.
- Hosted automation does not skip solely because inbox config was absent before missing-only bootstrap.

### Diagnostics

- Parser and preservation failures emit privacy-safe structured diagnostics.
- Diagnostics use known categories.
- Diagnostics include capture id and attachment id/ordinal where useful.
- Diagnostics do not include raw content, local paths, contact identifiers, auth headers, provider payloads, or secrets.

## Verification Plan

For implementation, run focused checks first:

- `pnpm --dir apps/web test -- hosted-mailbox`
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
- Privacy scan over touched files for local usernames, home paths, secrets, auth headers, phone numbers, emails, and local paths in generated diagnostics/prompts.

Docs-only edits for this plan only need exact-file diff checks and privacy scanning.

2026-04-29 reset-replay close-out verification:

- `pnpm --dir packages/cli typecheck`: passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-runner.test.ts -t "runs the assistant phase on restart after the import checkpoint already advanced"`: passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-linq-document-preservation-e2e.test.ts test/hosted-runtime-workspace-runner.test.ts`: passed.
- `pnpm --dir packages/assistant-runtime test:coverage`: passed.
- `pnpm typecheck`: passed.
- `pnpm docs:drift`: passed.
- `git diff --check` on scoped files: passed.
- Required security/privacy, coverage-write, and final-review passes found no blockers.

## Migration Plan

Phase 0: Hosted mailbox lane sequencing.

- Fix duplicate append sequencing so dedupe conflicts cannot burn lane sequence numbers.
- Add concurrent duplicate append regression coverage.

Phase 1: Persist and checkpoint before parser drain.

- Split hosted conversation import into durable plain-pipeline persistence and post-checkpoint best-effort parser drain.
- Split minimal pre-import bootstrap from rebuild/enrichment work.
- Add parser-registry, parser-drain, rebuild, and missing-raw-email regressions.

Phase 2: Shared best-effort prompt input.

- Remove both pending/running attachment global defers.
- Replace them with a per-attachment evidence classifier.
- Render parser status and missing transcript/extracted text explicitly.
- Unify or retire the legacy string prompt path so it cannot drift from the prepared multimodal path.
- Capability-gate PDF/file evidence and avoid overclaiming.

Phase 3: Preservation enrichment.

- Remove document preservation from the scan pre-reply gate.
- Add the best-effort preservation helper with privacy-safe diagnostics.
- Keep retry opportunistic through existing scan/wake behavior.

Phase 4: Runtime continuity hardening.

- Codify current hosted snapshot behavior: durable operational runtime included, projections/cache/tmp excluded.
- Harden denylist coverage for secret-like unknown runtime files.
- Add private restore permission tests.
- Add missing-only inbox config bootstrap and projection rebuild coverage.

Phase 5: Cleanup.

- Update durable runtime docs after behavior is implemented.
- Remove obsolete comments or tests that assume parser completion is a reply precondition.
- Keep descriptors documented as taxonomy/audit metadata, not the hosted snapshot gate.

## Risks and Tradeoffs

- Codex may reply before a transcript or extracted document text is ready. That is acceptable if prompt text clearly marks missing parser output.
- Metadata-only replies can be less helpful than waiting. This is still better than silence, and product behavior can add a small audio grace window later if evidence supports it.
- Raw image/file evidence can increase model input cost. Only attach evidence the provider route can actually consume.
- PDF support may require provider capability work. Do not claim PDF evidence is available until that path is tested end to end.
- Preservation retry can duplicate work if idempotency is weak. Keep current canonical match checks and avoid a new retry queue in the first pass.
- Broad operational runtime inclusion can accidentally capture sensitive files. The denylist must be explicit, table-tested, and privacy-reviewed.
- Projection rebuild must be reliable enough that excluding `.runtime/projections/**` does not hide persisted captures after restore.

## Non-Goals

- Do not replace the parser stack.
- Do not add a new broad assistant/enrichment state machine.
- Do not add a durable preservation queue in the first pass.
- Do not make canonical document import required for reply.
- Do not pass raw audio to Codex unless the provider/runtime supports it through an existing clean interface.
- Do not snapshot `.runtime/projections/**`, cache, temp, or process-local state.
- Do not weaken secret handling to make snapshot restore easier.
- Do not log raw attachment content, local filesystem paths, contact identifiers, or provider payloads for debugging.

## Open Questions

- Should audio attachments get a short grace window before reply when the message contains no text, or should Codex always reply best-effort immediately?
- Should document preservation retry stay opportunistic forever, or become a narrow maintenance pass after evidence shows retries are needed?
- Which exact secret-like basenames should the hosted runtime denylist cover beyond token/key/credential/private-key/cookie/session/log patterns?
- Should parser completion trigger a follow-up assistant wake only when no reply has happened yet, or also when the transcript materially changes available context?
- Should PDF/file support be added to the Codex provider route in this pass, or deferred until after metadata/status robustness lands?

## Working Set

Likely implementation files:

- `apps/web/src/lib/hosted-mailbox/store.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/email.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- `packages/inbox-services/src/inbox-services/promotions.ts`
- `packages/inbox-services/src/inbox-services/state.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/hosted-bundle-node.ts`
- `packages/runtime-state/src/local-state-taxonomy.ts`
- `packages/runtime-state/src/inbox-local-state-descriptors.ts`
