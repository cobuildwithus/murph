# Assistant Input Attachment Extensions

## Goal

Preserve safe source file extensions when assistant-input raw attachment evidence is materialized without a useful MIME type.

Success criteria:

- MIME-less or generic image/document attachments copied from safe raw source paths retain safe source extensions.
- Multimodal image routing remains eligible after assistant-input materialization.
- PDF document prompt handling still recognizes PDF evidence after materialization.
- Unsafe or missing source extensions continue to fall back to neutral `.dat` / `.bin` paths.

## Constraints

- Keep the change local to assistant attachment evidence and focused tests.
- Do not broaden raw artifact path roots or accept arbitrary source extensions.
- Preserve unrelated dirty working-tree edits.

## Plan

1. Inspect current assistant-input raw materialization and prompt/routing tests.
2. Pass source path into assistant-input raw target extension selection.
3. Add focused tests for MIME-less, generic MIME, PDF prompt, and unsafe fallback cases.
4. Run focused package verification, typecheck, and required review checks.
5. Commit scoped changes if the working tree allows it safely.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-inbox-attachment-evidence.test.ts test/assistant-attachment-evidence-model.test.ts test/assistant-automation-prompt-builder.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `git diff --check -- packages/assistant-engine/src/assistant/inbox-attachment-evidence.ts packages/assistant-engine/test/assistant-inbox-attachment-evidence.test.ts packages/assistant-engine/test/assistant-attachment-evidence-model.test.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts agent-docs/exec-plans/active/2026-05-04-assistant-input-attachment-extensions.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed before the plan was archived.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/inbox-attachment-evidence.ts packages/assistant-engine/test/assistant-inbox-attachment-evidence.test.ts packages/assistant-engine/test/assistant-attachment-evidence-model.test.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts` passed assistant-engine and several reverse-dependent checks, then failed in unrelated `apps/cloudflare verify` because `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts` has mailbox post-checkpoint type errors.
- `pnpm typecheck` failed for the same unrelated assistant-runtime mailbox post-checkpoint type errors.

## Handoff Notes

- Security/privacy review: no findings.
- Coverage-write pass added one test-only MIME-precedence case.
- Final task review: no findings.
- Scoped commit was blocked by overlapping active dirty work in the same assistant-engine test/source files and unrelated assistant-runtime files.

Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
