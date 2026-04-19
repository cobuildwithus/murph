## Title

Require `wakeEventId` in all hosted wake fetch proofs and fail closed when it is absent.

## Goal

Remove the rollout-only compatibility path that still accepts hosted wake fetch proofs without `wakeEventId`, so terminal/quarantine verification always binds fetched proof validity to the current fetched wake row identity.

## Scope

- `apps/web/src/lib/hosted-wake/{fetch-proof,store}.ts`
- focused hosted wake proof tests only where the legacy compatibility behavior is currently exercised

## Constraints

- Keep the change narrow to hosted wake fetch-proof verification and direct proof tests.
- Fail closed for missing `wakeEventId`; do not add a new compatibility shim or fallback path.
- Preserve unrelated in-flight hosted wake and hosted web edits elsewhere in the worktree.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-wake/fetch-proof.ts apps/web/src/lib/hosted-wake/store.ts apps/web/test/hosted-wake-store.test.ts`

## Notes

- This is an intentional hard cut for greenfield hosted execution, not a staged backwards-compatible rollout.
- The invariant is exact fetched-row identity binding, not just wake id plus seq.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
