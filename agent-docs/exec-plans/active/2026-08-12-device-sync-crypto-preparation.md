# Device-sync transaction-safe crypto preparation

Status: active

## Objective

Move provider-capable classification, compression, and crypto preparation out of consent/member/connection locked transactions while preserving the exact consent and connection authority fences.

## Scope

- Dirty connection writes and clean-to-dirty wake composition that still perform cold-cache local preparation or secure-box work under locks.
- OAuth connection secret writes that encrypt bounded secrets under locks.
- Exact-root and consent/connection revalidation, with no private health-data preparation before consent authority permits it.

## Exclusions

- Runtime apply/source cardinality owned by the existing bounded-protocol PR.
- Generic mailbox crypto APIs owned by the prepared-mailbox foundation.
- Scheduled-reconcile tombstone rearm owned by its separate patch.
- OAuth/token secret writes remain on the bounded-protocol branch that already
  changes the connection-secret owner; this lane must not duplicate or conflict
  with that active work.

## Decisions

- Stack the committed crypto-identity foundation through a normal non-fast-forward
  merge so prepared root capabilities remain attributable and independently
  reviewable.
- Keep payload-bearing dirty ciphertext, classifier output, normalized resource
  batches, and exact dirty snapshots behind request-local `WeakMap`
  capabilities. Public tokens expose only identity, predicted revision, and
  wake expectation. Compact-only webhook hints use the canonical store owner in
  the final transaction and do not mint an unnecessary dirty capability.
- Consent-gated webhook and companion paths use short admission preflight and
  final transactions. Classification, lazy provider loading, compression,
  dirty-payload sealing, and conditional mailbox-root preparation occur between
  them, outside every database lock.
- The final transaction revalidates consent, connection epoch/setup/provider,
  exact source admission, dirty snapshot, device root, and (when waking) ingress
  root under a provider-closed scope. Exact preparation drift gets one full
  retry with a fresh root cache; a second drift is returned retryably.
- Exact source admission uses a max-one, minimally projected SQL read scoped by
  connection, provider slug, connected status, and disconnect-fence state.
- Changelog: not applicable. This is an internal transaction-ownership and
  contention reduction with intentionally unchanged member-visible behavior.

## Progress

- [x] Merged crypto-identity preparation foundation at its committed head.
- [x] Added private prepared dirty-write and dirty-payload crypto capabilities.
- [x] Moved webhook and companion dirty/wake preparation outside admission locks.
- [x] Added focused capability, ordering, fresh-replan, and PostgreSQL consent
  race proofs.
- [x] Updated reliability, ingestion, architecture, control-plane, and testing
  documentation.
- [ ] Complete repository verification, required audits, ReviewGPT, and task
  closure.

## Verification

- Focused unit tests for provider/dynamic-import/KMS ordering and root drift.
- Real PostgreSQL lock/concurrency tests where relevant.
- Web typecheck, scoped lint, privacy diff scan, and current-main merge simulation.

Evidence so far:

- Corrected focused Vitest: 170 passing tests across dirty store, source
  admission projection, preseal concurrency, and hosted wake behavior.
- Opt-in local PostgreSQL: 4 passing webhook/companion consent-ordering races,
  plus the 1,641-receipt incident replay at 31-way admission concurrency.
- Hosted Web prepared typecheck: passing.
- Local diff verification: passing, including 9,724 Web tests across 725 files,
  full Web lint (unrelated baseline warnings only), dev smoke, and production
  Next build.
- Scoped lint, docs drift, privacy scan, and diff check: passing.
- The preliminary specialist review found and the correction set now covers the
  real shared mailbox-root mismatch, plus the composed built-in maximum of two
  webhook resources (companion remains exactly one). The protected private
  hosted-local Junction scenario owns the production-faithful encrypted
  mailbox, runtime import, acknowledgement, and dirty-drain proof; this public
  lane has no hermetic companion-route equivalent and does not replace that gap
  with a mock-only harness.
- Final ReviewGPT round 1 found that compact-only webhook bursts shared an
  unnecessary prepared dirty snapshot and that exact source admission hydrated
  unbounded connection-wide history. The correction splits compact-only work to
  the canonical final owner, bounds source admission in SQL, and extends the
  real-PostgreSQL incident replay to prove 1,641 accepted hints at 31-wide
  contention without dirty crypto preparation or avoidable stale responses.
