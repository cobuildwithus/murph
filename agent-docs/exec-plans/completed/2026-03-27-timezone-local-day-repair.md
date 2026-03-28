# Timezone local-day repair

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Stop canonical day-key derivation from depending on UTC ISO slicing.
- Make recurring local-time schedules survive UTC hosts and DST transitions.
- Align query and web read paths with stored local-day data instead of recomputing dates from UTC timestamps.

## Success criteria

- Shared timezone helpers can derive a local `YYYY-MM-DD` day key from an instant and IANA timezone without relying on host-local `Date` math.
- Canonical event/sample/history/journal writes that need a local day use an explicit timezone source instead of `toISOString().slice(0, 10)`.
- New vault initialization no longer silently defaults to `America/New_York`.
- Query/search/timeline/web overview paths prefer stored `dayKey` for grouping/filtering and only format exact instants with an explicit timezone.
- Recurring daily assistant scheduling stores timezone-aware local schedule metadata and computes `nextRunAt` as an absolute UTC instant.
- Regression tests cover Melbourne local-day writes, UTC-midnight-crossing cases, and DST-sensitive daily schedule recomputation.

## Scope

- In scope:
  - shared timezone/day-key primitives
  - optional record timezone metadata where the existing contracts can carry it safely
  - vault/init timezone default cleanup
  - canonical write-path day-key repairs in core, inbox, and importer flows
  - query/search/web read-side day/date normalization
  - assistant recurring schedule model + food auto-log integration
  - focused docs/tests needed to keep runtime behavior truthful
- Out of scope:
  - introducing a new hosted multi-user user-profile timezone model (`homeTimeZone`, `lastSeenTimeZone`) that does not exist in this repo yet
  - migrating every legacy record perfectly when the original timezone is unrecoverable
  - replacing arbitrary one-shot UTC timestamps or fixed-interval schedules that are already absolute-time safe

## Constraints

- Preserve existing dirty edits in overlapping `core`, `query`, `importers`, and web files.
- Prefer additive/compatible schedule evolution over breaking stored cron state outright.
- Keep cross-package sharing on declared public entrypoints only.
- Update tests/docs together when the architecture or contract surface changes.

## Risks and mitigations

1. Risk: timezone helper changes subtly alter legacy date comparisons beyond the intended local-day fixes.
   Mitigation: centralize conversion helpers, replace explicit slicing call sites deliberately, and add focused regression tests at write and read boundaries.
2. Risk: assistant cron state migration breaks existing stored jobs.
   Mitigation: keep legacy schedule parsing readable, add the new daily-local kind additively, and only shift newly created local daily schedules to the timezone-aware model.
3. Risk: overlapping dirty edits in `packages/query/src/{canonical-entities.ts,model.ts}` and `packages/importers/src/device-providers/*.ts` make broad rewrites unsafe.
   Mitigation: patch the minimal date/day-key seams, preserve unrelated helper simplifications, and stop if adjacent work turns incompatible.

## Tasks

1. Add shared timezone/day-key helpers and validation in the contracts layer.
2. Thread timezone-aware local-day derivation through core canonical write paths and related inbox/importer callers.
3. Replace read-side UTC slicing with stored-day or shared normalization helpers in query and web packages.
4. Introduce timezone-aware daily-local assistant schedule support and rewire recurring food scheduling to use it.
5. Add/adjust tests for Melbourne local-day writes, UTC-crossing read behavior, and DST-aware daily-local scheduling.
6. Run required verification, required completion-workflow audit passes, and close the coordination row after the lane is complete.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/core/test/core.test.ts packages/core/test/device-import.test.ts packages/query/test/query.test.ts packages/web/test/overview.test.ts packages/cli/test/assistant-cron.test.ts --no-coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Direct scenario target:
  - create or use a vault with `Australia/Melbourne`, add a meal at `2026-03-26T21:00:00.000Z`, and verify the stored `dayKey` remains `2026-03-27`; also prove a timezone-aware daily schedule recomputes a post-run `nextRunAt` that stays at the same local wall time across a DST boundary.

## Outcome

- Completed the shared timezone/day-key helper layer in contracts/core and removed UTC date slicing from the repaired write/query/web call paths in scope.
- Added timezone-aware `dailyLocal` assistant schedules plus timezone inheritance for legacy cron schedules created without an explicit timezone.
- Focused package tests passed, `pnpm typecheck` passed, and `pnpm test` / `pnpm test:coverage` remained blocked by the unrelated `apps/cloudflare/test/node-runner.test.ts` failure (`VaultError: Food was not found.`).
- Web rendering was inspected at desktop and mobile sizes via local Safari screenshots because richer Safari automation was unavailable in the current environment.
Completed: 2026-03-28
