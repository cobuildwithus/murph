# Recover overdue device connections after consumed scheduled wakes

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Goal

- Recover an overdue device connection when its scheduled wake was consumed without advancing canonical cadence, while preserving retained retries and no-change preflight.

## Success criteria

- A consumed scheduled wake with no remaining owner admits one fresh mailbox item and signals it after commit.
- Pending mailbox work, retained continuations, future retries, changed connection epochs/cadence, and conflicting payloads cannot use recovery.
- Focused PostgreSQL proof, typecheck, parent review, required ReviewGPT, and exact-head CI pass.

## Scope

- In scope: scheduled device-sync mailbox admission and composed regression proof.
- Out of scope: changing container size, lifecycle timers, provider validation, or Temporal ownership.

## Constraints

- Derive recovery identity from the consumed system frontier; use the existing encrypted mailbox and prepared-crypto transaction, without a new queue, schema, or scheduler.
- Preserve connection epoch, current due date, consent, duplicate-payload integrity, and retry ownership. Keep private production evidence out of artifacts.
- Product UX (Patch): restore automatic sync recovery for established connections; prove fresh admission and retained-work exclusions through the ordinary scheduled-wake API.

## Risks and mitigations

1. A stale sweep could duplicate retained work. Revalidate canonical connection and mailbox/workspace ownership inside the append transaction.
2. Legacy checkpoints omit newer optional pending fields. Require matching handled/imported/consumed frontiers and no future wake before interpreting absence as settled.

## Tasks

1. Reproduce a consumed, still-due scheduled wake returning accepted without fresh work.
2. Recover it at the existing scheduled mailbox append boundary, with deterministic identity and current ownership fences.
3. Run focused proof and typecheck, update the contract, review, commit, and open a green PR.
4. Continue observing the deployed cadence fix and report remaining wake optimization evidence.

## Decisions

- Exact scheduled-envelope deduplication remains intact. Recovery creates a successor rather than altering consumed mailbox history.
- Reuse the clean, already-authorized task checkout on a fresh branch; new checkout creation is blocked by an unrelated missing locked worktree.

## Verification

- Local PostgreSQL scheduled-wake retention tests plus focused scheduled-wake unit tests; Web typecheck and complexity diff.
- The new regression must fail before the fix and pass afterward, including concurrent duplicate recovery and stale/retained ownership exclusions.
