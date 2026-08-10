# Vercel cron cadence reduction

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Reduce the fixed Vercel cron invocation floor without delaying the normal
  stable signup-link reward owner, coupling referral work to billing-critical
  Stripe reconciliation, or moving the daily product-feedback digest.

## Success criteria

- Usage/referral recovery retains its standalone authenticated route, every
  existing route/auth test, and its every-minute cadence because the fixed
  50-row scan normally settles attributed stable-link activations.
- The Stripe minute sweep remains unchanged and has no referral-recovery
  dependency, latency, response, or failure coupling.
- The feedback digest is scheduled only during the two UTC hours that cover
  18:00 America/New_York across daylight and standard time, retaining six
  ten-minute retry opportunities in the service-owned local window.
- The fixed schedule floor is 3,517 invocations/day, down 132/day (about 3.6%)
  from 3,649/day.
- Focused Web tests, typecheck, diff, and privacy checks pass; exact-head CI,
  final review, and the required ReviewGPT gate remain pending.

## Scope

- In scope: the product-feedback cron schedule, exact cron config guards,
  truthful referral scheduler ownership docs, review-remediation evidence, and
  the one-line current-main telemetry census repair required for green CI.
- Out of scope: referral cadence or business rules, a new immediate signup
  settlement handoff, Stripe route behavior, retention behavior, and every
  other cron cadence.

## Constraints

- Keep `recoverPendingHostedUsageReferrals` on its existing authenticated
  minute route; add no scheduler, queue, lock, state owner, or dependency.
- Do not put the bounded referral pass, which may scan or re-signal up to 150
  durable candidates, on the billing-critical Stripe request path.
- Do not describe stable signup-link settlement as immediate or fallback-only:
  the standalone cron is its normal owner and the signup scan is capped at 50
  oldest-first candidates per pass.
- Preserve the digest service's America/New_York authority and idempotency; the
  Vercel schedule is only a bounded trigger window.

## Risks and mitigations

1. Risk: reducing the referral cadence delays normal stable-link rewards and
   compounds under a backlog larger than 50 candidates.
   Mitigation: retain the existing minute schedule; an actual immediate
   activation handoff would be separate product and architecture work.
2. Risk: DST causes the digest to miss 18:00 Eastern.
   Mitigation: cover both 22:00 and 23:00 UTC and retain the service window test
   across both DST transitions.
3. Risk: a deployment rollback restores code but not the old Vercel schedule.
   Mitigation: retain every route and auth contract, and verify the active cron
   configuration after deployment or rollback.
4. Risk: the newly added static Family setup page leaves current-main Web
   verification red because it is absent from the fail-closed telemetry census.
   Mitigation: register only its canonical static pathname with the existing
   query/fragment-stripping owner and keep the focused census test green.

## Tasks

1. [x] Inspect current referral and feedback cron owners, Vercel config, tests,
   and fixed invocation math.
2. [x] Retain the standalone referral route and auth tests without Stripe
   coupling.
3. [x] Narrow the digest schedule and add exact cron allowlist/cadence proof.
4. [x] Accept the preliminary specialist finding that the stable signup-link
   path normally settles through the fixed 50-row cron scan.
5. [x] Restore referral cadence to every minute and remove unsupported
   immediate-or-fallback-only claims from durable docs and PR intent.
6. [x] Run focused Web tests, typecheck, diff, privacy, and schedule-math checks.
7. [x] Commit and push the remediation, then update the PR body and finding
   ledger for the exact corrected head.
8. [x] Complete final review, exact-head CI, ReviewGPT, and plan closure.

## Decisions

- Keep referral recovery at one minute because it is the normal stable
  signup-link settlement owner, not merely a safety net after an immediate
  activation handoff. The fixed 50-row oldest-first batch also makes a slower
  cadence compound under backlog.
- Do not add a new immediate activation handoff to justify a larger reduction;
  that would broaden this schedule-only PR into another asynchronous owner.
- Keep referral recovery off the Stripe route because its three bounded lanes
  can inspect or re-signal up to 150 durable candidates and can issue Temporal
  signals. The standalone owner preserves independent timeout, response, and
  retry semantics for recovery and billing.
- Keep every route and every other cron cadence unchanged; only the feedback
  trigger window has enough evidence for reduction in this PR.

## Invocation math

- Stripe minute sweep: 1,440/day.
- Referral recovery minute sweep: 1,440/day.
- Contact-card hourly sweep: 24/day.
- Linq health every five minutes: 288/day.
- Runtime-latency alert every five minutes: 288/day.
- Product-feedback digest across 22:00 and 23:00 UTC: 12/day.
- Retention hourly sweep: 24/day.
- Growth snapshot daily sweep: 1/day.
- Total: 3,517/day, saving 132/day from the prior 3,649/day floor
  (approximately 3.6%).

## Review finding ledger

- Accepted product-experience finding: five-minute polling would delay the
  normal stable signup-link reward journey because no immediate activation
  caller settles those receipts and grants. Restored the minute cadence.
- Accepted coverage finding: the prior focused proof established idempotent
  recovery but could not prove the unsupported immediate-path claim. Removed
  that claim and retained exact minute-cadence configuration proof; no
  speculative immediate-handoff test or abstraction was added.
- The first preliminary capture returned this evidence but did not satisfy the
  ReviewGPT trust floor, so it does not count as the required pass. Parent
  inspection independently reproduced and accepted both findings.
- The valid corrected-head preliminary specialist pass returned no findings
  and confirmed the referral minute owner, feedback DST window, recovery
  semantics, and executable schedule proof.
- The first final round-1 response completed below the repository trust floor
  and was discarded. The trusted same-head round-1 retry and current-head
  full-snapshot round 2 both passed with no findings.

## Verification

- Passed the focused Stripe route, referral route/recovery, feedback digest,
  digest-window, and production cron config suite: 5 files and 71 tests.
- Passed `git diff --check`, direct schedule arithmetic (3,517/day, saving
  132/day or 3.6%), and the changed-line privacy scan.
- Web typecheck passed.
- After merging current main, the exact production cron guard passed 50 tests
  and the Family telemetry census/redaction repair passed 10 tests.
- Exact-head GitHub Actions passed on the reviewed candidate. Final ReviewGPT
  round 2 passed with no findings, and the parent final scope/call-path review
  found no additional issue. The documentation-only plan-closure head requires
  the ordinary final exact-head CI confirmation.
Completed: 2026-08-09
