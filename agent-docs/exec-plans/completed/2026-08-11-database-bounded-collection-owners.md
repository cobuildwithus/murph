# Bound Linq and vault database collection owners

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

Complete the recovered Linq chat-health and vault-share bounded-work lane while
keeping each correction at its existing owner and adding no generic scheduling
or bulk-work framework. The initially considered growth-snapshot lane produced
no valid accepted artifact and is not included in this local commit series.

## Success criteria

- Vault-share delivery admits a hard bounded page, prepares crypto before any
  transaction, finalizes each share through short live revalidation, and locks
  reciprocal member pairs in one canonical order. Pagination remains complete
  across revoke/regrant generation changes.
- Linq chat-health synchronization projects a bounded inventory in fixed-size
  database chunks instead of one read/create/update sequence per chat.
- Maximum-cardinality, overflow, retry, stale-evidence, regrant, and concurrency
  tests prove fixed query and transaction behavior for both owners.
- Existing open PRs retain their scopes; runtime-progress and device-runtime
  apply changes are not duplicated.

## Scope

- In scope: hosted vault-share delivery and member lock ordering, Linq
  chat-health inventory projection, focused tests, migrations, and directly
  authoritative reliability/testing documentation.
- Out of scope: runtime-progress alert scanning (PR #1664), device runtime
  apply and source cardinality (PR #1658), device snapshot/status reads (PR
  #1645), Linq roster resolution and message-edit preparation (PRs #1641 and
  #1644), group-share grant admission/maintenance (PR #1688), schema or new
  durable state without owner-level necessity, the unlanded growth-snapshot
  candidate, and unrelated database audit findings.

## Architecture

- Reuse active share identity and current callback continuation for bounded
  delivery. Prepare immutable crypto candidates first, then use short
  database-only compare-and-set finalization with sorted unique member locks.
- Keep Linq provider pagination outside transactions and project normalized
  health records through fixed-size set operations owned by the existing
  health store.
- Prefer deletion and reordered work. Add no queue, scheduler, cache, manager,
  dependency, or generic bulk abstraction.

## Tasks

1. [x] Inspect open-PR overlap and current owner contracts.
2. [x] Inspect every returned patch path and hunk, reject scope growth, and
   apply accepted behavior deliberately as separate owner commits.
3. [x] Add or correct maximum-cardinality and concurrency proof, then run
   focused tests, hosted Web and Cloudflare typechecks, scoped lint,
   documentation drift, diff, and privacy checks.
4. [x] Complete the exact-head ReviewGPT correction loop and leave scoped local
   commits with no push or PR.

## Verification

- Focused Web suites: 5 files and 79 tests passed.
- Focused Cloudflare callback suite: 1 file and 4 tests passed.
- Opt-in PostgreSQL Linq, reciprocal-lock, index, and vault regrant proofs:
  4 files and 6 tests passed.
- Fresh PostgreSQL database: all 180 migrations deployed; migration status was
  current; the destination cursor index was present and superseded delivery
  index names were absent.
- Web and Cloudflare typechecks passed.
- Scoped ESLint passed. Documentation drift, hosted crypto, hosted Temporal,
  logging, provider-request, workspace-boundary, package-cycle, diff, and
  identifier/privacy guards passed.

## Progress

- Confirmed exact base `05988dd160797405924a72affdb6366f716c141c` and created
  a sanctioned isolated task worktree.
- Inspected PRs #1658, #1645, #1641, #1644, #1664, and #1688. Excluded the
  runtime-progress raw scan and device-runtime apply changes already owned by
  #1664 and #1658.
- Started independent ReviewGPT implementation work for growth snapshot reads,
  vault-share delivery/locks, and Linq chat-health bulk projection.
- Accepted and committed bounded Linq provider pagination, global duplicate
  convergence, fixed-size set projection, canonical current/legacy privacy-key
  locking, and replay-safe equal-timestamp ordering.
- Accepted and committed vault delivery pages, a shared deadline across
  Cloudflare continuation requests, pre-transaction encryption, canonical
  owner-first member locks, exact destination-root fencing, exact-generation
  compare-and-set finalization, and split single-operation concurrent index
  migrations.
- Exact-head ReviewGPT identified and locally confirmed one remaining
  high-severity edge case: a revoke/regrant could change the mutable generation
  id and move an unprocessed row behind the continuation cursor.
- Corrected pagination and its partial index to use stable destination identity
  while retaining generation id for ciphertext AAD and finalization. Added
  production-faithful PostgreSQL proof for the regrant boundary.
- The same ReviewGPT thread passed the exact correction head with no unresolved
  findings and no additional patch.
- The growth-snapshot implementation request produced no valid accepted
  artifact. No growth behavior was changed in this series; that owner remains a
  separate future lane if reprioritized.
Completed: 2026-08-12
