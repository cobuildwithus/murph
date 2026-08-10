# Vercel cron cadence reduction

Status: active — local candidate complete; parent publication and exact-head gates pending
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Reduce the fixed Vercel cron invocation floor while keeping referral
  recovery independent from billing-critical Stripe reconciliation and keeping
  the daily product-feedback digest on time.

## Success criteria

- Usage/referral recovery retains its standalone authenticated route and all
  existing route/auth coverage, with cadence reduced from every minute to every
  five minutes.
- The Stripe minute sweep remains unchanged and has no referral-recovery
  dependency, latency, response, or failure coupling.
- The feedback digest is scheduled only during the two UTC hours that cover
  18:00 America/New_York across daylight and standard time, retaining six
  ten-minute retry opportunities in the service-owned local window.
- The fixed schedule floor is 2,365 invocations/day, down 1,284/day (about
  35.2%) from 3,649/day.
- Focused Web tests, typecheck, lint, diff, and privacy checks pass; exact-head
  CI and required review gates are green before completion.

## Scope

- In scope: referral and product-feedback cron schedules, exact cron config
  guards, cadence wording in their durable owner docs, and focused route/auth
  and service-window regression proof.
- Out of scope: Stripe route behavior, referral business rules, retention
  behavior, and every other cron cadence.

## Constraints

- Keep `recoverPendingHostedUsageReferrals` on its existing authenticated route;
  add no scheduler, queue, lock, state owner, or dependency.
- Do not put the bounded referral pass, which may scan or re-signal up to 150
  durable candidates, on the billing-critical Stripe request path.
- Preserve the digest service's America/New_York authority and idempotency; the
  Vercel schedule is only a bounded trigger window.

## Risks and mitigations

1. Risk: five-minute referral recovery increases worst-case replay latency.
   Mitigation: immediate post-commit reconciliation remains primary, recovery
   is idempotent, and five minutes preserves frequent bounded retries.
2. Risk: DST causes the digest to miss 18:00 Eastern.
   Mitigation: cover both 22:00 and 23:00 UTC and retain the service window test
   across both DST transitions.
3. Risk: a deployment rollback restores code but not the old Vercel schedule.
   Mitigation: retain the route and auth contract unchanged, document the
   cadence owner, and verify the active cron configuration after deployment or
   rollback.

## Tasks

1. [x] Inspect current referral and feedback cron owners, Vercel config, tests,
   and fixed invocation math.
2. [x] Retain the standalone referral route and auth tests, remove all Stripe
   coupling, and set its cadence to every five minutes.
3. [x] Narrow the digest schedule and update exact cron allowlist/cadence proof.
4. [x] Run focused Web tests, typecheck, lint, diff, privacy, and schedule-math
   checks.
5. [x] Return the implementation and evidence for parent review, publication,
   and exact-head gates.
6. [ ] Close the plan with final exact-head evidence.

## Decisions

- Keep every route and every other cron cadence unchanged; current evidence
  supports only the referral and feedback schedule reductions.
- Keep referral recovery off the Stripe route because its three bounded lanes
  can inspect or re-signal up to 150 durable candidates and can issue Temporal
  signals. The standalone owner preserves independent timeout, response, and
  retry semantics for both recovery and billing.
- Retaining the authenticated route keeps a schedule rollback code-compatible;
  operators still must verify the active Vercel cron configuration after a
  deploy or rollback.

## Invocation math

- Stripe minute sweep: 1,440/day.
- Referral recovery every five minutes: 288/day.
- Contact-card hourly sweep: 24/day.
- Linq health every five minutes: 288/day.
- Runtime-latency alert every five minutes: 288/day.
- Product-feedback digest across 22:00 and 23:00 UTC: 12/day.
- Retention hourly sweep: 24/day.
- Growth snapshot daily sweep: 1/day.
- Total: 2,365/day, saving 1,284/day from the prior 3,649/day floor
  (approximately 35.2%).

## Verification

- Passed the focused Stripe route, referral route/recovery, feedback digest,
  digest-window, and production cron config suite: 5 files and 71 tests.
- Passed `pnpm --dir apps/web typecheck`.
- Passed `pnpm --dir apps/web lint` with zero errors and 37 warnings outside
  the changed behavior.
- Passed `git diff --check`, unchanged Stripe/referral route and auth boundary
  proof, obsolete cadence wording search, and changed-line privacy scan.
- Direct config proof found 8 cron entries, 2,365 fixed invocations/day, 1,284
  removed/day, and a 35.2% reduction.
- Pending exact-head GitHub Actions and required review gates.
