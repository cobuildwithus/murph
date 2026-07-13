# PR 511 ReviewGPT Round 7 Fixes

## Goal

Resolve the two accepted ReviewGPT findings for PR 511:

1. Preserve the canonical routed-group classification when webhook planning reruns with a fetched Linq roster.
2. Serialize participant-addition marker consumption with marker writes so the first accepted group message after a committed addition receives the coalesced context.

## Constraints

- Keep the canonical planning event as the single representation across every planning pass for one webhook.
- Reuse the existing `HostedThreadRoute` row and transaction boundary; do not add a counter, queue, scheduler, or state machine.
- Preserve provider-event idempotency, route authority, quiet-room behavior, and the one-coalesced-opportunity contract.
- Prove both PostgreSQL lock orderings with production-faithful coverage.

## Working Set

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-routing/thread-route-store.ts`
- `apps/web/test/hosted-onboarding-linq-thread-route.test.ts`
- focused PostgreSQL concurrency coverage in the existing hosted web test owners
- `.github/workflows/cloudflare-hosted-e2e.yml`
- `apps/cloudflare/test/hosted-local-linq-group-route-drift-e2e.test.ts`
- matching verification and CI-map documentation

## Verification Plan

- Focused Vitest for routed-group roster reruns and participant-addition consumption.
- Real PostgreSQL concurrency proof for both route-row lock orderings.
- Web typecheck, scoped diff checks, and relevant completion audits.
- Push the reviewed head, rerun ReviewGPT, and continue until zero accepted findings.

## Decisions

- Reuse the request-local canonical planning event for the roster-backed planning pass instead of reconstructing or mutating webhook input.
- Lock the existing `HostedThreadRoute` row before reading and conditionally clearing the participant-addition bit. This makes the marker and consumer share one PostgreSQL serialization point without new persisted state.
- Run the real PostgreSQL ordering proof in the existing route-authority CI leg, where the hosted E2E stack already provisions PostgreSQL.
- Update the route-drift E2E expectation to one canonical roster read. The removed post-commit roster writer no longer performs the second read, while the canonical admission read and accepted reply remain covered.

## Progress

- Preserved canonical routed-group classification across both webhook planning passes.
- Added route-row locking before pending participant-addition consumption.
- Added deterministic PostgreSQL coverage for both lock orderings and exact-once mailbox coverage for the accepted-message path.
- Updated the hosted route-authority CI leg and durable verification map.

## Verification Evidence

- `pnpm --dir apps/web typecheck:prepared` — passed.
- Focused hosted-onboarding Vitest — 44 passed; 2 opt-in PostgreSQL cases skipped in the ordinary run.
- Opt-in real PostgreSQL concurrency Vitest — 2 passed.
- `pnpm test:diff` across the full working set — passed, including web verification (4,301 passed, 11 skipped), Cloudflare verification (1,738 passed), build, development smoke, and lint.
- `git diff --check` — passed.

## Completion Audits

- Security/privacy review — no Critical, High, or Medium findings.
- Coverage-write review — no unresolved findings; added one focused exact-once mailbox assertion.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
