# Resolve PR 807 ReviewGPT findings

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Correct the two reproduced lifecycle inconsistencies from ReviewGPT Round 1
  and disclose the intentional shared `/experiments` navigation consequence.

## Success criteria

- Active and paused runs with a known start but unknown end expose their true
  elapsed day and known phase without inventing a total duration.
- Private-only cards use the canonical private projection as their lifecycle
  owner whenever it exists, including review-due history placement and saved
  outcome summaries.
- Runnable public cards keep their existing public protocol route; unpublished
  and protocol-less cards keep the authenticated private results fallback.
- Focused owner regressions, `pnpm test:diff`, CI, and ReviewGPT correction
  verification pass on the resulting exact head.

## Scope

- In scope: browser-query run day/phase derivation, private-only card lifecycle
  projection, focused tests, and the PR intent disclosure.
- Out of scope: republishing draft protocols, changing experiment setup
  readiness, adding persisted lifecycle state, or changing public protocol
  detail behavior.

## Tasks

1. Derive elapsed day from the known run start and classify phase from each
   available boundary without requiring an intervention end.
2. Remove the second private-card lifecycle resolver and use the canonical
   projection when present.
3. Add focused active, paused, review-due, home-section, and summary proof.
4. Update the PR body disclosure, run scoped verification, commit and push, then
   run ReviewGPT Round 2 concurrently with CI.

## Review dispositions

- Accepted: unknown-end active runs remain on a synthetic Day 1 because the
  query omits day and phase until both intervention boundaries exist.
- Accepted: private-only cards combine canonical labels with raw overview
  lifecycle status, which can hide saved summaries and misplace review-due runs.
- Accepted as disclosure-only: the shared library-card builder intentionally
  makes unmatched private cards clickable on both `/home` and `/experiments`.

## Constraints

- Keep one lifecycle owner and delete restrictive conditions where possible.
- Preserve incomplete setup-readiness diagnostics for a missing end date.
- Keep all fixtures synthetic and free of supplied-vault content.

## Verification

- Browser-query owner regressions: 2 files and 164 tests passed.
- Web projection/home regressions: 3 files and 63 tests passed.
- Coverage-write follow-up and frontend remediation review returned no
  findings; rendered browser proof remains unavailable because the in-app
  browser reports `No browser is available`.
- `pnpm test:diff` passed every affected package typecheck, then the unrelated
  assistant-engine suite exhausted its 4 GB Node heap in
  `assistant-local-service-runtime.test.ts`. An exclusive host-slot rerun
  reproduced the same OOM and dead-worker termination timeout, proving it was
  not host contention. The task does not change assistant-engine source or
  tests; focused owners are green and the pushed head still requires full CI.
- Remaining: scoped commit/push, PR disclosure and shape update, exact-head
  ReviewGPT correction round, and final CI/merge-tree proof.
Completed: 2026-07-20
