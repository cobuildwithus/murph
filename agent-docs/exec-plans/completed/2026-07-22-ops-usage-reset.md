# Add safe hosted usage reset and reporting

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Give allowlisted operators one safe place to inspect per-member and
  per-container message volume and AI usage.
- Let an operator reset the current included-usage period without leaving the
  existing usage-limit notice claim attached to the replenished capacity.

## Success criteria

- `/ops` links to a usage surface listing every hosted member and synthetic
  group container, with retained inbound message counts, seven-day volume,
  seven-day daily average, all-time priced AI usage, current-period spend and
  capacity, and blocked/notice state.
- Reset is same-origin, ops-allowlisted, explicit, stale-safe, and atomic with
  respect to usage accounting.
- Reset preserves immutable usage rows and purchased-credit balance, clears
  only current-period included spend/blocking, and releases only the current
  capacity epoch's notice idempotency claim while retaining its delivery row.
- Focused tests, diff-aware verification, browser proof, required audits, CI,
  and ReviewGPT pass for the exact PR head.

## Scope

- Hosted Web `/ops` usage UI, its authenticated mutation route, and one
  `hosted-ops` usage owner.
- Focused ops usage service, route, and client tests.
- Current hosted usage product and Web ownership documentation.

## Constraints

- Do not mutate the usage-credit ledger or purchased-credit balance.
- Do not delete immutable AI usage or Linq delivery history.
- Do not change the usage-limit notice dispatcher or its current idempotency
  key construction; an active PR lane owns those internals.
- Message totals must disclose the existing 30-day mailbox retention boundary
  rather than introducing a second message-count source of truth.
- Lock the member before the current usage period, matching usage-accounting
  lock order, and reject a stale reset instead of discarding concurrent spend.

## Tasks

1. Add the read model for members, containers, retained messages, immutable AI
   usage, current allowance, and current notice-claim state.
2. Add an atomic current-period reset that nulls the current notice claim's
   idempotency key while preserving the delivery record.
3. Add the ops page, confirmation interaction, and `/ops` navigation entry.
4. Add focused coverage and document the supported reset semantics.
5. Complete verification, browser proof, audits, commit, PR, CI, and ReviewGPT.

## Evidence

- The live incident proved that resetting `spent_usd_micros` and `blocked_at`
  alone leaves the current capacity epoch's accepted quota-notice claim in
  place, so a later crossing resolves as `already_notified`.
- Hosted mailbox conversation rows are retained for 30 days; daily global
  snapshots are durable but do not preserve per-member history.
- Immutable priced AI usage rows retain all-time allowance cost independently
  from the mutable current-period allowance projection.
Completed: 2026-07-22
