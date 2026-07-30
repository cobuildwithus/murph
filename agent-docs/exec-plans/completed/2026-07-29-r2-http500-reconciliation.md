# R2 Copy HTTP 500 Reconciliation

## Goal

Make the online R2 bundle copier recover safely from one ambiguous Cloudflare
`CopyObject` HTTP 500 so a fresh, isolated production-read rehearsal can run to
completion without broadening production authority or risking duplicate
destination writes.

## Constraints

- Production R2 is a read-only source. No production deploy, route change,
  write, delete, freeze, or cutover is part of this task.
- Retry only the first `CopyObject` HTTP 500. Preserve current behavior for all
  other HTTP and transport outcomes.
- Reconcile the destination and source with exact ETag and byte-size checks
  before deciding whether one further create-only destination write is safe.
- The recovery write gets exactly one raw attempt and never resets the existing
  pre-connect retry budget.
- Any unresolved or repeated ambiguity is terminal and requires quarantining
  the rehearsal destination.
- Keep secrets and private object identifiers out of code, tests, docs, logs,
  review artifacts, and commits.

## Plan

1. Extract the existing bounded R2 HEAD operation so copy reconciliation and
   ordinary post-copy verification share one read path.
2. Add the one-HTTP-500 state machine with exact identity checks and a single
   raw create-only recovery attempt.
3. Add focused failure-matrix and retry-budget tests, including body-read and
   transport ambiguity.
4. Update the R2 cutover runbook and Cloudflare README with the exact recovery
   and quarantine contract.
5. Run focused tests and typechecks, then complete preliminary ReviewGPT,
   parent review, final ReviewGPT, and CI before merging.

## Verification

- Focused R2 online-copy Vitest suite
- Cloudflare TypeScript typecheck
- `pnpm test:diff ...`
- `pnpm verify:acceptance` or the documented bounded-admission fallback
- Preliminary completion-specialists ReviewGPT
- Final PR-lane ReviewGPT and exact-head CI

## Deployment

This code change is backward compatible and does not itself deploy anything.
After merge, the rehearsal uses a new isolated ENAM destination bucket. A
production cutover remains a separate, explicitly authorized operation.
Status: completed
Updated: 2026-07-30
Completed: 2026-07-30
