# Non-expiring starter usage

Last verified: 2026-09-10
Status: Implemented current-state contract

## Product contract

Every eligible new hosted member receives one non-expiring starter-enrollment
grant worth $4.50. The grant remains available until usage consumes it. Account
age, a calendar deadline, and historical Stripe trial timestamps never deny
work.

Authorized support recovery is separate from enrollment. When the canonical
gate shows a direct Starter member fully exhausted with zero total credit, an
operator may use `/ops/usage` to append one fresh $4.50 recovery grant. Each
action restores one allowance; a later action is eligible only after that
credit is genuinely consumed and the current gate is exhausted again. This is
an operator-discretion recovery control, not an automatic refill, member
self-service entitlement, scheduled cadence, or promise of recurring free
usage. Historical paid, purchase, or referral activity does not independently
admit or deny recovery; the current locked direct-Starter gate and zero total
credit are the authority.

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
- enrollment semantic key: one policy-versioned key per beneficiary member;
- Ops recovery semantic key: one key per beneficiary and locked pre-grant
  ledger version;
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

No second balance, allowance table, timer, scheduler, expiry job, or automatic
recovery queue is introduced. Enrollment and operator recovery both append to
the ordinary ledger under the beneficiary lock. The usage gate represents
starter access as a direct Starter allowance with zero recurring included
allowance plus the ordinary credit ledger balance. Starter status uses a
lifetime meter derived from the ledger rather than a synthetic monthly period.

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

## Text entry and image access

New model-admitted direct phone contacts on iMessage, SMS, or RCS can use instant
start from the existing configured phone prefixes. Signed provider ingress,
exact same-line routing, unique new-member creation, and the exact admission
token still own activation. Existing pending accounts are not converted by this
change. iMessage email handles retain their separate existing identity path;
SMS/RCS cannot claim email-handle authority.

All personal Starter accounts require a currently attached Stripe card before
a hosted image generation or image edit request. Ordinary text chat remains
available within the existing allowance. Paid, Family-sponsored, and group
access retain their current allowance owners. This check is in the Cloudflare
provider interceptor, including requests outside the normal dynamic tool; local
assistant image generation keeps its existing behavior.

Web resolves the current usage source and, for direct Starter, lists one card
on the member's existing encrypted Stripe customer binding. It checks mode and
attachment and rechecks the binding after Stripe responds. Missing cards,
provider failure, or incompatible responses cannot authorize an image request.
There is no cached ever-added-card flag or new account field. The gateway uses
its authenticated runtime member binding for the signed Web callback and never
accepts a caller-selected payer.

Settings offers card-only Stripe Checkout in setup mode, reusing the existing
member customer owner. Saving a card starts no subscription and creates no
charge or additional usage grant. Setup completion and expiry are receipt-only
Stripe events; image access reads current attachment directly. A denied image
completion tells the member how to save a card and request the image again,
without automatically retrying or claiming an image exists.

The existing operational alert cron also evaluates Starter abuse signals:
10 enrolled accounts created in 15 minutes, or 3 accounts created in the past
hour whose original Starter grants have at most half their capacity remaining.
It reads at most 1,000 recent accounts; saturation alerts with lower-bound
counts. It reuses `HOSTED_LINQ_ALERT_EMAILS`, the shared Resend configuration,
and the incident lease, idempotency, and reminder policy. Alerts may send during
quiet hours and do not depend on latency timezone configuration. Email contains
aggregate counts and an Ops link, not member identities or messages. These
signals request investigation; they neither prove fraud nor suspend accounts.

Deploy the Web access route, setup-event handling, and Settings consumer with
`HOSTED_ONBOARDING_LINQ_SMS_INSTANT_START_ENABLED` unset first, then deploy
the Cloudflare gateway check. Only after its signed access proof passes, set
that Web variable to `1` to enable new SMS/RCS instant start. It defaults off
so a mixed deployment cannot open SMS grants before the image restriction.
A new gateway against old Web denies images;
old gateways do not enforce the card rule. Warm older runtimes still pass
through the updated Worker gateway but may display generic failure copy until
the assistant bundle updates. No persisted schema changes or data backfills
are required. Once the restriction is enabled, rolling the Worker back below
this check would reopen image access and requires disabling that effect first.

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

