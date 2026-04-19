## Title

Handle snapshot-only finalize CAS conflicts without dropping DO-local pending commit cleanup state.

## Goal

Fix the hosted runner cleanup path so `finalizePendingCommitAfterCursorCommit(...)` preserves the latest DO-local pending commit state when the snapshot-only cursor compare-and-swap returns `committed: false`, and prove duplicate-finalize conflict behavior with a focused Cloudflare test.

## Scope

- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- focused `apps/cloudflare/test/user-runner-hosted-wake.test.ts`

## Constraints

- Keep the main committed wake cursor advance single-step.
- Preserve the existing DO-local pending-commit recovery seam.
- Do not broaden into unrelated hosted-wake, onboarding, or migration cleanup work.

## Verification

- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform apps/cloudflare/test/user-runner-hosted-wake.test.ts -t "same final snapshot|stale cursor" --no-coverage`

## Notes

- This is a greenfield hosted-wake correctness follow-up under the stateless-executor cutover.
- The intended regression case is a duplicate finalize that loses the snapshot-only CAS because another finalize already published the same final snapshot.
