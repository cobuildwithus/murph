# Hosted Account-Deletion Maintenance

Last verified: 2026-07-27

## Purpose

This is the sole lifecycle owner for
`HOSTED_ACCOUNT_DELETION_MAINTENANCE`. The flag closes account deletion when a
cutover temporarily makes the complete external-deletion target set
unprovable. While it is set, subscription Checkout creation is also closed so
a pre-fence billing writer cannot enlarge that target set.

A purpose-specific migration may require or release the control, but it must
not independently clear or delete it. The operator who changes the flag owns
the shared active-purpose check and the production proof below.

## Protected effects

Every maintenance-bearing Web deployment must reject these effects with `503`
before authentication authority is consumed or a provider call starts:

- `account.delete` at
  `POST /api/settings/sensitive-action-challenge`;
- account removal at `POST /api/settings/privacy/delete`; and
- personal and Family subscription Checkout creation, including the
  server-side Family-plan tool path.

`vault.export` remains available. Usage-credit purchases do not create a
subscription and are outside this control.

## Shared purpose ownership

Keep a compact operator record of the active purpose names, opening
deployment, owner, and exit evidence. Do not put member, Checkout, Customer,
Subscription, or other private identifiers in it.

The current named purposes are:

| Purpose | Opens before | Closes only after |
| --- | --- | --- |
| `checkout-session-deletion-fence` | the additive schema migration and first bind-before-return writer | after predecessor retirement, complete no-cutoff pagination finds every Murph personal Session and each has an outcome-specific proof: expired/missing, or completed with its Customer and Subscription owned canonically or cleaned up at Stripe; the fence writer is live everywhere |
| `r2-bundles-enam` | destination creation | OC retirement or mechanically proven pre-commit abandonment, as defined by `apps/cloudflare/R2_BUNDLES_ENAM_MIGRATION.md` |

Clearing is authorized only when every active purpose has supplied its exit
evidence. Finishing one purpose cannot clear a window still owned by another.
No ordinary error path leaves an unowned flag set: retain the purpose and
assign a new operator deadline until its documented exit is safe.

## Close admission across deployment skew

Changing a Vercel environment value and sending a deployment to 100 percent do
not retire clients pinned to older deployments by Skew Protection. Treat the
later of the production promotion and custom Skew Protection Threshold update
as the admission-closing instant.

For each closure:

1. Confirm Skew Protection is enabled, record its current maximum age, confirm
   Fluid Compute, and obtain the current absolute Node.js Function maximum from
   Vercel's official limits. The wait below uses the absolute platform maximum,
   not this route's configured duration or a log-flush interval.
2. Set `HOSTED_ACCOUNT_DELETION_MAINTENANCE=1` in the Vercel production
   environment and deploy a maintenance-bearing release to 100 percent.
3. Prove the current release rejects all protected HTTP effects with `503`,
   reports `account_deletion_maintenance` for deletion and
   `subscription_checkout_maintenance` for subscription Checkout, and still
   permits an authenticated `vault.export` challenge.
4. Record the exact predecessor and maintenance deployment IDs. Advance the
   project's custom Skew Protection Threshold to the maintenance deployment.
5. From an authenticated browser that loaded the predecessor before the
   threshold, retry deletion and personal subscription Checkout against the
   production origin. Also repeat each request against the production origin
   with the predecessor deployment ID pinned through Vercel's supported
   deployment-id mechanism. Both requests must resolve to the maintenance
   behavior and return the expected `503`; the Checkout response must create no
   Stripe Session and no local Checkout binding. A generated deployment URL is
   not a substitute for this proof: production cookies and same-origin
   authority must never be copied to another origin.
6. Wait the recorded absolute Function maximum after the admission-closing
   instant. Runtime logs are diagnostic only; quiet logs cannot shorten the
   wait.

If any check resolves to predecessor behavior, creates a Session, reaches
deletion, or cannot prove the deployment boundary, stop. Keep maintenance set,
do not begin a target-set sweep, and correct the threshold or deployment.

## Checkout-session fence rollout

Use two skew closures because the old production release understands the
deletion flag but does not yet reject subscription Checkout:

1. Deploy the current release with maintenance set, advance the threshold to
   it, prove deletion is closed from a predecessor-pinned browser, and wait the
   absolute Function maximum.
2. Apply the additive nullable Checkout-binding migration.
3. Deploy the bind-before-return release with maintenance still set. It must
   reject both deletion and subscription Checkout.
4. Advance the threshold again, this time to the bind-before-return
   maintenance deployment. Run the full pinned-predecessor proof above and wait
   the absolute Function maximum. Only the completed wait makes the pre-fence
   Session set finite: a predecessor admitted before the threshold can create
   its Stripe Session after the threshold.
5. After that wait, omit both `status` and `created` filters and automatically
   paginate every Checkout Session. Select every `mode=subscription` Session
   whose existing `client_reference_id`, `memberId`, `billingPlanCode`, and
   `checkoutOffer` metadata identify Murph personal billing. Reject malformed,
   incomplete, or conflicting metadata rather than silently excluding it. The
   complete paginated result across Stripe's retained history, not a
   clock-bounded or open-only subset, is the rollout set. Do not persist or
   publish raw provider or member identifiers.
6. Prove one outcome for every Session in that immutable set:
   - expire `open`, then retrieve it and require `expired`;
   - accept `expired` or provider-proven missing;
   - for `complete`, require nonempty Customer and Subscription ids. Accept the
     exact pair when either the canonical member billing reference or canonical
     account-group billing reference owns both. Account-group ownership is
     accepted without replaying the personal completion and without
     cancellation because direct-paid Family conversion intentionally moves the
     pair there. If neither owner survives, cancel the exact Subscription and
     delete the Customer only when no surviving canonical reference owns it;
   - treat any other status, owner conflict, failed replay, failed cancellation
     or deletion, pagination uncertainty, or ambiguous provider response as an
     open purpose that keeps maintenance active.
7. Repeat the full all-status pagination, not an open-only query. The set is
   closed only when every matching row has the required outcome proof and no row
   was skipped. Prove new personal and Family Checkouts stay bound, and prove
   deletion captures an open Session and a concurrently completed Session.
   In the rollout rehearsal, hold a predecessor personal Checkout request
   across threshold advancement, let it create its test-mode Stripe Session
   afterwards, complete the absolute wait, and prove the no-cutoff scan includes
   and terminalizes that late Session before maintenance can lift.
8. Mark `checkout-session-deletion-fence` closed. Clear maintenance only if the
   shared active-purpose record is otherwise empty, then deploy and smoke
   deletion plus personal and Family Checkout.

The first converged bind-before-return deployment is the Web rollback floor.
An emergency rollback below it keeps maintenance active; deletion must not
resume until a fence-capable deployment is restored, the threshold and
absolute wait are repeated, and the full all-status Session proof succeeds
again without a creation cutoff.

## Release or remove the control

To release the final active purpose, remove the production environment value,
deploy the current fence-capable release, and prove deletion and subscription
Checkout reach their normal application paths. Keep the first fence-capable
deployment as the rollback floor.

Do not delete the module, environment contract, effect guards, or this runbook
from a purpose-specific cleanup. Their eventual removal requires a separate
review proving that no active purpose, retained deployment, or supported
rollback can need the boundary.

References: [Vercel Skew Protection][vercel-skew-protection] and
[Vercel Function limits][vercel-function-limits].

[vercel-skew-protection]: https://vercel.com/docs/skew-protection
[vercel-function-limits]: https://vercel.com/docs/functions/limitations
