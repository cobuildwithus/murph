# Assistant Attachment Filenames

## Goal

Preserve safe attachment filenames from hosted and local inbox sources through assistant input descriptors, attachment evidence, model bundles, and prompt rendering without admitting path-like or unsafe filename payloads.

## Constraints

- Keep filenames bounded to the existing assistant input safe filename contract.
- Unsafe filenames become `null`; staging must not throw because a provider sent a bad filename.
- New staged input should treat filename as immutable content.
- Existing staged input with `null` filenames must remain replay-compatible when a later replay has the same safe filenames.
- Preserve unrelated active work in mailbox import and prompt builder.

## Plan

1. Add a small shared assistant filename normalizer.
2. Carry normalized filenames through hosted and local attachment descriptors.
3. Carry normalized filenames through attachment evidence, model bundles, routing-image metadata, and prompt sections.
4. Add focused tests for hosted, local, evidence, model-bundle, prompt, unsafe filename, and replay-compatibility behavior.
5. Run focused package verification, required audit passes, and the repo typecheck.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-mailbox-conversation-import.test.ts` passed before final dot-segment hardening.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-input-store.test.ts test/assistant-inbox-attachment-evidence.test.ts test/assistant-attachment-evidence-model.test.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-runtime.test.ts` passed after security-review fixes.
- `pnpm typecheck` passed after security-review fixes.
- `bash scripts/workspace-verify.sh test:diff <task files>` passed after security-review fixes.
- Coverage-write audit made no changes; existing proof was sufficient.
- Security/privacy audit findings were fixed: prompt-facing attachment ids removed; filename control characters rejected.
- Final-review low findings were fixed: `.` / `..` filenames rejected and this verification section refreshed.
- Final focused checks passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-input-store.test.ts test/assistant-inbox-attachment-evidence.test.ts test/assistant-attachment-evidence-model.test.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-runtime.test.ts`; `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-mailbox-conversation-import.test.ts`.
- Final required checks passed: `pnpm typecheck`; `bash scripts/workspace-verify.sh test:diff <task files>`.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
