# PR 1041 ReviewGPT round 17 lock-boundary retrospective

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Finish the direct Pulse Checkout race fix without holding a member database
  transaction or row lock across hosted-field decryption or GCP KMS work.
- Keep the correction inside the existing member, billing-reference, and
  crypto-domain-root owners with no new state machine, service, queue, or
  lifecycle machinery.

## Round 17 finding

- The round-16 decision read is narrow and database-only, but the accepted
  candidate then enters the generic Stripe billing writer while the member row
  remains locked.
- That writer reads and projects the complete encrypted billing reference
  before and after its write. The projection can batch-unwrap domain roots and
  call GCP KMS from inside the transaction.
- First activation also provisions and unwraps control and ingress roots before
  the transaction returns. The caller prepared signed candidates before the
  lock, but it did not durably provision and warm the winning roots before the
  member transaction.

## Change-shape retrospective

The immutable first-review shape and current shape are measured from each
exact reviewed head against its then-current merge base. Base-only merge
history and generated output are excluded.

| Category | First additions | First deletions | Current additions | Current deletions |
| --- | ---: | ---: | ---: | ---: |
| Source | 1,346 | 177 | 3,624 | 568 |
| Tests / fixtures | 1,487 | 181 | 4,844 | 556 |
| Docs | 178 | 35 | 679 | 42 |
| Config / tooling | 15 | 0 | 15 | 0 |
| Generated / other | 0 | 0 | 0 | 0 |
| **Total** | **3,026** | **393** | **9,162** | **1,166** |

- Authored source grew by 2,278 additions and 391 deletions; tests grew by
  3,357 additions and 375 deletions; docs grew by 501 additions and 7
  deletions. The patch expanded from 25 to 53 files.
- Review-driven work added prepared Checkout completion and reversal inputs,
  deterministic lookup-key classification, durable direct-Checkout attempt
  ownership, a narrow locked Pulse decision read, post-commit loser cleanup,
  and scoped domain-root unwrap caching.
- Review-driven deletion removed the superseded broad Customer-reservation and
  reconstruction approach from the earlier implementation. The closed
  44,000-line Stripe PR remains replaced rather than revived.
- The retained owners are the hosted member row, the member billing reference,
  Stripe event freshness and receipts, post-commit loser cleanup, and hosted
  crypto domain roots. No review round added a second entitlement owner,
  queue, worker, billing manager, or compatibility layer.

## Repeated-mechanism diagnosis

- Earlier corrections moved visible Stripe calls and identifier encryption
  before `BEGIN`, but treated a generic billing writer as database-only.
- That assumption was false because the writer returns rich billing snapshots;
  snapshot projection decrypts private fields and the batch root-unwrapper can
  reach KMS.
- The prepare/commit split was therefore incomplete at an indirect helper
  boundary, not absent at the top-level Checkout path.

## Decision

- **Shrink the locked path.** Do not split the PR, rewrite the billing system,
  or broaden the generic policy writer shared with the adjacent Group-plan PR.
- After the existing locked eligibility decision and Checkout acceptance,
  update only the scalar Pulse-trial billing facts and member billing status.
  The accepted prepared ciphertext and blind lookup keys remain the identity
  write; no encrypted fields need to be read or projected.
- Durably provision the existing crypto-domain roots in their own short
  database transaction, then warm the control and ingress roots in the existing
  request-scoped cache before acquiring the member lock. Activation may retain
  its defensive provision/unwrap calls, which become database-only and cache
  hits on these Checkout paths.
- Tighten the acceptance read to an explicit select. Add no schema, dependency,
  durable owner, retry loop, or asynchronous process.

## Overlap audit

- Open PR 1130 changes Group-plan eligibility and scheduling fields in the
  billing store and generic policy writer. This correction does not change the
  generic policy writer or implement Group-plan behavior.
- Open PR 1139 changes email-only Family activation routing. This correction
  does not edit `member-activation.ts`.
- Open PR 1148 changes an unrelated crypto-store test fixture. Any crypto proof
  added here must cover the Stripe activation preflight and not reproduce that
  disclosure work.
- No other open PR implements the direct Pulse Checkout accepted-candidate
  database-only write or pre-lock activation-root warmup.

## Success criteria

- Browser and webhook Pulse Checkout winner paths perform no Stripe request,
  hosted-field decrypt/projection, or KMS call after acquiring the member lock.
- First activation, repeated activation, stale loser, and superseded completion
  preserve their existing outcomes and post-commit cleanup ownership.
- Checkout acceptance selects only the scalar attempt, lookup-key, and
  freshness fields it consumes.
- Focused tests prove query shape and provider/crypto ordering at the real
  domain-root unwrap boundary.
- Hosted Web typecheck, canonical verification, exact-head CI, and a later
  ReviewGPT `ROUND_OUTCOME: PASS` all succeed.

## Plan

1. [x] Replace the generic Pulse-trial writer on the accepted direct Checkout path
   with one narrow database-only scalar update.
2. [x] Provision and warm direct-activation roots before browser and webhook member
   transactions while retaining the request-scoped unwrap cache.
3. [x] Add focused query-shape, ordering, first/repeated activation, and loser
   regressions.
4. [x] Run focused proof, Hosted Web typecheck, canonical verification, finish the
   scoped plan, push, and continue exact-head CI plus ReviewGPT until both pass.

## Verification

- Six focused Hosted Web suites pass: 209 tests covering the real domain-root
  unwrap boundary, browser and webhook ordering, Checkout acceptance query
  shape, direct Pulse application, losers, and reconciliation.
- The production crypto fixture records exactly two KMS decrypts during
  preflight and no additional decrypt when the simulated locked activation
  reuses control and ingress through the nested scoped cache.
- Hosted Web prepared typecheck, touched-file ESLint, and `git diff --check`
  pass.
- Canonical `pnpm test:diff` passed every repository guard and reached the full
  Web verification lane. That lane remained queued behind another checkout's
  owned acceptance process, so this task's exact queued verifier was stopped
  without touching the other process. Exact-head CI owns the remaining broad
  PR proof.
- The open-PR path audit found no duplicate implementation. The adjacent
  Group-plan, email-only Family activation, and disclosure-fixture changes have
  different behavior and hunks. The pre-existing auto-trial finalizer still
  holds Stripe work under its own lock, but this PR does not change that file
  or subsystem.

## Progress

- Checkout acceptance now selects only the six scalar attempt, lookup-key, and
  freshness fields it consumes.
- An accepted direct Pulse candidate writes trial scalars with one guarded
  `updateMany`, updates member billing status, and never invokes the generic
  rich billing-snapshot writer.
- Browser and checkout-webhook paths provision roots in a separate short
  transaction and warm control plus ingress before the member transaction.
- The reliability contract now describes the exact database-only locked
  boundary.
Completed: 2026-07-29
