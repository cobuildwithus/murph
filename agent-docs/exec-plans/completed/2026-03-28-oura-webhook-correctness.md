# 2026-03-28 Oura Webhook Correctness

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Restore Oura webhook correctness so delete notifications become canonical tombstone imports, webhook timestamps accept Oura's documented header/body shapes, and webhook-triggered imports preserve specific object/resource identity instead of degrading into a blind short-window reconcile.

## Success criteria

- Oura delete webhooks for sessions, workouts, sleeps, and daily aggregates can produce `snapshot.deletions` end-to-end.
- Oura webhook verification accepts numeric second-based timestamps as well as millisecond/ISO forms, and uses the webhook body event time when present.
- Webhook-triggered Oura jobs preserve `dataType` and `objectId` through execution so deletes and resource refreshes are resource-aware instead of generic seven-day polls.
- The Oura provider env/config exposes a webhook timestamp tolerance knob.
- Focused Oura provider/importer regression tests cover the fixed behavior, and repo-required verification is run or any unrelated blocker is recorded.

## Scope

- In scope:
- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/test/oura-provider.test.ts`
- `packages/importers/src/device-providers/oura.ts`
- `packages/importers/test/device-providers.test.ts`
- Out of scope:
- Broader hosted/local device-sync architecture changes outside the Oura provider/importer seam.
- Unrelated WHOOP, Garmin, or hosted control-plane follow-ups.

## Constraints

- Technical constraints:
- Preserve existing device-sync/importer public contracts and work on top of the already-dirty tree without reverting unrelated edits.
- Keep Oura webhook handling aligned with existing repo patterns, especially WHOOP's resource/delete job split and shared importer tombstone builders where that fits.
- Product/process constraints:
- Maintain the coordination ledger row for this active coding lane.
- Run the required completion-workflow audit passes (`simplify`, `test-coverage-audit`, `task-finish-review`) via spawned subagents before handoff.

## Risks and mitigations

1. Risk: Oura webhook resource handling could overfit to one payload shape and regress compatibility with existing deliveries.
   Mitigation: accept both documented/body aliases, keep timestamp parsing backward-compatible, and add direct regression tests for numeric and ISO timestamp/header forms.
2. Risk: Object-scoped webhook jobs may fetch the wrong window or miss tombstones for aggregate resources that lack single-resource endpoints.
   Mitigation: split delete jobs from resource jobs, synthesize explicit deletion markers for deletes, and use data-type-specific narrow import windows for create/update jobs.

## Tasks

1. Add an Oura-specific webhook event/resource descriptor layer that preserves operation, data type, object id, and occurred-at semantics.
2. Rework Oura job execution so webhook jobs can run as resource-aware imports or explicit delete imports instead of generic reconcile windows.
3. Extend Oura importer normalization to treat explicit deletion markers for all supported resource types consistently.
4. Add focused provider/importer regression coverage for delete-webhook end-to-end handling, numeric timestamp headers, event-time parsing, and tolerance config wiring.
5. Run required verification and mandatory audit passes, then close the plan if the task is complete.

## Decisions

- Reuse the repo's existing WHOOP pattern of separate webhook job kinds for resource refreshes and deletes rather than extending the generic reconcile flow further.
- Prefer backward-compatible parsing that accepts both legacy/internal aliases and Oura's documented webhook field names.
- Add one combined provider-plus-importer test path so the Oura delete webhook flow is proven through the shared importer boundary rather than only in separate provider/importer tests.

## Verification

- Commands to run:
- `pnpm vitest packages/device-syncd/test/oura-provider.test.ts packages/importers/test/device-providers.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Focused Oura tests prove delete-webhook, timestamp, and importer tombstone behavior directly.
- Repo-required commands pass, or any unrelated pre-existing blocker is documented with causal separation.

## Outcome

- Completed the Oura provider fix: numeric-second webhook timestamps now verify correctly, `event_time` wins over receipt time, delete webhooks become explicit deletion imports, and webhook-triggered resource jobs preserve `dataType` plus `objectId`.
- Completed the config/test follow-up: `OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS` is wired from env/config and covered by a focused regression test.
- Completed focused proof: the provider delete-job path now runs through the shared importer boundary in test coverage, and importer coverage includes an explicit Oura daily-aggregate deletion marker case.
- Verification notes:
  - Passed: `pnpm --dir packages/device-syncd build`
  - Passed: `pnpm --dir packages/importers build`
  - Passed: `pnpm vitest --no-coverage packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/config.test.ts packages/importers/test/device-providers.test.ts -t Oura`
  - Failed outside this lane: `pnpm typecheck` at pre-existing `packages/core/src/{ids.ts,operations/canonical-write-lock.ts}` plus downstream `@murph/runtime-state` dependency fallout.
  - Failed outside this lane: `pnpm test` at the same pre-existing `packages/core`/`runtime-state` issues and then a transient unrelated `packages/inboxd/dist` cleanup error during the retry pass.
  - Failed outside this lane: `pnpm test:coverage` at pre-existing `packages/core` build failures and unrelated active `packages/cli/src/{assistant/service.ts,commands/assistant.ts}` typing failures.
Completed: 2026-03-28
