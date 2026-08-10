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

Use this rollout order:

1. from the linked production Web project, create and publish one disabled,
   first-position project route named `Starter hard-cut maintenance`:

   ```bash
   pnpm exec vercel --cwd apps/web routes add "Starter hard-cut maintenance" \
     --src "^/.*$" --action set-status --status 503 \
     --set-response-header "Retry-After=60" --position start --disabled --yes
   pnpm exec vercel --cwd apps/web routes publish --yes
   ```

   Inspect the production version before continuing. Do not stage another
   traffic owner, app flag, or Render suspension for this cut;
2. immediately before the merge that can run the migration, enable and publish
   that route. Confirm the production rule is enabled and both `GET /` and a
   harmless `POST /api/hosted-onboarding/linq/webhook` probe return `503` with
   `Retry-After: 60`. Because the rule is project-level and first-position, the
   response occurs before any old Web handler can create a legacy trial,
   accept a provider delivery, signal Temporal, or call Cloudflare directly;

   ```bash
   pnpm exec vercel --cwd apps/web routes enable "Starter hard-cut maintenance"
   pnpm exec vercel --cwd apps/web routes publish --yes
   pnpm exec vercel --cwd apps/web routes list --production \
     --search "Starter hard-cut maintenance" --expand
   curl -sS -D - -o /dev/null "${HOSTED_WEB_PRODUCTION_ORIGIN}/"
   curl -sS -D - -o /dev/null -X POST \
     -H "Content-Type: application/json" -d '{}' \
     "${HOSTED_WEB_PRODUCTION_ORIGIN}/api/hosted-onboarding/linq/webhook"
   ```

3. leave the route enabled while already accepted old Web and runtime work
   drains. Require bounded runtime-log evidence that no prior
   `ensureRuntimeProcessing` attempt remains in flight before allowing the
   migration to commit;
4. merge the reviewed head. Let the production Web deploy apply the additive
   ledger-kind/check-constraint migration and Starter backfill, and deploy the
   Cloudflare Worker/runner bundle from that same commit with
   `container_rollout=immediate`. Do not restore traffic after only one plane
   succeeds;
5. while the edge still returns `503`, require the exact production Web commit
   and exact runner-bundle fingerprint. Then disable and publish the route so
   only the converged pair receives traffic. Keep the disabled rule staged for
   immediate re-enable until post-deploy proof finishes;

   ```bash
   pnpm exec vercel --cwd apps/web routes disable "Starter hard-cut maintenance"
   pnpm exec vercel --cwd apps/web routes publish --yes
   ```

6. require signed active and exhausted Starter plan-usage reads and one
   eligible subscription quote. Exercise one approved canary Linq delivery—or
   observe one provider retry held by the `503` window—and prove one durable
   acceptance, one Cloudflare ensure, one completed processing result, and one
   Starter debit. A duplicate delivery must not add another debit;
7. confirm every old Web deployment capable of creating a Stripe trial is
   drained, then let delayed Stripe events and the runtime compatibility owner
   convert exact post-migration legacy objects through the canonical Starter
   grant path;
   keep the configured legacy Pulse Price unchanged through this drain and the
   delayed-event horizon so exact old objects remain verifiable;
8. delete the disabled maintenance route and publish only after all post-deploy
   proof passes;

   ```bash
   pnpm exec vercel --cwd apps/web routes delete \
     "Starter hard-cut maintenance" --yes
   pnpm exec vercel --cwd apps/web routes publish --yes
   ```

9. run `pnpm --dir apps/web stripe:retire-legacy-pulse-trials --stripe-mode=<test|live>`
   in dry-run mode and review the aggregate candidate and provider-status
   counts;
10. apply only with the exact observed count using `--apply
   --expected-candidates=<count>`; any potentially paid provider state aborts
   the entire preflight before mutation;
11. rerun the dry-run until it reports zero candidates; and
12. after the delayed-event horizon has passed, remove the legacy offer fields,
   wire actions, cleanup owner, and operator command together.

The complete prior Web/runner pair remains a rollback target only until the
Starter migration commits. After commit, re-enable and publish the edge rule
on any failure, then forward-fix or redeploy the exact current Web/runner pair;
neither prior plane may resume against the migrated ledger. The operator command requires an
explicit Stripe mode and verifies that it matches the configured credential,
defaults to dry-run, prevalidates every candidate before applying, and is safe
to rerun.

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
creators are gone, the operator dry-run reports zero, and the maximum delayed
Stripe event horizon has elapsed. Analytics-only cohort names and immutable
historical records are not runtime compatibility and may remain.

Do not revert the Starter migration: its ledger kind and historical entries are
accounting history. Recovery after migration commit is forward-only under the
same project-edge traffic gate.
