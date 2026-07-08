# Ops Growth Dashboard (`/ops/growth`)

Status: completed
Owner: Claude (supervisor) + Codex (implementation)
Created: 2026-07-06

Our utmost priority is clean, simple, long term maintainable and composable architecture with minimal complexity.

## Why

The founder needs one internal page answering the Paul Graham "Startup = Growth" questions at a glance: how many paying customers, how many on trial, signups today, week-over-week growth, MRR and its growth, and trial-to-paid conversion. Today this requires ad-hoc prod SQL.

## User-visible goal

A founder-gated dashboard at `/ops/growth` (linked from the `/ops` index, plus a `/growth` redirect) showing live growth metrics with small charts, entirely from the existing web Postgres via Prisma. No Stripe API calls at render time.

## Ground truth (verified)

- `HostedMember` (`apps/web/prisma/schema.prisma:333`): `billingStatus` enum (`not_started|active|incomplete|past_due|canceled|unpaid|paused`), `suspendedAt`, `createdAt`. `created_at` = member row creation (includes pending Linq contacts and family invitees, not only checkout signups — label honestly).
- `HostedMemberBillingRef` (`schema.prisma:627`): plaintext `currentBillingPlanCode`, `currentBillingPhase` (`trial|paid`), `currentCheckoutOffer`, `pulseTrialRedeemedAt`, `currentTrialStartedAt/EndsAt`, `currentPeriodStart/End`. No amounts stored.
- Prices are code constants in `apps/web/src/lib/hosted-onboarding/billing-plans.ts`: `launch_monthly` 800¢/mo (Pulse), `launch_edge_monthly` 2000¢/mo (Edge), family seat `HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS` = 700¢/mo. Reuse these constants and `isHostedPulseTrialBillingState` — do not duplicate prices or trial logic.
- Family billing: `HostedAccountGroup` (+ `billingStatus`, `suspendedAt`) with `HostedAccountGroupBillingRef.billedSeatCount` and `currentBillingPhase`; memberships in `HostedAccountGroupMembership` (`status = "active"`). Sponsored members may have own `billingStatus = not_started`.
- `HostedStripeEvent` is receipt-only (no payload, no member linkage) → **no historical MRR/paying-count exists anywhere**. History must accrue via a new daily snapshot table.
- Ops gating: `requireHostedOpsPageAccess()` / `requireHostedOpsRequestAccess()` in `apps/web/src/lib/hosted-ops/access.ts` (env allowlist `HOSTED_OPS_MEMBER_IDS`, fail-closed). Page precedent: `apps/web/app/(dashboard)/ops/runtime-latency/page.tsx` (force-dynamic, no-store, robots noindex, `getHostedDashboardPageAuthSnapshot()` first).
- Charts: recharts + `apps/web/src/components/ui/chart.tsx` (`ChartContainer`, `ChartTooltip*`); client-component precedent `apps/web/src/components/experiments/experiment-detail/trend-chart.tsx`.
- Crons live in `apps/web/vercel.json`; mirror the auth pattern of `apps/web/app/api/internal/hosted-onboarding/stripe/cron/route.ts` exactly (read it first).

## Metric definitions (deterministic — implement exactly)

All date bucketing in UTC. "WoW" compares rolling 7-day windows (last 7 days vs the 7 before), not calendar weeks.

- **Paying individual**: has `HostedMemberBillingRef.currentBillingPhase = 'paid'` and `HostedMember.suspendedAt IS NULL`.
- **Paying family group**: `HostedAccountGroup.suspendedAt IS NULL`, group `billingRef.currentBillingPhase = 'paid'`, `billedSeatCount >= 1`. Verify against `family-plan.ts` reconciliation that `'paid'` is the phase it actually writes; if family uses a different paid marker, derive from what reconciliation writes and note it in the store's doc comment.
- **Paying customers** = paying individuals + paying family groups (a family counts as one customer). Also compute **covered members** = paying individuals + active memberships in paying groups.
- **MRR (USD cents)** = Σ paying individuals by plan price (via `getHostedBillingPlanDefinition`) + Σ paying family groups `billedSeatCount × 700¢`. A paying individual with a null/unknown plan code contributes 0 and increments an `unpricedPaidMembers` anomaly count surfaced on the page.
- **On trial now**: `HostedMember.suspendedAt IS NULL`, `billingStatus IN ('active','paused')`, and `isHostedPulseTrialBillingState(billingRef)`. Secondary stat: trials with `currentTrialEndsAt` within the next 3 days.
- **New members**: count of `HostedMember.createdAt` per UTC day. Tiles: today, last 7 days, WoW %. Label the tile "New members" with a caption noting rows include invited/pending contacts.
- **Trial starts**: count of `pulseTrialRedeemedAt` per UTC day (set-once marker).
- **Trial→paid conversion**: cohort = members with `pulseTrialRedeemedAt IS NOT NULL`. A cohort member is **mature** when `pulseTrialRedeemedAt < now − 10 days` (max policy duration). Converted = `currentBillingPhase = 'paid'`. Headline = converted/mature among mature members. Also a weekly cohort table (last 8 weeks by trial-start week): started, converted, still-trialing (immature), conversion %.
- **Status breakdown** (small card): counts of members by `billingStatus` in (`past_due`, `canceled`, `paused`, `unpaid`) as churn-risk signals.
- **WoW for MRR / paying customers**: compare live value against the `HostedGrowthDailySnapshot` row 7 days old (accept 6–8 days, prefer closest to 7). When no snapshot exists yet, render "—" with a "history accrues from first visit" note. Do not fabricate backfilled history.

