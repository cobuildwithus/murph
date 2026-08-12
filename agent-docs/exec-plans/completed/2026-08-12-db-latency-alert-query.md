# Bound the hosted runtime latency monitor query

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Keep the five-minute hosted runtime latency monitor index-bounded as retained
  trace, delivery, and mailbox history grows.

## Success criteria

- Candidate admission no longer depends on one cross-table `OR` predicate that
  can force broad scans before the 20,001-row cap.
- The query preserves the exact 24-hour resumed-activity, usage-denial,
  chronology, grouping, and truncation semantics.
- A representative PostgreSQL proof demonstrates bounded candidate work and
  usable indexes under dominant unrelated history.
- Focused tests, Web typecheck, lint, privacy review, and ReviewGPT review pass.

## Constraints

- Reuse the current latency trace, mailbox, and delivery owners.
- Prefer a small `UNION` of indexed candidate identities followed by one exact
  hydration query; add no queue, cache, or duplicate projection without a
  demonstrated need.
- Return only aggregate monitor health and preserve identifier-free alerts.

## Tasks

1. [x] Complete the valid pushed-head review gates. The recovered pre-PR thread
   remained an unusable one-character partial and was not treated as a pass;
   draft PR #1735 supplied the exact candidate context for a preliminary
   specialist PASS and final ReviewGPT round-one PASS with no findings or patch
   artifact.
2. [x] Replace the broad cross-owner `OR` with five independently time-indexed
   candidate branches and one exact hydration query.
3. [x] Add PostgreSQL query-plan/cardinality proof under dominant stale history
   and at the 20,001-row truncation boundary.
4. [x] Run focused tests, typecheck, lint, schema/migration checks, architecture
   guards, docs drift, privacy scan, and diff review.

## Verification

- Run the latency alert monitor and cron suites, the relevant opt-in PostgreSQL
  proof, Web typecheck, and scoped lint.
- Exact-head GitHub Actions passed on the corrected candidate, including Web
  app verification, build/typecheck, all package coverage shards, CLI host
  matrices, migration/fixture proof, repo hygiene, billing, and release gates.

## Outcome

- Candidate admission now uses a materialized five-branch `UNION` over the
  existing trace, delivery, and mailbox owners, followed by exact trace
  hydration and the unchanged latency-origin, chronology, grouping, and
  truncation rules.
- Three concurrent indexes cover previously unindexed staging, delivery
  acceptance, and mailbox consumption candidate branches. Existing indexes
  continue to cover ingress acceptance, provider start, and owner joins.
- A local PostgreSQL proof seeded 50,000 stale rows per owner, admitted exactly
  one candidate through each branch, observed all five intended time indexes
  with no owner sequential scan, and preserved usage-denial restart chronology
  plus the 20,001-row truncation signal.
- Focused monitor/cron tests, the PostgreSQL proof and denial-concurrency test,
  Web typecheck, scoped lint, Prisma generation/validation/migration deploy, the
  production migration guard, workspace and architecture guards, docs drift,
  privacy scan, and `git diff --check` passed.
- CI found one stale migration-inventory test expectation. The current
  candidate adds only the missing migration name to that proof; its focused
  suite passes 9/9 and exact-current-head CI passes. This isolated test-only
  proof update does not change the reviewed production patch or implemented
  contract.
- Preliminary specialist review at `fddb2f65b3e` returned
  `SPECIALIST_OUTCOME: PASS` with no findings and no patch artifact. Final
  ReviewGPT round 1 at the same exact candidate returned `ROUND_OUTCOME: PASS`
  with no qualifying findings. Its PR-body note about index write maintenance
  was accepted as an accuracy correction and resolved in the PR description.
Completed: 2026-08-12
