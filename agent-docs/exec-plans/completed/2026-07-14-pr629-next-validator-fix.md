# PR 629 Next validator fix

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Resolve ReviewGPT round 1 by preserving TypeScript 7 source checking while restoring Next-owned validation of generated route and page contracts.

## Success criteria

- The hosted production build runs the TypeScript 7 source precheck and Next's local compatibility check.
- No environment proof flag or duplicate proof state controls `ignoreBuildErrors`.
- A framework-invalid entrypoint passes the standalone source check but fails Next validation.
- Focused hosted-web tests, scoped verification, CI, and a new ReviewGPT round pass.

## Scope

- `apps/web` build configuration, verification script, focused tests, and matching durable verification docs.
- No product behavior, dependency, or broad build-system changes.

## Tasks

1. Reproduce the standalone-TypeScript versus generated-Next-contract gap. Completed.
2. Delete the proof protocol and restore Next validation. Completed.
3. Add the smallest durable regression proof and update affected docs. Completed.
4. Verify, audit, commit, push, and rerun ReviewGPT on the new head. In progress.

## Decisions

- Accepted ReviewGPT round 1's generated-contract invariant finding after a temporary route handler with an extra required context field passed the TypeScript 7 source check but failed Next's generated validator.
- Rejected the finding's page-prop example because Next 16's generated page contract intentionally permits additional props; the route-handler path proved the broader invariant instead.
- Restored direct compiler ownership instead of adding another gate: TypeScript 7 checks repository source, and Next with the web-local TypeScript 5 compatibility compiler checks generated framework contracts.
- Deleted the environment proof flag, `ignoreBuildErrors` branch, shell proof state, and proof-only tests. The fix reduces implementation complexity.

## Verification

- Focused Next config and production build-guard tests.
- Production-faithful invalid-entrypoint proof.
- `pnpm test:diff` for the touched hosted-web and documentation surfaces.
- PR CI and ReviewGPT zero-accepted-findings round.

Completed local proof:

- Temporary invalid route handler: `pnpm --dir apps/web typecheck:prepared` passed; after `pnpm --dir apps/web exec next typegen`, the web-local TypeScript check failed in `.next/types/validator.ts` because the required extra context field is not framework-supplied.
- Focused config/build-guard lane: 67 tests passed.
- Coverage-write exact `pnpm test:diff` lane: 409 test files, 4,963 tests, dev smoke, lint with zero errors and 11 unchanged warnings, and the production Next build including its app-local generated-contract check all passed.
- `git diff --check` and shell syntax passed.
Completed: 2026-07-14
