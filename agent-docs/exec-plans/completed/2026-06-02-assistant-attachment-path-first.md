# Assistant Attachment Path-First Simplification

## Goal

Make document and data-file attachments usable by the assistant as soon as the file is persisted. For PDFs, CSVs, and similar non-image files, the assistant context should say that the user sent an attachment and provide a usable local raw file path. Automatic extracted text should not be required, should not gate assistant replies, and should not be the primary prompt surface.

Images remain different: they should keep the existing multimodal byte routing where appropriate.

## Success Criteria

- A hosted Linq PDF or CSV attachment that has been downloaded and persisted is visible to the assistant with file metadata and the canonical `storedPath` under `raw/inbox/...` before any parser output exists.
- Assistant prompt construction does not need `extractedText`, parser manifests, or `parseState=complete` for document/data-file attachments to be considered usable.
- Hosted conversation import does not synchronously drain document/data-file parser jobs before the assistant can answer.
- Ingestion does not automatically enqueue document/data-file parser jobs for the assistant handoff path.
- Attachment-bearing inputs do not reach prompt prep before downloaded raw attachment `storedPath` evidence is available, or before a clear unavailable-file state is recorded for failed downloads.
- Images still route as multimodal content when the provider supports image input.
- Captureless late-input handling includes the same raw attachment evidence path that normal staged inputs include.
- Provider prompts avoid provider URLs, external attachment IDs, secrets, or absolute machine paths.

## Current Evidence Path

The current pipeline already persists raw attachments, but then layers parser state into the assistant handoff:

- Linq normalization downloads attachment bytes into inbound capture attachments: `packages/inboxd/src/connectors/linq/normalize.ts`.
- Inbox persistence stores raw attachment files under inbox raw storage and records `storedPath`: `packages/inboxd/src/indexing/persist.ts`.
- Inbox runtime enqueues parser jobs for attachment kinds that are configured for automatic parsing and records parser state: `packages/inboxd/src/kernel/sqlite.ts`.
- Hosted conversation import currently drains parser jobs after capture processing: `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`.
- Hosted mailbox import stages assistant input first, then creates assistant input attachment evidence after checkpoint projection: `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`.
- Assistant evidence materialization can be simplified to use validated `raw/inbox/...` `storedPath` values directly. Prompt-only raw copies under `raw/assistant-input/...` are unnecessary complexity: `packages/assistant-engine/src/assistant/inbox-attachment-evidence.ts`.
- Assistant prompt bundle construction mixes raw paths, parser state, inline extracted text, derived parser manifests, and image byte routing: `packages/assistant-engine/src/assistant/attachment-evidence-model.ts` and `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`.
- Captureless late-input prompt construction can currently render descriptors without using the same attachment evidence bundle path: `packages/assistant-engine/src/assistant/automation/reply.ts`.
- Assistant reply scanning can still trigger document-preservation side effects after replies; that automatic promotion hook should be removed from the path-first handoff.

## Proposed Architecture

1. Treat canonical raw attachment `storedPath` as the assistant readiness boundary.

   Once an attachment has a validated local `storedPath` and basic metadata, document/data-file attachments are ready for the assistant. Parser output is not part of readiness. Descriptors alone are not enough.

2. Use `raw/inbox/...` directly.

   `raw/inbox/...` is already the canonical persisted file location. Do not create or accept a second `raw/assistant-input/...` copy just so the assistant can refer to the file. If the `raw/inbox/...` path shape is too revealing or too coupled to inbox internals, fix the inbox storage path shape itself rather than adding an alias layer.

3. Keep one assistant attachment surface.

   For non-image attachments, render a compact attachment block with:

   - ordinal
   - file name
   - MIME type
   - byte size when available
   - local raw path
   - a short instruction that the file is available at that path and should be inspected with local tools when needed

   Do not inline extracted text or parser manifests into the prompt for PDFs/CSVs/documents by default.

4. Keep images multimodal.

   Images can still include metadata/raw path in text, but the provider input should keep sending image bytes where supported.

5. Remove document/data parser dependency from hosted assistant reply readiness.

   Hosted conversation import should not wait on document/data-file parser jobs. The assistant can inspect the raw path with tools if the user asks about the file. Existing audio/video transcription can remain queued and drained because it is a different media workflow.

6. Delete automatic document/data-file parser enqueue from the assistant handoff path.

   Automatic parser enqueue is a second state machine for something the assistant can do explicitly with tools. The cleaner long-term shape is: ingestion stores the file and records `storedPath`; the assistant or an explicit product action parses the file only when needed. Parser code can remain available, but parser jobs should not be created automatically for PDFs/CSVs/documents as part of assistant readiness.

7. Remove hidden document preservation from assistant scanning.

   Reply scanning should not automatically preserve or promote document attachments after a reply. Explicit product actions can keep using preservation/promote APIs, but the assistant handoff should not have a background document-specific side effect.

8. Keep path exposure narrow and local.

   The prompt should expose only validated local vault-relative `raw/inbox/...` paths that assistant tools can read. It should not expose provider download URLs, provider auth state, external message IDs as attachment fallbacks, query strings, object-store keys, `file://` URLs, machine absolute paths, home-relative paths, backslashes, dot segments, or any path-like text copied from untrusted `combinedText`.

## Implementation Shape

### Phase 1: Lock the Desired Behavior With Tests

