# Live provider canaries

Last verified: 2026-09-17

A passing live canary means its actual journey and business assertions completed.
A successful scheduler, skipped job, connection-only result, or unavailable
credential is not equivalent evidence. GitHub completion timestamps identify the
age of an executed run; this system adds no product-state receipt database.

## Existing journeys

- Native iOS and Android execute on every staggered twelve-hour schedule, including
  unchanged revisions. They retain immutable private-source pins, exact deployed
  revision checks, non-destructive identity ownership, and fixed non-canceling
  concurrency. Manual recovery is restricted to current protected main. iOS
  independently selects and verifies the actual production deployment, including
  protected-main ancestry and dispatch-time equality. The Web SHA records the
  deployment selected at launch, not an assertion that production stays frozen
  for the entire native journey. Ordinary promotions do not invalidate successful
  native business assertions; the canary emits no per-commit acceptance status.
- Linq resolves the actual production alias before its six-hour journey, verifies
  protected-main ancestry and exact deployment, and repeats deployment validation
  after execution. A manual requested SHA must match the deployed revision.
  The fixed canary account is reset through its existing input-free owner.
  Phone-account creation saves an explicit GPT-6 Luna preference only for the
  server-configured Linq canary number. Each reset recreates that preference;
  ordinary member defaults and existing saved model choices are unchanged.
  The canary retains the normal first-day priority policy and member pricing.
  After the identity exchange, the person asks for a manageable walking plan
  and accepts the proposal in ordinary language. Canonical observations require
  zero Goals after identity and proposal, then exactly one active Goal after
  acceptance, with valid bank/goal provenance and a distinct canonical ID. The
  model may choose its title. The conversation contains no storage command or
  exact-title readback demand; exact save/readback is covered separately by
  `packages/cli/test/health-goal-save.test.ts`. A focused real-model journey
  shares the canary messages and checks the walking plan and linked Goal;
  production counts alone prove lifecycle and provenance, not plan semantics.
  Deploy the active-Goal observer before running the new conversation controller.
  Pending
  conversation work or a checkpoint change during the read prevents accepting
  the result. The observer parses the live v2 checkpoint and compares its complete
  fingerprint before and after decryption. Published-replica freshness uses the
  existing Browser Vault generation/age policy; the runtime owns canonical-content
  hashing. A checkpoint archive fingerprint is never compared with the replica's
  independent canonical source hash. The fixed-target read-only outcome route
  returns counts/readiness only.
  It cannot choose another member or enqueue a refresh. Deployment movement,
  absent support, stale projection, missing effect, or duplicate effects fail.
  Each canonical observation allows the shared default runner quiet window plus
  two minutes for publication, currently twelve minutes with at most 720 serial
  one-second polling attempts and a ten-second per-request cap inside that
  overall deadline. A timed-out read (including its response body) or HTTP 503
  uses the next existing poll without extending the deadline or repeating a
  message/reset. Persistent unavailability fails at the deadline; other HTTP
  errors, malformed evidence, and incorrect goal counts still fail immediately.
  This accommodates the normal ten-minute quiet window before
  checkpointing and subsequent replica publication. The separate
  send-to-reply and inter-reply budgets remain 20 seconds; canonical observation
  time is excluded. The workflow has a 55-minute cap covering reset, all three
  observations, replies, setup, and final exact-deployment verification.
- Stripe runs its protected sandbox browser matrix daily. Hermetic billing checks
  remain on every eligible PR and main push; a scheduled run requires live success.
  After the browser
  schedules Edge to Pulse, a real owned test clock advances through renewal and
  invoice collection. A different paid subscription-cycle invoice, reconciled
  Pulse period, cleared schedule, and production usage admission must agree.
  The usage reader's existing `now` input receives the vendor frozen time;
  ordinary browser/application clocks remain unchanged. Cleanup waits for clock
  settlement before deleting dependent objects, and failed clocks cannot be
  silently abandoned as successful cleanup.
- Garmin requires real provider login, callback completion, persisted connection
  reload, and cleanup. The scheduled private executor selects
  `MURPH_E2E_JUNCTION_WEARABLE_DATA=synthetic_webhook` to replace asynchronous
  Garmin delivery with a signed synthetic activity sent to the harness's local
  public Junction webhook route. An ephemeral harness-only signing secret
  exercises normal signature verification. The existing control plane, managed
  Temporal worker, importer, canonical mutation path, replica publication, and
  encrypted member readback remain real. No direct vault writes or forced wakes
  are used. The initial canonical steps view must be empty; success requires a
  fresh replica with the fixture's day/value/unit and Garmin activity-summary
  provenance, followed by UI disconnect and final provider cleanup.
  The version-3 private receipt uses `dataOutcome: synthetic_webhook_matched`;
  output explicitly identifies synthetic delivery. It does not prove live Garmin
  delivery latency or live upstream data availability. Missing persisted data,
  malformed proof, auth failure, cancellation, and cleanup failure still fail.
  Optional manual mode `MURPH_E2E_JUNCTION_WEARABLE_DATA=1` retains the strict
  independent live-provider oracle and bounded closed-category diagnostics.
  That mode requires a real provider/canonical match and writes a version-2
  `matched` receipt. Empty live provider reads still fail. Both modes require
  sole Garmin selection, sandbox authority, and the real managed private worker.


## Garmin execution boundary

The public `.github/workflows/junction-wearable-canary.yml` controller runs on
a daily schedule and manual recovery. It reuses only the existing
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
revalidated before acceptance. The controller polls boundedly for 74 minutes
and never retries an ambiguous dispatch or cancels provider work.

The private executor owns managed Temporal, the worker package, local PostgreSQL,
runner, a fresh provider browser without saved login state, and sandbox provider
authority. Its
new `junction-wearable-canary` Environment must be separately provisioned by an
authorized operator with the existing dedicated sandbox credentials. Local
agents must not retrieve or copy those credentials. Missing configuration fails closed. The synthetic-delivery result is explicit;
empty provider results cannot establish canonical persistence.

## Safe rollout and recovery

1. Land public synthetic-mode support while the private executor still uses the
   existing strict live-data mode. Then enable the private synthetic workflow
   together with its version-3 receipt reader. The reader retains legacy matched
   receipts and rejects empty/connection-only proof. To roll back public support,
   first restore the private workflow's live-data mode.
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
