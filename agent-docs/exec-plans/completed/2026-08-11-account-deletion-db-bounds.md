# Bound account-deletion database critical sections

Status: completed
Created: 2026-08-11
Updated: 2026-08-13

## Goal

- Preserve atomic, complete account erasure while preventing one deletion from
  monopolizing the shared PostgreSQL pool through external crypto, duplicate
  checkout reads, cardinality-scaled row-lock loops, or avoidable sequential
  database statements.

## Success criteria

- Subscription Checkout identifiers are decrypted once before provider work and
  are not reopened inside the terminal transaction.
- The terminal transaction performs database-only work with deterministic,
  set-based locking and deletion at the existing privacy owner.
- Existing target-set revalidation, suspension fencing, provider cleanup,
  phone-transfer, and receipt atomicity remain intact.
- Focused unit and opt-in PostgreSQL concurrency/cardinality proof, typecheck,
  lint, privacy scan, ReviewGPT implementation review, and final diff review
  pass.

## Scope

- In scope: `apps/web` account-deletion orchestration, its existing store
  helpers, focused tests, and the live account-deletion owner documentation.
- Out of scope: new queues, staged partial deletion, provider behavior changes,
  unrelated billing and group-outreach critical sections, and schema changes
  without a demonstrated need.

## Constraints

- Technical constraints: keep KMS, Stripe, browser-provider, and root-Prisma
  work outside the terminal transaction; retain exact transaction-time target
  revalidation; use existing tables and owner boundaries; expose explicit
  maximum-cardinality behavior in tests.
- Product/process constraints: deletion remains fail-closed, privacy-complete,
  and available to suspended/non-billing members; ReviewGPT's patch is untrusted
  intent and must be locally inspected and adapted; no push or PR in this lane.

## Risks and mitigations

1. Risk: Moving reads outside the terminal transaction could admit a stale
   deletion set.
   Mitigation: prepare only immutable/decrypted facts outside and retain exact
   locked database revalidation immediately before receipt persistence.
2. Risk: Combining statements could alter foreign-key deletion order or result
   counts.
   Mitigation: preserve dependency order and assert every public store count in
   focused unit tests.
3. Risk: Adjacent open work changes a shared critical-section dependency.
   Mitigation: keep the patch account-deletion-owned, record overlap exclusions,
   and let the parent integrate prerequisite lanes in dependency order.

## Tasks

1. Map the complete deletion call tree and freeze overlap/base evidence.
2. Ask ReviewGPT for a scoped attachment patch and inspect its assumptions.
3. Implement the smallest database-only terminal transition and focused proof.
4. Run required local checks, privacy/diff review, and commit through the plan
   completion path.

## Decisions

- Retain one canonical terminal transaction rather than inventing a deletion
  queue: local account erasure and cleanup-receipt ownership must commit
  atomically.
- Treat the runtime-log and group-outreach fixes as prerequisite integration
  lanes, not code to duplicate here.
- Use exact database-only target fingerprints for terminal revalidation;
  plaintext provider identifiers and secure-box/root access stay outside
  `BEGIN`.
- Replace cardinality-scaled lock statements with ordered set locks. An
  aggregate-only production check observed no subscription-checkout rows and
  maxima of 24 owned thread containers, 48 computer runs, and 21 handoffs per
  populated owner, so the proof must remain statement-bounded above those
  observed cardinalities without persisting production row data.
- Treat a consumed device OAuth state as the callback's durable pre-provider
  claim. First-delivery no-provider outcomes atomically discard only an exact
  unconsumed admission, every consumed redelivery is an unconditional replay,
  and the successful connection or durable failure owner deletes the exact
  consume epoch in the same database transaction. Ambiguous provider work
  retains its claim; deletion rejects an in-flight claim and revalidates the
  stored connection/credential epoch before erasure.
- Make post-provider OAuth cleanup monotonic at the same connection owner:
  atomically persist the token-bearing failed connection and exact consume
  claim first, attempt provider revocation second, and clear credentials only
  after confirmed revocation under the exact connection epoch. Ambiguous
  revocation retains the failed token owner, while deletion fails closed for a
  live OAuth row whose credential material is unexpectedly absent.
- Preserve the refresh lease as the stronger OAuth owner while provider-side
  rotation is unresolved. Setup-failure marking returns a distinct blocked
  result without mutating that lease; after rotation settles, cleanup rereads
  the current durable token generation and confirmed-clear requires that exact
  generation plus an absent lease.
- Use the same monotonic OAuth authority rule for ordinary disconnect and
  consent-withdrawal cleanup. Ambiguous provider revocation keeps the exact
  encrypted token generation in an inert reauthorization-required row;
  confirmed revocation atomically changes the credential kind to `none`, clears
  that generation, and marks the row disconnected. Account deletion treats a
  missing-secret OAuth row as unresolved regardless of legacy status.
- Treat missing provider configuration as unavailable cleanup, never as proof
  that revocation is unnecessary. Ordinary disconnect retains either durable
  credential kind and remains inert; direct deletion fails retryably. Only a
  durable `none` row may take the local-only path, and restored configuration
  retries the retained exact generation.
- Preserve atomic phone-transfer retirement while preparing identity and
  mailbox ciphertext outside the terminal transaction. The terminal path
  compares raw source/target identity, routing, and email-authorization rows
  under the ordered locks and performs only prepared database mutations.
- Detach terminal usage-credit payer history with one guarded set update and a
  count match, keeping the transaction statement count constant as history
  grows.

