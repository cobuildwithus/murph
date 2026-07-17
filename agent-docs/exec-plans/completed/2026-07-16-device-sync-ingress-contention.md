# Device-sync ingress contention

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Reduce production tail latency for hosted device-sync webhook persistence by
  shortening the lock window on each connection's dirty-state row without
  weakening durable webhook retention, deduplication, or wake ordering.

## Success criteria

- Prepare encrypted durable payload rows before the dirty-state compare-and-swap
  update when an existing connection transitions revisions.
- Preserve the single transaction as the rollback boundary so a stale compare-
  and-swap cannot retain payload rows from a failed attempt.
- Add focused regression proof for the new ordering and retain the existing
  contention-retry and durable-payload behavior.
- Make no schema, index, queue, billing, provider, or deployment-boundary change.
- Pass the routed hosted-web verification, coverage audit, parent final review,
  green PR CI, and exact-head ReviewGPT gate.

## Scope

- In scope: the existing dirty-connection Prisma store, its focused tests, and
  the hosted control-plane documentation if the transaction-ordering invariant
  needs clarification.
- Out of scope: one-off readonly operator diagnostics, unrelated row-lock
  queries, provider subscription lifecycle, paused-member backlog policy, and
  new production observability or persisted state.

## Constraints

- Keep Postgres as the one durable hosted owner and preserve exact durable
  webhook work until runtime acknowledgement.
- Prefer reordering within the existing transaction over a new abstraction,
  queue, table, index, or compatibility path.
- Preserve unrelated active work and keep edits limited to the declared files.

## Risks and mitigations

1. Risk: payload rows could survive a lost compare-and-swap attempt.
   Mitigation: retain payload insertion and the revision update in the same
   Prisma transaction; the thrown contention error rolls the attempt back.
2. Risk: concurrent webhooks could lose or misattribute exact work.
   Mitigation: keep the existing trace claim, revision derivation, unique
   payload identity, retry owner, and payload-only dirty branch unchanged; add
   ordering proof around the existing transaction seam.
3. Risk: optimization scope could expand into the paused-member backlog.
   Mitigation: defer that separate lifecycle decision until a lossless,
   billing-safe drain owner is proven; do not cap or drop retained work here.

## Tasks

1. Register the isolated task and trace the exact transaction and tests.
2. Add a regression test that fails while payload preparation occurs after the
   contended dirty-row update.
3. Reorder the existing operations with no new state or abstraction.
4. Run focused and routed verification plus the required coverage audit and
   parent final review.
5. Close the plan, commit, push, open the intent-complete PR, and run ReviewGPT
   concurrently with CI through the required pass state.

## Decisions

- Do not add an index: production evidence shows the dirty table is tiny and
  the primary-key row update is not scan-bound.
- Do not change the two readonly diagnostic queries because they are operator
  traffic rather than application call paths.
- Do not mix paused-member retention policy into a lock-window optimization.

## Audit outcomes

- The required `coverage-write` audit returned no findings and made no edits.
  It confirmed the existing stale-preseal test now proves the failed attempt
  reaches neither write and the successful attempt inserts the payload before
  the dirty-marker compare-and-swap.
- The parent final review found no new lock-order cycle or owner-boundary
  change. Payload acknowledgement deletes only previously observed payload ids,
  and account deletion already removes payload rows before dirty markers.
- Transaction rollback remains the established Prisma callback contract; no
  mock-only rollback scaffold was added.

## Verification

- Focused dirty-connection Vitest: 18 tests passed.
- `pnpm test:diff` for the touched hosted-web source and test passed global
  guards, TypeScript 7, production build, dev smoke, lint with zero errors, and
  the hosted-web suite: 437 files and 5,376 tests passed, with 3 files and 141
  tests skipped.
- `git diff --check` passed.
- Remaining external gates: exact-head ReviewGPT, PR CI, and merge proof against
  current `main`.
Completed: 2026-07-16
