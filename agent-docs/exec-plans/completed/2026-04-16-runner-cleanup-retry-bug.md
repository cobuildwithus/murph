## Goal

Reproduce the hosted runner cleanup failure locally through the Cloudflare runner test/E2E path, then stop post-success container teardown failures from triggering dispatch retries or poison.

## Scope

- `apps/cloudflare/src/runner-container.ts`
- focused `apps/cloudflare/test/**` coverage for the teardown-after-success path
- any narrow test harness adjustments required to exercise the bug locally

## Constraints

- Keep the fix scoped to post-run container cleanup semantics.
- Do not alter the hosted delivery journal or cross-package delivery ownership contract in this lane.
- Preserve overlapping in-flight `apps/cloudflare/test/**` local E2E work by avoiding unrelated harness churn.

## Verification

- Focused Cloudflare runner/local E2E repro that demonstrates teardown failure after a successful run
- Relevant `apps/cloudflare` test/type checks for the touched path

## Outcome

- Reproduced the failure against the real `RunnerContainer` lifecycle in `apps/cloudflare/test/runner-container.test.ts` by making warm-shell restart call `destroy()` while the shell was already transitioning to `stopping`.
- Fixed `destroyIfRunning()` so a thrown `destroy()` does not fail closed if the container still reaches `stopped` inside the existing destroy timeout window.
- Added focused regressions for both explicit destroy and warm-shell restart teardown races.

## Verification Results

- PASS: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts --no-coverage`
- FAIL (pre-existing unrelated hosted-delivery/typecheck breakage): `pnpm typecheck`
- FAIL (pre-existing unrelated hosted-delivery fixture drift): `pnpm test:e2e:duplicate-commit:local`
- FAIL (blocked by the same unrelated hosted-delivery/typecheck breakage inside app verify): `pnpm test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
