# Bound growth snapshot database load

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Reduce the maximum database connection demand and private-message material retained by one growth snapshot without changing reported metrics.
- Keep the existing growth-metrics owner and its current snapshot contract; add no cache, queue, scheduler, or durable state.

## Success criteria

- Independent snapshot reads run in explicit bounded phases whose largest phase is materially below the default hosted Web pool size.
- The four status counts share one grouped database query while preserving all four output values, including zero-count statuses.
- Group-message processing pages the existing 30-day window in deterministic order instead of loading the full ciphertext collection at once.
- Maximum-cardinality tests prove query count, phase concurrency, selected fields, pagination, and unchanged metric results.
- Focused tests and hosted-Web typecheck pass; the exact pushed PR head passes required CI and final ReviewGPT.

## Scope

- In scope: the growth snapshot query schedule, status-count aggregation, bounded group-message paging, focused tests, the owning load contract, and one repository-friction entry for the unavailable required Graft command.
- Out of scope: changing metric definitions, snapshot cadence, pool sizing, retention policy, mailbox reads, companion connection selection, billing, device sync, or schema changes.

## Product UX Patch

- Outcome: Existing growth reporting completes with less database contention and no metric changes.
- Reaches: Internal growth snapshot generation only; no member-facing interaction or copy changes.
- Proof: Focused parity tests plus deterministic maximum-cardinality query/concurrency assertions.

## Risks and mitigations

1. Risk: phased reads observe a slightly wider database time window.
   Mitigation: preserve the existing independent-read semantics and snapshot boundary inputs; do not claim transaction-level consistency that does not exist today.
2. Risk: grouped counts omit statuses with zero rows.
   Mitigation: initialize every expected status to zero and overwrite only returned groups.
3. Risk: pagination duplicates or skips messages with equal timestamps.
   Mitigation: use a stable composite cursor/order owned by the message table and test equal-time boundaries.

## Tasks

1. Trace the current snapshot query graph, metric contracts, schema indexes, and focused test seams.
2. Reorder independent work into explicit bounded phases and collapse status counts into one grouped query.
3. Page the 30-day group-message window with a deterministic cursor and incremental decoding/aggregation.
4. Add maximum-cardinality and result-parity proof; update the owning database-load contract if its recorded peak changes.
5. Run focused tests, hosted-Web typecheck, diff/privacy checks, Product UX walkthrough, complexity review, and parent final review.
6. Close the plan with `scripts/finish-task`, push the draft PR candidate, then run final ReviewGPT concurrently with required exact-head CI.

## Decisions

- Treat this as a Product UX Patch because it restores operational headroom for an existing internal report without changing product meaning.
- Keep every metric in the current owner and reduce load through query combination, ordering, and paging only.
- Current `origin/main` already contains the earlier dashboard-wave correction and deterministic peak-concurrency proof, so this PR preserves its eight-operation ceiling instead of duplicating that completed work.
- Preserve the snapshot's existing failure isolation by partitioning every fetched page before decode: activity decode remains authoritative for activity availability, while attribution-only decode failure discards only attribution and retries on a later snapshot.
- Changelog is expected to be not applicable because the change is internal reporting efficiency with no member-visible behavior claim.

## Verification

- `pnpm --dir apps/web exec tsx scripts/run-hosted-web-vitest.mts test/hosted-ops-growth.test.ts` — passed, 59 tests, including the 101-row equal-time pagination boundary, status aggregation, eight-operation peak, and attribution failure isolation.
- `pnpm --dir apps/web typecheck` — passed after generating the repository-owned Health Commons artifact and building the existing device-sync package entrypoint required by a fresh worktree.
- Scoped ESLint over the changed production and test files — passed.
- `pnpm complexity:diff` — passed; no complexity debt and the file maximum remained 17.
- `git diff --check` and task-path direct-identifier/credential scan — passed.
- Exact pushed-head required GitHub checks and sensitive final ReviewGPT full-patch round.
Completed: 2026-09-04
