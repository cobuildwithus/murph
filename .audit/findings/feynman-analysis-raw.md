# Feynman Billing Audit — Raw Analysis

Status: hypotheses captured before verification. Do not treat this file as the
final result; the verified report is `feynman-verified.md`.

## Phase 0: attacker and failure hit list

- Language/runtime: TypeScript, Next.js route handlers, Prisma/PostgreSQL, and
  the Stripe Node SDK.
- Worst outcomes: duplicate charge without refund, payment after authority
  loss, payer unable to cancel, account deletion permanently blocked, or a
  valid Family action rejected by unrelated stale state.
- Novel/high-risk code: Family mixed-tier capacity changes, direct-to-Family
  conversion, usage-credit saved-card confirmation, group refill recovery, and
  webhook loser cleanup.
- Value stores: Stripe Subscriptions/Invoices/PaymentIntents/Refunds; Family
  capacity and membership rows; usage-credit purchases and grants; group
  sponsorship authorizations.
- Most complex paths: browser action -> authenticated route -> locked database
  owner -> Stripe mutation -> webhook receipt -> local reconciliation.

## Scope and function-state matrix

The audit covered every billing entry point and recovery owner changed by the
verified findings, plus its immediate callers, inverse operation, and Stripe or
database boundary.

| Entry point / owner | Reads | Writes / effect | Guard expected |
| --- | --- | --- | --- |
| `issueHostedFamilyInviteTx` | owner, roster, invites, capacities | invite/capacity request | exact owner and contact-not-member |
| `acceptHostedFamilyInviteTx` | invite, same/other group membership | membership/invite | target binding and no active duplicate |
| `updateHostedFamilyMemberPlan` | group, member plan, capacity, billing ref | pending marker and Stripe items | owner plus exact transition CAS |
| `upgradeHostedFamilyDirectPaidSubscriptionUnderOwnerLock` | direct and group billing owners | Stripe Subscription update | same locked source, supported provider state |
| `readHostedFamilyBillingRecoveryForOwner` | Family billing projection | recovery capability | exact owner, no entitlement mutation |
| billing Portal route | member/group customer owner | Stripe Portal Session | authenticated exact billing owner |
| `scheduleHostedBillingPlanSwitchWithLockedOwner` | direct Subscription and schedule | Stripe schedule | one automatic unpaused renewal owner |
| `assertHostedPulseTrialStartPaidMutationAuthorityTx` | member and billing ref | authorizes Stripe update/resume | exact locked snapshot, unsuspended |
| `refundHostedExactOrdinaryInvoicePayment` | live Invoice payments/refunds | full Stripe refund | exact single paid allocation only |
| invoice event reconciliation | receipt and current Family owner | loser cleanup/refund | event-owned exact payment evidence |
| usage-credit return handoff | URL and auth completion | navigation only | bounded return shape, no credit authority |
| `readHostedGroupUsageFundingManagementTargetByLocator` | group locator | identifier projection only | payer binding required downstream |
| sponsorship management route | payer authorization and action | cancel/pause/resume/cap | cancellation survives target loss |
| `hasHostedGroupSponsorshipPaymentAuthorityTx` | payer, authorization, purchase | permits confirm | locked exact payer remains unsuspended |
| account-deletion usage-credit preparation | terminal purchases | detaches payer on delete | provider-terminal/reconciled shape |

## Cross-function analysis

- Guard consistency: create/retry/payment actions need live entitlement and
  unsuspended payer; cancellation/Portal repair need ownership but must survive
  access loss. The pre-fix routes applied the live-access guard symmetrically
  when the inverse operations intentionally require different guards.
- Inverse parity: Family invite issue and acceptance both need a duplicate
  membership check; saved-card bind and confirm both need the suspension fence;
  loser cancel and refund both need exact payment ownership.
- State transitions: pending Family plan markers must clear only before any
  ambiguous Stripe mutation; webhook replay must preserve the same refund
  owner; a canceled sponsorship remains manageable until the payer releases it.
- Value conservation: only a full succeeded payment for one ordinary Invoice
  allocation can be automatically refunded. Partial or compound Stripe shapes
  require support.

## Raw hypotheses

