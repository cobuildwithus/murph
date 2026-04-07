# Hide hosted share signing details behind hosted-execution share issuer adapter

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Keep hosted share-link behavior unchanged while moving hosted-web private signing/header details out of `packages/assistant-engine` and behind a semantic `@murphai/hosted-execution` share issuer client.

## Success criteria

- `packages/assistant-engine` no longer imports `HOSTED_EXECUTION_USER_ID_HEADER` or `createHostedExecutionSignatureHeaders` to create hosted share links.
- `packages/hosted-execution` exposes a semantic client for issuing hosted share links through the signed hosted web-control seam.
- Focused tests cover the new hosted-execution share issuer behavior and the assistant-engine caller still returns the hosted share payload shape.
- Required verification for the touched packages passes, or any unrelated blocker is documented with evidence.

## Scope

- In scope:
- Add a hosted share internal-create route helper and semantic client in `packages/hosted-execution`.
- Switch `issueHostedShareLink` in `packages/assistant-engine` to use that client.
- Add focused tests in `packages/hosted-execution/test` and `packages/assistant-engine/test`.
- Out of scope:
- Hosted share business logic in `apps/web`.
- Broader hosted execution auth contract changes or route-handler rewrites.

## Constraints

- Technical constraints:
- Reuse the existing user-bound signed requester seam in `packages/hosted-execution` instead of inventing a second signing path.
- Preserve current request/response payloads for `/api/hosted-share/internal/create`.
- Product/process constraints:
- Preserve unrelated dirty worktree edits, especially the active hosted share and hosted-execution lanes.
- This is a trust-boundary change, so it needs the high-risk verification/audit path.

## Risks and mitigations

1. Risk: The new semantic client could subtly change request shaping or error surfacing for hosted share creation.
   Mitigation: Keep the route path, payload, and non-OK error mapping aligned with the current assistant-engine behavior and add focused client tests.
2. Risk: Overlap with other active hosted-execution edits could cause merge collisions.
   Mitigation: Keep the write scope narrow to the shared route/client files and read current file state before patching.

## Tasks

1. Add the ledger row and record this plan.
2. Introduce a hosted share route helper plus semantic share issuer client in `packages/hosted-execution`.
3. Replace direct signing/header code in `packages/assistant-engine/src/assistant-cli-tools/execution-adapters.ts`.
4. Add or update focused tests.
5. Run verification, perform the required review pass, and finish with a scoped commit.

## Decisions

- Keep the existing hosted web route `/api/hosted-share/internal/create`; only the calling seam moves.
- Put the semantic adapter in `packages/hosted-execution` so hosted-web signing details stay with the hosted control-plane owner package.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- focused hosted-execution and assistant-engine Vitest coverage for the new seam before the package/full baseline
- Expected outcomes:
- Focused assistant-engine test passed: `pnpm --dir packages/assistant-engine test -- --run test/execution-adapters.test.ts`
- Focused hosted-execution test passed once before repo-wide verification: `pnpm --dir packages/hosted-execution test -- --run test/hosted-share-issuer.test.ts`
- Required repo-wide verification failed for a credibly unrelated pre-existing blocker in `packages/hosted-execution/src/contracts.ts`:
- `pnpm typecheck`
- `pnpm test:coverage`
- After the repo-wide build/test lanes refreshed the hosted-execution source graph, re-running the focused hosted-execution test hit the same unrelated `@murphai/device-syncd/hosted-runtime` import/export blocker before any share-issuer assertions ran.
Completed: 2026-04-07
