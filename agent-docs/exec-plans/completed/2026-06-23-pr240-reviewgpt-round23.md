# PR 240 ReviewGPT round 23 fixes

## Goal

Resolve the accepted ReviewGPT round 23 findings on PR 240 with the smallest
maintainable changes.

Success means:

- Ambiguous checkpoint cleanup cannot lose the replaced workspace snapshot ref.
- Retryable parser setup/drain failures keep pending media parser jobs
  production-runnable instead of advancing the mailbox watermark.
- Inbox media retention no longer hashes files when deletion no longer depends
  on digest equality.
- Focused tests, typecheck, diff verification, CI, and the next ReviewGPT round
  pass or have documented unrelated blockers.

## Constraints

- Preserve existing owners: upload-session recovery owns checkpoint cleanup,
  mailbox import owns retryable conversation import outcomes, and inboxd owns
  raw media retention.
- Do not add a scheduler, service, persisted table, or duplicated retention
  state.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Plan

1. Patch ambiguous checkpoint retirement to durably record both cleanup refs
   before deleting the upload session.
2. Propagate parser retry signals through mailbox import so deterministic
   re-import can drain pending jobs.
3. Collapse retention hashing to regular-file presence checks.
4. Add focused regression tests and run required verification.
5. Commit, push, and run ReviewGPT on the pushed PR head.

## Progress

Implemented:

- Ambiguous checkpoint retirement now records both the uploaded object and any
  replaced snapshot ref as orphan candidates before deleting the upload session.
- Parser setup and drain exceptions leave pending jobs retryable and cause the
  mailbox item to return a retryable blocked outcome instead of advancing the
  watermark.
- Inbox media retention now checks for a contained regular file instead of
  hashing bytes that no longer affect deletion policy.

Passing:

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts`
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts`
- `pnpm --filter @murphai/inboxd exec vitest run --config vitest.config.ts --no-coverage test/inbox-media-retention.test.ts`
- `pnpm typecheck`
- `pnpm test:diff --base origin/main`

Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
