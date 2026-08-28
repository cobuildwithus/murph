# Feynman Billing Audit — Verified Findings

## Scope

- Language/runtime: TypeScript, Next.js, Prisma/PostgreSQL, Stripe Node SDK.
- Modules analyzed: Family invitation/capacity/conversion, direct subscription
  transitions and Portal, Stripe event/refund reconciliation, usage-credit
  account deletion and browser return recovery, and group sponsorship payment
  and management.
- Entry points analyzed: 15 state/effect owners plus their routes, UI
  projections, inverse operations, and focused tests.

## Verification summary

| ID | Original severity | Verdict | Final severity |
| --- | --- | --- | --- |
| FF-001 | Medium | True positive; regression reproduced and fixed | Medium |
| FF-002 | Medium | True positive; projection trace and UI regression | Medium |
| FF-003 | Medium | True positive; route regression | Medium |
| FF-004 | High | True positive; provider-state regressions | High |
| FF-005 | Medium | True positive; deterministic/ambiguous failure regressions | Medium |
| FF-006 | Medium | True positive; route-capacity regression | Medium |
| FF-007 | High | True positive; phone/email issue and acceptance regressions | High |
| FF-008 | High | True positive; exact-Subscription conversion regressions | High |
| FF-009 | High | True positive; locked stale-authority regressions | High |
| FF-010 | Medium | True positive; migration, guard, and real PostgreSQL proof | Medium |
| FF-011 | Medium | True positive; auth/navigation regressions | Medium |
| FF-012 | Low | True positive; render regression | Low |
| FF-013 | Medium | True positive; route/page/card regressions | Medium |
| FF-014 | High | True positive; locked confirmation regression | High |
| FF-015 | High | True positive; exact refund-owner regressions | High |
| FF-016 | High | True positive; late paid-invoice reconciliation regression | High |

No Critical finding or unverified High/Medium claim remains.

## Verified findings and corrections

### FF-001 — Direct-paid Family owner rejected during member retier

The owner-only member-tier path called the shared billing admission without its
existing `allowDirectPaidOwner` mode. The corrected call in
`family-plan.ts:updateHostedFamilyMemberPlan` permits the Family owner while
still rejecting unrelated direct billing. `hosted-family-plan.test.ts` proves
the accepted owner and rejected conflicting member states.

### FF-002 / FF-003 — Billing repair and cancellation trapped by access state

`readHostedFamilyBillingRecoveryForOwner` now projects `manage` for an exact
nonterminal inactive Family Subscription, and the join surface renders the real
Portal component. The Portal route no longer treats suspension as loss of
billing ownership; it still derives the exact Customer from authenticated
member/Family state. Route, page, and component tests prove both management
states and preserve the no-entitlement-from-return invariant.

### FF-004 — Renewal schedule admitted contradictory Stripe owners

`scheduleHostedBillingPlanSwitchWithLockedOwner` now rejects `cancel_at`,
paused collection, manual collection, and an existing schedule before schedule
creation. Focused scheduling tests prove each provider shape fails before any
Stripe mutation.

### FF-005 / FF-006 — Family transition marker and retier capacity traps

`updateHostedFamilyMemberPlan` records whether it created the pending marker and
whether provider mutation began. A deterministic pre-provider failure clears
only that fresh marker through compare-and-set; an ambiguous provider outcome
preserves it for reconciliation. Invite retier capacity now has a distinct
domain error, so the route cannot misinterpret it as authorization for a new
seat purchase. Family regressions cover both failure classes.

### FF-007 — Existing owner/member invitation could buy an unusable seat

`issueHostedFamilyInviteTx` resolves the normalized phone/email blind-index
candidates and rejects a current owner or active member before capacity work.
`acceptHostedFamilyInviteTx` repeats same-group membership admission inside the
acceptance transaction. Phone, email, owner, member, and concurrency-backstop
regressions prove the target cannot consume new capacity. Linq and Telegram
classify that acceptance backstop as a permanent invite miss, so an old or
Telegram-only duplicate invite does not become an endless provider retry.

### FF-008 — Direct Trial to Family created competing subscriptions

`upgradeHostedFamilyDirectPaidSubscriptionUnderOwnerLock` now supports an exact
direct Trial source, revalidates group/member/billing identity under the member
Stripe mutation lock, requires one supported automatic Subscription, updates
that same Subscription to Family, ends the Trial immediately, and clears
Trial-only metadata. Paid conversion remains in-place. Focused Family tests
prove exact request shape, idempotency (including an already-applied retry that
no longer contains the obsolete direct item), stale authority, and unsupported
Stripe states.

### FF-009 — Start-paid used stale pre-lock authority

`assertHostedPulseTrialStartPaidMutationAuthorityTx` compares every nullable
billing/schedule field and suspension state after the Stripe mutation lock is
owned. Both update and paused-resume paths call it immediately before provider
mutation. The complete start-paid service suite proves changed identity,
schedule, phase, plan, offer, and suspension all fail before Stripe.

### FF-010 — Terminal automatic-refill failure blocked account deletion

Migration `20260810050000_relax_detached_automatic_refill_failure` admits only a
payerless, terminal, reconciled `payment_failed` row that retains the exact
sponsorship authorization, a positive refill ordinal, and no Checkout,
PaymentIntent, or Charge lookup. The deployment migration allowlist, static
constraint tests, production migration guard, and opt-in real PostgreSQL suite
prove the actual cancellation -> preparation -> payer delete sequence.

### FF-011 / FF-012 — Browser recovery feedback disappeared

