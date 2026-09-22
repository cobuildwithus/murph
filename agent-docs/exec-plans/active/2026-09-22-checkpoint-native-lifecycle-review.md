# Audit and review native checkpoint lifecycle simplification

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Audit the checkpoint fix for brittle rejection rules, remove unnecessary
mechanisms, and deliver a PR with resolved ReviewGPT and green required CI.

## Architecture and scope

Assistant Engine owns observed native child lifecycle, usage completion and the
workspace boundary. Preserve that owner and native protocol events. Keep cron
occurrence state, billing ownership, prompts, provider input and public APIs intact.
No additional scheduler, persistent ledger, compatibility layer or native fork.

## Audit findings and decisions

- Parent activity metadata can be delayed, reordered, incomplete or refer to a
  reused/nested child. Its ancestry is not snapshot authority. Remove the
  outside-root, reused-child, nested-child and untracked-completion rejections,
  along with the parent-turn tracking maps they required.
- One child-turn map owns pending/completed state. A parent spawn acknowledgement
  only reserves a child before native turn start; parent completion is advisory.
  Native start resets completion, matching native completion settles it, and
  starts during terminal checks repeat the bounded check.
- A pending usage report prevented foreground cancellation because its wait used
  an uncancellable Promise.all. Reuse the existing abortable operation waiter;
  cancellation retains the report and the next boundary still waits for it.
- Keep genuine safety requirements: exact process ownership, valid native turn
  identity, live-terminal checks, timeout, usage completion and checkpoint lease
  validation. Removing these would permit concurrent writes or stale ownership.
- A native queued follow-up may be acknowledged before its turn-start event. Source
  review found no existing queue-drain barrier in terminal listing, thread reading
  or the separate user-submission queue API. Record the limitation rather than add
  sleeps, infer follow-up semantics from provider text, or reject communication.
  This is a residual native ordering gap, not the diagnosed checkpoint rejection.
- Local deep review included one independent read-only native lifecycle review.
  No production data was copied into the plan, tests or review materials.

## Proof

- Passed native event/process tests after the simplification: 94 tests.
- Coverage includes reordered advisory metadata, malformed native turn identity,
  sibling and later-root lifecycle, follow-up starts during terminal RPCs,
  cancellation during pending usage, stale completion and unfinished-child timeout.
- Passed package typecheck, complexity, privacy and parent candidate diff review.
  Production diff removes 82 net lines; lifecycle checks stay below the threshold.
- PR #3651 is open. Its complete Assistant Engine CI coverage and both required
  CLI host checks passed at the initial candidate. Final exact-head CI is pending.
- Initial review attempts did not send: one lane could not select the model and
  another kept Send disabled after attachment staging. No substantive review
  exists for the initial candidate; preserve this attempt history when retrying.
- CI exposed two unchanged proof bugs: case-sensitive apt dump validation rejects
  a correctly loaded timeout, and a fixed July sleep fixture expires against the
  real clock. Remove the redundant apt guard and fix only that test's Date clock.
  Isolated Ubuntu proof preserves the 180-second apt timeout and Playwright exit
  status; four installer tests, 36 route tests and Web typecheck pass.
- A Google font-loader CI failure did not reproduce with any of the three actual
  configured loaders. Leave font behavior intact and rerun on the next candidate.
- Public-safe Frog entries record the apt and fixture-clock causes. Final
  ReviewGPT and current-base mergeability are pending.
- No live model call is required: native lifecycle consumption changes; model
  instructions, tools, inference and provider-visible input do not.

## Deployment

Runner-only code update. No persisted schema or protocol producer changes. Old
runners retain the old rejection behavior; ordinary replacement adopts the fix.
No migration or rollback floor. Reverting reintroduces the original rejection.
Production deployment is outside the current request.
