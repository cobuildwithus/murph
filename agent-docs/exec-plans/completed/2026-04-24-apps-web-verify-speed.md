# Speed up apps/web verification

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Cut the local `apps/web verify` wall time by roughly 2x from the observed 170s path.
- Keep the hosted-web verification signal truthful: app tests, lint, local dev smoke, and production `next build` still run.
- Preserve the repo-wide verification contract and avoid weakening production/runtime checks.

## Scope

- `apps/web/scripts/verify-fast.sh`
- `apps/web/scripts/dev-smoke.ts`
- `apps/web/test/dev-smoke.test.ts`
- `apps/web/package.json` only if script wiring needs to change
- directly coupled verification docs/tests only if behavior changes
- `agent-docs/exec-plans/active/{2026-04-24-apps-web-verify-speed.md,COORDINATION_LEDGER.md}`

## Out of scope

- changing hosted-web product behavior
- weakening lint, app tests, dev smoke, or production build coverage
- dependency updates
- broad workspace verification rewrites outside the hosted-web lane

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not expose local paths, secrets, or environment values in docs, commits, logs, or examples.
- Use timing evidence before changing the verify lane.
- Keep any parallelism fail-fast enough that a failing background step does not leave stray dev/build processes.

## Tasks

1. Register the scoped verification-speed lane.
2. Measure the current `apps/web verify` steps and compare the existing parallel mode.
3. Remove redundant work or safely overlap independent steps until the lane reaches the 2x target.
4. Run the required scoped checks and completion review, then finish with a scoped commit if safe.

## Verification

- `bash -n apps/web/scripts/verify-fast.sh`
- `pnpm exec vitest run apps/web/test/dev-smoke.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- `pnpm --dir apps/web verify`
- direct timing comparison before/after

## Latest results

- Baseline observed by user: `apps/web verify` reported 170s total / 58s step.
- Confirmed old `verify:parallel` was unsafe: it could make `pnpm dev:smoke` exit with code 130 while Next dev reported ready.
- Implemented stable local ordering: one Prisma generate, `pnpm dev:smoke`, then parallel `next build` / `pnpm test` / `pnpm lint`.
- Removed recursive `.next-smoke` artifact walking from `dev-smoke`; route types and Turbopack cache are checked by direct paths and freshness.
- Final `pnpm --dir apps/web verify`: passed in 47.6s wall, with step timings of Prisma 1s, smoke 25s, lint 8s, test 8s, and build 22s.
- `pnpm typecheck`: passed.
Completed: 2026-04-24
