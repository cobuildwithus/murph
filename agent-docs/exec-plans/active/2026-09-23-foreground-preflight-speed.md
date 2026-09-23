# Reduce foreground mailbox and session preflight work

Status: active
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
