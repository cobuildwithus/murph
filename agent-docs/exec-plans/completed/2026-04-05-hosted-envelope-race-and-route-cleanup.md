# Fix hosted envelope races and delete dead web runtime seams

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Eliminate the hosted root-key envelope recipient-update race before release.
- Remove dead hosted web runtime route/client surface that no longer serves the live Cloudflare-owned runtime path.

## Success criteria

- Recipient updates for a single hosted user cannot clobber each other when multiple writes arrive close together.
- The fix uses the existing per-user Durable Object as the serialization boundary instead of adding a new cross-surface persistence contract.
- Dead web runtime route/client code for removed device-sync runtime and hosted usage callbacks is deleted without breaking the remaining connect-link or scheduler flows.
- Focused regression coverage proves the envelope-write serialization and route cleanup, then required repo verification and final audit pass complete.

## Scope

- In scope:
- `apps/cloudflare/src/{user-runner.ts,user-key-store.ts}`
- Focused hosted Cloudflare tests covering concurrent recipient updates
- `ARCHITECTURE.md`
- `packages/hosted-execution/src/{routes.ts,web-control-plane.ts}`
- `packages/assistant-runtime/src/{hosted-device-sync-runtime.ts,hosted-runtime/usage.ts}` if proxy-only cleanup requires adjustments
- `apps/web/app/api/internal/hosted-execution/outbox/drain/route.ts`
- Small docs/tests updates that must match the removed dead surface
- Coordination/plan docs needed for this lane
- Out of scope:
- Re-architecting drain-time device-sync hydration
- Removing the still-live hosted device connect-link route
- Broad hosted onboarding/runtime refactors already in flight

## Constraints

- Technical constraints:
- Keep the per-user Durable Object as the only serialization boundary; do not add a second persistence model.
- Preserve the current hosted runtime behavior for live proxy paths and signed control paths.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Finish with required verification, final audit, and a scoped commit helper flow.

## Risks and mitigations

1. Risk: A lock added too broadly could serialize unrelated runner work and reduce throughput.
   Mitigation: Lock only root-key envelope mutation methods, reusing the existing narrow promise-chain pattern already used for other runner-local mutation lanes.

2. Risk: Deleting route/client code that still has a live caller could break hosted runtime behavior.
   Mitigation: Trace each remaining caller first, keep the connect-link and scheduler paths intact, and add focused regression updates where needed.

## Tasks

1. Update the active plan and coordination ledger for this hosted runtime hardening lane.
2. Add explicit per-user Durable Object serialization around root-key envelope mutation methods.
3. Add focused regression coverage for concurrent recipient writes.
4. Remove dead web runtime route/client surface that still assumes deleted device-sync runtime or usage-record web callbacks.
5. Keep the durable architecture wording aligned with the now-proxy-owned runtime path when this cleanup removes the last stale callback seam wording.
6. Run required verification, capture evidence, run the required final review audit, and commit the scoped paths.

## Decisions

- Use a dedicated promise-chain lock inside `HostedUserRunner` for root-key envelope mutations because the calls already reach the per-user Durable Object and only need stronger in-object sequencing across awaited steps.
- Keep the hosted device connect-link route and internal token because the runner still proxies that flow through web; remove only dead runtime/usage callback seams.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Outcomes:
- `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-http.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner.test.ts --no-coverage` passed after the review-driven lock widening.
- `pnpm typecheck` passed before the review-driven fix, and `pnpm --dir apps/cloudflare typecheck` passed after the follow-up change.
- `pnpm test` failed for a credibly unrelated pre-existing hosted-web assertion in `apps/web/test/device-sync-settings-routes.test.ts` expecting headline `Connected and syncing normally` while the current branch returns `Connected`.
- `pnpm test:coverage` failed for the same unrelated hosted-web assertion and for pre-existing coverage threshold misses in `packages/hosted-execution/src/{env.ts,client.ts}`.
- Focused hosted tests now prove both concurrent recipient upserts and a later crypto-backed write waiting for an in-flight envelope replacement.
Completed: 2026-04-05
