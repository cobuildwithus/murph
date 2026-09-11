# Live provider canaries

Last verified: 2026-09-10

A passing live canary means its actual journey and business assertions completed.
A successful scheduler, skipped job, connection-only result, or unavailable
credential is not equivalent evidence. GitHub completion timestamps identify the
age of an executed run; this system adds no product-state receipt database.

## Existing journeys

- Native iOS and Android execute on every staggered six-hour schedule, including
  unchanged revisions. They retain immutable private-source pins, exact deployed
  revision checks, non-destructive identity ownership, and fixed non-canceling
  concurrency. Manual recovery is restricted to current protected main.
- Linq resolves the actual production alias before its hourly journey, verifies
  protected-main ancestry and exact deployment, and repeats deployment validation
  after execution. A manual requested SHA must match the deployed revision.
  The fixed canary account is reset through its existing input-free owner.
  After onboarding, the journey requires zero goals, one canonical fixed-goal
  write, a later model readback, and exactly one persisted goal. Pending
  conversation work or a checkpoint change prevents accepting an older replica. The fixed-target read-only outcome route returns counts/readiness only.
  It cannot choose another member or enqueue a refresh. Deployment movement,
  absent support, stale projection, missing effect, or duplicate effects fail.
- Stripe retains its protected sandbox browser matrix. After the browser
  schedules Edge to Pulse, a real owned test clock advances through renewal and
  invoice collection. A different paid subscription-cycle invoice, reconciled
  Pulse period, cleared schedule, and production usage admission must agree.
  The usage reader's existing `now` input receives the vendor frozen time;
  ordinary browser/application clocks remain unchanged. Cleanup waits for clock
  settlement before deleting dependent objects, and failed clocks cannot be
  silently abandoned as successful cleanup.
- Garmin uses actual positive completed-day provider activity, with an initially
  empty canonical steps view. The browser stays connected while the ordinary
  callback-owned Temporal/runtime pipeline imports data. Provider day/value/unit
  and Garmin activity-summary provenance must match canonical query output.
  Missing real data fails; the test invents no sandbox samples and forces no
  ensure-processing call. Only after comparison, UI disconnect, and final owned
  cleanup does the suite write its private temporary receipt. This proves pull
  and canonical ingestion; it does not claim provider webhook-delivery proof.

## Garmin execution boundary

The public `.github/workflows/junction-wearable-canary.yml` controller runs on
protected-main pushes, daily, and manual recovery. It reuses only the existing
`temporal-compatibility` Environment's repository-scoped GitHub App authority:
private Actions write and Contents read for `cobuildwithus/murph-cloud`. It never
checks out private source, receives provider credentials, or downloads private
logs/artifacts.

The fixed private workflow is `.github/workflows/junction-wearable-canary.yml`
with API name `Private Junction Garmin Canary`. Inputs are contract version `1`,
exact public SHA, and opaque request id. The controller resolves private main
before dispatch, accepts the returned run id only for that exact workflow and
private revision on attempt one, and requires exactly one successful final job:
`Junction wearable canary proof / <digest>`. The digest is SHA-256 of version,
public SHA, private SHA, and request id, each newline terminated. Completion
must be from this dispatch, not an old run or a skipped proof. Private main is
revalidated before acceptance. The controller polls boundedly for 54 minutes
and never retries an ambiguous dispatch or cancels provider work.

The private executor owns managed Temporal, the worker package, local PostgreSQL,
runner, dedicated Garmin browser profile, and sandbox provider authority. Its
new `junction-wearable-canary` Environment must be separately provisioned by an
authorized operator with the existing dedicated sandbox credentials. Local
agents must not retrieve or copy those credentials. Missing configuration or
missing real provider data fails closed.

## Safe rollout and recovery

1. Land the private executor with canonical-data receipt validation. It must
   reject an older public revision that supports only connection proof.
2. Let every prior provider-bearing public Garmin run finish naturally before
   the first private provider run. Cross-repository concurrency group names alone
   do not serialize an old public executor with the new private executor.
3. Provision the private sandbox Environment and merge the public controller and
   data journey. Retain private fixed non-canceling concurrency as the provider
   account's execution owner. Run a protected-main manual recovery and require
   the exact successful digest receipt.
4. Deploy the fixed Linq outcome reader before treating the extended production
   canary as available. Until then, a missing observer is a failed proof rather
   than an accepted older three-reply result.

Rolling back test controllers does not roll back product data. Preserve the
fixed account boundary and never enable both public and private Garmin executors
against one provider account. Provider runs and new Environment provisioning
remain external acceptance steps, distinct from hermetic PR checks.

## Focused verification

Controller proof: `node --test scripts/github-wearable-canary.test.mjs
scripts/linq-production-canary-ci.test.mjs scripts/native-ios-hosted-e2e.test.mjs
scripts/native-android-hosted-e2e.test.mjs`.

The relevant Web canary/support tests, Cloudflare canonical-data oracle tests,
and harness environment-partition tests exercise the production readers and
bounded proof boundaries. Protected provider runs supply the real-network proof;
local fixtures never replace them.

The dispatch controller follows GitHub's [workflow dispatch contract](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
and [workflow run identity API](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run).
