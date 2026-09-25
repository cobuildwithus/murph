# Reduce query projection workspace storage

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and protected invariant

Reduce workspace archive overhead while preserving the complete query SQLite
restore cache, canonical data, query output, and source-manifest freshness.
No production mutation or edits to the supplied archive are authorized here.

## Evidence and owner

Private archive inspection identified the query projection as the largest
component. Aggregate in-memory experiments showed obsolete SQLite payload bytes
inflate compressed archives, and nullable biomarker index entries consume space
without serving biomarker equality lookups. Private rows and identifiers stay
out of repository artifacts. The existing query schema/rebuild owner is enough.

## Implementation

1. Use a partial biomarker index; retain every metric row and equality lookup.
2. Enable secure deletion only on writable query connections so replacement
   clears obsolete payload bytes without a separate vacuum or maintenance loop.
3. Bump the derived schema version for a clean rebuild of carried caches.

Canonical ownership, portable cache eligibility, JSON formats, and public query
behavior stay unchanged. Existing unsupported-version reset handles old/new
runner skew in either direction. A version transition pays one derived rebuild;
no coordinated deployment or canonical migration is needed. Atomic publication
and existing canonical locks remain authoritative.

## Proof and completion

- Synthetic index cardinality, query-plan, filtered/unfiltered result parity.
- Synthetic deletion/reinsertion and rollback with physical payload inspection.
- Previous-version rebuild and restored current-cache freshness regressions.
- Focused query tests, package typecheck, complexity guard, parent diff review.
- Internal storage optimization; no public changelog item or assistant behavior
  change. No PR or deployment requested; scoped local commit is the endpoint.

## Results

- Focused query storage, provider scope, source health, canonical-write,
  concurrency, wearable-store, and main query suites: 162 passed, 1 pre-existing
  skipped test across seven files.
- `pnpm --dir packages/query typecheck`: passed after building the declared
  dependency closure with `pnpm --filter '@murphai/query^...' build`.
- `pnpm complexity:diff`: passed; no hotspots, unchanged maximum complexity 7.
- `git diff --check` and task-file privacy inspection: passed.
- Parent review: all metric rows and equality-index eligibility are preserved;
  secure deletion runs only on writable connections. Existing transactions
  retain rollback semantics. No new state owner, dependency, vacuum, snapshot
  filter, canonical format, or network operation was introduced.
- In-memory inspection verified ordinary table equality and SQLite integrity
  across a clean schema rebuild. No private source rows or archive-derived
  fixtures were persisted. The source archive was not modified.
- Product outcome: Ready for local implementation; unchanged queries and
  restorable cache proved. Deployment and external PR review were not performed.
- Rollout cost: the schema version change causes one derived-cache rebuild on
  first use. Mixed old/new runners may rebuild again when switching versions.
  Existing restore freshness and unsupported-version handling remain in force.
Completed: 2026-09-21
