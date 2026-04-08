# Greenfield Hosted Lookup And Dispatch Cleanups

## Goal

Land the greenfield long-term architecture for two hosted seams:

1. hosted-member lookup APIs return the matched slice plus core member state instead of discarding the slice and forcing follow-up reads
2. hosted execution dispatch lifecycle keeps transport-local outbox state separate from the shared cross-boundary dispatch outcome vocabulary

Success means the repo uses one shared hosted dispatch outcome owner, the hosted web outbox no longer treats handoff as terminal product truth, and hosted-member slice lookups are normalized around nested slice-owned results without reviving a wide aggregate.

## Scope

- `agent-docs/references/data-model-seams.md`
- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/**`
- `apps/cloudflare/src/user-runner/**`
- `apps/cloudflare/test/**`
- `packages/hosted-execution/{src/**,test/**}`

## Constraints

- Preserve unrelated dirty worktree edits, especially the hosted legal, hosted runner smoke, Node-version, and giant-file composability lanes already in progress.
- Treat this as a greenfield cleanup: prefer direct canonical APIs over long compatibility layering unless a current caller would otherwise force a risky big-bang cut.
- Keep transport-local `ExecutionOutbox` delivery mechanics separate from the shared hosted dispatch outcome vocabulary.
- Do not reintroduce a wide hosted-member aggregate or expose encrypted/blind-index storage fields outside slice owners.
- Keep Cloudflare queue-internal scheduling detail app-local; expose only the shared outcome union on event-scoped cross-boundary reads.

## Target Architecture

### Hosted-member lookups

- Each slice owner returns a nested lookup result:
  - identity: `{ core, identity, matchedBy }`
  - billing: `{ core, billingRef, matchedBy }`
  - routing: `{ core, routing, matchedBy }`
- `core` should stay a privacy-minimized hosted-member core projection, not raw Prisma rows plus relations.
- Composed service lookups may report multiple match reasons when more than one identity binding matches the same member.
- Full nested hosted-member composition remains the job of `readHostedMemberSnapshot(...)`, not the lookup stores.

### Hosted execution lifecycle

- `ExecutionOutbox.status` remains transport-local for handoff/retry state only.
- Add a persisted shared dispatch-outcome field on the outbox row and store the shared `HostedExecutionEventDispatchState` union there.
- Web activation/onboarding progress should derive product state from the shared outcome field plus any live Cloudflare status, not from `status === dispatched`.
- Cloudflare event-scoped reads should return the shared outcome union directly rather than leaking raw queue-state booleans across the boundary.

## Worker Split

### Worker 1: Hosted-member lookup cleanup

Owns:

- `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-lookup.ts`
- `apps/web/src/lib/hosted-onboarding/billing-service.ts`
- directly affected `apps/web/test/**`

Deliverables:

- nested lookup result types for billing and routing
- canonical service seams that preserve the matched slice
- caller updates that remove avoidable lookup-then-read cycles
- tests for new lookup return shapes and auth/billing/routing callers

### Worker 2: Hosted web outbox transport/outcome split

Owns:

- `apps/web/prisma/schema.prisma`
- matching Prisma migration
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/web/src/lib/hosted-onboarding/activation-progress.ts`
- `apps/web/src/lib/hosted-onboarding/lifecycle.ts`
- directly affected `apps/web/test/**`

Deliverables:

- persisted shared dispatch-outcome field on `ExecutionOutbox`
- web outbox write/read logic that separates transport state from shared outcome
- activation/onboarding state resolution updates
- tests for queue/pending/completed/poisoned semantics

### Worker 3: Shared outcome + Cloudflare event-state cleanup

Owns:

- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/test/**`
- `apps/cloudflare/src/user-runner/**`
- `apps/cloudflare/test/**`

Deliverables:

- event-scoped Cloudflare status surface aligned to the shared outcome owner
- any necessary shared contract refinements
- tests proving direct shared outcome reporting instead of raw presence translation leaks

## Integration Notes

- Worker 2 and Worker 3 must agree on the shared dispatch outcome names already owned by `@murphai/hosted-execution`; Worker 3 owns any shared contract edits.
- Worker 1 stays entirely inside hosted-member and billing/routing callers and must not touch the outbox or Cloudflare files.
- The main agent will integrate worker results, run repo verification, update seam docs, and handle the required final audit pass.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- focused reruns for touched hosted-web, hosted-execution, and Cloudflare tests if the full lane fails mid-iteration
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
