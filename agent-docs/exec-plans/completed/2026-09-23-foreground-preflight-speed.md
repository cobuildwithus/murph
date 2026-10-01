# Reduce foreground mailbox and session preflight work

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Goal

Reduce the work required before a fresh conversation reaches the provider while
preserving causal completion ordering, session routing, and runtime ownership.

## Success criteria

- Profile current mailbox preparation and session lookup before changing them.
- Remove demonstrated unnecessary foreground work before adding mechanisms.
- Preserve ordering, routing validation, recovery, and security in focused tests.
- Pass affected typechecks, candidate review, and exact-head PR gates.

## Scope

- In scope: system mailbox selection, session preflight, and their shared owners.
- Out of scope: provider latency, routing policy changes, new caches or services.

## Constraints

Use synthetic committed fixtures. Private profiling inputs and intermediate
artifacts remain in ignored local scratch and never enter review bundles.
Prefer deletion and explicit data flow; retain existing canonical authorities.

## Risks and mitigations

1. Removing a read can bypass ordering or session validation. Keep regression
   coverage for the affected owner and compare behavior before and after.
2. Local filesystem timings differ from hosted storage. Report operation counts
   alongside measured local times; do not claim production gains without proof.

## Tasks

1. Measure both paths and identify avoidable operations.
2. Implement the smallest change supported by those measurements.
3. Run focused regression tests, typechecks, and repeat the private benchmark.
4. Review the candidate, complete the PR gates, and ship within authorization.

## Decisions

- Challenge the need for existing work before optimizing it; no speculative cache.

## Verification

- Focused tests and typechecks for affected packages.
- Local aggregate-only timing and filesystem-operation measurements.
- Required exact-head CI and routed review for the final candidate.

## Implementation result

- Kept directory-lock metadata private until the single atomic directory
  publication; removed the duplicate file publication and parent preparation.
- Moved secret-directory validation to session persistence, preserving checks
  before mutation while removing unused work from preflight.
- Skipped unrelated continuation reads and unchanged mailbox writes.
- Added no cache, state, dependency, or new abstraction. Complexity debt is
  unchanged; remaining routing and mailbox hotspots preserve existing policies.

## Verification result

- Runtime lock/security: 13 tests passed.
- Session preflight/persistence: 41 tests passed, including secret-path symlinks.
- Hosted mailbox/maintenance: 141 tests passed.
- Changelog rendering: 10 tests passed.
- Runtime-state, assistant-engine, assistant-runtime, and hosted-web typechecks passed.
- Private aggregate-only profiling: steady asynchronous filesystem calls fell
  from 36 to 13 for ineligible mailbox preparation and 36 to 23 for preflight.
  Shared lock calls fell from 20 to 12. SQLite-internal I/O is excluded.
- Local warm-cache medians across 49 samples: mailbox 2.020 to 1.107 ms;
  preflight 1.971 to 1.837 ms. These are not production speedup claims.
- PR: https://github.com/cobuildwithus/murph/pull/3667

## Release boundary

Implementation and local verification close out in this plan. Exact-head CI,
final ReviewGPT, and release observation are tracked by the PR. Existing phase
telemetry must verify hosted latency after deployment; the local benchmark did
not reproduce the reported seconds-long stalls.
Completed: 2026-09-23