## New persisted state (placement gate: rebuildable-adjacent but authoritative history → web Postgres, same as other hosted product truth)

```prisma
model HostedGrowthDailySnapshot {
  snapshotDate       DateTime @id @map("snapshot_date") @db.Date
  capturedAt         DateTime @map("captured_at")
  totalMembers       Int      @map("total_members")
  payingIndividuals  Int      @map("paying_individuals")
  payingFamilyGroups Int      @map("paying_family_groups")
  payingFamilySeats  Int      @map("paying_family_seats")
  payingCustomers    Int      @map("paying_customers")
  coveredMembers     Int      @map("covered_members")
  trialingMembers    Int      @map("trialing_members")
  mrrUsdCents        Int      @map("mrr_usd_cents")

  @@map("hosted_growth_daily_snapshot")
}
```

Additive migration following the repo's migration folder naming. Snapshot rows contain only aggregate integers — no member data.

## Files to touch

1. `apps/web/prisma/schema.prisma` + new migration — snapshot table above.
2. `apps/web/src/lib/hosted-ops/growth-metrics.ts` — the only new domain module:
   - `readHostedGrowthDashboard(now: Date)` → one typed model consumed by the page (tiles, daily series last 30d, weekly rows last 8w, cohort rows, plan breakdown, snapshot history).
   - `captureHostedGrowthDailySnapshot(now: Date)` → computes current aggregates and upserts the UTC-date row (last write wins for the day).
   - Keep Prisma queries minimal-select; do day/week bucketing, WoW math, MRR math, and cohort math in exported pure functions so they unit-test without a DB. Reuse `billing-plans.ts` exports; import prisma via `getPrisma` from `@/src/lib/prisma`.
3. `apps/web/app/(dashboard)/ops/growth/page.tsx` — server component. `getHostedDashboardPageAuthSnapshot()` then `requireHostedOpsPageAccess()`, then `captureHostedGrowthDailySnapshot(new Date())` (awaited; it self-heals cron gaps) and `readHostedGrowthDashboard(...)`. Same headers/metadata conventions as sibling ops pages (force-dynamic, no-store, robots noindex).
4. `apps/web/app/(dashboard)/ops/growth/growth-charts.tsx` — `"use client"` chart components (daily new members + trial starts; MRR/paying history line from snapshots) using the existing `ChartContainer` wrapper, styled like `trend-chart.tsx`. Server page passes plain serializable props.
5. `apps/web/app/api/internal/hosted-growth/snapshot/cron/route.ts` — mirrors the stripe cron route's auth/shape; calls `captureHostedGrowthDailySnapshot`.
6. `apps/web/vercel.json` — add `{ "path": "/api/internal/hosted-growth/snapshot/cron", "schedule": "10 0 * * *" }`.
7. `apps/web/app/growth/page.tsx` — server redirect to `/ops/growth` (gating happens there; fail-closed for non-ops visitors).
8. `apps/web/app/(dashboard)/ops/page.tsx` — add a Growth card to `OPS_TOOLS`.
9. `apps/web/test/hosted-ops-growth.test.ts` — pure-function coverage (WoW incl. zero-baseline, MRR incl. family seats + unknown plan anomaly, trial-state counting via the real `isHostedPulseTrialBillingState`, cohort maturity boundary at exactly 10 days, snapshot upsert idempotence with mocked prisma) + access fail-closed for page/cron route (mirror `hosted-runtime-maintenance-ops.test.ts` mocking patterns).

## Page layout (keep it one screen, ops styling: font-serif heading, mono metrics, Card/Table primitives)

1. Stat tiles: MRR (+WoW %), Paying customers (+WoW), On trial (+ "N ending ≤3d"), New members today / 7d (+WoW %), Trial→paid conversion (mature).
2. Charts row: daily new members + trial starts (last 30d); MRR & paying-customers history (from snapshots; renders whatever exists).
3. Weekly growth table (last 8 rolling weeks): new members, trial starts, WoW %.
4. Trial cohort table (8 weekly cohorts).
5. Breakdown card: MRR by plan (Pulse/Edge/Family seats), billing-status churn signals, anomaly count if nonzero.

## Edge cases to cover

- Zero rows everywhere (fresh DB): no NaN/Infinity; WoW with zero baseline renders "—" not `Infinity%`.
- Paid member with missing billingRef plan code → anomaly bucket, MRR unaffected.
- Family group with `billedSeatCount` null → not a paying group; do not throw.
- Members both individually paid AND in a paying family group: count once as paying individual; exclude from that group's covered-member increment if double-counted (covered members must not exceed total members).
- Trial members with `billingStatus = 'canceled'` are not "on trial now" but stay in their conversion cohort as non-converted once mature.
- Snapshot upsert must be safe under concurrent page loads (plain upsert by date PK).
- BigInt from Prisma count/aggregate paths: convert explicitly; page props must be JSON-serializable numbers.

## Non-goals

- No Stripe API reads, no backfilled history, no per-member drill-down, no CSV export, no new env vars, no changes to billing write paths.

## Verification

- Fresh worktree bootstrap: `pnpm install`, then prisma generate (repo script), before typecheck.
- `pnpm typecheck` (web), focused vitest run of the new test file from repo root, and `pnpm test:diff` over touched paths if truthful.
- Static readback of the migration SQL against the Prisma model.

## Deployment

Web-only. Migration is additive and runs via the existing `release:production:migrate` build command. Cron activates on next Vercel deploy. `HOSTED_OPS_MEMBER_IDS` already configured in prod (used by existing ops pages).
Updated: 2026-07-06
Completed: 2026-07-06
