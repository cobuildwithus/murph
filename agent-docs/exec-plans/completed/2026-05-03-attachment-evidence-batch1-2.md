# Land attachment evidence Batch 1 and Batch 2 patch

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Land the supplied Batch 1/2 attachment evidence patch against current main.
- Add event-owned assistant input attachment evidence plus source-neutral materialization helpers without changing the prompt path.

## Success criteria

- Patch intent is ported without clobbering unrelated working-tree edits.
- Assistant input events default and mutate `attachmentEvidence` without changing immutable replay identity.
- Attachment evidence materialization preserves image multimodality and PDF stored-path metadata.
- Focused assistant-engine tests and typecheck pass, or any blocker is clearly unrelated and named.

## Scope

- In scope: `packages/assistant-engine` source and tests touched by the supplied patch.
- Out of scope: prompt-builder/reply prompt-path changes, inbox evidence producer adapters, and parser-drain producer updates.

## Constraints

- Technical constraints: keep artifact refs vault-relative and safe; keep derived/inbox evidence rebuildable and non-canonical.
- Product/process constraints: preserve unrelated dirty work and avoid writing local personal identifiers in generated files or commit text.

## Risks and mitigations

1. Risk: persisted assistant runtime shape drift or unsafe path acceptance.
   Mitigation: schema validation plus focused store/materialization tests and security/privacy review.

## Tasks

1. Apply/port the supplied patch against current main.
2. Inspect the resulting implementation for stale assumptions.
3. Run focused assistant-engine tests and package typecheck.
4. Run required completion audits.
5. Commit the scoped change.

## Decisions

- The patch is treated as architecture intent; one stale `input-store.ts` helper hunk may be ported manually onto the current helper layout.
- The source-neutral model layer reuses the existing inbox model-bundle contract for now instead of adding a parallel bundle schema, because Batch 2 is foundation-only and prompt-path hard cut remains out of scope.
- Added proof beyond the supplied patch for legacy-record defaulting, input-source exposure, and derived manifest `allowedRoot` enforcement after checking the migration guide Batch 1/2 checklist.
- Added final guide-check proof for oversized inline fragment rejection and invalid raw image path text-only fallback before filesystem reads.

## Verification

- Passed: `pnpm --filter @murphai/assistant-engine test -- assistant-input-attachment-evidence-store assistant-attachment-evidence-model`.
- Fixed type drift, then passed: `pnpm --dir packages/assistant-engine typecheck`.
- Scoped diff verifier reached reverse-dependent app verification and failed in `apps/cloudflare/test/container-entrypoint.test.ts` with a timeout unrelated to this assistant-engine diff.
- Passed after migration-guide proof additions: `pnpm --filter @murphai/assistant-engine test -- assistant-input-attachment-evidence-store assistant-attachment-evidence-model assistant-input-source`.
- Passed: `pnpm --dir packages/assistant-engine test:coverage`.
- Passed: `pnpm typecheck`.
- Security/privacy review found unsafe artifact-path payload segments, unsafe inline fragment text, and image-read error detail leakage; fixed with stricter schema validation and sanitized image-read failure details.
- Passed after security fixes: `pnpm --filter @murphai/assistant-engine test -- assistant-input-attachment-evidence-store assistant-attachment-evidence-model assistant-input-source`.
- Passed after security fixes: `pnpm --dir packages/assistant-engine typecheck`.
- Passed after security fixes: `pnpm --dir packages/assistant-engine test:coverage`.
- Blocked after unrelated dirty-tree drift: `pnpm typecheck` now fails in hosted-local dev config/test files (`localCodexCommand` / `localCodexBridge*` fields on `HostedLocalDevConfig`), outside this task's working set.
- Latest direct focused pass: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-input-attachment-evidence-store.test.ts test/assistant-attachment-evidence-model.test.ts test/assistant-input-source.test.ts` (3 files, 39 tests).
- Latest package typecheck pass: `pnpm --dir packages/assistant-engine typecheck`.
- Latest package-wide Vitest wrapper run is blocked by unrelated dirty-tree failures in `assistant-cli-surface-bootstrap.test.ts` and `model-behavior.test.ts`; the wrapper selected all assistant-engine tests instead of only the three Batch 1/2 patterns.
- Direct three-file coverage run passed the selected tests but failed global package coverage thresholds because only three files were selected; use the earlier full-package coverage pass as the last clean coverage proof before unrelated dirty-tree drift.
Completed: 2026-05-03
