# Growth message-volume charts

Status: active
Created: 2026-07-31

## Outcome

- Let the operator see cumulative hosted message volume and messages per UTC day on `/ops/growth` so movement over time is immediately legible.
- Keep the existing acquisition, revenue, and weekly scorecard behavior intact.

## Ownership and evidence

- `HostedGrowthDailySnapshot` already owns prior-day inbound and outbound message counts.
- `HOSTED_MESSAGE_VOLUME_BASE` already represents untracked pre-snapshot history for the public lifetime total.
- The gap is presentation and a bounded read projection: the dashboard currently drops the two message-count fields before rendering its chart series.

## Plan

1. Derive a bounded message series from the existing daily snapshots, with the message date shifted to the prior UTC day and cumulative totals seeded from the existing historical base.
2. Add cumulative and per-day charts to the existing `GrowthCharts` component using the current Recharts and chart-token system.
3. Render the real chart composition with synthetic data in the existing growth design study.
4. Add focused projection and rendering regressions, then run scoped hosted-web checks and desktop/mobile browser proof.
5. Commit, push a pull request, complete the required specialist and UI review gates, and require green exact-head CI.

## Invariants

- Do not add a schema, persistence owner, cron, or provider call.
- Do not count mailbox rows or delivery rows differently from the existing snapshot and public message-volume definitions.
- Keep unknown legacy snapshot counts honest rather than displaying them as a known zero.
- Keep the series bounded and the operator page free of member or message identifiers.
- Preserve responsive readability and the existing warm-paper chart vocabulary.

## Verification

- Focused hosted growth metric and rendering tests.
- Hosted-web TypeScript and lint checks for touched files.
- Frontend design-proof guard.
- Desktop and mobile Playwright proof from `/design?tab=sections`.
- Preliminary `completion-specialists` ReviewGPT pass with product-experience, frontend, and coverage lenses.
- Claude Code UI double-check while credits are available.
- Exact-head required CI and parent final review.
