# Hosted Projection Effect Result

## Goal

Make hosted mailbox post-checkpoint logs report typed projection/evidence outcomes, even when projection code catches failures internally and returns without throwing.

Success criteria:

- Hosted inbox projection effects return a typed result with projection/evidence update booleans, status, and reason code.
- Workspace runner logs include those result fields for each post-checkpoint effect.
- Failed, partial, and succeeded projection/evidence states are visible in durable hosted runtime logs without exposing message contents, vault data, local paths, or identifiers.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`

## Constraints

- Preserve mailbox import checkpoint semantics: projection is post-checkpoint enrichment and must not block assistant admission.
- Preserve existing attachment-evidence downgrade guard work in the same files.
- Keep logs metadata-only and redacted.
- Do not introduce persisted product state or a durable retry queue.

## Plan

1. Inspect current effect callback and projection failure handling.
2. Add typed mailbox post-checkpoint effect result plumbing.
3. Return explicit results from hosted inbox projection/evidence paths.
4. Extend runner log tests and projection import tests for partial/failed internal outcomes.
5. Run focused verification and required completion audits.
6. Close the plan and commit scoped changes if the working tree allows it safely.

## Verification

- `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-mailbox-checkpoint.test.ts` passed after final changes.
- `pnpm --dir packages/assistant-runtime typecheck` passed after final changes.
- `git diff --check -- packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-checkpoint.test.ts` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-checkpoint.test.ts` passed after restoring prepared runtime artifacts with `pnpm build:test-runtime:prepared`.
- Required security/privacy review completed; one low reason-code-shape finding was fixed by strict runtime-log code normalization plus a regression test.
- Required coverage review completed; runner-level real conversation import coverage was added.
- Required final review completed; one low synthetic contact literal finding was fixed.

## Handoff Notes

- Implementation complete.
- Commit blocked by overlapping dirty work in the same assistant-runtime mailbox files and unrelated active rows. Do not stage these files wholesale without separating ownership.

Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
