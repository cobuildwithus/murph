# Upgrade system-mailbox runtimes in place on foreground input

Status: active
Created: 2026-09-17
Updated: 2026-09-17

## Goal

- A conversation message that lands while a `system_mailbox` runtime is booting
  or importing is served by that same runtime through the existing post-import
  foreground upgrade, instead of the runtime discarding its restored workspace,
  releasing ownership, and forcing a second fresh start and restore.

## Success criteria

- A `system_mailbox` invocation that receives a default-mode wake before or
  during its initial system-lane import completes that import, checkpoints
  what the existing post-import path requires, and runs the foreground pass in
  the same invocation when qualified conversation rows exist.
- The pre-import early return, the interruptible initial fetch, and every piece
  of plumbing that existed only for them are deleted; the change is net
  negative in production source.
- `assistantExecutionBlocked`, deferred cold bootstrap, replay-budget, and
  spurious-promotion (no conversation rows) behavior are unchanged and proven.
- Focused assistant-runtime tests and typecheck pass; exact-head CI is green;
  final ReviewGPT is resolved.

## Scope

- In scope: `packages/assistant-runtime/src/hosted-runtime.ts` initial-import
  section and its dead `mailboxFetchSignal` chain through `workspace-runner.ts`,
  `mailbox-checkpoint.ts`, and `mailbox-import.ts`; the four system-preemption
  tests that pin the old hand-off plus focused new coverage; the
  `ARCHITECTURE.md` sentences that describe `system_mailbox` return behavior;
  a public changelog item.
- Out of scope: Durable Object fence mode after an in-place upgrade (pre-existing
  for the post-import upgrade), Temporal accepted-mode bookkeeping, the Web
  direct-ensure `active_child_rejected` retry, typing-indicator ordering relative
  to system-mailbox maintenance, workspace restore size.

## Constraints

- Technical constraints: no new state, queue, scheduler, flag, or wake carrier;
  keep `HostedMailboxPrefixPrefetch.signal` and every other checkpoint-wake
  interruption user intact; keep system-lane-only prefetch for system-mode
  starts; preserve `importOrStartupCheckpointPending` and the
  `foregroundHandoffPending` checkpoint before qualification.
- Product/process constraints: foreground priority is enforced at the next
  ownership-safe boundary; a default wake is a hint, never authorization; no
  member identifiers in code, tests, docs, or PR text; container image rollout
  is required for the fix to reach production (a Worker-only deploy is not
  sufficient).

## Risks and mitigations

1. Risk: a promotion wake consumed before import is invisible to the post-import
   check, so the runtime would run the system-only pass and return normally.
   Mitigation: in system mode leave the notification pending in the coalescing
   signal; prove with the before-fetch and during-fetch tests that the same
   invocation admits the conversation batch.
2. Risk: a slow initial system fetch can no longer be cut short by a wake.
   Mitigation: accepted explicitly; the deleted shortcut cost a full release,
   fresh start, and second restore, which is strictly larger than any remaining
   fetch tail under the existing transport timeouts.
3. Risk: blocked members could be promoted by a default hint.
   Mitigation: the existing `assistantExecutionBlocked` guards on the post-import
   path remain; add parameterized before/during/after-import blocked coverage.

## Tasks

1. Delete the pre-import hand-off and interruptible initial fetch; leave the
   pending wake unconsumed in system mode; unify the initial import call with
   mode-appropriate prefetch lanes.
2. Delete the dead `mailboxFetchSignal` / `initialMailboxFetchSignal` /
   `fetchSignal` chain.
3. Rewrite the four pinned tests as in-place upgrade proof; keep a
   spurious-promotion test; add blocked and deferred-bootstrap coverage.
4. Update `ARCHITECTURE.md`; add the changelog item.
5. Run focused tests, typecheck, complexity guard, docs drift; parent diff
   review; commit, push, draft PR, Ready, CI plus final ReviewGPT.

## Decisions

- Chosen fix: delete the pre-import hand-off so the existing post-import upgrade
  owns every foreground arrival (ReviewGPT investigation on 2026-09-17 ranked
  this first over a DO-side in-flight-start conversion, a Temporal admission
  change, and a cheaper hand-off).
- Product UX effort: Patch. Outcome: replies stay on the same runtime when a
  message overlaps a scheduled background pass. Reaches: any member texting
  within the boot window of a scheduled system wake (hourly device sync, cron,
  retention follow-ups). Proof: same-invocation admission tests for wakes
  before and during the initial fetch, plus unchanged blocked behavior.

## Verification

- Commands to run: focused `vitest run` on the system-preemption, system-mailbox,
  delegated-foreground-owner, background-wake-convergence, and workspace-runner
  test files; `pnpm --dir packages/assistant-runtime typecheck`;
  `pnpm complexity:diff`; `pnpm docs:drift`.
- Expected outcomes: all pass; the diff is net negative in production source;
  the four rewritten tests fail on the base commit and pass on the head.
