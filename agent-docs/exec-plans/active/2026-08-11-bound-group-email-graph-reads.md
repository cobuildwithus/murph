# Bound group-email graph reads

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

Keep generic group-email preparation and final recipient revalidation bounded
at database query time without weakening membership, access, email-identity, or
share authorization semantics.

## Success criteria

- The preliminary group-membership read and canonical RepeatableRead snapshot
  select at most the admitted participant maximum plus one overflow sentinel.
- Each canonical member share relation selects the email authorization grant,
  the full admitted authorized-share maximum, and only one overflow sentinel.
- Oversized membership or share snapshots fail closed before access/email
  expansion or authorization-proof and recipient construction.
- Exact participant and authorized-share maxima preserve current preparation,
  recipient, and proof-change behavior.
- Focused tests assert the Prisma query bounds and both exact-boundary and
  one-over-bound outcomes.

## Scope

- In scope: the hosted Web group-email authorization reader, its focused unit
  tests, and only the durable documentation needed if the runtime contract
  materially changes.
- Out of scope: schema changes, new persisted state, group membership policy,
  share semantics, email delivery or retry ownership, and unrelated hosted
  group readers.

## Constraints

- Reuse the existing hosted runtime participant and authorized-share limits.
- Preserve the final RepeatableRead authority snapshot and stable proof
  derivation.
- Keep queries and ordering deterministic, including stable row tie-breakers.
- Prefer one bounded query-shape correction over new state, caching, or a new
  abstraction.

## Tasks

1. Inspect and integrate the ReviewGPT implementation patch against the exact
   supplied base, then reconcile current `origin/main` before candidate proof.
2. Verify member and share sentinel arithmetic and ensure overflow exits before
   downstream expansion or construction.
3. Run the focused hosted Web test, app-local typecheck, diff/docs/privacy
   checks, and the parent candidate review.
4. Commit and push the exact candidate, open the PR, run the preliminary
   coverage specialist and sensitive final ReviewGPT gate with CI, resolve all
   accepted findings, perform the parent final review, and close this plan.

## Verification

- Focused `apps/web/test/hosted-group-email.test.ts` Vitest suite.
- Hosted Web typecheck and scoped lint when selected by the final diff.
- `git diff --check`, documentation-drift checks, and identifier/privacy scan.
- Exact-head required GitHub Actions, preliminary specialist PASS or resolved
  findings, final ReviewGPT PASS with zero accepted findings, and a clean
  current-base merge-tree proof.

## Progress

- The implementation-first ReviewGPT patch was applied exactly, reconciled to
  current main, and proved with the focused suite, hosted Web typecheck,
  scoped lint, documentation drift, diff integrity, and privacy checks.
- The preliminary specialist found that a corrupt second email-kind grant
  could consume the overflow-sentinel slot because the database uniqueness key
  constrains scope rather than projection kind. The reader now requires every
  email-kind grant to use the canonical scope key and rejects more than one
  before constructing participants or proofs; preparation, recipient, and
  singleton-noncanonical regressions cover the correction.
- The specialist's request for a new live PostgreSQL and KMS maximum-graph
  harness was not accepted. This diff adds only bounded metadata relation reads;
  the exact Prisma order/take shape and composed reader call counts are covered
  here, while the unchanged verified-email owner already proves one email batch,
  one envelope batch, and concurrency-capped KMS unwraps in its own suite.
