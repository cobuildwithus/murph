# End-to-End Hosted Reply Latency Tracing

Status: completed
Updated: 2026-07-09

## Goal

Extend the existing hosted ingress trace through accepted Linq delivery and
receipt so cold/warm median reply latency can be measured end to end without
adding a hot-path telemetry request.

## Constraints

- Reuse the existing ingress trace, accepted delivery record, and runtime
  write-fence attempt identity.
- Schedule trace linkage after the delivery callback response; observability
  failure must never fail or delay reply delivery.
- Persist only opaque existing identifiers and timestamps; no message content,
  phone data, paths, or provider payloads.
- Deduplicate grouped-message samples by delivery id.
- Reject cross-attempt provider milestones instead of mixing attempts.
- Do not add a metrics service or change reply correctness ownership.

## Implementation

1. Add an optional delivery relation and reply-attempt id to the ingress trace.
2. After an accepted delivery callback, best-effort link exact answered mailbox
   traces to the delivery using the authenticated user and write-fenced attempt.
3. Prevent provider-start callbacks from updating a trace pinned to a different
   runtime attempt.
4. Extend the ops dashboard with provider-to-attempt, provider-network,
   receipt, and cold/warm end-to-end distributions plus trace-quality counts.
5. Add schema, store, route, dashboard, privacy/migration, and idempotency tests.

## Verification

- Prisma validation and 61 focused latency-store, delivery-link, route,
  migration/privacy, and production-migration tests passed.
- Diff-aware `apps/web` verification passed: 4,035 tests passed, 9 skipped;
  lint completed with no errors; dev smoke and production build passed.
- Root `pnpm typecheck` passed after preparing the clean-worktree runtime
  artifacts.
- Parent and read-only data-flow review found no remaining blocker. The review
  removed an unused index, added the runtime-log lookup index, gated Linq-only
  metrics, and kept coverage counters neutral and row-scoped.
- PR CI and the repository PR ReviewGPT loop remain post-push gates.

## Working Set

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/*hosted_ingress_latency_delivery_link*`
- `apps/web/app/api/internal/hosted-runtime/linq-egress/delivery/route.ts`
- `apps/web/app/(dashboard)/ops/runtime-latency/page.tsx`
- `apps/web/src/lib/hosted-runtime-latency/store.ts`
- focused `apps/web/test/**` and migration registry files
Completed: 2026-07-09
