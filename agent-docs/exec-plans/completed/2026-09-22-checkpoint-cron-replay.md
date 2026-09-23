# Preserve scheduled completion through checkpoint failures

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Allow ordinary native subagent communication without rejecting completed workspace
progress. Preserve the completed scheduled occurrence through checkpointing.

## Architecture

Assistant Engine owns the native process boundary and child-turn correlation.
Cron execution already owns the canonical occurrence timestamp. Keep those existing
owners: no new scheduler, database ledger, recovery queue, or shutdown fallback.

## Decisions

- Remove interaction/interruption policy failures. These native activity notices
  are requests, not evidence that a child is active or finished.
- Track the current native turn and completion together per child. A later start
  clears completion; an old terminal event or parent acknowledgement cannot finish
  the new turn. Repeat checks if work starts during the boundary RPCs.
- Preserve cancellation, timeout, malformed lifecycle, process availability,
  terminal and usage-report failures. An unestablished boundary still fails.
- No delivery-key change: the composed retry regression passes on the original
  implementation, so the proposed adjacent edit was removed.
- This fixes replay caused by the rejected interaction boundary. General storage
  failure remains at-least-once execution; this change does not claim exactly-once
  model calls across an unavailable checkpoint store.

## Success criteria

- Message/interruption activity does not poison an otherwise valid child boundary.
- Checkpointing waits for follow-up turns, including starts during terminal checks.
- Stale completions cannot release a running follow-up.
- Actual failures and foreground cancellation retain their existing behavior.
- Relevant tests, typecheck, complexity and candidate review pass.

## Verification

- Passed: native runtime event and process suites, 90 tests, using
  `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage`
  with `assistant-codex-runtime-events.test.ts` and
  `assistant-codex-runtime-process.test.ts`.
- Passed: `pnpm --dir packages/assistant-engine typecheck`.
- Passed: `pnpm complexity:diff`; existing complexity debt is unchanged and
  changed lifecycle methods stay below the threshold.
- Passed: `git diff --check` and parent review of privacy, native event ordering,
  cancellation, stale completions, bounded waiting and existing cron ownership.
- Native protocol-shaped tests cover both message and follow-up notifications,
  delayed native and parent acknowledgements, a follow-up starting during the
  terminal scan, and a child that never finishes. Existing process tests cover
  checkpoint cancellation, process ownership and usage completion.
- No live model run: the change consumes native lifecycle events and does not
  alter model instructions, tools, decisions or provider-visible input.
- No production mutation or deployment. PR CI and external review apply when
  this local change enters the PR lane.

## Review and deployment

Only Assistant Engine's existing in-memory native child boundary changes. No
persisted schema, protocol producer, scheduler or new public package entrypoint
changes. Ordinary runner replacement adopts the fix; older runners retain the
prior rejection behavior. Reverting code reintroduces that behavior but requires
no data migration. A post-deploy observation should confirm that communicating
scheduled work completes its idle checkpoint without repeated execution.

Changelog not applicable: this restores the existing internal checkpoint contract;
no new member-facing interface, workflow or feature is introduced.

## Product journeys

- Ready: a communicating scheduled turn finishes and checkpoints once.
- Ready: a child continues working while the root reply remains available;
  checkpoint waits for the actual latest child turn.
- Ready: foreground input cancels the wait without discarding child state.
- No new user-facing controls or messages.
Completed: 2026-09-22
