# Growth Snapshot Message Counts + Homepage Volume Line

Status: completed
Updated: 2026-07-16

## Why

There is no durable record of message volume: inbound `conversation.message`
mailbox rows expire on TTL (~30 days) and the Linq delivery ledger only dates
to 2026-06-30, so all-time totals can only be estimated (~6,000 exchanged as
of 2026-07-16). The daily growth snapshot cron (00:10 UTC) already persists
member/MRR metrics; adding per-day message counts there makes volume durable
before the source rows expire, with no new cron, table, or user-facing query
path.

## What

1. `HostedGrowthDailySnapshot` gains nullable `inbound_messages_prior_day`
   and `outbound_messages_prior_day` columns (additive migration
   `20260716220000_hosted_growth_snapshot_message_counts`).
2. `captureHostedGrowthDailySnapshot` counts, for the full UTC day before
   `snapshot_date` (deterministic on rerun): inbound `conversation.message`
   mailbox items by `occurred_at`, and Linq deliveries with status
   `accepted`/`delivered`/`sent_no_receipt_expected` by `attempted_at`.
   Counts run in the existing cron's `Promise.all`; no request-path work.
   Outbound counts only the Linq ledger; Telegram/email egress has no
   delivery ledger yet (known undercount, documented in code).
3. Homepage trust section gains a static right-aligned header line:
   "6,000+ messages and counting" (seeded from the 2026-07-16 estimate; no
   data fetch).

## Verification

- `apps/web` scoped vitest: growth metrics (window + upsert payload), trust
  section markup, migration guard list. Typecheck green.
- Required audits: `frontend-review`, `coverage-write`; ReviewGPT PR lane as
  the cross-cutting gate if eligible.
Completed: 2026-07-16
