# Prevent competing Stripe Customers at admission

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Prevent an already-bound direct Checkout Session from overlapping reusable
  Customer creation, so the provider cannot produce a losing unowned Customer.

## Success criteria

- Customer preparation rejects retryably while a direct Checkout Session is
  durably bound and never calls `customers.create` in that state.
- The reverse ordering remains owned by direct Checkout's existing claim check.
- Real PostgreSQL proof covers completion-first and Customer-admission-first
  ordering with one terminal Customer identity and no live claim.

## Scope

- In scope: the existing Customer preparation transaction, existing bound
  Checkout Session marker, focused unit/PostgreSQL proof, and cutover contract.
- Out of scope: provider-Customer deletion inference, new state, schema, queues,
  retry managers, portal replacement, and operator drain work.

## Constraints

- Technical constraints: use the existing member lock and billing row; keep
  provider calls outside transactions; preserve direct Checkout recovery.
- Product/process constraints: satisfy the prior review's terminal provider
  invariant before starting round 3; preserve the deployment stop boundary.

## Risks and mitigations

1. Risk: a tactical completion guard leaves the Checkout-created Customer
   unowned after the separate claim candidate wins.
   Mitigation: reject Customer claim admission while the exact existing Session
   owns the member, so the competing provider call never starts.
2. Risk: blocking an attempt before Stripe creates its Session harms recovery.
   Mitigation: fence only the durably bound Session lookup key; attempt-only
   races retain the existing safe loser cleanup, which knows Customer ownership
   from its prepared input.

## Tasks

1. [x] Replace the completion/webhook tactical guards with one claim-admission
   fence on a bound direct Checkout Session.
2. [x] Rewrite focused proof around the prevented provider call and both owner
   orderings.
3. [x] Update durable docs and candidate evidence, then run scoped verification.
4. [x] Prepare the exact candidate for same-thread ReviewGPT and required CI
   while preserving the draft deployment stop.

## Decisions

- Round 2 requires a terminal invariant in which neither a permanently live
  claim nor an unowned provider Customer is acceptable.
- A provider-side cleanup cannot infer ownership safely from a completed Session
  because Checkout may have reused an existing Customer. The smaller correction
  is to prevent claim admission while the existing local Session owner is live.
- Attempt-only overlap remains safe: the Session-creation caller retains the
  pre-create Customer state and already deletes an unbound Session Customer when
  post-create revalidation sees a claim.

## Results

- The final source delta for the repeated race is one bound-Session admission
  check in the existing Customer preparation transaction; the earlier direct
  completion and shared webhook guards were deleted.
- Focused unit proof passes 46 tests. The real PostgreSQL file passes 40 tests,
  including completion-first lock waiting, Customer-admission-first rejection
  before Stripe egress, the reverse claim-first direct Checkout fence, account
  deletion serialization, and terminal claim clearing.
- Web typecheck, focused ESLint, the hosted-billing CI guard, and docs drift all
  pass. The original round-3 thread, immutable baseline, previous reviewed head,
  and Mountain browser lane remain the external review handoff.

## Verification

- Commands to run: focused Customer/Checkout Vitest, real PostgreSQL concurrency,
  Web typecheck, focused ESLint, hosted-billing guard, docs drift, diff/privacy,
  and current-base merge-tree.
- Expected outcomes: the exact round-2 open-Session ordering rejects before
  Stripe egress; the opposite ordering resolves to the Checkout identity; no
  loser Customer or durable claim remains.
Completed: 2026-08-27
