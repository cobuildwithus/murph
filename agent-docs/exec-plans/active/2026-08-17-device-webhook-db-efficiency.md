# Device webhook database efficiency

## Goal

Reduce the application-visible SQL and transaction count for hosted device
webhook bursts while preserving exact trace, consent, connection, source,
credential, dirty-state, and mailbox authority.

The motivating same-account compact-hint burst currently performs roughly
2,012 application-visible SQL operations for 100 deliveries. The first target
is the evidence-backed reduction from the ReviewGPT architecture audit:
approximately 1,200-1,250 operations, 201 transaction scopes, and one root
unwrap for that illustrative burst.

## Scope

- Stop loading and decrypting unused connection secret columns during verified
  external-account ingress lookup.
- Resolve exact webhook source admission with one minimally projected,
  deterministic store query and reuse that tx-scoped snapshot where safe.
- Return the canonical dirty row from compare-and-swap writes instead of
  writing and then rereading it.
- Carry the already-proven connection owner through private ingress context to
  remove the redundant owner lookup while retaining final authority rechecks.
- Skip the generic preparation transaction for already-dirty compact hints and
  reuse exact source preflight proof for deferred source work, with the existing
  one-time full replan on authority drift.
- Add or update focused query-budget, concurrency, and behavior coverage.

## Constraints

- ReviewGPT authors the implementation patch; the parent inspects, scopes,
  applies, and verifies it.
- Do not bulk-claim live trace leases, parallelize within an account lane, or
  combine multiple events/accounts into one database transaction.
- Provider or crypto work stays outside database transactions.
- Keep the final consent, connection/source identity, credential, application,
  ingress-root, dirty-snapshot, and mailbox-root checks required by current
  contracts.
- Preserve level-triggered coalescing and durable event-work semantics.
- Do not add terminal duplicate prefetch or multi-mailbox append unless measured
  workload evidence demonstrates that those optional paths are beneficial.

## Risks and direct proof

1. A pending-to-clean race could incorrectly skip required preparation.
   Preserve exact dirty-snapshot comparison and allow one full replan on drift.
2. Source state could change during provider I/O. Revalidate the exact source
   proof in the final transaction and retry or settle according to existing
   durable-versus-rehydratable semantics.
3. Removing secret projection could accidentally weaken account matching.
   Keep blind-index lookup plus verified external-account equality supplied by
   the trusted caller, and add focused projection/decryption tests.
4. Returning CAS rows could alter canonical merge behavior. Exercise insert,
   update, no-winner, and concurrent drift branches against current semantics.
5. Query-count wins could hide a transaction or lock-order regression. Extend
   the maximum-cardinality and real-PostgreSQL proofs with explicit budgets.

## Plan

1. Package the exact current tree and ask fresh ReviewGPT to author a bounded
   implementation patch for the scoped findings.
2. Inspect every returned hunk against the current device-sync contracts and
   apply only the safe, task-scoped patch.
3. Run focused unit and real-PostgreSQL tests, query-budget assertions,
   typecheck, and the required completion review gates.
4. Close this plan through the repository's scoped finish path only after the
   verified implementation is ready.

## Status

### ReviewGPT round 2 retrospective

- Original requirement: reduce device-webhook SQL and transaction duration
  without changing source authority, recovery, durable dirty work, or mailbox
  delivery.
- The first-reviewed and round-2 heads both contain 530 authored production
  additions and 282 deletions. Review remediation added tests and disclosure,
  not a durable owner or lifecycle. The repeated mechanism was a split identity
  rule: the shared resolver accepted a same-slug legacy source only for the
  final connection-establishment owner to reject that selected row as stale.
- Decision: continue with one canonical-preferred legacy-compatibility rule
  owned by the existing resolver and final locked transaction. Delete the
  downstream exact-key-only rejection; let the existing canonical upsert
  converge a selected legacy row. An exact canonical row still wins before any
  sibling, and the existing disconnect predicate continues to fence it.
- Do not add state, an owner, a queue, a migration, a compatibility table, a
  repair pass, or a reconciliation loop. Round 3 must prove connected and
  recoverable-disconnected legacy paths, canonical-blocked precedence, and
  source/credential drift with trace, source, dirty, signal, mailbox, and query
  ownership assertions.

- ReviewGPT authored the implementation patch from the exact target tree. The
  parent applied it and corrected two narrow type boundaries plus two affected
  test fixtures found by local verification.
- Focused deterministic verification is green: the public-ingress package has
  80 passing tests, the three Prisma store files have 94 passing tests, and the
  hosted wake file has 165 passing tests. Device-sync package typecheck and Web
  typecheck are also green.
- The new real-PostgreSQL proof fixes the 100 already-dirty compact-hint handler
  budget at 1,000 application-visible statements and 100 health transactions;
  the admitted deferred-source handler is capped at 20 statements and two
  health transactions. The suite could not execute locally because no
  loopback `DATABASE_URL` is configured, so its normal migrated CI lane remains
  the final runtime query-budget proof.
- The implementation is ready for the repository completion review and PR
  workflow; the plan remains active until those gates complete.

### ReviewGPT round 3 remediation

- Round 3 returned one review-induced Material UX finding: the production
  SQLite service adapter still exact-filtered canonical Junction source keys,
  unlike the hosted resolver and public-ingress test double. A disconnected
  legacy-only source could therefore be acknowledged and queued even though
  the worker would later skip it.
- A production-composition regression reproduced the failure through
  `createDeviceSyncService`, `SqliteDeviceSyncStore`, signed Junction ingress,
  the durable job queue, the real Junction executor, trace release/completion,
  and importer calls.
- The correction deletes the exact-key filter and applies the existing
  canonical-first, admitted-fallback ordering to the same bounded source list.
  No state, owner, query, queue, migration, or compatibility subsystem was
  added.
- Focused proof and the complete device-sync package suite are green: 1,121
  tests passed, including no-source, connected/disconnected legacy-only,
  canonical-blocked-with-legacy-sibling, and canonical-connected cases. The
  package typecheck and `git diff --check` also pass.
- The plan remains active pending a passing later ReviewGPT round, exact-head
  CI, parent final review, merge-tree proof, and final plan closure.