## Anomaly retrospective

- Trigger: the next ReviewGPT audit is substantive round 3 or later, OAuth
  authority produced accepted findings in consecutive correction rounds, and
  the current snapshot reaches 2,361 authored-source lines of churn. Current
  test churn is 3,146 lines and tracked documentation churn is 43 lines; tests,
  fixtures, and documentation are excluded from the authored-
  source threshold.
- Original requirement: keep account deletion atomic and privacy-complete while
  removing external crypto and history-scaled database work from its terminal
  transaction. The first reviewed shape concentrated on the transaction itself
  and did not fully model authority that could be created or transferred while
  deletion was in progress.
- Review-driven growth: the additional source is attributable to exact OAuth
  consume-epoch handoff at existing connection/failure owners, sequence-free
  prepared mailbox envelopes at the existing mailbox owner, raw phone-transfer
  revalidation at the existing identity owner, the set-based usage-credit
  owner, and ordered device-authority locks plus a complete revocation-input
  fingerprint. No correction adds a queue, migration, lease, scheduler, new
  durable owner, or compatibility state machine.
- Decision: continue as one indivisible local task. Splitting the OAuth,
  mailbox, phone-transfer, usage-credit, or device-authority correction would
  leave a known gap in the same account-deletion commit boundary, while
  reverting them would restore accepted privacy or availability failures. The
  corrections instead shrink transaction work, delete per-row transactions,
  and transfer ownership through existing writes. Further source growth is not
  authorized without another retrospective; any new finding must first be
  solved by deletion, reordering, or tightening an existing owner.

## Verification

- Commands to run: focused Web Vitest slices for account deletion and PostgreSQL
  concurrency, Web typecheck/lint scoped by repository tooling, privacy/diff
  guards, and targeted static transaction-boundary assertions.
- Expected outcomes: all checks pass; provider/KMS activity is proven outside
  the transaction; maximum transaction statements and set-based lock behavior
  are deterministic; final worktree contains only scoped changes.

## Progress

- ReviewGPT's accepted high-severity findings were corrected at the
  existing ownership boundaries: device callback claim cleanup ownership,
  prepared phone-transfer crypto, set-based usage-credit history detachment,
  monotonic post-provider OAuth revocation ownership, and refresh-lease/token-
  generation fencing for that revocation. The latest accepted disconnect
  finding now retains OAuth credentials after an ambiguous provider response,
  retries the exact durable generation, and makes `credentialKind=none` the
  only local proof that revocation authority was released. The subsequent
  missing-configuration correction applies that same rule when no revoke hook
  can be constructed: durable OAuth or provider-config authority is retained,
  consent withdrawal reports failure, and direct deletion blocks until a
  restored hook confirms cleanup. The final cleanup-authority correction makes
  raw `credentialKind` exhaustive: `none` skips hydration/provider lookup even
  if Prisma can materialize a local account object, while every failed non-none
  revoke retains its exact credential, connection, and sources in a retryable
  nonterminal state. The consent-withdrawal owner now selects candidates from
  that same raw authority: every non-none credential is retried regardless of
  legacy lifecycle status, while only `disconnected + none` is skipped.
  Final parent diff review found that the special first-attempt-success path
  for a legacy disconnected provider-config credential cleared the credential
  without terminalizing its connected child sources. That exact branch now
  marks the sources disconnected inside the same transaction after the exact
  credential clear.
- Focused Web account-deletion, usage-credit, mailbox, OAuth-store,
  provider-application, sponsorship, and phone-call suites pass locally. The
  full Web suite passes 9,720 tests with 408 skipped across 723 passing files
  and 47 skipped files, the focused device-sync store/public-ingress suite
  passes 179 tests, and Web plus device-sync package
  prepared typechecks pass. Full Web lint has zero errors and 39 unrelated
  warnings.
- A fresh isolated PostgreSQL database applied all 178 migrations, then the
  device/OAuth, phone-transfer, and 512-row usage-credit proofs passed 18 tests.
  This includes the real store retaining an unresolved refresh lease and v1,
  accepting the committed v2 generation, rejecting stale-v1 clear, and
  clearing only exact v2 afterward. It also proves the production disconnect
  service first retains exact ciphertext and version when its registry omits
  the revoke hook, retains them again after an ambiguous provider response,
  then clears that same generation and records credential kind `none` only on
  confirmed retry. It additionally proves consent withdrawal selects a legacy
  disconnected provider-config credential, counts ambiguous cleanup as failed,
  retries and clears it after confirmed success without writing another
  consent event, and skips a completed disconnected `none` sibling. The
  same production-service proof now recreates the legacy disconnected retained
  credential plus connected-source shape and proves first-attempt confirmed
  revoke clears the credential and terminalizes the source. The refreshed
  device/OAuth/consent PostgreSQL lane passes 12 tests. The temporary databases
  and generic test roles were removed after their runs.
- The same-thread final ReviewGPT correction audit inspected the fresh focused
  source snapshot for more than five minutes and returned `ROUND_OUTCOME: PASS`
  with zero actionable findings. Its verification sidecar confirms the
  requested model through response slug `gpt-5-6-pro`.
- Final closure checks passed: `git diff --check`, the scoped privacy/credential
  scan, and the final status review found only the intended task files. Root
  typecheck is not used as a completion gate while the shared workspace
  verifier is owned by an unrelated process; all changed-package typechecks
  pass independently.
Completed: 2026-08-13
