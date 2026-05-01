# Fix hosted runner idle nudge fallback alarm race

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Prevent idle hosted runner nudges from double-starting work when the durable
  fallback alarm fires while the immediate detached drive is already active.

## Success criteria

- Idle `nudgeHostedRunner()` still persists a pending nudge and starts the
  detached runner drive immediately.
- The alarm scheduled for an idle nudge is delayed as a recovery fallback rather
  than scheduled for immediate execution.
- If an alarm handler waited for an active in-isolate invocation, it rechecks
  runner state and skips a second empty drain when no pending nudge or due wake
  remains.
- Focused Cloudflare runner tests cover the idle-nudge/alarm race.

## Scope

- In scope: `apps/cloudflare/src/user-runner.ts`, focused
  `apps/cloudflare/test/user-runner-alarm.test.ts` coverage, plan/ledger.
- Out of scope: web nudge workflow, mailbox protocol, native container runtime,
  assistant-runtime internals.

## Constraints

- Technical constraints: keep the Durable Object alarm as the durable recovery
  path; do not remove pending-nudge coalescing or persisted in-flight recovery.
- Product/process constraints: preserve unrelated dirty work; no secrets,
  payloads, local account identifiers, or plaintext user data in logs/tests/docs.

## Risks and mitigations

1. Risk: delaying the idle fallback alarm could slow recovery if the detached
   drive fails immediately.
   Mitigation: use the existing retry delay fallback and keep the detached-drive
   failure path scheduling retry alarms.
2. Risk: alarm skip logic could skip due runtime timer work.
   Mitigation: skip only when the refreshed record has no pending nudge and no
   due `nextWakeAt`; future wakes remain scheduled.

## Tasks

1. Register plan/ledger.
2. Change idle nudge fallback alarm timing.
3. Add alarm post-wait state recheck and skip.
4. Add focused regression coverage.
5. Run required focused verification and completion workflow.

## Decisions

- Use `retryDelayMs` for idle-nudge fallback alarm timing so the immediate
  detached drive is the fast executor and the alarm remains durable recovery.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts`
  - `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-01-hosted-runner-idle-nudge-fallback.md`
- Expected outcomes: focused runner regression and Cloudflare typecheck pass;
  record any unrelated broader failure explicitly.

## Results

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts` passed
  with 1 file and 27 tests after the security-review fix.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed
  through `apps/cloudflare verify`.
- `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-01-hosted-runner-idle-nudge-fallback.md` passed.
- Earlier wrapper form
  `pnpm --dir apps/cloudflare test -- --runInBand test/user-runner-alarm.test.ts`
  widened to the full Cloudflare Node suite and hit an unrelated runner-bundle
  artifact failure; the direct focused Vitest command and scoped diff lane above
  are the accepted verification for this task.
- Required security/privacy review found one medium recovery issue: the skip path
  could trust a future persisted `nextWakeAt` after the active invocation if a
  real DO alarm was not armed. Fixed by reapplying the future alarm before
  returning idle from the skip path, with focused test coverage.
- Required task-finish review reported no findings before the security-review
  follow-up; local reruns passed after the follow-up.
Completed: 2026-05-01
