# Snapshot Publication Observation Race

## Goal

Make the hosted snapshot-publication fallback E2E accept the valid interval where
recovery has published a successor snapshot but the recovered invocation has not
yet reached global idle.

## Background

Two consecutive exact-head CI runs completed the intended runtime behavior:
corrupted completion metadata was rejected, the failed container was recycled,
and recovery published a clean successor snapshot. The test then failed because
it used full invocation settlement to decide whether any recovery publication had
occurred. During the narrow interval where the snapshot reference had advanced
but `inFlight` was still true, it incorrectly required that successor reference
to equal the retained baseline.

## Scope

- `apps/cloudflare/test/hosted-local-snapshot-publication-fallback-e2e.test.ts`

## Constraints

- Keep this test-only; do not change snapshot publication or recovery runtime
  behavior.
- Preserve proof that rejection retains a valid baseline or produces a valid
  successor, recovery settles cleanly, and later work restores the baseline
  contents.
- Do not add sleeps, retries, state owners, or abstractions.

## Plan

1. Classify whether recovery publication was already observed from the snapshot
   reference itself, independently of global invocation settlement.
2. Queue the retry provider response only when no successor publication was
   observed.
3. Always wait for the existing clean-publication predicate before continuing
   with restored-workspace assertions.
4. Run focused and canonical verification, exact-head review, and CI.

## Verification

- Focused snapshot-publication fallback E2E where the local harness is available.
- Canonical `pnpm test:diff` for the changed test owner.
- Canonical `pnpm verify:acceptance`.
- Exact-head hosted E2E CI.

Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
