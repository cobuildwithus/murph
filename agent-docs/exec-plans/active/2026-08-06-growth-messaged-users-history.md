# Growth messaged-user history

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Show how many unique people messaged Murph today and during the trailing
  seven days on the hosted growth page.
- Preserve exact completed-day activity history through the existing daily
  growth snapshot and cron owner so the page can chart the trend after live
  mailbox evidence expires.

## Success criteria

- Direct member messages and attributable group-participant messages dedupe
  through the existing growth identity resolver.
- The growth scorecard exposes prominent today and trailing-seven-day counts,
  with an explicit lower-bound treatment when private group-sender evidence
  has already been retired.
- Each daily snapshot stores the exact unique prior-day and trailing-seven-day
  counts when complete; legacy or incomplete history remains null rather than
  being backfilled or presented as zero.
- The existing authenticated 00:10 UTC snapshot cron remains the only
  scheduler and upserts one row per UTC date idempotently.
- A 30-completed-day chart shifts each snapshot onto the day its activity
  window ended and preserves gaps for unknown history.
- Focused service, migration, component, accessibility, and browser proof cover
  the production path and design-catalog study.

## Scope

- In scope: hosted growth snapshot schema and additive migration, unique-sender
  aggregation, daily activity series, growth scorecard/chart presentation,
  design-catalog fixtures, focused tests, and matching durable docs.
- Out of scope: historical reconstruction beyond retained mailbox evidence,
  another analytics table or scheduler, per-member activity storage, channel
  expansion, or changes to message ingress and retention.

## Constraints

- Postgres remains the sole hosted growth-history owner.
- The snapshot stores anonymous aggregate counts only, never member ids,
  contact lookup keys, message content, or sender evidence.
- The live and historical metrics use UTC boundaries, matching the existing
  growth snapshot and chart semantics.
- Retired group-sender evidence produces a lower bound live and a chart gap in
  durable history; it is never guessed.
- The metric covers retained senders. Account deletion removes the deleted
  account or owned group activity, matching the existing row-derived growth
  metrics without adding a durable deletion-timestamp analytics trail.
- Activity attribution failure creates unknown activity on the first same-date
  write but cannot overwrite existing activity on retry; revenue, member, and
  message history still updates. A successful pass may replace unknown values
  or write null when it proves retained group evidence incomplete.
- The migration is additive and nullable so old Web versions and existing rows
  remain valid during deploy and rollback.
- Keep the MRR weekly growth rate visually primary, with activity readings
  prominent but subordinate inside the existing ops-notebook hierarchy.

## Risks and mitigations

1. Risk: direct members and the same people in group chats double count.
   Mitigation: reuse the current member/contact identity resolution and merge
   both channels into one identity set before counting.
2. Risk: content retirement makes a historical window look exact.
   Mitigation: carry the existing completeness proof into the live UI and
   persist null instead of a count when a completed window is incomplete.
3. Risk: a new cron path creates duplicate scheduling and retries.
   Mitigation: extend the existing date-keyed snapshot upsert and its current
   authenticated Vercel cron route.
4. Risk: legacy snapshots render as zero activity.
   Mitigation: keep new columns nullable and build the chart on an exact date
   spine with null gaps.
5. Risk: the chart weakens the existing scorecard hierarchy or accessibility.
   Mitigation: reuse the cataloged production component, keep MRR first, and
   verify desktop, mobile, keyboard focus, tooltip, and forced-color states.

## Tasks

1. [x] Trace the existing active-user attribution, snapshot cron, chart series,
   migration, and design-catalog owners.
2. [x] Add nullable activity snapshot fields and focused migration/schema
   proof.
3. [x] Extend live and completed-day unique-person aggregation without a
   second identity owner.
4. [x] Add the two activity readings and historical chart to the production
   component and design study.
5. [x] Update durable architecture/reliability/design guidance and run focused
   verification plus desktop/mobile browser proof.
6. [ ] Push the exact candidate, run preliminary and final ReviewGPT alongside
   CI, resolve accepted findings, complete parent review, and close this plan.

## Verification

- Passed: Prisma Client generation and schema validation.
- Passed after base reconciliation and retrospective correction: focused
  hosted growth and migration Vitest suites (49 tests), Prisma Client
  generation/schema validation, touched-file ESLint, and hosted Web prepared
  TypeScript.
- Passed: hosted Web prepared TypeScript check and touched-file ESLint.
- Passed: desktop and mobile Playwright accessibility/browser proof from
  `/design?tab=sections#ops-weekly-growth-compass` (2 tests), plus exact and
  lower-bound desktop/mobile rendered studies. The final Fable review passed
  after its stale-scorecard-proof finding was resolved with fresh captures.
- Passed with resolved findings: preliminary product-experience/frontend/
  coverage ReviewGPT and final sensitive ReviewGPT round 1. The accepted
  findings added non-color chart encoding, update-branch null coverage, and
  isolation of activity-attribution failures from the legacy snapshot fields.
- Resolved after the required anomaly retrospective: the recovered round 2
  advisory showed that a failed same-date retry could erase exact activity.
  Failed updates now omit activity fields, while successful exact or
  proven-incomplete passes remain authoritative; the focused transition proof
  passes after merging current `main`.
- Pending: a fresh gate-valid final sensitive ReviewGPT remediation round,
  post-merge desktop/mobile browser proof, exact-head CI, and parent final
  review.
