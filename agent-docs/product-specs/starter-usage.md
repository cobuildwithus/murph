# Non-expiring starter usage

Last verified: 2026-08-09
Status: Implemented current-state contract

## Product contract

Every eligible new hosted member receives one non-expiring starter-usage grant
worth $4.50. The grant remains available until usage consumes it. Account age,
a calendar deadline, and historical Stripe trial timestamps never deny work.

Starter usage is the free entry state, not a subscription plan:

- signup requires no card and creates no Stripe Customer or Subscription;
- the member has active hosted product access while the ordinary usage gate
  decides whether new usage-bearing work can run;
- the Settings and assistant surfaces present `Starter` with a lifetime usage
  window;
- when capacity is exhausted, Murph offers the current eligible paid plan or
  usage-recovery path without claiming that time expired; and
- paid, Family-sponsored, group-funded, purchased, and referral capacity keep
  their existing owners and compose through the same usage system.

The 14-day window remains only an analytics maturity window for conversion
cohorts. It is not entitlement, billing, usage, notification, or scheduling
authority.

## Ownership

`apps/web` owns starter enrollment and access. The existing immutable hosted
usage-credit ledger owns the grant and all later consumption:

- grant kind: `starter_grant`;
- amount: `4_500_000` USD micros;
- semantic key: one policy-versioned key per beneficiary member;
- mutable projection: the existing `HostedUsageCreditGrant` remaining balance;
- member projection: the existing usage-credit balance and ledger version; and
- consumption: ordinary `usage_debit` entries attributed to the exact parent
  grant.

The starter enrollment service takes the existing beneficiary/member lock,
checks current suspension and billing history, appends the semantic-keyed grant
when absent, activates the member through the existing positive-source owner,
and performs the existing post-commit runtime wake and welcome effects. Duplicate
web, companion, invite, retry, or Linq instant-start attempts converge on the
same grant.

No second balance, allowance table, timer, scheduler, expiry job, or recovery
queue is introduced. The usage gate represents starter access as a direct
starter allowance with zero recurring included allowance plus the ordinary
credit ledger balance. Starter status uses a lifetime meter derived from the
ledger rather than a synthetic monthly period.

## Enrollment paths

The supported grant provenance values are:

- `web_onboarding`;
- `companion_onboarding`;
- `linq_instant_start`; and
- `legacy_trial_migration`.

Provenance is descriptive. It is stored on the starter grant's bounded source
reference and never changes entitlement or capacity.

Linq instant start retains the existing single-owner admission token and
accepted-message replay rules. After revalidating that exact token, the starter
enrollment owner grants capacity and activates the member without contacting
Stripe. A second ordinary planner pass counts and appends the original inbound
once after active access is visible.

## Paid conversion

A starter member may begin an eligible paid direct plan through the existing
subscription quote and Stripe checkout owners. Paid access is positive only
from accepted paid Stripe evidence; starter activation cannot imitate a paid
phase. Existing starter, purchase, and referral credit remains ordinary credit
and is not deleted merely because a subscription begins. The first accepted
subscription or positive-invoice event that changes the locked member snapshot
from no direct paid billing to direct paid billing reconciles the ordinary paid
usage gate and enters the existing retry-owned runtime-recheck path. Either
provider-event ordering therefore resumes already accepted work after Starter
exhaustion; the second event and later replays observe paid state and do not
repeat the transition. If the post-commit signal fails, the existing Stripe
receipt carries that retry obligation into its next claim and reissues the
idempotent wake for the resolved member while the accepted direct paid phase
remains current. An expired processing lease does the same conservatively, so
a process loss after the paid commit cannot discard the wake.

Legacy Stripe trial subscriptions may still emit delayed events after rollout.
The retained compatibility code may identify, cancel, or reconcile those exact
provider objects, but historical trial fields and offer metadata are read-only
legacy evidence. They must never restore a time-based entitlement, create a new
trial, extend one, or suppress starter capacity.

During the bounded compatibility window, an exact legacy trial object in a
non-paid provider state is converted through the same Starter grant owner used
by signup and migration. The conversion reads the historical trial usage
period, appends the canonical full grant plus the deterministic debit when
needed, and clears the obsolete local Stripe identity. Provider states that may
represent paid service (`active`, `past_due`, or `unpaid`) fail closed and stay
on the ordinary invoice-backed reconciliation path. `invoice.paid` remains the
only source that may turn legacy trial evidence into paid access, and its line
Price must overlap the exact subscription's current Price before Murph accepts
that conversion.