- Add or update a PDF-only hosted Linq test proving the provider request includes a local raw attachment path and does not require parser output.
- Add a CSV/document prompt-builder test proving non-image attachments are usable with path-only evidence.
- Add coverage for captureless late-input prompt construction so it includes raw attachment evidence.
- Add coverage for failed attachment download or missing `storedPath` so the assistant does not pretend the file is readable.
- Preserve image multimodal tests.

### Phase 2: Make StoredPath Evidence Available Before Prompt Prep

- Ensure attachment-bearing hosted inputs get validated `storedPath` evidence before assistant prompt preparation/admission.
- Do not rely on an after-checkpoint effect that can run after the initial assistant phase.
- Use the existing inbox `storedPath` directly for document/data-file prompt handoff.
- Delete document/data-file prompt copies to `raw/assistant-input/...`; keep image byte routing on the original `raw/inbox/...` file.
- For failed downloads, record a clear unavailable-file state instead of a path.

### Phase 3: Remove Automatic Document/Data Parser Coupling

- Ensure `drainHostedConversationParsers` has no document/data-file work to drain and returns immediately when no media parser jobs are queued.
- Stop automatic document/data-file parser job enqueue for the assistant handoff path.
- Stop writing or surfacing parser pending/failed state as document/data-file attachment readiness.
- Remove old `raw/assistant-input/...` and `derived/assistant-input/...` roots from new assistant input attachment evidence.
- Remove automatic document-preservation calls from reply scanning.
- Only compute and pass derived parser manifest paths for audio/video parser evidence.
- Update inbox parser/status/search surfaces that assumed document/data-file parsing was automatically queued. Keep only explicit parser behavior where there is a deliberate caller.

### Phase 4: Simplify Assistant Attachment Prompt Bundles

- For non-image attachments, make raw path metadata enough to produce prompt content.
- Stop rendering parser status, parser lifecycle text, inline extracted text, and derived parser manifests for document/data-file attachments by default.
- Render paths only from structured, revalidated attachment evidence. Do not pass through path-like lines from `combinedText`.
- Use the same compact attachment renderer for normal staged inputs and captureless late inputs.
- Keep image byte routing intact.

### Phase 5: Align Prompt Guidance

- Update assistant system/policy prompt wording away from automatic parse/import assumptions.
- The model guidance should say that attached files are available at local paths and can be inspected with tools as needed.

### Parser Code Boundary

- Do not delete parser packages or parser helpers as part of this plan unless they become unused after removing auto enqueue.
- Keep parser functionality as explicit/tool-time behavior if there is still a caller that intentionally requests parsing.
- If no deliberate parser caller remains for PDFs/CSVs/documents, remove that dead parser surface in the same implementation pass instead of preserving a vestigial queue/status model.

## Non-Goals

- Do not delete parser packages, database columns, or historical parser state unless the implementation proves they are unused after removing automatic enqueue.
- Do not migrate old inbox data.
- Do not introduce a new attachment storage owner or queue.
- Do not introduce or require a second prompt-only attachment copy for PDFs/CSVs/documents.
- Do not send PDF/CSV bytes as provider-native file inputs unless there is a separate explicit product decision.
- Do not broaden path disclosure beyond validated local `raw/inbox/...` stored paths for attachments.

## Open Questions

- Should audio and video stay on the current transcription path, or follow the same raw-path-first rule? Default for this plan: keep them out of scope and preserve current transcript behavior.
- Which current parser/status/search tests should be retired because they only validate the old automatic enqueue model?
- Are there any deliberate parser callers that should remain as explicit/tool-time behavior after automatic enqueue is removed?
- Can image byte routing also read directly from `storedPath`, or does it still need a separate materialized artifact path for provider input?

## Subagent Review Prompts

Run four review passes before implementation:

1. Architecture simplification reviewer: find redundant layers and propose ways to collapse this plan further.
2. Runtime edge-case reviewer: inspect hosted/Linq/email/Telegram timing, captureless late inputs, failed downloads, retry behavior, and active-turn behavior.
3. Security/privacy reviewer: inspect path exposure, prompt metadata, logs, provider payloads, and raw artifact boundaries.
4. Test/compatibility reviewer: identify fragile tests, parser consumers, image/audio/CSV compatibility issues, and the smallest verification set.

## Verification Target

- Focused assistant-engine attachment prompt/model tests.
- Focused assistant-runtime hosted conversation/import tests, including no document/data parser drain and pre-prompt raw evidence.
- Focused Cloudflare hosted-local Linq PDF e2e test if expectations change there.
- Focused inboxd/inbox-services parser/status tests updated to prove document/data-file ingestion no longer creates automatic parser jobs, while any explicit parser call still works if retained.
- `pnpm typecheck` unless blocked by unrelated dirty work.
- A direct provider-request inspection showing a non-image `raw/inbox/...` `storedPath` is present, parser output is not required, and provider URLs/absolute machine paths are absent.

## Review Outcomes

- Architecture review: subagents recommended `raw/assistant-input/...` as a privacy alias, but the simpler target is to use canonical `raw/inbox/...` `storedPath` directly for document/data-file prompts. Any path-shape concern should be fixed at inbox storage, not by adding a second file location.
- Runtime review: the main bug risk is staging before projection/evidence; path evidence must exist before prompt prep, captureless late inputs must reuse the same renderer, and failed downloads must not become misleading path prompts.
- Security/privacy review: render prompt paths only from structured revalidated local `storedPath` refs; do not trust `combinedText` path lines or fall back to provider URLs/IDs.
- Test/compatibility review: update assistant prompt/evidence and hosted no-drain tests first; with the revised architecture, also update or retire parser/status/search tests that only encoded automatic document/data-file enqueue.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
