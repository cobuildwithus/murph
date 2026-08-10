# Growth monthly revenue chart

Status: completed
Created: 2026-08-07

## Outcome

- Let the operator see total revenue per calendar month on `/ops/growth` as a bar chart, with a tooltip that splits each month into personal subscriptions, family subscriptions, group sponsorship, and one-time usage top-ups.
- Keep every existing growth chart, scorecard, and table behavior intact.

## Ownership and evidence

- There is no local subscription invoice ledger; `HostedGrowthDailySnapshot.mrrUsdCents` is the only durable subscription-revenue history, so monthly subscription revenue is the month's latest snapshot MRR.
- The snapshot only stores the MRR total today, so the individual/family split must start being captured; two nullable columns written by the existing `captureHostedGrowthDailySnapshot` upsert close that gap from values `calculateHostedGrowthCurrentMetrics` already computes.
- `HostedUsageCreditPurchase` is the exact cash ledger for top-ups and group sponsorship: fulfilled live-mode rows bucketed by `paidAt`, classified by the sponsorship authorization/moment markers.
- Pre-split snapshot months (July 2026) cannot be split truthfully; they render one combined subscription value instead of an invented split.

## Plan

1. Add nullable `individual_mrr_usd_cents` and `family_mrr_usd_cents` snapshot columns (expand-only migration) and write them in the daily capture upsert.
2. Add a pure `buildHostedGrowthMonthlyRevenueSeries` projection over month-latest snapshots and fulfilled live purchases, with leading no-evidence months trimmed.
3. Read the bounded snapshot and purchase windows in `readHostedGrowthDashboard` and expose `monthlyRevenueSeries`.
4. Render one restrained sage total bar per month in `GrowthCharts` with a custom breakdown tooltip, reusing the existing chart-token system.
5. Extend the growth design study with synthetic monthly revenue data and update the growth charts e2e spec.
6. Add focused projection, dashboard, and capture regressions; run scoped hosted-web checks and desktop/mobile browser proof.
7. Commit, push a pull request, complete the required specialist and UI review gates, and require green exact-head CI.

## Invariants

- The migration stays expand-only: nullable columns, no backfill, no constraint changes.
- Do not invent a personal/family split for months that predate the split columns; show them as combined subscriptions.
- Only fulfilled, live-mode purchases count as revenue; deleted accounts remove their purchase history and the card copy says so.
- Keep the series bounded, aggregate-only, and the operator page free of member or purchase identifiers.
- Preserve responsive readability and the existing warm-paper chart vocabulary.

## Verification

- Focused hosted growth metric, capture, and series tests.
- Hosted-web TypeScript and lint checks for touched files.
- Frontend design-proof guard.
- Desktop and mobile Playwright proof from `/design?tab=sections`.
- Preliminary `completion-specialists` ReviewGPT pass with product-experience, frontend, and coverage lenses.
- Exact-head required CI and parent final review.
Updated: 2026-08-08
Completed: 2026-08-08
