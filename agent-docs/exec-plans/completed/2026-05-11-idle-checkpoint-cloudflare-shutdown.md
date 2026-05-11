# Idle Checkpoint Cloudflare Shutdown Ownership

## Goal

Let Cloudflare/container lifecycle own normal warm runner teardown after an
idle-shutdown checkpoint. Idle checkpoint remains warm-only best-effort
workspace compaction and must not force a container destroy on the quiet success
path.

Success means:

- quiet committed idle-shutdown checkpoint cleanup clears runner checkpoint
  scheduling state without calling the runner container destroy API;
- pending foreground work still preempts or preserves foreground recovery;
- explicit destroy remains available for deletion, failed/ambiguous state,
  smoke cleanup, and security/recovery paths;
- architecture/runtime docs and focused Cloudflare tests match the behavior.

## Constraints

- Preserve the Cloudflare thin-runner boundary and web-owned checkpoint fences.
- Do not weaken foreground reply priority or pending-work recovery.
- Do not touch unrelated active ledger rows or dirty CLI work.
- No secrets, direct personal identifiers, raw payloads, or local paths in docs
  or logs.

## Current Evidence

- `apps/cloudflare/src/user-runner.ts` currently calls
  `destroyRunnerContainerAfterIdleCheckpointBestEffort` after quiet idle
  checkpoint cleanup.
- `apps/cloudflare/src/runner-container.ts` already has `sleepAfter` plus
  activity-expiry fallback cleanup for natural container lifecycle teardown.
- `apps/cloudflare/test/user-runner-alarm.test.ts` currently pins the old
  quiet-success destroy behavior.

## Plan

1. Remove the normal successful idle-checkpoint destroy step from
   `UserRunner.finishIdleShutdownCheckpoint`.
2. Update focused tests to assert no destroy attempt and a clear
   no-container-destroy log.
3. Update durable hosted runtime docs and runtime verification notes to state
   that idle checkpoint does not force teardown.
4. Run focused Cloudflare tests plus required typecheck/verification according
   to the task scope, then run required completion audits.

## Verification Target

- Focused Cloudflare runner alarm test(s) for quiet idle checkpoint cleanup.
- `pnpm test:diff` scoped to the touched Cloudflare/runtime docs where
  truthful.
- Broader required verification if scoped verification is not sufficient.

## Result

- Removed normal post-idle-checkpoint container destroy from
  `HostedUserRunner.finishIdleShutdownCheckpoint`.
- Updated Cloudflare runner tests and hosted-local continuity E2Es to wait for
  the no-container-destroy checkpoint cleanup log instead of a destroy-confirmed
  log.
- Updated hosted runtime docs to document idle checkpoint as warm-only
  best-effort compaction that does not force teardown.
- Preserved explicit destroy paths for deletion, failed/stale/ambiguous warm
  state, deploy smoke, warm health failure, and activity-expiry cleanup.

## Verification

- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts -t "leaves warm container teardown to Cloudflare after quiet idle-checkpoint cleanup" --no-coverage`
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage`
- PASS: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts apps/cloudflare/README.md ARCHITECTURE.md agent-docs/references/hosted-runtime-protocol.md agent-docs/operations/verification-and-runtime.md agent-docs/exec-plans/active/2026-05-11-idle-checkpoint-cloudflare-shutdown.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: `pnpm docs:drift` after updating `agent-docs/index.md`.
- PASS: reran `bash scripts/workspace-verify.sh test:diff ...` with
  `agent-docs/index.md` included.
- PASS: scoped `git diff --check`.

## Audits

- PASS: `security-privacy-review` reported no findings. Residual risk is live
  Cloudflare-managed container expiry behavior after deploy.
- PASS: `task-finish-review` reported no high/medium findings. Its low finding
  was that `agent-docs/index.md` needed to be included in scoped verification;
  the diff-aware lane was rerun with that file included.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
