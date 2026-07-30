# Capped group sponsorship

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

Finish group sponsorship as a payer-authorized monthly maximum rather than a
fixed monthly charge or message bundle. A sponsor chooses a $5, $10, or $20
monthly maximum; Web creates ordinary $5 usage-credit purchases only when the
group's existing capacity owner says more credit is needed.

## Product contract

- Present monthly sponsorship as the primary group-funding option and retain a
  one-time contribution as the secondary option.
- A sponsorship period may charge $0, $5, $10, $15, or $20, never more than its
  selected maximum. Unspent purchased credit remains in the existing ledger
  across sponsorship-period boundaries.
- Show ordinary participants only that the chat is sponsored. Do not expose
  percentages, message estimates, balances, payer identity, or refill events in
  the room.
- Give only the authenticated payer the current-period amount charged, monthly
  maximum, period end, and controls to change, pause, or cancel.
- Notify the payer privately near the maximum. Notify the room only if the
  existing admission gate actually pauses work.
- Permit only one active automatic sponsor per group. Other people may still
  make one-time contributions.
- Keep the first successful sponsorship acknowledgment and optional creative
  moment. Automatic maintenance refills remain silent.

## Ownership and invariants

- `HostedUsageCreditPurchase`, `HostedUsageCreditEntry`, and the member credit
  projection remain the only financial and capacity truth. Do not add a wallet,
  second balance, consumption system, Stripe subscription, refill queue,
  scheduler, or Cloudflare billing state.
- Add only the durable authorization needed to prove the payer, beneficiary,
  status, selected cap, and anchored sponsorship period. Derive current-period
  fulfilled and pending charges from purchases associated with that
  authorization.
- Every automatic refill is the existing fixed $5 offer and has deterministic
  authorization/period/ordinal identity. The beneficiary lock and existing
  transaction ordering serialize cap checks and purchase creation.
- Stripe work stays outside the usage-accounting and reply transaction. Reuse
  the existing saved-card PaymentIntent create/bind/confirm path and webhook
  reconciliation; only verified fulfillment grants credit and the existing
  runtime recheck resumes accepted work.
- Activation uses the existing low-capacity $5 purchase path to establish a
  reusable off-session card and the authorization together. Do not create an
  unrelated card-vault or SetupIntent lifecycle. An already active
  authorization may have a later period with zero charges.
- The existing Web-owned allowance gate remains the single capacity decision.
  Automatic refill demand is derived after durable usage settlement, without
  waiting for Stripe inside the reply path.
- Sponsorship state is payer-private. Group-facing tool and prompt projections
  must remove exact remaining percentage and suppress low-capacity pressure
  while sponsorship is active.
- Remove the hard-coded public message conversion from all usage-credit
  presentation. Dollars purchase cost-weighted usage credit, not owned message
  counts.
- Preserve current one-time purchase recovery, refund/dispute reconciliation,
  account deletion, funding-only locators, authorization checks, and
  product-critical reply flow.

## Implementation route

1. Have ReviewGPT implement the complete scoped change and return a patch
   attachment, including schema/migration, owner services, UI, assistant
   contract/policy, durable docs, and focused tests.
2. Inspect the full returned patch for scope, privacy, owner reuse, transaction
   ordering, idempotency, period rollover, failed-card recovery, and accidental
   parallel state. Apply only a coherent patch.
3. Run focused Prisma, Web, hosted-execution, assistant, Stripe reconciliation,
   UI, and design-catalog proof. Exercise desktop and mobile states in the
   browser.
4. Push the exact candidate, open the PR with the required product and
   architecture contract, and run the preliminary completion-specialists pass
   concurrently with CI.
5. Resolve accepted findings through ReviewGPT-returned correction patches,
   complete parent review and verification, close this plan, and run the final
   ReviewGPT gate concurrently with final CI.
6. Complete exact-head preflight before reporting merge readiness.

## Verification

- ReviewGPT implementation and correction patches applied and inspected through
  three remediation rounds.
- `prisma validate`, Web typecheck, frontend design-proof structure, the focused
  416-test sponsorship/UI suite, the 190-test authorization/notification/
  purchase suite, and the hosted-execution contract test pass on the
  pre-rebase branch.
- Parent review restored the existing detailed top-up contract instead of
  deleting unrelated personal, Family, ledger, refund, and reconciliation
  invariants. It also added regression coverage for a bound automatic
  PaymentIntent after pause or cancel.
- Rebased onto current `origin/main`. The post-rebase changed-owner Web suite
  passes 807 tests; the hosted-execution suite passes 66 tests; the focused
  assistant suite passes 15 tests with 16 live-only cases skipped; Prisma
  validation and affected TypeScript lanes pass.
- A fresh isolated PostgreSQL database accepts all 148 Web migrations through
  the normal guarded deploy command, and the 21-test usage-credit concurrency
  suite passes against it. The replacement active-payer index is created
  before the legacy index is dropped, and the predeploy exception is limited
  to the proved check/index relaxation.
- Pending desktop and mobile design-catalog evidence.
- Pending preliminary specialist pass, final ReviewGPT pass, exact-head CI, and
  PR-head preflight.

## Deployment compatibility

The schema migration is additive. Deploy the tolerant Cloudflare/runtime reader
first, then apply the migration, drain older warm runtimes, and deploy the new
Web producer only after database and runtime convergence. Existing Web and
runtime code treat the new authorization and purchase association as absent.
The first monthly authorization is the old-Web rollback floor; from that point,
recover with a forward fix on the compatible schema, Web, and runtime.
