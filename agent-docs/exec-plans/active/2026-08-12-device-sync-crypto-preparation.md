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
- Keep dirty ciphertext, classifier output, normalized resource batches, and
  exact dirty snapshots behind request-local `WeakMap` capabilities. Public
  tokens expose only identity, predicted revision, and wake expectation.
- Consent-gated webhook and companion paths use short admission preflight and
  final transactions. Classification, lazy provider loading, compression,
  dirty-payload sealing, and conditional mailbox-root preparation occur between
  them, outside every database lock.
- The final transaction revalidates consent, connection epoch/setup/provider,
  exact source admission, dirty snapshot, device root, and (when waking) ingress
  root under a provider-closed scope. Exact preparation drift gets one full
  retry with a fresh root cache; a second drift is returned retryably.
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

- Focused Vitest: 153 passing tests across dirty store, preseal concurrency, and
  hosted wake behavior.
- Opt-in local PostgreSQL: 4 passing webhook/companion consent-ordering races.
- Hosted Web prepared typecheck: passing.
- Local diff verification: passing, including 9,724 Web tests across 725 files,
  full Web lint (unrelated baseline warnings only), dev smoke, and production
  Next build.
- Scoped lint, docs drift, privacy scan, and diff check: passing.