The auth dialog preserves only a tightly shaped Settings return containing one
valid usage result and one syntactically valid purchase id; it grants no credit
and merely resumes the server-owned recovery page. `BillingPortalButton` now
renders its failure alert inside the dialog that owns it. Auth, Settings, and
component tests prove valid recovery and malformed-query rejection.

### FF-013 / FF-014 — Sponsorship cancellation lost; suspended payer charged

The management-only group resolver yields an identifier, never funding
authority. The page and route bind it to the authenticated payer's exact
sponsorship and expose cancellation only when runtime access is gone. Payment,
retry, pause/resume, and cap changes retain their live guards.
`hasHostedGroupSponsorshipPaymentAuthorityTx` additionally rechecks that the
current payer is unsuspended before automatic-refill confirmation. Route, page,
card, funding-owner, and payment-authority tests prove both boundaries.

### FF-015 / FF-016 — Refund owner guessed or failed to run

`refundHostedExactOrdinaryInvoicePayment` is the single ordinary-invoice refund
owner. It requires an exact paid Invoice, full amount equality, no balance or
credit-note adjustments, one paid allocation, one succeeded PaymentIntent or
Charge, no pagination, and either zero or one full succeeded refund. Ambiguous,
partial, pending, or compound shapes require recovery/support. Legacy Family
cleanup reuses it, and `invoice.paid` reconciliation requests refund-capable
loser cleanup so a late paid direct Subscription is not merely canceled.
Focused event and cleanup tests prove exact full refund and fail-closed complex
shapes.

## Verification evidence

- Affected hosted-web suites: 18 passed, one opt-in suite skipped in the
  hermetic run; 767 tests passed.
- Real PostgreSQL installed-migration suite: 23 tests passed, including the
  terminal automatic-refill deletion case.
- Credential-free Stripe owner proof: hosted-local harness 87 tests passed;
  web owner proof 73 tests passed.
- Web TypeScript check, provider request boundary guard, and hosted billing CI
  guard passed after every Stripe request object was made explicitly typed.

## False positives eliminated

The initial real-PostgreSQL fixture omitted `recoveryStartedAt` and the
production account-deletion sponsorship-cancel owner. Those two failures were
fixture-shape mismatches, not product findings. The fixture was corrected to
execute the real sequence before FF-010 was accepted.

## Summary

- Final findings: 7 High, 8 Medium, 1 Low.
- Every High/Medium finding has a complete code trace and executable
  regression; value-moving and schema findings additionally use exact provider
  shapes or an installed PostgreSQL proof.
- No finding was fixed by weakening identity, payment, webhook, or entitlement
  authority.

## Group cardinality audit addendum

### Verified findings and dispositions

- **GC-001 — exact named routing failed before matching.** The named path read
  one 26-row sentinel page and returned `too_many_groups` before comparing the
  supplied normalized label. It now resolves exact normalized labels across all
  slim active memberships; only unnamed clarification is bounded, at 64
  distinct visible labels. A target after 26 leading memberships is covered.
- **GC-002 — detailed membership row 26 was unreachable.** Detailed summaries
  remain bounded to 25 per response, but stable `(createdAt, id)` keyset
  pagination now exposes `nextCursor`. Malformed, padded, oversized, or
  non-canonical cursors fail explicitly instead of becoming false exhaustion.
- **GC-003 — disclosure read bounds became lifetime product admission.** The
  lifetime permission/grant history counts and active-count refusal are
  removed. Group and personal active-grant projections independently page 25
  decrypted summaries at a time while exact grant ids continue to own read and
  revocation authority.
- **GC-004 / GC-005 — destination 26 was refused and naive paging could starve.**
  Vault-share grants no longer have a destination-count admission cap. Delivery
  remains bounded to 25 sequential replacements per Web request, uses a stable
  destination continuation, and retains one full-cohort generation token.
  Each successful replacement atomically stores the exact source workspace
  version with ciphertext; retry from the beginning skips only rows completed
  for that version. Revoke, regrant, and recent-date generation backfill clear
  the marker. A 64-destination cohort, first materialization beyond 25, and a
  partial-retry progression are covered.
- **GC-006 — stale-generation backfill could falsely report completion.** The
  grantor batch reads one 26th sentinel row, processes 25, and propagates inner
  deferred work to the outer `hasMore` result.
- **GC-007 — separate token and page reads weakened generation binding.** A
  revoke/regrant between the full-cohort query and a second page query could
  pair the caller's old generation token with the regranted row. Delivery now
  reads the complete active cohort once and derives both the token and bounded
  page from that same result. A later generation change makes the existing
  exact-id conditional replacement a no-op and retains retry ownership.

### Preserved work bounds

Join-confirmation draining and first-materialization generation selection were
verified as resumable work batches, not product cardinality limits, and remain
bounded. The separate 200-member shared-read snapshot and 100-recipient email
bounds require immutable authority pagination or recipient batching; changing
their literals without that architecture would increase load while merely
moving another failure boundary, so they are outside this patch.

### Verification evidence

- Hosted Web focused suites: membership store 78 tests, group/disclosure 210
  tests, and vault delivery/storage 71 tests passed.
- Cloudflare continuation consumer: 4 tests passed.
- Hosted-execution strict request/response contracts: 91 tests passed.
- Assistant-engine group schema and prompt ceiling: 172 tests passed.
- Hosted Web, Cloudflare, assistant runtime, assistant engine, and hosted
  execution TypeScript checks passed; agent-doc drift and diff checks passed.
- The focused real-Codex journey queued one exact named group handoff with one
  `handoff` tool call and no membership-list call.
