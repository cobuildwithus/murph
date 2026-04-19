## Title

Fence hosted wake cursor commits to the snapshot ref captured by the last cursor-advancing wake.

## Goal

Prevent Cloudflare from publishing a future bundle snapshot on the web-owned cursor when a later wake mutates the local bundle cache before that later wake is actually committed. The advancing cursor commit must use the snapshot ref attached to the wake being committed, not a later mutable cache read.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused hosted wake execution helpers in `apps/cloudflare/src/user-runner/runner-wake-processor.ts` only if needed for the per-wake snapshot fence
- focused hosted wake tests in `apps/cloudflare/test/user-runner-hosted-wake.test.ts`
- focused cursor-store tests in `apps/web/test/hosted-wake-store.test.ts` only if needed for the regression proof

## Constraints

- Keep the canonical queue and cursor fully web-owned.
- Preserve the DO-local pending-commit recovery seam.
- Do not broaden into schema changes, onboarding, or unrelated hosted wake refactors.
- Preserve the existing snapshot-only finalize CAS path for already-committed pending cleanup.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-wake-processor.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/web/src/lib/hosted-wake/store.ts apps/web/test/hosted-wake-store.test.ts`

## Notes

- The regression proof is a mixed batch where the first wake completes and the second wake records a DO-local pending commit but fails before its cursor advance. Web must remain at the first wake's `committedSeq` and snapshot ref.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
