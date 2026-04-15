# 2026-04-16 Device Sync Dead Path Wake

## Goal

Apply the returned wake-task patch that removes the obsolete web-side hosted device-sync runtime projection write path after the hosted control-plane cutover, while keeping the change narrowly scoped to the affected device-sync files and contract surface.

## Constraints

- Preserve unrelated worktree edits already present across the repo.
- Do not widen the hosted control-plane surface or reintroduce per-user runtime projection writes from `apps/web`.
- Keep the change limited to the existing device-sync web implementation and the `@murphai/device-syncd` hosted-runtime contract test surface.
- Avoid printing or committing secrets, tokens, or other sensitive runtime data while verifying.

## Verification Plan

- `pnpm typecheck`
- `pnpm test:diff apps/web/src/lib/device-sync packages/device-syncd/src/hosted-runtime.ts packages/device-syncd/test/hosted-runtime.test.ts`
- `git diff --check`

## Audit Plan

- Required `coverage-write` pass if the verification lane remains owner/diff coverage based
- Required `task-finish-review` pass

## Status

- Ready to land. The downloaded patch now also includes the minimal current-tree test updates required after deleting `apps/web/src/lib/device-sync/runtime-client.ts`.

## Verification Outcome

- Passed: `pnpm --dir packages/device-syncd typecheck`
- Passed: `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/hosted-runtime.test.ts --no-coverage`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/agent-session-service.test.ts apps/web/test/prisma-store-local-heartbeat.test.ts apps/web/test/prisma-store-oauth-connection.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/device-sync-internal-runtime.test.ts --no-coverage`
- Passed: `git diff --check -- apps/web/src/lib/device-sync packages/device-syncd/src/hosted-runtime.ts packages/device-syncd/test/hosted-runtime.test.ts agent-docs/exec-plans/active/2026-04-16-device-sync-dead-path-wake.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Blocked by unrelated workspace state: root `pnpm typecheck` waited on a long-held `apps/cloudflare verify` workspace lock owned by another active lane.
- Blocked by unrelated pre-existing app state: `pnpm --dir apps/web typecheck:prepared` still fails in `.next/types/validator.ts` on missing `app/design-system/page.js` and missing hosted share-import route modules.
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
