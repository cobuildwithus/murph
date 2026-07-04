Goal (incl. success criteria):
- Address ReviewGPT round 21 for PR 379 by removing stale job-history suppression from Junction retry repair.
- Success means metadata-owned connect-backfill retry recovery can rematerialize after a dead execution row, while active queued/running exact-window dedupe still prevents duplicates.

Constraints/Assumptions:
- Keep the fix deletion-first and scoped; no new state owner, table, scheduler, queue, dependency, or configuration.
- Preserve existing exact-window dedupe keys and bounded empty-response retry attempts from Junction metadata.
- Preserve unrelated worktree changes.

Key decisions:
- Treat dead job rows as execution history, not authority to suppress metadata-owned repair.

State:
- Verification passed; ready to close.

Done:
- ReviewGPT round 21 finding verified against current code.
- Removed `skipIfDedupeKeyPayloadKeySeen` and the payload-key history helper.
- Updated the dead retry repair regression to prove metadata rematerializes recovery work.
- `git diff --check`
- `pnpm --dir packages/device-syncd test -- service.test.ts`
- `pnpm --dir packages/device-syncd test -- service.test.ts junction-provider.test.ts hosted-runtime.test.ts provider-manifests.test.ts`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/device-syncd test:coverage`
- `pnpm typecheck`

Now:
- Close the plan and commit.

Next:
- Push, preflight, and rerun ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/store.ts`
- `packages/device-syncd/src/store/jobs.ts`
- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/test/service.test.ts`
Status: completed
Updated: 2026-07-04
Completed: 2026-07-04