Family invite acceptance never treats a locally `paused` legacy row as safe to
sponsor while its Stripe subscription remains bound. The provider-validated
retirement owner clears that obsolete binding first; the ordinary Family guard
then admits the Starter member while continuing to fail closed for every bound
nonterminal direct subscription.

## Existing-member migration

The migration converts each eligible legacy trial account into the same
canonical starter ledger history:

1. append the full immutable $4.50 `starter_grant`;
2. append one deterministic `usage_debit` for historical trial consumption;
3. set the mutable grant projection to the actual unused amount;
4. add only that unused amount to the member balance;
5. preserve purchased and referral credit; and
6. clear a persisted usage block only when total available credit is positive.

This shape applies to untouched, partially consumed, and fully exhausted
accounts. Fully exhausted accounts therefore retain auditable full-grant and
full-debit history instead of disappearing from the starter ledger. Paid
conversions, suspended members, and explicitly terminal billing states are not
reactivated.

## Removed machinery

The current product has no:

- trial-expiry authorization branch;
- Stripe trial creation during signup;
- trial countdown or expiration banner;
- conversion-pending usage denial;
- trial continuation action;
- manual trial-extension page or API;
- expiry notification or scheduled extension path; or
- trial-only checkout offer exposed to new users.

Historical completed execution plans and database columns remain historical
records. Live code may retain only the bounded legacy Stripe-cleanup reads
required to drain already-created provider objects.

## Deployment and rollback

The non-expiring Starter migration is committed and the production hard cut is
complete. Its no-downtime rollout deployed compatible Web and Cloudflare
Worker/runner code from the same current public `main`, used an immediate
container rollout with managed-container and live-model smoke, then let the
post-deploy contract-migration workflow wait its declared drain before applying
the database migration. The Render Temporal worker did not change or pause.

`HOSTED_EXECUTION_CONTROL_URL` is a shared Web-to-Cloudflare authority for
runtime starts, privacy actions, export, media, and account deletion. Do not
remove it as a route-specific execution pause: doing so disables unrelated
operations and is not a safe Starter deployment primitive. Future updates use
the normal compatibility-first Web/Cloudflare rollout and the owning
post-deploy migration workflow; they do not replay this completed hard cut.

The legacy provider-object drain is complete. On 2026-08-10 an authenticated
production apply retired 69 exact candidates, then its automatic verification
reported zero remaining candidates and convergence. The one-time Ops control,
batch route and service, and local CLI were then removed.

Keep the configured accepted legacy Pulse Price and the per-member cleanup and
event-compatibility guards unchanged through the delayed-event and manual-replay
horizon so exact old objects remain verifiable. These retained guards continue
to fail closed for unreadable, ambiguous, or potentially paid provider state.
After that horizon has passed, remove the legacy offer fields, wire actions,
and per-member compatibility owner together in a separate contracting change.

Rollback after the committed Starter migration is forward-only: repair or
redeploy the current compatible Web/runner pair. A pre-Starter Web or runner
must not resume against the migrated ledger.

After deploy, verify:

- a fresh web, companion, and direct-iMessage member receives exactly one grant;
- a duplicate enrollment does not change balance or ledger version;
- migrated untouched, partial, and exhausted members have full-grant plus
  deterministic-debit history and the correct remaining balance;
- elapsed historical trial dates do not block execution;
- starter exhaustion produces the starter recovery copy;
- paid checkout still activates only from accepted Stripe paid evidence and
  resumes already accepted Starter-exhausted work without another inbound;
- subscription-first and invoice-first paid-event orderings each produce one
  retry-owned runtime recheck, while replay produces none; and
- a failed post-commit signal and an expired receipt lease both reissue the
  already-committed paid wake before the receipt can complete;
- delayed legacy trial events cannot recreate or extend free access; and
- a legacy trial retired to Starter can accept a Family invitation only after
  its obsolete direct subscription binding is cleared.

Compatibility is removable only when all three conditions hold: old trial
creators are gone, the operator dry-run has reported zero, and the maximum
delayed Stripe event and manual-replay horizon has elapsed. The first two are
complete; the horizon remains the final gate. Analytics-only cohort names and
immutable historical records are not runtime compatibility and may remain.

Do not revert the Starter migration: its ledger kind and historical entries are
accounting history. Recovery after migration commit is forward-only while both
the Web direct-control deployment and the Temporal worker remain paused.
