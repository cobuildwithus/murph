# Expand secure file delivery to common media

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal

- Let secure file delivery prepare common images, audio, video, and documents
  through its existing file-and-destination approval and outbox.

## Success criteria

- Generated and saved media reach approval with the correct MIME type and
  unchanged bytes; unsupported extensions return an actionable tool result.
- Existing hash, path, permission, destination, retry, and cleanup checks pass.
- Focused tests, typecheck, parent review, and a real-Codex journey pass.

## Scope

- In scope: extend the file owner's extension map to provider-supported common
  media and document formats; explain unsupported formats without private data.
- Out of scope: arbitrary binaries, changing public URL validation, raising
  size limits, new delivery methods, production sends or deployment.

## Constraints

- Reuse generated-delivery staging, secure approval, outbox, Linq attachments,
  and Telegram multipart documents. Add no state, queue, or dependency.
- Preserve existing consent and destination binding; retain ordinary vault files.

## Risks and mitigations

1. A file accepted locally could fail at the provider MIME boundary.
   Prove mappings through the existing Linq adapter and Telegram send path.
2. Old runners cannot revalidate newly supported media.
   Existing persisted descriptors accept MIME strings, but old file readers
   reject the new extensions. Require runner convergence before relying on
   new-format intents and retain the expanded reader as the rollback floor.

## Tasks

1. Prove the missing media extensions with focused regressions.
2. Extend the current map and actionable unsupported-format result.
3. Prove preparation, verified reads, cleanup, and provider dispatch.
4. Run focused real-Codex approval/recovery journeys and review the replies.
5. Update the durable contract and changelog, review, and commit.

## Decisions

- The public-image validator separately rejects query strings; this change
  addresses secure file delivery only.
- Current generated JPEG preparation rejects the extension before file adoption
  or approval. Existing generated-file tests exercise PDFs.
- Product UX: a requested saved or newly generated media file should produce
  one approval request, followed by the existing runtime-owned delivery after
  approval. Unsupported files should get a concise conversion/ZIP option.
- Affected journeys: iMessage and private Telegram; generated and existing
  files; pending approval, approval replay, changed bytes, unsupported format.
- No additional awaited network/database operations or initial prompt changes.

## Verification

- Focused assistant vault-file, generated-delivery cleanup, Linq attachment,
  Telegram delivery, and dynamic-tool tests; assistant-engine typecheck.
- One focused real-Codex media approval/recovery journey using production tools
  and synthetic ports. Provider mocks prove request construction, not receipt.
- Changelog generation/render proof, complexity diff, and scoped diff review.

## Results and review

- Regression first: 16 new image/audio/video/EPUB preparation cases failed with
  the unsupported-type error while both existing PDF cases passed.
- Final focused command: `pnpm --filter @murphai/assistant-engine exec vitest run
  --config vitest.config.ts --no-coverage test/assistant-vault-file-send.test.ts
  test/assistant-generated-delivery-files.test.ts test/assistant-telegram-files.test.ts
  test/assistant-runtime-residue.test.ts`: 163 passed.
- All 39 added extension mappings pass the actual Linq upload adapter's MIME
  contract using synthetic reservation/upload responses and exact-byte checks.
- Assistant-engine and hosted-web typechecks pass. Changelog generation and
  `apps/web/test/changelog-page.test.tsx` pass (10 tests).
- Real-Codex commands: `pnpm test:assistant:live -- --test 'real Codex common
  media file delivery e2e.*poster'` and the same pattern ending in `archive`.
  Both pass with gpt-6.1-sol and local subscription authentication. JPEG:
  one tool call, one approval, one awaiting-approval intent, unchanged original.
  Unsupported binary: one tool call, zero approvals/intents, unchanged original.
  Both replies were reviewed: truthful, concise, no premature delivery claim,
  no model-visible approval capability. Product UX verdict: Ready locally.
- Parent review: scoped extension map, safe fixed error copy, generated-file
  permissions and hashes, persisted retries, provider types, cleanup, and
  negative privacy/error paths inspected. No new state, provider method, network
  call, schema, or initial provider-input change. Complexity guard passes with
  unchanged debt; existing unrelated hotspots remain untouched.
- Tests use synthetic bytes and provider ports; they do not prove physical
  device rendering or external delivery. No production send or deploy occurred.
- Scope ends at a local commit. PR creation, exact-head CI and the applicable
  final ReviewGPT gate remain for PR completion; the changelog source-PR list
  can be populated when that PR exists.
- Deployment concern: old cleanup treats newly supported staged extensions as
  invalid. Rollout must establish compatible readers before allowing new-format
  obligations to move between runner versions, and must not roll those readers
  back while such obligations remain. This work does not perform that rollout.
Completed: 2026-10-21
