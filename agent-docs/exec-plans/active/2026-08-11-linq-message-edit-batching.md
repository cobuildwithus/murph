# Linq message-edit batching

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Keep Linq message-edit replay, ordering, and direct/group authority intact
  while moving bounded lineage crypto work out of the PostgreSQL critical
  section and replacing per-row reads with one narrow set read.

## Success criteria

- The appendable maximum of six historical rows plus a distinct active root
  performs no KMS work inside the transaction and never exceeds four concurrent
  KMS unwraps; the seventh historical row remains a no-append sentinel.
- The transaction reacquires the existing ordered source locks, revalidates the
  exact live/AAD/storage snapshot, and reuses the six-row lineage limit as its
  sole finite attempt bound when that snapshot changes.
- Contact-privacy lookup uses the current version plus at most one prior
  version, while edit replay, revision limits, and direct/group authority remain
  fail-closed.
- Focused unit and real-PostgreSQL concurrency proof, routed typecheck/lint,
  required ReviewGPT gates, and exact-head CI pass.

## Scope and constraints

- Reuse the mailbox store, request-scoped domain-root cache, secure-box batch
  unwrap, and existing webhook transaction/retry owners.
- Prefer the existing blind-only direct home-route projection over decrypting
  unrelated private routing fields.
- Add no schema, dependency, service, queue, long-lived cache, compatibility
  layer, or second authority owner.
- Treat every ReviewGPT patch as untrusted intent: inspect all paths and hunks,
  run `git apply --check`, and land only locally verified changes.

## Plan

1. Ask ReviewGPT for a narrow mailbox-owner patch and inspect its complete
   artifact against the proven edit invariants and privacy rules.
2. Implement bounded pre-transaction lineage preparation, exact transactional
   revalidation, narrow direct-route authority, and the two-version privacy
   contract using existing owners.
3. Add max-cardinality incident-shape, mismatch/retry, direct/group authority,
   KMS ordering/concurrency, three-contender retry, and real-PostgreSQL
   serialization proof.
4. Run focused verification and direct replay, inspect scope and documentation,
   then push a candidate PR with a concrete internal-only changelog decision.
5. Run the preliminary completion-specialists pass and sensitive final
   ReviewGPT loop against exact pushed heads, resolve accepted findings, perform
   final local review, close this plan, and require green exact-head CI.

## Risks and mitigations

1. Prepared plaintext becomes authority after a concurrent change.
   Mitigation: compare the full bounded lineage snapshot under the existing
   source locks before any decrypt or append; retry sequentially within the
   existing six-attempt lineage bound on drift.
2. A historical root misses the request cache and unwraps under the lock.
   Mitigation: prewarm every exact root plus the active append root before
   `BEGIN`, and prove KMS ordering with deterministic instrumentation.
3. Direct or group authority weakens while shortening the critical section.
   Mitigation: retain the existing member/sender locks and live access checks,
   and compare only the blind route/contact fields required by the edit.

## Verification

- Focused hosted Web Vitest slices for mailbox lineage, Linq edit dispatch,
  privacy rotation, and domain-root batching.
- The opt-in local PostgreSQL Linq routing/edit serialization suite with
  `MURPH_TEST_POSTGRES_CONCURRENCY=1`.
- App-local typecheck, scoped lint, `git diff --check`, direct incident-shape
  replay, clean current-base merge-tree, required exact-head CI, and both
  ReviewGPT completion gates.

## Decisions

- The prepared package is attempt-bound evidence, never an authorization or
  mutation input by itself.
- Snapshot mismatch uses one typed preparation-required outcome and the
  existing service loop, bounded by the same six-row accepted-correction cap,
  rather than adding another retry owner, queue, or backoff policy.
- With `V` privacy lookup versions (`V <= 2`), steady/no-contention work is
  `V + 4` lineage queries. The six-attempt worst case is `6 x (V + 4)`
  sequential queries (at most 36), while each attempt holds at most one
  transaction/connection and runs all KMS work before `BEGIN`, with at most four
  unwraps in flight concurrently.
- This is internal reliability work; no member-visible changelog entry is
  planned unless implementation changes a visible outcome.
