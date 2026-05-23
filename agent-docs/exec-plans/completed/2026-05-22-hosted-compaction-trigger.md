# Hosted compaction retirement

Status: completed
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Remove the operational hosted compaction path because the production one-shot
  run found no compactable legacy wearable receipt envelopes.
- Keep the core repair helper scaffold for now, but make sure no hosted cron,
  operator script, orchestration wake, or automatic runtime path can trigger it.

## Success Criteria

- Vercel no longer registers the one-shot compaction cron.
- The hosted web operator script and cron route are removed.
- Hosted runtime no longer schedules or handles
  `legacy-wearable-receipt-compaction-v1` housekeeping wakes.
- Runtime demand/logging no longer treats the retired wake reason as active
  maintenance.
- Durable architecture docs no longer describe automatic hosted compaction.

## Scope

- In scope:
  - Hosted web cron/script removal.
  - Hosted runtime housekeeping trigger removal.
  - Focused test and docs updates.
- Out of scope:
  - Removing the tested core repair helper scaffold.
  - New product APIs, durable maintenance queues, or new DB fields.

## Constraints

- Keep the implementation simple and aligned with the existing hosted runtime
  wake primitive.
- Preserve unrelated active work and ledger rows.
- Do not expose direct user/member identifiers in code comments, generated
  reports, logs, examples, or handoff notes.

## State

- The production one-shot cron completed across the active hosted workspaces and
  reported zero compacted envelopes.
- There are no outstanding observed compaction wakes after that run.
- The user no longer wants the hosted compaction operation, but is comfortable
  leaving the core repair helper scaffold in place.
- Security review found and the implementation fixed one stale-state edge case:
  a persisted retired `legacy-wearable-receipt-compaction-v1` workspace wake is
  now ignored by runtime demand instead of authorizing a hosted run.
- Final review found and the implementation fixed the matching runtime-result
  stale-state edge case: a retired non-null runtime-result wake reason is now
  ignored instead of authorizing a retry run or future idle wake.
- Final verification passed: focused hosted-web demand and production-migration
  guard tests, `git diff --check`, `pnpm typecheck`, `pnpm test:smoke`, and
  `pnpm test:diff`.
- The scoped final review rerun reported no findings after the runtime-result
  allowlist fix.

## Tasks

1. Remove hosted web cron/script/route and tests.
2. Remove hosted runtime housekeeping scheduling/handling and tests.
3. Update runtime demand tests/docs for the retired wake reason.
4. Run scoped verification and required reviews.
5. Rerun final verification after review-driven fixes.
6. Close the plan with a scoped commit if the worktree allows it.
Completed: 2026-05-22
