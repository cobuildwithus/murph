## Title

Align Cloudflare hosted-wake drain tests with refetch-after-commit behavior.

## Goal

Update the failing hosted-wake drain tests so they model the current `HostedUserRunner` contract: once a wake in a fetched batch commits, later wakes in that batch are handled after a refetch under the new cursor fence, not from the stale batch payload.

## Scope

- `apps/cloudflare/test/user-runner-hosted-wake.test.ts`
- directly related Cloudflare test fixtures only if the refetch sequencing requires them

## Constraints

- Test-only slice; do not modify `apps/cloudflare/src/**`.
- Preserve adjacent in-flight hosted-wake test and runtime edits.
- Keep expectations aligned with the runtime’s current refetch-and-fence contract, not the older stale-batch behavior.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner-hosted-wake.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare verify`

## Notes

- The current failures are stale assumptions in tests that expected two wakes to drain from one fetched batch without refetching after the first cursor commit.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
