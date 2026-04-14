# Verify and fix non-webapp workspace blockers

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Determine whether the repository is green outside `apps/web`, and fix any remaining non-webapp failures so the rest of the workspace verifies cleanly.

## Success criteria

- Current non-webapp failing lanes are identified with exact commands.
- Any failure outside `apps/web` is fixed in-tree when reasonably attributable to current repo state.
- Verification is rerun and the remaining blockers, if any, are explicit.

## Scope

- In scope:
- non-webapp verification commands and any required code/test fixes
- `apps/cloudflare/**` and other non-webapp packages/apps if they fail
- Out of scope:
- `apps/web/**` failures unless they are proven to block non-webapp verification mechanically

## Tasks

1. Reproduce current failures and separate `apps/web` blockers from the rest.
2. Fix non-webapp failures.
3. Rerun verification and commit the exact touched files.

## Decisions

- Treat `apps/cloudflare` as in scope because it was the only confirmed non-webapp red lane.
- Fix the Cloudflare worker runtime test expectation rather than runtime code because the queue intentionally clamps past preferred wake times to `Date.now()`.

## Verification

- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck`

## Outcome

- `apps/cloudflare` verify is green after updating the stale worker-runtime wake expectation.
- The root `pnpm typecheck` lane now fails only in `apps/web/test/hosted-onboarding-privy-service.test.ts`.
- No other non-webapp blocker was reproduced in this pass.
Completed: 2026-04-14
