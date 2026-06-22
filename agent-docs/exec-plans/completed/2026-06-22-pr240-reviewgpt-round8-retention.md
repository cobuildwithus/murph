# PR 240 ReviewGPT round 8 retention fixes

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Resolve accepted ReviewGPT round-8 retention findings for PR 240 with the
  smallest changes in existing snapshot cleanup, restore/rebuild, and retention
  owners.

## Success criteria

- A successful hosted checkpoint marks the replaced successful snapshot for the
  existing orphan cleanup path.
- Hosted sidecar rebuild does not create parser jobs that can pin old media
  unless that runtime will drain those jobs.
- Lazy legacy media materialization remains bounded by the retention batch.
- Focused regression tests and required verification pass.

## Scope

- In scope:
  - Hosted workspace checkpoint snapshot replacement cleanup.
  - Inbox sidecar rebuild parser-job enqueue behavior.
  - Inbox media retention candidate/materialization budgeting.
  - Focused Cloudflare, hosted-runtime, and inboxd regression tests.
- Out of scope:
  - New cleanup scheduler, queue, service, or retention database.
  - New durable pin state.
  - Broad hosted snapshot storage redesign.

## Constraints

- Default to deletion and radical simplicity.
- Reuse existing orphan cleanup and retention wake mechanisms.
- Preserve foreground wake priority and fail-closed checkpoint authority.
- Do not expose local identifiers or secret material in committed artifacts.

## Tasks

1. Inspect snapshot checkpoint/orphan cleanup flow and add the narrow replaced-snapshot cleanup hook.
2. Stop restore-side parser replay from pinning old media; keep ingestion enqueue behavior.
3. Bound retention lazy materialization without reintroducing loops.
4. Add focused regressions.
5. Run verification, commit, push, and rerun ReviewGPT.

## Decisions

- Use the existing orphan-candidate mechanism for replaced snapshots.
- Make parser enqueue behavior explicit at rebuild call sites instead of adding
  another parser-retention state flag.
- Use retention's existing `hasMoreEligibleAttachments` wake to drain deferred
  materialization chunks.

## Progress

- Implemented the round-8 fixes:
  - Successful web checkpoint responses now include the replaced snapshot ref
    from the CAS transaction, and Cloudflare records that V2 object as an
    orphan candidate through the existing delayed cleanup path.
  - Runtime projection rebuild no longer enqueues parser jobs by default;
    ingestion still enqueues parser work through the existing path.
  - Retention bounds lazy materialization by batch and tombstones expired
    missing media after a bounded materialization miss so later passes advance.

## Verification

- Passed:
  - `pnpm --dir packages/inboxd test -- inbox-media-retention idempotency-rebuild`
  - `pnpm --dir packages/hosted-execution test -- hosted-runtime-control`
  - `pnpm --dir apps/cloudflare test -- runner-outbound`
  - `pnpm --dir apps/web test -- hosted-runtime-internal-routes`
  - `pnpm typecheck`
  - `pnpm --dir packages/contracts test:artifacts`
  - `pnpm test:smoke`
  - `pnpm docs:drift`
  - `git diff --check`
  - `MURPH_APP_VERIFY_PARALLEL=0 MURPH_VERIFY_STEP_PARALLEL=0 pnpm test:diff`
Completed: 2026-06-22
