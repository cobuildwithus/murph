# PR 240 ReviewGPT round 22 fixes

## Goal

Resolve the accepted ReviewGPT round 22 findings on PR 240 with the smallest
maintainable changes.

Success means:

- Replaced hosted workspace snapshot refs are durably recorded before the web
  checkpoint CAS can remove the old current pointer.
- Eligible raw inbox media expires even if its current bytes no longer match
  the original metadata, after normal path containment and active-work checks.
- Hosted parser setup-level failures leave unclaimed parser jobs retryable
  instead of terminalizing them.
- Focused regression tests, typecheck, and the next ReviewGPT round pass or
  have documented unrelated blockers.

## Constraints

- Keep the current owners: upload-session recovery in Cloudflare runner code,
  retention policy in inboxd, parser retry semantics in assistant-runtime.
- Do not add a new scheduler, broad cleanup service, or new durability concept.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Plan

1. Verify each reported failure against the current code.
2. Add focused regression coverage for the three failure modes.
3. Patch the smallest production paths that make those tests pass.
4. Run targeted tests, `pnpm typecheck`, and scoped diff verification.
5. Commit, push, and run ReviewGPT on the pushed PR head.

## Progress

- Implemented pre-CAS replaced snapshot ref persistence in the existing upload
  session owner.
- Let inbox media retention delete eligible canonical raw media even when the
  observed bytes no longer match original metadata.
- Changed hosted parser setup failures to leave unclaimed jobs pending and
  return a bounded retry wake.
- Added focused regression coverage for all three paths.
- Passing:
  - `pnpm --filter @murphai/inboxd exec vitest run --config vitest.config.ts --no-coverage test/inbox-media-retention.test.ts`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-conversation-event.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff --base origin/main`
- Broader `pnpm --dir apps/cloudflare test:node` currently fails in
  `apps/cloudflare/test/runner-bundle-process.test.ts` because the local
  Corepack cache path for pnpm is missing under the test's temporary home; the
  failure is outside the changed paths.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
