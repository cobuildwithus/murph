# Consolidate established-account preservation after ReviewGPT Round 4

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Preserve an established shared Junction account and its generation when a
  local or tunneled member starts another target source.
- Make the established-account write policy explicit and identical across the
  shared ingress, hosted Prisma, and local SQLite production owners.
- Prove sibling continuity through the real device-sync service controller and
  SQLite store before the final ReviewGPT round.

## ReviewGPT evidence

- Shared ingress requests established-account reuse for a source-scoped
  Junction start.
- Hosted Prisma honors that request, but the local service adapter drops it
  before `SqliteDeviceSyncStore.upsertAccount`.
- SQLite therefore rewrites the shared account to `pending_link`, changes its
  epoch, and causes account-level admission readers to suspend established
  siblings.
- Existing preservation coverage uses an in-memory adapter and does not compose
  the production local controller with SQLite.

## Smallest durable correction

- Replace the optional reuse hint with one closed existing-account write policy
  owned by the public account contract.
- Apply the same policy helper inside both production persistence owners,
  including their conflict/race paths.
- Keep ordinary reconnect replacement behavior explicit.
- Add one production-composed local scenario covering start, abandon, retry,
  completion, failure, webhook, reconcile, scheduler, worker, account epoch,
  and source status.

## Tasks

1. [x] Reproduce the SQLite overwrite with the production controller.
2. [x] Consolidate the established-account policy across production owners.
3. [x] Add production-composed sibling-continuity and failure-path coverage.
4. [x] Update durable owner docs, the anomaly retrospective, and PR disclosure.
5. [x] Run focused, canonical, acceptance, and parent review. The scoped
   commit, final ReviewGPT gate, and exact-head CI follow from the immutable
   pushed head after this plan is archived.

## Verification

- Focused device-sync and hosted Prisma owner suites passed.
- `pnpm test:diff packages/device-syncd apps/web apps/cloudflare` passed,
  including 873 device-sync tests, 6,976 web tests, 2,016 Cloudflare Node
  tests, and 2 Cloudflare Workers tests.
- The default capable-host acceptance profile exposed unrelated worker
  starvation: two isolated tests timed out and another web worker could not
  start. Both isolated files passed immediately with one worker.
- `pnpm verify:acceptance` then passed with the documented concurrency
  overrides pinned to serial, one-worker execution.
- `git diff --check` and the task-path privacy scan passed.
Completed: 2026-07-28
