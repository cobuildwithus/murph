# Hosted runner web-owned wake rearm

Status: completed
Created: 2026-05-18
Updated: 2026-05-18

## Goal

- Reconcile future web-owned hosted workspace wakes into Cloudflare runner state
  when mailbox demand is already caught up, so status/nudge checks re-arm the
  Durable Object alarm instead of clearing it after state drift.
- Simplify hosted runner progress reconciliation with a snapshot that separates
  durable demand, active transport state, and the Durable Object alarm cache.

## Success criteria

- `ensureRunnerProgress()` keeps the no-demand/caught-up path thin but caches a
  valid future `webStatus.workspace.nextWakeAt` into runner state before syncing
  the Durable Object alarm.
- `ensureRunnerProgress()` reads one `RunnerProgressSnapshot` and branches on
  write fence, backoff, mailbox backlog, due assistant wake, or idle alarm sync.
- A focused `apps/cloudflare` regression proves a caught-up mailbox with empty
  Cloudflare `wake_at` re-arms the future workspace wake.
- Verification covers the touched Cloudflare runner path and no private
  identifiers or sensitive payloads are introduced.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner.ts`
  - `apps/cloudflare/test/user-runner-alarm.test.ts`
- Out of scope:
  - Web-owned scheduler semantics.
  - Runtime checkpoint scheduling after successful invocations.
  - Broad runner lifecycle or container wake refactors.

## Constraints

- Technical constraints:
  - Cloudflare remains a cache/backstop for web-owned scheduler truth, not the
    canonical product owner.
  - Preserve existing mailbox-demand, write-fence, backoff, and retry-cap
    behavior.
  - Durable Object alarms provide one per-object future wake slot; scheduling
    must continue to choose the effective runner alarm from persisted state.
- Product/process constraints:
  - Preserve unrelated dirty worktree edits and overlapping hosted-runner rows.
  - Do not expose user identifiers, raw payloads, paths, or secrets in tests or
    logs.

## Risks and mitigations

1. Risk: A caught-up status/nudge path could overwrite a meaningful Cloudflare
   runtime wake with a stale/null web wake.
   Mitigation: normalize only future web wakes and use the existing
   `scheduleNextWake()` state helper plus existing alarm derivation.
2. Risk: Focused tests may miss worker-runtime alarm behavior.
   Mitigation: place the regression alongside existing `user-runner-alarm`
   coverage and run the Cloudflare-focused verification lane.

## Tasks

1. Inspect the existing demand/read/status state flow and alarm test helpers.
2. Replace the demand-only read helper with a progress snapshot that preserves
   the state record, web status, and durable demand classification.
3. Update the no-demand branch to cache normalized future web workspace wakes
   before `syncAlarm()`.
4. Add the caught-up mailbox regression for empty Cloudflare `wake_at`.
5. Run focused verification, required audits, and close the plan.

## Decisions

- Use the existing `scheduleNextWake()` state-store method rather than adding a
  second web-wake-specific storage path.
- Treat runner `wakeAt` as the local alarm cache and web workspace `nextWakeAt`
  as the durable assistant-wake source when mailbox demand is caught up.

## Verification

Completed:

- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir apps/cloudflare test:node -- user-runner-alarm -t "does not report caught-up when mailbox checkpoints are caught up behind an active write fence"` passed.
- `pnpm --dir apps/cloudflare test:node -- user-runner-alarm -t "web-owned workspace wake|earlier Cloudflare wake"` passed and reported the Cloudflare node workspace green.
- `pnpm --dir apps/cloudflare test:node -- user-runner-alarm -t "schedules a short recheck when runtime completion requests immediate follow-up work|web-owned workspace wake|earlier Cloudflare wake"` passed and reported the Cloudflare node workspace green.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform apps/cloudflare/test/user-runner-alarm.test.ts -t "schedules a short recheck when runtime completion requests immediate follow-up work"` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform apps/cloudflare/test/user-runner-alarm.test.ts -t "web-owned workspace wake|earlier Cloudflare wake"` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed.
- `pnpm typecheck` passed.
- `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-18-hosted-runner-web-owned-wake-rearm.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Targeted diff scan found no direct path, username, authorization header,
  bearer token, API key, or private-key string in the runner/test/plan diff.

Completion notes:

- Required `security-privacy-review` completed with no findings.
- Required `coverage-write` added the earlier-Cloudflare-wake regression and
  reported verification green.
- Required final completion review found an immediate-runtime-wake regression;
  the runner/test fix was restored, focused verification was rerun, and the
  current working tree contains the short-recheck branch.
- A later final-review rerun observed the same branch absent after overlapping
  same-file edits; a clean final review/commit remains blocked by that checkout
  coordination issue.
- A scoped `finish-task` commit is unsafe from this checkout because the same
  hosted-runner files and coordination ledger contain overlapping dirty work
  from active tasks.
Completed: 2026-05-18
