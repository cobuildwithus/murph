## Title

Remove leftover Cloudflare terminal-flow `replaced` residue after the hosted-wake concept cleanup landed.

## Goal

Delete dead Cloudflare-side `replaced` handling that no longer matches the terminal callback contract, while preserving valid hosted-wake lifecycle/status semantics elsewhere.

## Scope

- `apps/cloudflare/src/user-runner/runner-wake-state.ts`
- `apps/cloudflare/test/runner-wake-state.test.ts`
- `apps/cloudflare/test/workers/test-hosted-wake-control.ts`

## Constraints

- Preserve valid hosted-wake lifecycle-state `replaced` handling where it still models web-owned status for stale or superseded event identities.
- Do not touch overlapping dirty-tree hosted-wake runtime work outside this exact cleanup.
- Keep the change minimal and local to dead terminal-flow residue.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-wake-state.ts apps/cloudflare/test/runner-wake-state.test.ts`

## Notes

- The completed hosted-wake concept cleanup already removed terminal `replaced` from the shared contract and web route.
- The remaining Cloudflare cleanup should target only dead terminal-flow residue, not valid lifecycle/status references such as `wakeState: "replaced"` on stale fetch-proof recovery paths.
- `test-hosted-wake-control.ts` already has overlapping dirty-tree edits from another hosted-wake lane; only the dead `isCommitEligibleStoredWakeState("replaced")` branch is part of this cleanup.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