| ID | Initial severity | Question that exposed it | Concrete pre-fix failure |
| --- | --- | --- | --- |
| FF-001 | Medium | Why does member-tier change reject a direct-paid Family owner when other Family mutations allow that owner? | A valid owner could not change a member tier because the shared admission helper treated the owner's direct plan as a conflict. |
| FF-002 | Medium | What action remains when Family billing is inactive but the Stripe Subscription is nonterminal? | Join recovery projected neither checkout nor Portal management, leaving no repair/cancel path. |
| FF-003 | Medium | Why does entitlement suspension block a billing-owner cleanup operation? | A suspended direct member could not open the Customer Portal to repair or cancel billing. |
| FF-004 | High | What happens if renewal scheduling runs on a canceled, paused, or manual-collection Subscription? | Murph could create a second schedule over a provider state with another renewal owner. |
| FF-005 | Medium | If deterministic validation fails after a fresh pending plan marker but before Stripe, who clears it? | The marker remained and future member-tier attempts reported perpetual syncing. |
| FF-006 | Medium | Why does changing an already-pending invite tier look like an empty-seat shortage? | The route treated a retier conflict as new capacity demand and could purchase an orphan destination seat. |
| FF-007 | High | Why is duplicate membership checked only after an invitation is paid/reserved? | Inviting the current owner or an active member by verified contact could buy a seat that could never be consumed. |
| FF-008 | High | Why does a direct Trial enter a new Family Checkout instead of updating its exact Subscription? | The same customer could acquire a competing direct Trial and Family Subscription. |
| FF-009 | High | What if suspension or billing identity changes while start-paid waits for the Stripe lock? | Stripe update/resume could execute using stale pre-lock authority. |
| FF-010 | Medium | Can every provider-terminal purchase shape survive payer deletion under the installed check constraint? | A terminal unbound automatic-refill failure could not detach, permanently blocking account deletion. |
| FF-011 | Medium | What owns a valid usage-credit return when Stripe returns to a signed-out Settings page? | Auth completion discarded the exact return query, hiding recovery even though the browser return grants no credit. |
| FF-012 | Low | Where is the Portal failure rendered after the dialog opens? | The error alert was outside the dialog subtree and remained hidden with the closed trigger surface. |
| FF-013 | Medium | Why does beneficiary access gate a payer's inverse recurring-billing action? | The payer lost all sponsorship cancellation UI/API access after beneficiary inactivity or departure. |
| FF-014 | High | Does automatic-refill confirmation repeat the payer suspension fence after the intent is bound? | A payer suspended between bind and confirm could still be charged. |
| FF-015 | High | How does legacy Family refund choose among partial or multiple invoice payments? | It selected the first payment and ignored existing partial refund ownership. |
| FF-016 | High | What happens when a late direct invoice pays after Family has already won? | The loser Subscription was canceled without refunding the newly paid invoice. |

All High and Medium hypotheses proceeded to code-trace plus regression-test
verification. FF-010 additionally proceeded through the real installed
PostgreSQL migration and account-deletion sequence.

## Group cardinality audit addendum

### Function-state matrix

| Entry point / owner | Bounded work | Product state | Failure question |
| --- | --- | --- | --- |
| exact named group ask/handoff | slim membership labels | all active memberships | Was the label matched before or after a summary page limit? |
| `list_memberships` | 25 detailed summaries per response | all active memberships | Can a later page still expose exact membership, permission, and funding identifiers? |
| disclosure projection reads | 25 decrypted grants per response | all active and historical permission generations | Does a read bound prevent future grants or revocations? |
| vault-share delivery | 25 encrypted replacements per request | all active destinations for an exact scope | Can retries advance after a partial deadline without weakening generation proof? |
| recent-date backfill | 25 stale rows per grantor pass | every stale generation | Does the outer continuation remain true when only the inner page has more work? |

### Raw hypotheses

| ID | Initial severity | Concrete pre-fix failure |
| --- | --- | --- |
| GC-001 | High | Exact named routing checked the 25-row summary boundary before exact normalized-label resolution and returned ambiguity for a unique later membership. |
| GC-002 | Medium | Detailed membership row 26 and later had no cursor, making assistant leave, permission, and funding actions unreachable. |
| GC-003 | High | Disclosure history and active-count checks reused a 25-row prompt bound as lifetime admission, permanently refusing new authority after enough prior use. |
| GC-004 | High | Vault-share admission refused destination 26 even though 25 was only needed to bound sequential encryption and replacement work. |
| GC-005 | High | Naive vault-share pagination could restart at the first page after every deadline and starve later destinations unless successful replacements persisted progress for the exact source version. |
| GC-006 | Medium | Recent-date generation backfill could process 25 rows but report no continuation when a 26th stale row existed. |
| GC-007 | High | If the full generation token and delivery page came from separate database reads, could revoke/regrant bind an old token to a new share generation between those reads? |

The audit also challenged every nearby literal 25. Join-confirmation draining and
first-materialization selection already represented resumable work batches, not
product cardinality, so deleting those bounds would increase operational risk
without restoring any user capability. Separate 200-member shared-read and
100-recipient email bounds depend on immutable authority snapshots and recipient
batching; they were recorded as distinct architecture work rather than changed
speculatively in this patch.