Legacy paid subscriptions still carry the historical Pulse-trial offer and
policy metadata. Exact identity and known-policy validation remain part of
ordinary paid reconciliation. An `active`, `past_due`, or `unpaid` provider
subscription is potentially paid service, never authority for a free grant or
trial-specific cancellation. `invoice.paid` remains the only source that may
turn legacy trial evidence into paid access, and its line Price must overlap
the exact subscription's current Price before Murph accepts that conversion.
An invoice-proven paid identity continues to reconcile cancellation,
delinquency, and recovery through the normal subscription owner. Exact bound
terminal updates remain authoritative after delinquency clears the paid phase
and on cancellation retries; they remove access without granting capacity.

The unpaid provider-object drain and its delayed-event window are complete.
Unbound retired unpaid trial events and unpaid trial Checkout events return the
existing empty activation outcome: no Starter migration grant, activation,
billing-identity replacement, or trial-specific cancellation. There is no new
age-based replay exclusion. Generic Family-loser financial reconciliation and
account-deletion cleanup retain their ordinary authority checks.

A Family invitation still fails closed for every bound nonterminal direct
subscription, including a locally paused row. The retired trial path no longer
clears such bindings or creates free access.

## Existing-member migration

The migration converts each eligible legacy trial account into the same
canonical starter ledger history:

1. append the full immutable $4.50 `starter_grant`;
2. append one deterministic `usage_debit` for historical trial consumption;
3. set the mutable grant projection to the actual unused amount;
4. add only that unused amount to the member balance;
5. preserve purchased and referral credit; and
6. clear a persisted usage block only when total available credit is positive.

The completed migration applied this shape to untouched, partially consumed,
and fully exhausted accounts. Fully exhausted accounts therefore retain
auditable full-grant and full-debit history instead of disappearing from the starter ledger. Paid
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
records. Live code retains paid normalization, immutable history decoding, and
completed-receipt recovery; the unpaid migration and cancellation paths are
removed.

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

The checkout-time cleanup owner and delayed unpaid-trial conversion/cancellation
owner are removed. Starting an ordinary paid Checkout does not retrieve or
cancel a legacy trial. Preserve the accepted legacy Pulse Price, paid offer
normalization, historical ledger provenance, and completed-receipt fallback.
Those have current consumers independent of the completed unpaid drain. The
generic customer-provisioning idempotency namespace also retains its historical
name so unknown-outcome retries address the original provider operation.

Before rollout of the unpaid contraction, recheck that no unpaid legacy
subscription bindings or pending legacy phone-transfer deletion cleanup remain.
Deploy through the normal Web compatibility path. Do not reset poisoned
receipts, rewrite historical ledger entries, or impose a new replay policy.
After deploy, ordinary paid events and historical completed receipt retries
must retain their existing behavior.

Rollback after the committed Starter migration is forward-only: repair or
redeploy the current compatible Web/runner pair. A pre-Starter Web or runner
must not resume against the migrated ledger.

After deploy, verify:

- a fresh web, companion, and direct-iMessage member receives exactly one grant;
- a duplicate enrollment does not change balance or ledger version;
- an authorized Ops recovery adds exactly one policy-sized grant for the
  locked exhausted ledger version, while a stale replay adds none;
- a later Ops recovery is unavailable until the prior recovery is consumed and
  the current direct-Starter gate is fully exhausted again;
- migrated untouched, partial, and exhausted members have full-grant plus
  deterministic-debit history and the correct remaining balance;
- elapsed historical trial dates do not block execution;
- starter exhaustion produces the starter recovery copy;
- paid checkout still activates only from accepted Stripe paid evidence and
  resumes already accepted Starter-exhausted work without another inbound;
- subscription-first and invoice-first paid-event orderings each produce one
  retry-owned runtime recheck, while replay produces none;
- a failed post-commit signal and an expired receipt lease both reissue the
  already-committed paid wake before the receipt can complete;
- delayed legacy trial events cannot recreate or extend free access;
- paid legacy cancellation and delinquency update current billing without
  creating Starter credit; and
- phone transfer rejects retired trial billing scaffolds while retaining the
  ordinary pristine and untouched Starter source checks.

Paid legacy event normalization, completed-receipt fallback, and accounting
history are separate compatibility contracts. Their removal requires proof that
their own consumers are gone; expiration of an old trial event window does not
supply that proof. Analytics-only cohort names and immutable historical records
may remain.

Do not revert the Starter migration: its ledger kind and historical entries are
accounting history. Recovery after migration commit remains forward-only
against the compatible Web and runner deployment.
